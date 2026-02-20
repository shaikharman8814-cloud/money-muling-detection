const fileInput = document.getElementById("fileInput");
const sampleBtn = document.getElementById("sampleBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeSpinner = document.getElementById("analyzeSpinner");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");
const summaryPanel = document.getElementById("summaryPanel");
const tableBody = document.querySelector("#resultsTable tbody");
const ringsTableBody = document.querySelector("#ringsTable tbody");
const graphEl = document.getElementById("graph");
const graphPanel = document.querySelector(".graph-panel");
const graphStateBadge = document.getElementById("graphStateBadge");
const uploadRow = document.querySelector(".upload-row");
const centerGraphBtn = document.getElementById("centerGraphBtn");
const pauseGraphBtn = document.getElementById("pauseGraphBtn");
const explainNetworkToggle = document.getElementById("explainNetworkToggle");
const explainModeToggle = document.getElementById("explainModeToggle");
const explainText = document.getElementById("explainText");
const analysisProgress = document.getElementById("analysisProgress");
const analysisProgressBar = document.getElementById("analysisProgressBar");
const insightCard = document.getElementById("insightCard");
const insightTextBody = document.getElementById("insightTextBody");
const insightList = document.getElementById("insightList");
const networkInsights = document.getElementById("networkInsights");
const riskBreakdownTitle = document.getElementById("riskBreakdownTitle");
const riskBreakdownList = document.getElementById("riskBreakdownList");
const riskBreakdownTotal = document.getElementById("riskBreakdownTotal");
const successToast = document.getElementById("successToast");

let latestResult = null;
let network = null;
let currentTheme = localStorage.getItem("ml-theme") || "dark";
let activeFile = null;
let lockTimer = null;
let animationPaused = true;
let centerGraphFn = null;
let storyTimer = null;
let storyIndex = 0;
let focusSuspiciousFn = null;

document.body.setAttribute("data-theme", currentTheme);

const themeToggleBtn = document.createElement("button");
themeToggleBtn.id = "themeToggleBtn";
themeToggleBtn.className = "btn theme-toggle";
themeToggleBtn.type = "button";
themeToggleBtn.textContent = currentTheme === "dark" ? "Light Mode" : "Dark Mode";
uploadRow.appendChild(themeToggleBtn);
centerGraphBtn.disabled = true;
pauseGraphBtn.disabled = true;

const nodeTooltip = document.createElement("div");
nodeTooltip.className = "node-tooltip";
nodeTooltip.hidden = true;
graphEl.parentElement.appendChild(nodeTooltip);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#d62828" : "";
}

function setLoading(isLoading) {
  statusEl.classList.toggle("loading", isLoading);
  if (analyzeSpinner) {
    analyzeSpinner.classList.toggle("is-visible", isLoading);
  }
  if (analysisProgress) {
    analysisProgress.classList.toggle("active", isLoading);
    analysisProgress.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }
  if (analysisProgressBar && !isLoading) {
    analysisProgressBar.style.width = "100%";
  }
  sampleBtn.disabled = isLoading;
  analyzeBtn.disabled = isLoading;
  downloadBtn.disabled = isLoading || !latestResult;
  centerGraphBtn.disabled = isLoading || !network;
  pauseGraphBtn.disabled = isLoading || !network;
}

function setGraphStateBadge(stabilized) {
  if (!graphStateBadge) return;
  graphStateBadge.textContent = stabilized ? "Graph stabilized" : "Physics enabled";
  graphStateBadge.classList.toggle("stabilized", stabilized);
}

function syncActiveFileFromInput() {
  activeFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  if (activeFile) {
    setStatus("Dataset ready");
  } else {
    setStatus("Waiting for file...");
  }
}

function getActiveFile() {
  return (fileInput.files && fileInput.files[0]) || activeFile;
}

function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.body.setAttribute("data-theme", currentTheme);
  localStorage.setItem("ml-theme", currentTheme);
  themeToggleBtn.textContent = currentTheme === "dark" ? "Light Mode" : "Dark Mode";
  if (latestResult?.graph) {
    renderGraph(latestResult.graph);
  }
}

