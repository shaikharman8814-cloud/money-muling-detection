# Money Laundering Network Detector (Hackathon Demo)

Full-stack demo app for spotting suspicious transaction behavior from CSV files.

## Features

- Upload a CSV file with columns: `sender`, `receiver`, `amount`, `timestamp`
- Backend builds a directed transaction graph and scores each account by:
  - High transaction count
  - Rapid incoming -> outgoing transfers
  - Circular fund flows
  - Abnormal total volume
- Frontend shows:
  - Interactive network graph
  - Suspicious accounts highlighted in red
  - Risk table with reasons
  - Download JSON with suspicious accounts

## Tech

- Backend: Python + Flask
- Frontend: HTML/CSS/Vanilla JS
- Visualization: vis-network (CDN)

## Run

```bash
cd "/Users/shaikharman/Documents/New project"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

Use `sample_transactions.csv` for a quick demo.
