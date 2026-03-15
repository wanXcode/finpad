"""
FinPad Sync Engine
Adapted from personal-finance-automation auto_ingest_and_sync.py
Fetches bills from email IMAP, parses them, and writes to FinPad SQLite.
"""
import csv
import email
import hashlib
import imaplib
import json
import os
import re
import sqlite3
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from email.header import decode_header
from pathlib import Path
from zipfile import ZipFile
from zoneinfo import ZoneInfo

import requests

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # finpad/
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
STATE_FILE = DATA_DIR / "sync_state.json"
DB_PATH = DATA_DIR / "finpad.db"

# Parsers from old project
OLD_PROJECT = Path("/root/.openclaw/workspace/projects/personal-finance-automation")

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def decode_mime(s: str) -> str:
    if not s:
        return ""
    out = []
    for txt, enc in decode_header(s):
        if isinstance(txt, bytes):
            out.append(txt.decode(enc or "utf-8", errors="ignore"))
        else:
            out.append(txt)
    return "".join(out)


def safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name)[:180]


def tx_hash(prefix: str, raw: str) -> str:
    return prefix + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"processed_email_ids": []}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    state["processed_email_ids"] = state.get("processed_email_ids", [])[-500:]
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Parsers ──

def extract_wechat_link(msg) -> str | None:
    html = ""
    text = ""
    for part in msg.walk():
        ctype = part.get_content_type()
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        content = payload.decode(part.get_content_charset() or "utf-8", errors="ignore")
        if ctype == "text/html":
            html += content
        elif ctype == "text/plain":
            text += content
    merged = html + "\n" + text
    m = re.search(r"https://tenpay\.wechatpay\.cn/userroll/userbilldownload/downloadfilefromemail\?[^\"\s<]+", merged)
    return m.group(0) if m else None


def parse_alipay_csv(csv_file: Path):
    text = csv_file.read_bytes().decode("gb18030", errors="ignore").splitlines()
    header_idx = None
    for i, line in enumerate(text):
        if line.startswith("交易时间,交易分类,交易对方"):
            header_idx = i
            break
    if header_idx is None:
        return []

    def map_direction(v: str) -> str:
        v = (v or "").strip()
        if "支出" in v:
            return "支出"
        if "收入" in v:
            return "收入"
        return "不计收支"

    rows = []
    for r in csv.DictReader(text[header_idx:]):
        tx_time_raw = (r.get("交易时间") or "").strip()
        if not tx_time_raw:
            continue
        order_no = (r.get("交易订单号") or "").strip()
        txid = f"alipay_{order_no}" if order_no else tx_hash("alipay_", f"{tx_time_raw}|{r.get('金额', '')}|{r.get('交易对方', '')}|alipay")
        note = (r.get("商品说明") or "").strip()
        remark = (r.get("备注") or "").strip()
        if remark:
            note = f"{note} | 备注:{remark}" if note else f"备注:{remark}"
        rows.append({
            "tx_id": txid,
            "tx_time": tx_time_raw,
            "platform": "支付宝",
            "account": (r.get("收/付款方式") or "").strip(),
            "direction": map_direction(r.get("收/支", "")),
            "amount": float((r.get("金额") or "0").replace(",", "").strip() or 0),
            "category": (r.get("交易分类") or "其他").strip() or "其他",
            "counterparty": (r.get("交易对方") or "").strip(),
            "note": note,
        })
    return rows


def read_xlsx_rows(xlsx_path: Path) -> list[list[str]]:
    with ZipFile(xlsx_path) as z:
        sst = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("a:si", NS):
                sst.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        rid = wb.find("a:sheets", NS).findall("a:sheet", NS)[0].attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        ws = ET.fromstring(z.read("xl/" + rid_to_target[rid]))

        out = []
        for row in ws.findall(".//a:sheetData/a:row", NS):
            vals = []
            for c in row.findall("a:c", NS):
                t = c.attrib.get("t")
                v = c.find("a:v", NS)
                val = "" if v is None else (v.text or "")
                if t == "s" and val != "":
                    val = sst[int(val)]
                vals.append(val)
            out.append(vals)
        return out


