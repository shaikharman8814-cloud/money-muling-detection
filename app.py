from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean, pstdev
from time import perf_counter

from flask import Flask, jsonify, render_template, request, send_file

app = Flask(__name__)


REQUIRED_COLUMNS = {"sender", "receiver", "amount", "timestamp"}


class Transaction:
    def __init__(self, sender: str, receiver: str, amount: float, timestamp: datetime):
        self.sender = sender
        self.receiver = receiver
        self.amount = amount
        self.timestamp = timestamp



def parse_timestamp(raw_ts: str) -> datetime:
    raw_ts = raw_ts.strip()
    # Accept common hackathon-friendly formats
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(raw_ts, fmt)
        except ValueError:
            continue

    try:
        # Best effort for ISO timestamps with timezone variants
        return datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"Unsupported timestamp format: {raw_ts}") from exc



def parse_csv(file_storage) -> list[Transaction]:
    text = file_storage.read().decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise ValueError("CSV appears empty or missing header row.")

    normalized = {name.strip().lower() for name in reader.fieldnames if name}
    if not REQUIRED_COLUMNS.issubset(normalized):
        raise ValueError(
            "CSV must include columns: sender, receiver, amount, timestamp"
        )

    transactions: list[Transaction] = []
    for i, row in enumerate(reader, start=2):
        try:
            sender = (row.get("sender") or row.get("Sender") or "").strip()
            receiver = (row.get("receiver") or row.get("Receiver") or "").strip()
            amount_raw = row.get("amount") or row.get("Amount")
            ts_raw = row.get("timestamp") or row.get("Timestamp")

            if not sender or not receiver:
                raise ValueError("sender/receiver cannot be empty")

            amount = float(str(amount_raw).strip())
            if amount <= 0:
                raise ValueError("amount must be > 0")

            timestamp = parse_timestamp(str(ts_raw))
        except Exception as exc:
            raise ValueError(f"Invalid row {i}: {exc}") from exc

        transactions.append(Transaction(sender, receiver, amount, timestamp))

    if not transactions:
        raise ValueError("CSV has no transaction rows.")

    transactions.sort(key=lambda t: t.timestamp)
    return transactions



def detect_cycles(adjacency: dict[str, set[str]], max_depth: int = 4) -> set[str]:
    cycle_nodes: set[str] = set()

    def dfs(start: str, current: str, visited: list[str]):
        if len(visited) > max_depth:
            return

        for neighbor in adjacency.get(current, set()):
            if neighbor == start and len(visited) >= 2:
                cycle_nodes.update(visited)
                cycle_nodes.add(start)
                continue
            if neighbor in visited:
                continue
            dfs(start, neighbor, visited + [neighbor])

    for node in adjacency.keys():
        dfs(node, node, [node])

    return cycle_nodes



def detect_fraud_rings(
    transactions: list[Transaction],
    incoming_by_account: dict[str, list[Transaction]],
    outgoing_by_account: dict[str, list[Transaction]],
    account_scores: dict[str, int],
) -> list[dict]:
    rings: list[dict] = []
    seen_keys: set[tuple] = set()
    outgoing_map = {k: sorted(v, key=lambda t: t.timestamp) for k, v in outgoing_by_account.items()}

    # Pattern: A -> B -> C -> A cycle
    for tx1 in transactions:
        for tx2 in outgoing_map.get(tx1.receiver, []):
            if tx2.timestamp < tx1.timestamp:
                continue
            if tx2.timestamp - tx1.timestamp > timedelta(hours=6):
                break
            for tx3 in outgoing_map.get(tx2.receiver, []):
                if tx3.timestamp < tx2.timestamp:
                    continue
                if tx3.timestamp - tx2.timestamp > timedelta(hours=6):
                    break
                if tx3.receiver != tx1.sender:
                    continue
                members = sorted({tx1.sender, tx1.receiver, tx2.receiver})
                key = ("cycle", tuple(members))
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                rings.append({"pattern": "cycle", "members": members})

    # Pattern: fan-in / fan-out
    accounts = set(incoming_by_account.keys()) | set(outgoing_by_account.keys())
    for account in accounts:
        senders = {tx.sender for tx in incoming_by_account.get(account, [])}
        receivers = {tx.receiver for tx in outgoing_by_account.get(account, [])}
        if len(senders) >= 3 and len(receivers) >= 2:
            members = sorted(senders | receivers | {account})
            key = ("fan_in_out", tuple(members))
            if key not in seen_keys:
                seen_keys.add(key)
                rings.append({"pattern": "fan_in_out", "members": members})
        elif len(senders) >= 4:
            members = sorted(senders | {account})
            key = ("fan_in", tuple(members))
            if key not in seen_keys:
                seen_keys.add(key)
                rings.append({"pattern": "fan_in", "members": members})
        elif len(receivers) >= 4:
            members = sorted(receivers | {account})
            key = ("fan_out", tuple(members))
            if key not in seen_keys:
                seen_keys.add(key)
                rings.append({"pattern": "fan_out", "members": members})

    # Pattern: layered chain A -> B -> C -> D within short hops
    for tx1 in transactions:
        for tx2 in outgoing_map.get(tx1.receiver, []):
            if tx2.timestamp < tx1.timestamp:
                continue
            if tx2.timestamp - tx1.timestamp > timedelta(hours=2):
                break
            for tx3 in outgoing_map.get(tx2.receiver, []):
                if tx3.timestamp < tx2.timestamp:
                    continue
                if tx3.timestamp - tx2.timestamp > timedelta(hours=2):
                    break
                members = sorted({tx1.sender, tx1.receiver, tx2.receiver, tx3.receiver})
                if len(members) < 4:
                    continue
                key = ("layered_chain", tuple(members))
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                rings.append({"pattern": "layered_chain", "members": members})

    normalized: list[dict] = []
    for idx, ring in enumerate(rings, start=1):
        member_scores = [account_scores.get(member, 0) for member in ring["members"]]
        risk_score = min(100, int((sum(member_scores) / max(1, len(member_scores))) + 35))
        normalized.append(
            {
                "ring_id": f"R{idx}",
                "members": ring["members"],
                "pattern": ring["pattern"],
                "risk_score": risk_score,
            }
        )

    return normalized