function renderSummary(summary) {
  if (!summary) {
    summaryPanel.innerHTML = "";
    return;
  }

  const suspicious = latestResult?.suspiciousAccounts || [];
  const avgRisk = suspicious.length
    ? suspicious.reduce((sum, item) => sum + item.score, 0) / suspicious.length
    : 0;
  const networkRiskValue = suspicious.length * 15 + avgRisk;
  const riskLevel = networkRiskValue >= 60 ? "HIGH" : networkRiskValue >= 30 ? "MEDIUM" : "LOW";

  summaryPanel.innerHTML = [
    { label: "Total Transactions", value: summary.totalTransactions, icon: "TX" },
    { label: "Suspicious Accounts", value: summary.suspiciousCount, icon: "RS" },
    { label: "Overall Network Risk", value: riskLevel, icon: "NR" },
  ]
    .map(
      ({ label, value, icon }) => `
      <div class="metric">
        <div class="metric-head">
          <span class="metric-icon">${icon}</span>
          <div class="label">${label}</div>
        </div>
        <div class="value">${value}</div>
      </div>`
    )
    .join("");
  animateMetricValues(summaryPanel, 850);
}

function animateMetricValues(root, duration = 700) {
  const nodes = root.querySelectorAll(".metric .value");
  for (const el of nodes) {
    const raw = el.textContent.trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) continue;
    const target = Number(raw) || 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) * (1 - t);
      el.textContent = `${Math.round(target * eased)}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    el.textContent = "0";
    requestAnimationFrame(tick);
  }
}

function renderNetworkInsights(payload) {
  networkInsights.innerHTML = "";
}

function renderTable(accounts) {
  tableBody.innerHTML = "";

  if (!accounts.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No suspicious accounts found in this dataset.</td></tr>';
    return;
  }

  for (const acc of accounts) {
    const tr = document.createElement("tr");
    const isHighRisk = acc.score >= 40;
    const hasTimingAlert =
      (acc.timingFlags?.rapidTransfers || 0) > 0 ||
      !!acc.timingFlags?.burstDetected ||
      !!acc.timingFlags?.fastChain;
    tr.className = `suspicious-row ${isHighRisk ? "high-risk-row" : ""} ${
      hasTimingAlert ? "timing-alert-row" : ""
    }`.trim();
    const badgeClass = isHighRisk ? "high" : hasTimingAlert ? "timing" : "default";
    const riskSignals = acc.reasons?.length
      ? `<ul class="risk-signals">${acc.reasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>`
      : '<span class="muted-cell">No signals</span>';
    tr.innerHTML = `
      <td class="high-risk">${acc.account}</td>
      <td><span class="risk-badge ${badgeClass}">${acc.score}</span></td>
      <td>${riskSignals}</td>
      <td>${acc.transactionCount}</td>
      <td>${acc.totalVolume.toLocaleString()}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function renderFraudRings(rings) {
  ringsTableBody.innerHTML = "";

  if (!rings?.length) {
    ringsTableBody.innerHTML = '<tr><td colspan="4">No fraud rings detected in this dataset.</td></tr>';
    return;
  }

  for (const ring of rings) {
    const row = document.createElement("tr");
    const members = Array.isArray(ring.members)
      ? ring.members.join(", ")
      : Array.isArray(ring.accounts)
      ? ring.accounts.join(", ")
      : String(ring.accounts || "");
    const ringId = ring.ring_id || ring.ringId || "-";
    const pattern = ring.pattern || ring.ringType || "-";
    const riskScore = ring.risk_score ?? ring.riskScore ?? "-";
    row.innerHTML = `
      <td>${ringId}</td>
      <td>${pattern}</td>
      <td>${members}</td>
      <td>${riskScore}</td>
    `;
    ringsTableBody.appendChild(row);
  }
}

function renderGraph(graph) {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }

  const styles = getComputedStyle(document.body);
  const nodeFontColor = styles.getPropertyValue("--graph-node-font").trim();
  const primaryColor = styles.getPropertyValue("--primary").trim();
  const edgeColor = currentTheme === "dark" ? "#5f7bab" : "#8fa6ce";
  const riskyColor = currentTheme === "dark" ? "#ef4444" : "#d62828";
  const timingColor = "#f59e0b";
  const riskyShadow = currentTheme === "dark";
  const accountDetailByAccount = new Map(
    (latestResult?.accountDetails || []).map((entry) => [entry.account, entry])
  );
  const showEdgeLabels = graph.edges.length <= 90;
  const baseNodeSizeById = new Map(graph.nodes.map((n) => [String(n.id), n.score >= 40 ? 22 : 14]));
  let hoveredNodeId = null;

  const nodes = new vis.DataSet(
    graph.nodes.map((node) => {
      const baseColor = node.score >= 40 ? riskyColor : node.timingAlert ? timingColor : node.color;
      return {
        id: node.id,
        label: node.label,
        color: node.ringMember
          ? {
              background: baseColor,
              border: "#a855f7",
              highlight: { background: baseColor, border: "#c084fc" },
            }
          : baseColor,
        borderWidth: node.ringMember ? 3 : 1,
        borderWidthSelected: node.ringMember ? 4 : 2,
        chosen: node.ringMember ? { node: true } : true,
        title: `Risk: ${node.score} | Volume: ${node.totalVolume}`,
        shape: "circle",
        size: node.score >= 40 ? 22 : 14,
        font: { color: nodeFontColor },
        mass: 1.2,
        shadow:
          node.score >= 40 && riskyShadow
            ? { enabled: true, color: "rgba(239, 68, 68, 0.58)", size: 13, x: 0, y: 0 }
            : false,
      };
    })
  );

  const edges = new vis.DataSet(
    graph.edges.map((edge, idx) => ({
      id: idx,
      from: edge.from,
      to: edge.to,
      arrows: "to",
      label: showEdgeLabels ? `${edge.amount}` : "",
      font: { align: "middle", size: 10 },
      color: { color: edgeColor, highlight: primaryColor },
      title: `Amount: ${edge.amount} | Time: ${edge.timestamp}`,
      smooth: false,
    }))
  );

  const options = {
    layout: {
      randomSeed: 7,
      improvedLayout: true,
    },
    physics: {
      enabled: true,
      solver: "barnesHut",
      barnesHut: {
        gravitationalConstant: -900,
        springLength: 140,
        springConstant: 0.01,
        damping: 0.12,
        avoidOverlap: 0.7,
      },
      stabilization: { enabled: true, iterations: 140, fit: false },
      minVelocity: 0.62,
    },
    interaction: {
      hover: true,
      tooltipDelay: 90,
      zoomSpeed: 0.2,
      hideEdgesOnDrag: true,
      hideNodesOnDrag: true,
    },
    edges: {
      width: 1.8,
    },
  };

  network = new vis.Network(graphEl, { nodes, edges }, options);
  setGraphStateBadge(false);
  const baseNodeStyle = new Map(nodes.get().map((n) => [String(n.id), { ...n }]));
  const baseEdgeStyle = new Map(edges.get().map((e) => [String(e.id), { ...e }]));
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 1.5;
  animationPaused = false;
  pauseGraphBtn.textContent = "Pause Physics";

  const fitGraph = () => {
    if (!network) return;
    network.fit({ animation: false, padding: { top: 56, right: 56, bottom: 56, left: 56 } });
    const clampedScale = Math.max(MIN_SCALE, Math.min(network.getScale(), MAX_SCALE));
    network.moveTo({
      position: network.getViewPosition(),
      scale: clampedScale,
      animation: false,
    });
  };

  const resetGraphFocus = () => {
    nodes.update(Array.from(baseNodeStyle.values()));
    edges.update(Array.from(baseEdgeStyle.values()));
  };

  const highlightSuspiciousPath = (accountId) => {
    const relatedEdgeIds = new Set();
    const pathEdgeIds = new Set();
    const relatedNodes = new Set([accountId]);

    for (const edge of graph.edges) {
      if (String(edge.from) === accountId || String(edge.to) === accountId) {
        relatedEdgeIds.add(String(edge.id ?? graph.edges.indexOf(edge)));
        relatedNodes.add(String(edge.from));
        relatedNodes.add(String(edge.to));
      }
    }

    // Simple main path: account -> n1 -> n2 and close loop if possible.
    const first = graph.edges.find((e) => String(e.from) === accountId);
    if (first) {
      const second = graph.edges.find((e) => String(e.from) === String(first.to));
      if (second) {
        const third =
          graph.edges.find((e) => String(e.from) === String(second.to) && String(e.to) === accountId) ||
          graph.edges.find((e) => String(e.from) === String(second.to));
        pathEdgeIds.add(String(graph.edges.indexOf(first)));
        pathEdgeIds.add(String(graph.edges.indexOf(second)));
        if (third) pathEdgeIds.add(String(graph.edges.indexOf(third)));
      }
    }

    const nodeUpdates = [];
    for (const [id, base] of baseNodeStyle.entries()) {
      if (relatedNodes.has(id)) {
        nodeUpdates.push({ id, ...base, hidden: false });
      } else {
        nodeUpdates.push({
          id,
          color: { background: "rgba(71,85,105,0.25)", border: "rgba(71,85,105,0.3)" },
          font: { color: "rgba(148,163,184,0.45)" },
          shadow: false,
        });
      }
    }
    nodes.update(nodeUpdates);

    const edgeUpdates = [];
    for (const [id, base] of baseEdgeStyle.entries()) {
      if (relatedEdgeIds.has(id)) {
        edgeUpdates.push({
          id,
          ...base,
          width: 2.4,
          color: { color: "#38bdf8", highlight: "#0ea5e9", opacity: 0.95 },
        });
      } else {
        edgeUpdates.push({
          id,
          ...base,
          width: 0.7,
          color: { color: "rgba(100,116,139,0.2)", highlight: "rgba(100,116,139,0.2)" },
        });
      }
    }
    edges.update(edgeUpdates);

    // Brief path animation pulse.
    if (pathEdgeIds.size) {
      const pulse = [];
      for (const id of pathEdgeIds) {
        const edge = baseEdgeStyle.get(id);
        if (!edge) continue;
        pulse.push({ id, ...edge, width: 3.1, dashes: [6, 4], color: { color: "#f97316", highlight: "#fb923c" } });
      }
      edges.update(pulse);
      setTimeout(() => {
        const unpulse = [];
        for (const id of pathEdgeIds) {
          const edge = baseEdgeStyle.get(id);
          if (!edge) continue;
          unpulse.push({ id, ...edge, width: 2.4, dashes: false, color: { color: "#38bdf8", highlight: "#0ea5e9" } });
        }
        edges.update(unpulse);
      }, 900);
    }
  };

  // Keep first render stable and centered.
  network.once("stabilizationIterationsDone", () => {
    network.setOptions({ physics: { enabled: false } });
    animationPaused = true;
    pauseGraphBtn.textContent = "Resume Animation";
    setGraphStateBadge(true);
    fitGraph();
  });

  // Hard lock positions for demo stability after short settle time.
  lockTimer = setTimeout(() => {
    if (!network) return;
    const positions = network.getPositions();
    const lockedNodes = Object.keys(positions).map((id) => ({
      id,
      x: positions[id].x,
      y: positions[id].y,
      fixed: { x: true, y: true },
    }));
    nodes.update(lockedNodes);
    network.setOptions({ physics: { enabled: false } });
    animationPaused = true;
    pauseGraphBtn.textContent = "Resume Animation";
    setGraphStateBadge(true);
    fitGraph();
  }, 2000);

  network.on("dragStart", () => {
    if (network) network.setOptions({ physics: { enabled: false } });
    animationPaused = true;
    pauseGraphBtn.textContent = "Resume Animation";
    setGraphStateBadge(true);
    nodeTooltip.hidden = true;
  });

  // Clamp zoom aggressively for demo stability.
  network.on("zoom", () => {
    if (!network) return;
    const current = network.getScale();
    const clamped = Math.max(MIN_SCALE, Math.min(current, MAX_SCALE));
    if (Math.abs(clamped - current) > 0.001) {
      network.moveTo({ scale: clamped, animation: false });
    }
  });

  // Stop residual momentum after drag actions.
  network.on("dragEnd", () => {
    if (network) network.stopSimulation();
  });

  const showNodeTooltip = (account, pointer = null) => {
    const data = graph.nodes.find((n) => String(n.id) === account);
    if (!data) {
      nodeTooltip.hidden = true;
      return;
    }
    const suspicious = accountDetailByAccount.get(account);
    const reasonItems = suspicious?.reasons?.length
      ? suspicious.reasons.map((reason) => `<li>${reason}</li>`).join("")
      : "<li>No suspicious reason recorded</li>";

    nodeTooltip.innerHTML = `
      <div><strong>Account ID:</strong> ${account}</div>
      <div><strong>Risk Score:</strong> ${data.score}</div>
      <div><strong>Transaction Count:</strong> ${suspicious?.transactionCount ?? "-"}</div>
      <div><strong>Total Volume:</strong> ${suspicious?.totalVolume?.toLocaleString?.() ?? "-"}</div>
      <div><strong>Reasons:</strong></div>
      <ul class="tooltip-reasons">${reasonItems}</ul>
    `;

    if (pointer?.x != null && pointer?.y != null) {
      nodeTooltip.style.left = `${Math.min(Math.max(pointer.x + 14, 12), graphEl.clientWidth - 260)}px`;
      nodeTooltip.style.top = `${Math.min(Math.max(pointer.y + 12, 12), graphEl.clientHeight - 86)}px`;
      nodeTooltip.style.right = "auto";
    } else {
      nodeTooltip.style.left = "";
      nodeTooltip.style.top = "";
      nodeTooltip.style.right = "18px";
    }
    nodeTooltip.hidden = false;
  };

  network.on("hoverNode", (params) => {
    hoveredNodeId = String(params.node);
    showNodeTooltip(String(params.node), params.pointer?.DOM);
  });

  network.on("blurNode", () => {
    const hoveredId = hoveredNodeId;
    if (hoveredId != null) nodes.update({ id: hoveredId, size: baseNodeSizeById.get(String(hoveredId)) || 14 });
    hoveredNodeId = null;
    nodeTooltip.hidden = true;
  });

  network.on("click", (params) => {
    if (!params.nodes.length) {
      nodeTooltip.hidden = true;
      renderInsight(null);
      renderRiskBreakdown(null);
      resetGraphFocus();
      return;
    }
    const selectedId = String(params.nodes[0]);
    const selectedInfo = accountDetailByAccount.get(selectedId);
    renderInsight(selectedId, accountDetailByAccount);
    if ((selectedInfo?.score || 0) >= 40) {
      renderRiskBreakdown(selectedId, accountDetailByAccount);
      highlightSuspiciousPath(selectedId);
    } else {
      renderRiskBreakdown(null);
      resetGraphFocus();
    }
  });

  focusSuspiciousFn = (accountId, storyText = null) => {
    highlightSuspiciousPath(accountId);
    network.focus(accountId, { animation: { duration: 500, easingFunction: "easeInOutQuad" }, scale: 1.05 });
    if (storyText) {
      nodeTooltip.innerHTML = `<div>${storyText}</div>`;
      nodeTooltip.style.right = "18px";
      nodeTooltip.style.left = "";
      nodeTooltip.style.top = "90px";
      nodeTooltip.hidden = false;
    }
  };

  centerGraphFn = fitGraph;
}