def parse_wechat_xlsx(xlsx_file: Path):
    rows = read_xlsx_rows(xlsx_file)
    header_idx = None
    for i, r in enumerate(rows):
        if r and r[0] == "交易时间":
            header_idx = i
            break
    if header_idx is None:
        return []

    headers = rows[header_idx]
    out = []
    for r in rows[header_idx + 1:]:
        if not r:
            continue
        if len(r) < len(headers):
            r += [""] * (len(headers) - len(r))
        d = {headers[i]: r[i] for i in range(len(headers))}
        tx_time_raw = (d.get("交易时间") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", tx_time_raw):
            continue
        amt_raw = (d.get("金额(元)") or "").strip().replace("¥", "").replace(",", "")
        amount = float(amt_raw or 0)
        direction = "支出" if "支出" in (d.get("收/支") or "") else ("收入" if "收入" in (d.get("收/支") or "") else "不计收支")
        tx_no = (d.get("交易单号") or "").strip()
        note = (d.get("商品") or "").strip()
        status = (d.get("当前状态") or "").strip()
        if status:
            note = f"{note} | 状态:{status}" if note else f"状态:{status}"
        out.append({
            "tx_id": f"wechat_{tx_no}" if tx_no else tx_hash("wechat_", f"{tx_time_raw}|{amt_raw}|{d.get('交易对方', '')}|wechat"),
            "tx_time": tx_time_raw,
            "platform": "微信",
            "account": (d.get("支付方式") or "").strip(),
            "direction": direction,
            "amount": abs(amount),
            "category": (d.get("交易类型") or "其他").strip() or "其他",
            "counterparty": (d.get("交易对方") or "").strip(),
            "note": note,
        })
    return out


def unzip_first(zip_path: Path, out_dir: Path, pwd: str):
    out_dir.mkdir(parents=True, exist_ok=True)
    with ZipFile(zip_path) as z:
        if pwd:
            z.extractall(out_dir, pwd=pwd.encode("utf-8"))
        else:
            z.extractall(out_dir)
        names = z.namelist()
    return [out_dir / n for n in names]


def parse_cmb_pdf(pdf_path: Path, out_json: Path):
    cmd = ["node", str(OLD_PROJECT / "scripts/parse/parse_cmb_pdf.js"), str(pdf_path), str(out_json)]
    subprocess.run(cmd, check=True, cwd=str(OLD_PROJECT))


def parse_icbc_pdf(pdf_path: Path, out_json: Path):
    cmd = ["node", str(OLD_PROJECT / "scripts/parse/parse_icbc_pdf.js"), str(pdf_path), str(out_json)]
    subprocess.run(cmd, check=True, cwd=str(OLD_PROJECT))


# ── Database ──

def insert_transactions(rows: list[dict], user_id: int = 1, source: str = "email_sync") -> dict:
    conn = sqlite3.connect(str(DB_PATH))
    new_count = 0
    dup_count = 0
    batch = datetime.utcnow().strftime("sync_%Y%m%dT%H%M%SZ")

    for r in rows:
        try:
            tx_time = r.get("tx_time", "")
            # Handle ms timestamp from old format
            if isinstance(tx_time, (int, float)) and tx_time > 1e12:
                tx_time = datetime.fromtimestamp(tx_time / 1000).strftime("%Y-%m-%d %H:%M:%S")

            conn.execute(
                """INSERT OR IGNORE INTO transactions
                   (user_id, tx_id, tx_time, platform, account, direction, amount,
                    category, original_category, counterparty, note, source, ingest_batch)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    r["tx_id"],
                    tx_time,
                    r.get("platform", ""),
                    r.get("account", ""),
                    r.get("direction", "不计收支"),
                    float(r.get("amount", 0) or 0),
                    r.get("category", "其他"),
                    r.get("category", ""),
                    r.get("counterparty", ""),
                    r.get("note", ""),
                    source,
                    batch,
                ),
            )
            if conn.total_changes:
                new_count += 1
            else:
                dup_count += 1
        except Exception:
            dup_count += 1

    conn.commit()
    conn.close()
    return {"new": new_count, "duplicates": dup_count, "total": len(rows)}


def write_sync_log(data_source_id: int, status: str, total: int, new: int, dups: int, errors: int, error_msg: str | None):
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        """INSERT INTO sync_logs (data_source_id, status, total_fetched, new_inserted,
           duplicates_skipped, errors, error_message, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))""",
        (data_source_id, status, total, new, dups, errors, error_msg),
    )
    conn.execute("UPDATE data_sources SET last_sync_at = datetime('now') WHERE id = ?", (data_source_id,))
    conn.commit()
    conn.close()


# ── Main sync ──

def sync_from_email(config: dict, data_source_id: int = 0):
    """
    config = {
        "imap_host": "imap.126.com",
        "email": "user@126.com",
        "password": "xxx",
        "platform": "alipay",  # alipay/wechat/cmb/icbc
        "zip_password": "",
    }
    """
    imap_host = config.get("imap_host", "imap.126.com")
    imap_user = config["email"]
    imap_pass = config["password"]
    platform = config.get("platform", "alipay")
    zip_pwd = config.get("zip_password", "")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    state = load_state()
    seen = set(state.get("processed_email_ids", []))

    batch_id = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    batch_dir = RAW_DIR / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    # Platform-specific subject filter
    subject_filters = {
        "alipay": "支付宝",
        "wechat": "微信支付",
        "cmb": "招商银行",
        "icbc": "工商银行",
    }

    m = imaplib.IMAP4_SSL(imap_host, 993)
    m.login(imap_user, imap_pass)
    try:
        tag = m._new_tag()
        cmd = f'{tag} ID ("name" "finpad" "version" "1.0" "vendor" "finpad")\r\n'
        m.send(cmd.encode("utf-8"))
        m._get_tagged_response(tag)
    except Exception:
        pass
    m.select("INBOX")

    status, data = m.search(None, "ALL")
    ids = data[0].split()[-50:] if status == "OK" and data and data[0] else []

    all_rows = []
    errors = 0
    error_msg = None

    for eid in ids:
        eid_s = eid.decode()
        if eid_s in seen:
            continue

        st, msg_data = m.fetch(eid, "(RFC822)")
        if st != "OK":
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        subject = decode_mime(msg.get("Subject", ""))

        # Only process matching platform
        sf = subject_filters.get(platform, "")
        if sf not in subject:
            continue

        email_dir = batch_dir / eid_s
        email_dir.mkdir(parents=True, exist_ok=True)

        try:
            rows = []
            if platform == "wechat":
                url = extract_wechat_link(msg)
                if not url:
                    raise RuntimeError("No wechat download url found")
                zip_path = email_dir / "wechat_bill.zip"
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                zip_path.write_bytes(r.content)
                extracted = unzip_first(zip_path, email_dir / "unzipped", zip_pwd)
                xlsx = next((p for p in extracted if p.suffix.lower() == ".xlsx"), None)
                if not xlsx:
                    raise RuntimeError("No xlsx found in wechat zip")
                rows = parse_wechat_xlsx(xlsx)
            elif platform == "alipay":
                attachment_paths = _save_attachments(msg, email_dir)
                zip_file = next((p for p in attachment_paths if p.suffix.lower() == ".zip"), None)
                if not zip_file:
                    raise RuntimeError("No zip attachment for alipay")
                extracted = unzip_first(zip_file, email_dir / "unzipped", zip_pwd)
                csv_file = next((p for p in extracted if p.suffix.lower() == ".csv"), None)
                if not csv_file:
                    raise RuntimeError("No csv found in alipay zip")
                rows = parse_alipay_csv(csv_file)
            elif platform == "cmb":
                attachment_paths = _save_attachments(msg, email_dir)
                zip_file = next((p for p in attachment_paths if p.suffix.lower() == ".zip"), None)
                if not zip_file:
                    raise RuntimeError("No zip attachment for cmb")
                extracted = unzip_first(zip_file, email_dir / "unzipped", zip_pwd)
                pdf_file = next((p for p in extracted if p.suffix.lower() == ".pdf"), None)
                if not pdf_file:
                    raise RuntimeError("No pdf found in cmb zip")
                out_json = email_dir / "cmb.normalized.json"
                parse_cmb_pdf(pdf_file, out_json)
                rows = json.loads(out_json.read_text(encoding="utf-8"))
            elif platform == "icbc":
                attachment_paths = _save_attachments(msg, email_dir)
                pdf_file = next((p for p in attachment_paths if p.suffix.lower() == ".pdf"), None)
                if not pdf_file:
                    zip_file = next((p for p in attachment_paths if p.suffix.lower() == ".zip"), None)
                    if zip_file:
                        extracted = unzip_first(zip_file, email_dir / "unzipped", zip_pwd)
                        pdf_file = next((p for p in extracted if p.suffix.lower() == ".pdf"), None)
                if not pdf_file:
                    raise RuntimeError("No pdf found for icbc")
                out_json = email_dir / "icbc.normalized.json"
                parse_icbc_pdf(pdf_file, out_json)
                rows = json.loads(out_json.read_text(encoding="utf-8"))

            if rows:
                result = insert_transactions(rows, source=f"email_{platform}")
                all_rows.extend(rows)

            seen.add(eid_s)
        except Exception as e:
            errors += 1
            error_msg = str(e)
            (email_dir / "error.txt").write_text(str(e), encoding="utf-8")

    m.logout()

    state["processed_email_ids"] = sorted(seen, key=lambda x: int(x) if x.isdigit() else 0)
    save_state(state)

    new_count = 0
    dup_count = 0
    if all_rows:
        result = insert_transactions(all_rows, source=f"email_{platform}")
        new_count = result["new"]
        dup_count = result["duplicates"]

    if data_source_id:
        write_sync_log(
            data_source_id,
            "success" if errors == 0 else "partial",
            len(all_rows),
            new_count,
            dup_count,
            errors,
            error_msg,
        )

    return {
        "total_fetched": len(all_rows),
        "new_inserted": new_count,
        "duplicates_skipped": dup_count,
        "errors": errors,
        "error_message": error_msg,
    }


def _save_attachments(msg, email_dir: Path) -> list[Path]:
    paths = []
    for part in msg.walk():
        cdisp = str(part.get("Content-Disposition", ""))
        if "attachment" not in cdisp.lower():
            continue
        filename = safe_name(decode_mime(part.get_filename() or "attachment.bin"))
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        p = email_dir / filename
        p.write_bytes(payload)
        paths.append(p)
    return paths
