# FinPad

个人财务控制台 — 自托管、可视化、AI 分析

## Quick Start

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs: http://localhost:8000/api/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Web UI: http://localhost:3000

## Default Login

- Username: `admin`
- Password: `finpad2026`