def analyze_transactions(transactions: list[Transaction]) -> dict:
    account_stats = defaultdict(
        lambda: {
            "incoming": [],
            "outgoing": [],
            "all_tx": [],
            "tx_count": 0,
            "total_in": 0.0,
            "total_out": 0.0,
            "rapid_transfers": 0,
            "burst_detected": False,
            "fast_chain": False,
            "reasons": [],
            "score": 0,
        }
    )

    incoming_by_account: dict[str, list[Transaction]] = defaultdict(list)
    outgoing_by_account: dict[str, list[Transaction]] = defaultdict(list)
    adjacency: dict[str, set[str]] = defaultdict(set)

    edges = []
    for tx in transactions:
        account_stats[tx.sender]["outgoing"].append(tx)
        account_stats[tx.sender]["all_tx"].append(tx)
        account_stats[tx.sender]["tx_count"] += 1
        account_stats[tx.sender]["total_out"] += tx.amount

        account_stats[tx.receiver]["incoming"].append(tx)
        account_stats[tx.receiver]["all_tx"].append(tx)
        account_stats[tx.receiver]["tx_count"] += 1
        account_stats[tx.receiver]["total_in"] += tx.amount

        incoming_by_account[tx.receiver].append(tx)
        outgoing_by_account[tx.sender].append(tx)
        adjacency[tx.sender].add(tx.receiver)

        edges.append(
            {
                "from": tx.sender,
                "to": tx.receiver,
                "amount": round(tx.amount, 2),
                "timestamp": tx.timestamp.isoformat(),
            }
        )

    # Timing rule 1: rapid pass-through transfer.
    for account in account_stats.keys():
        incoming_sorted = sorted(incoming_by_account.get(account, []), key=lambda t: t.timestamp)
        outgoing_sorted = sorted(outgoing_by_account.get(account, []), key=lambda t: t.timestamp)

        j = 0
        for in_tx in incoming_sorted:
            while j < len(outgoing_sorted) and outgoing_sorted[j].timestamp < in_tx.timestamp:
                j += 1
            k = j
            while k < len(outgoing_sorted):
                delta = outgoing_sorted[k].timestamp - in_tx.timestamp
                if delta > timedelta(hours=2):
                    break
                account_stats[account]["rapid_transfers"] += 1
                break
                k += 1

    # Timing rule 2: many transfers within 72 hours.
    for account, st in account_stats.items():
        txs = sorted(st["all_tx"], key=lambda t: t.timestamp)
        left = 0
        for right in range(len(txs)):
            while txs[right].timestamp - txs[left].timestamp > timedelta(hours=72):
                left += 1
            if right - left + 1 >= 8:
                st["burst_detected"] = True
                break

    # Timing rule 3: fast multi-hop A->B->C->D where each hop happens within 2 hours.
    outgoing_sorted_map: dict[str, list[Transaction]] = {
        account: sorted(txs, key=lambda t: t.timestamp) for account, txs in outgoing_by_account.items()
    }
    for tx1 in transactions:
        second_hops = outgoing_sorted_map.get(tx1.receiver, [])
        for tx2 in second_hops:
            if tx2.timestamp < tx1.timestamp:
                continue
            if tx2.timestamp - tx1.timestamp > timedelta(hours=2):
                break

            third_hops = outgoing_sorted_map.get(tx2.receiver, [])
            for tx3 in third_hops:
                if tx3.timestamp < tx2.timestamp:
                    continue
                if tx3.timestamp - tx2.timestamp > timedelta(hours=2):
                    break

                chain_accounts = [tx1.sender, tx1.receiver, tx2.receiver, tx3.receiver]
                if len(set(chain_accounts)) < 4:
                    continue

                account_stats[tx1.receiver]["fast_chain"] = True
                account_stats[tx2.receiver]["fast_chain"] = True
                break

    tx_counts = [st["tx_count"] for st in account_stats.values()]
    volumes = [st["total_in"] + st["total_out"] for st in account_stats.values()]

    count_threshold = mean(tx_counts) + (pstdev(tx_counts) if len(tx_counts) > 1 else 0)
    volume_threshold = mean(volumes) + (pstdev(volumes) if len(volumes) > 1 else 0)

    cycle_accounts = detect_cycles(adjacency)
    timing_alert_accounts = set()

    suspicious_accounts = []
    account_details = []
    nodes = []
    for account, st in account_stats.items():
        score = 0
        reasons = []
        total_volume = st["total_in"] + st["total_out"]

        if st["tx_count"] >= max(8, count_threshold):
            score += 25
            reasons.append("High transaction count")

        if account in cycle_accounts:
            score += 30
            reasons.append("Circular fund flow detected")

        if total_volume >= max(5000, volume_threshold):
            score += 20
            reasons.append("Abnormal total transaction volume")

        st["score"] = score
        st["reasons"] = reasons
        timing_flags = {
            "rapidTransfers": st["rapid_transfers"],
            "burstDetected": st["burst_detected"],
            "fastChain": st["fast_chain"],
        }
        has_timing_alert = (
            timing_flags["rapidTransfers"] > 0
            or timing_flags["burstDetected"]
            or timing_flags["fastChain"]
        )
        if has_timing_alert:
            timing_alert_accounts.add(account)
            reasons.append("Timing anomaly detected")

        node_color = "#d62828" if score >= 40 else "#f59e0b" if has_timing_alert else "#3a86ff"

        nodes.append(
            {
                "id": account,
                "label": account,
                "score": score,
                "color": node_color,
                "totalVolume": round(total_volume, 2),
                "timingAlert": has_timing_alert,
            }
        )

        account_details.append(
            {
                "account": account,
                "score": score,
                "reasons": reasons,
                "transactionCount": st["tx_count"],
                "totalVolume": round(total_volume, 2),
                "timingFlags": timing_flags,
            }
        )

        if score >= 40:
            suspicious_accounts.append(
                {
                    "account": account,
                    "score": score,
                    "reasons": reasons,
                    "transactionCount": st["tx_count"],
                    "totalVolume": round(total_volume, 2),
                    "timingFlags": timing_flags,
                }
            )

    suspicious_accounts.sort(key=lambda x: x["score"], reverse=True)
    account_details.sort(key=lambda x: x["score"], reverse=True)

    account_scores = {account: st["score"] for account, st in account_stats.items()}
    rings = detect_fraud_rings(transactions, incoming_by_account, outgoing_by_account, account_scores)
    ring_members = {member for ring in rings for member in ring["members"]}

    for node in nodes:
        node["ringMember"] = node["id"] in ring_members

    # Backward compatible alias used by existing frontend.
    fraud_rings = [
        {
            "ringType": ring["pattern"],
            "accounts": ring["members"],
            "indicator": f"Pattern: {ring['pattern']}",
            "riskScore": ring["risk_score"],
            "ringId": ring["ring_id"],
        }
        for ring in rings
    ]

    return {
        "summary": {
            "totalTransactions": len(transactions),
            "totalAccounts": len(account_stats),
            "suspiciousCount": len(suspicious_accounts),
        },
        "suspiciousAccounts": suspicious_accounts,
        "accountDetails": account_details,
        "rings": rings,
        "fraudRings": fraud_rings,
        "graph": {
            "nodes": nodes,
            "edges": edges,
        },
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze_csv():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Please upload a CSV file"}), 400

    try:
        start = perf_counter()
        transactions = parse_csv(file)
        result = analyze_transactions(transactions)
        result.setdefault("summary", {})["processingTimeSec"] = round(perf_counter() - start, 4)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Server error: {exc}"}), 500


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/sample-dataset")
def sample_dataset():
    sample_path = Path(__file__).resolve().parent / "sample_transactions.csv"
    return send_file(sample_path, mimetype="text/csv")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