function downloadSuspiciousJson() {
  if (!latestResult) return;
  const blob = new Blob([JSON.stringify(latestResult.suspiciousAccounts, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildReportFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function animateResults() {
  const targets = [summaryPanel, graphEl, document.getElementById("resultsTable"), document.getElementById("ringsTable")];
  for (const el of targets) {
    if (!el) continue;
    el.classList.remove("fade-in");
    void el.offsetWidth;
    el.classList.add("fade-in");
  }
}

function centerGraph() {
  if (centerGraphFn) centerGraphFn();
}

function toggleGraphAnimation() {
  if (!network) return;
  if (animationPaused) {
    network.setOptions({ physics: { enabled: true } });
    network.startSimulation();
    animationPaused = false;
    pauseGraphBtn.textContent = "Pause Physics";
    setGraphStateBadge(false);
  } else {
    network.setOptions({ physics: { enabled: false } });
    network.stopSimulation();
    animationPaused = true;
    pauseGraphBtn.textContent = "Resume Animation";
    setGraphStateBadge(true);
  }
}

function toggleExplainMode() {
  explainText.hidden = !explainModeToggle.checked;
}

function stopStoryMode() {
  if (storyTimer) {
    clearInterval(storyTimer);
    storyTimer = null;
  }
}

function toggleExplainNetworkMode() {
  stopStoryMode();
  if (!explainNetworkToggle.checked || !latestResult?.suspiciousAccounts?.length || !focusSuspiciousFn) {
    return;
  }

  const candidates = latestResult.suspiciousAccounts.map((a) => a.account);
  storyIndex = 0;
  const runStep = () => {
    const account = candidates[storyIndex % candidates.length];
    focusSuspiciousFn(account, "This account is part of a circular transfer loop.");
    storyIndex += 1;
  };
  runStep();
  storyTimer = setInterval(runStep, 2000);
}

function renderInsight(accountId, accountMap = null) {
  if (!insightCard) return;
  if (!accountId) {
    insightCard.hidden = true;
    insightTextBody.textContent = "Click a node to view a plain-language explanation.";
    insightList.innerHTML = "";
    return;
  }
  const map = accountMap || new Map((latestResult?.accountDetails || []).map((a) => [a.account, a]));
  const info = map.get(accountId);
  if (!info) {
    insightCard.hidden = false;
    insightTextBody.textContent = "No detailed explanation available for this account.";
    insightList.innerHTML = "";
    return;
  }

  insightCard.hidden = false;
  insightTextBody.textContent = "This account is flagged because:";
  const points = info.reasons?.length ? info.reasons : ["This account matches one or more risk signals."];
  insightList.innerHTML = points.map((p) => `<li>${p}</li>`).join("");
}

function renderRiskBreakdown(accountId, accountMap = null) {
  if (!riskBreakdownTitle || !riskBreakdownList || !riskBreakdownTotal) return;
  if (!accountId) {
    riskBreakdownTitle.textContent = "Risk Breakdown";
    riskBreakdownList.innerHTML = "<li>Select a suspicious account to view score composition.</li>";
    riskBreakdownTotal.textContent = "";
    return;
  }

  const map = accountMap || new Map((latestResult?.accountDetails || []).map((a) => [a.account, a]));
  const info = map.get(accountId);
  if (!info) return;

  const reasonPoints = {
    "High transaction count": 25,
    "Circular fund flow detected": 30,
    "Abnormal total transaction volume": 20,
    "Timing anomaly detected": 10,
  };

  const breakdownRows = (info.reasons || []).map((reason) => ({
    reason,
    points: reasonPoints[reason] ?? 0,
  }));

  riskBreakdownTitle.textContent = `Risk Breakdown for Account ${accountId}`;
  riskBreakdownList.innerHTML = breakdownRows.length
    ? breakdownRows.map((row) => `<li>${row.reason}: <strong>+${row.points}</strong></li>`).join("")
    : "<li>No scoring components available.</li>";
  riskBreakdownTotal.textContent = `Total score: ${info.score}`;

  const clusteringNote = buildTimestampAnomalyExplanation(accountId);
  if (clusteringNote) {
    const li = document.createElement("li");
    li.className = "timing-note";
    li.textContent = clusteringNote;
    riskBreakdownList.appendChild(li);
  }
}

function showSuccessToast(message) {
  successToast.textContent = message;
  successToast.hidden = false;
  successToast.classList.add("visible");
  setTimeout(() => {
    successToast.classList.remove("visible");
    successToast.hidden = true;
  }, 2600);
}

function buildReportFilename() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `fraud_report_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

function buildTimestampAnomalyExplanation(accountId) {
  if (!latestResult?.graph?.edges?.length) return "";
  const related = latestResult.graph.edges
    .filter((e) => e.from === accountId || e.to === accountId)
    .map((e) => ({ ...e, t: new Date(e.timestamp).getTime() }))
    .filter((e) => !Number.isNaN(e.t))
    .sort((a, b) => a.t - b.t);

  if (related.length < 3) return "";
  for (let i = 0; i <= related.length - 3; i += 1) {
    const mins = Math.round((related[i + 2].t - related[i].t) / 60000);
    if (mins <= 12 && mins >= 0) {
      const actors = new Set([
        related[i].from,
        related[i].to,
        related[i + 1].from,
        related[i + 1].to,
        related[i + 2].from,
        related[i + 2].to,
      ]);
      return `Transactions between ${Array.from(actors).slice(0, 3).join(", ")} occurred within ${mins} minutes - suspicious clustering.`;
    }
  }
  return "";
}

async function analyze() {
  const file = getActiveFile();
  if (!file) {
    setStatus("Please select a CSV file first.", true);
    return;
  }

  stopStoryMode();
  setStatus("Analyzing transaction network...");
  setLoading(true);
  if (analysisProgressBar) analysisProgressBar.style.width = "65%";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });
    const payload = await res.json();

    if (!res.ok) {
      throw new Error(payload.error || "Analysis failed");
    }

    latestResult = payload;
    renderSummary(payload.summary);
    renderTable(payload.suspiciousAccounts);
    renderFraudRings(payload.fraudRings);
    renderGraph(payload.graph);
    renderInsight(null);
    renderRiskBreakdown(null);
    renderNetworkInsights(payload);
    if (explainNetworkToggle.checked) {
      toggleExplainNetworkMode();
    }
    animateResults();

    if (analysisProgressBar) analysisProgressBar.style.width = "100%";
    const timing = payload.summary?.processingTimeSec;
    setStatus(
      typeof timing === "number"
        ? `Analysis complete • Processed in ${timing.toFixed(2)}s`
        : "Analysis complete",
    );
    showSuccessToast(`✔ Network analyzed successfully\n${payload.summary.suspiciousCount} suspicious accounts detected`);
    graphPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function useSampleDataset() {
  try {
    setStatus("Loading sample dataset...");
    setLoading(true);

    const res = await fetch("/static/sample_transactions.csv");
    if (!res.ok) {
      throw new Error("Unable to load sample dataset");
    }

    const blob = await res.blob();
    const sampleFile = new File([blob], "sample_transactions.csv", { type: "text/csv" });
    activeFile = sampleFile;
    setStatus("Dataset ready");

    // Try to mirror real upload input when browser allows programmatic assignment.
    if (typeof DataTransfer !== "undefined") {
      const transfer = new DataTransfer();
      transfer.items.add(sampleFile);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      syncActiveFileFromInput();
    }

    setLoading(false);
    await analyze();
  } catch (err) {
    setStatus(err.message || "Failed to use sample dataset", true);
    setLoading(false);
  }
}

fileInput.addEventListener("change", syncActiveFileFromInput);
analyzeBtn.addEventListener("click", analyze);
sampleBtn.addEventListener("click", useSampleDataset);
downloadBtn.addEventListener("click", downloadSuspiciousJson);
themeToggleBtn.addEventListener("click", toggleTheme);
centerGraphBtn.addEventListener("click", centerGraph);
pauseGraphBtn.addEventListener("click", toggleGraphAnimation);
explainModeToggle.addEventListener("change", toggleExplainMode);
explainNetworkToggle.addEventListener("change", toggleExplainNetworkMode);
