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

BASE_DIR = Path(__file__).resolve().parent.parent  # finpad/backend/
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PENDING_DIR = DATA_DIR / "pending"
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


# ── Encrypted ZIP detection & pending ──

def is_encrypted_zip(zip_path: Path) -> bool:
    """Check if a ZIP file is password-protected."""
    try:
        with ZipFile(zip_path) as z:
            for info in z.infolist():
                if info.flag_bits & 0x1:  # bit 0 = encrypted
                    return True
            # Try extracting to verify (some ZIPs don't set the flag correctly)
            try:
                z.testzip()
            except RuntimeError:
                return True
        return False
    except Exception:
        return False


def save_pending_import(data_source_id: int, user_id: int, email_uid: str,
                        subject: str, filename: str, zip_path: Path, platform: str) -> int:
    """Save an encrypted ZIP to pending dir and record in DB. Returns pending_import id."""
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    dest = PENDING_DIR / f"{data_source_id}_{email_uid}_{safe_name(filename)}"
    if not dest.exists():
        import shutil
        shutil.copy2(str(zip_path), str(dest))

    conn = sqlite3.connect(str(DB_PATH))
    try:
        # Check for duplicate
        cur = conn.execute(
            "SELECT id FROM pending_imports WHERE data_source_id = ? AND email_uid = ? AND filename = ?",
            (data_source_id, email_uid, filename)
        )
        existing = cur.fetchone()
        if existing:
            conn.close()
            return existing[0]

        cur = conn.execute(
            """INSERT INTO pending_imports (data_source_id, user_id, email_uid, subject, filename, raw_path, platform)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (data_source_id, user_id, email_uid, subject, filename, str(dest), platform)
        )
        conn.commit()
        pid = cur.lastrowid
    finally:
        conn.close()
    return pid


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
        """INSERT INTO sync_logs (data_source_id, status, records_total, records_created,
           records_skipped, error_message, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))""",
        (data_source_id, status, total, new, dups, error_msg),
    )
    conn.execute(
        "UPDATE data_sources SET last_sync_at = datetime('now'), last_sync_status = ?, last_sync_message = ? WHERE id = ?",
        (status, error_msg, data_source_id),
    )
    conn.commit()
    conn.close()


# ── Main sync ──

def _process_email_for_platform(platform: str, msg, eid_s: str, subject: str,
                                  email_dir: Path, zip_pwd: str,
                                  data_source_id: int) -> dict:
    """Process a single email for a specific platform. Returns dict with rows, pending flag, or error."""
    rows = []
    pending = False

    if platform == "wechat":
        url = extract_wechat_link(msg)
        if not url:
            raise RuntimeError("No wechat download url found")
        zip_path = email_dir / "wechat_bill.zip"
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        zip_path.write_bytes(r.content)
        if is_encrypted_zip(zip_path):
            save_pending_import(data_source_id, 1, eid_s, subject, zip_path.name, zip_path, platform)
            return {"rows": [], "pending": True}
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
        if is_encrypted_zip(zip_file):
            save_pending_import(data_source_id, 1, eid_s, subject, zip_file.name, zip_file, platform)
            return {"rows": [], "pending": True}
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
        if is_encrypted_zip(zip_file):
            save_pending_import(data_source_id, 1, eid_s, subject, zip_file.name, zip_file, platform)
            return {"rows": [], "pending": True}
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
                if is_encrypted_zip(zip_file):
                    save_pending_import(data_source_id, 1, eid_s, subject, zip_file.name, zip_file, platform)
                    return {"rows": [], "pending": True}
                extracted = unzip_first(zip_file, email_dir / "unzipped", zip_pwd)
                pdf_file = next((p for p in extracted if p.suffix.lower() == ".pdf"), None)
        if not pdf_file:
            raise RuntimeError("No pdf found for icbc")
        out_json = email_dir / "icbc.normalized.json"
        parse_icbc_pdf(pdf_file, out_json)
        rows = json.loads(out_json.read_text(encoding="utf-8"))

    return {"rows": rows, "pending": False}


def sync_from_email(config: dict, data_source_id: int = 0, platforms: list[str] | None = None):
    """
    Sync email for one or more platforms in a single IMAP connection.

    config = {
        "imap_host": "imap.126.com",
        "email": "user@126.com",
        "password": "xxx",
        "zip_password": "",
    }
    platforms = ["alipay", "wechat"]  # list of platforms to sync
    """
    imap_host = config.get("imap_host", "imap.126.com")
    imap_user = config["email"]
    imap_pass = config["password"]
    zip_pwd = config.get("zip_password", "")

    # Backward compat: if platforms not given, try config["platform"]
    if not platforms:
        p = config.get("platform", "alipay")
        if isinstance(p, list):
            platforms = p
        else:
            platforms = [p]

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

    # Per-platform result tracking
    platform_results: dict[str, dict] = {}
    for plat in platforms:
        platform_results[plat] = {
            "rows": [],
            "errors": 0,
            "error_message": None,
            "pending_count": 0,
        }

    for eid in ids:
        eid_s = eid.decode()
        if eid_s in seen:
            continue

        st, msg_data = m.fetch(eid, "(RFC822)")
        if st != "OK":
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        subject = decode_mime(msg.get("Subject", ""))

        # Check which platform(s) this email matches
        for plat in platforms:
            sf = subject_filters.get(plat, "")
            if sf not in subject:
                continue

            email_dir = batch_dir / f"{eid_s}_{plat}"
            email_dir.mkdir(parents=True, exist_ok=True)

            try:
                result = _process_email_for_platform(
                    plat, msg, eid_s, subject, email_dir, zip_pwd, data_source_id
                )
                if result["pending"]:
                    platform_results[plat]["pending_count"] += 1
                elif result["rows"]:
                    insert_transactions(result["rows"], source=f"email_{plat}")
                    platform_results[plat]["rows"].extend(result["rows"])
            except Exception as e:
                platform_results[plat]["errors"] += 1
                platform_results[plat]["error_message"] = str(e)
                (email_dir / "error.txt").write_text(str(e), encoding="utf-8")

        seen.add(eid_s)

    m.logout()

    state["processed_email_ids"] = sorted(seen, key=lambda x: int(x) if x.isdigit() else 0)
    save_state(state)

    # Build per-platform results
    results = {}
    overall_status = "success"
    has_error = False
    has_pending = False
    has_success = False
    messages = []

    for plat in platforms:
        pr = platform_results[plat]
        plat_rows = pr["rows"]
        new_count = 0
        dup_count = 0
        if plat_rows:
            ins_result = insert_transactions(plat_rows, source=f"email_{plat}")
            new_count = ins_result["new"]
            dup_count = ins_result["duplicates"]

        plat_label = subject_filters.get(plat, plat)

        if pr["errors"] > 0 and pr["pending_count"] > 0:
            plat_status = "partial"
            has_error = True
            has_pending = True
            messages.append(f"{plat_label}部分失败，{pr['pending_count']}个加密文件待输入密码")
        elif pr["errors"] > 0:
            plat_status = "error"
            has_error = True
            messages.append(f"{plat_label}同步失败: {(pr['error_message'] or '')[:100]}")
        elif pr["pending_count"] > 0:
            plat_status = "pending_password"
            has_pending = True
            messages.append(f"{plat_label}有{pr['pending_count']}个加密文件待输入密码")
        else:
            plat_status = "success"
            has_success = True
            messages.append(f"{plat_label}同步成功，新增{new_count}条")

        results[plat] = {
            "status": plat_status,
            "records_created": new_count,
            "records_skipped": dup_count,
            "pending_count": pr["pending_count"],
            "error_message": pr["error_message"],
        }

    # Determine overall status
    if has_error and (has_success or has_pending):
        overall_status = "partial"
    elif has_error:
        overall_status = "error"
    elif has_pending and has_success:
        overall_status = "partial"
    elif has_pending:
        overall_status = "pending_password"
    else:
        overall_status = "success"

    summary_message = "；".join(messages) if messages else "同步完成"

    if data_source_id:
        total_rows = sum(len(pr["rows"]) for pr in platform_results.values())
        total_new = sum(r["records_created"] for r in results.values())
        total_dup = sum(r["records_skipped"] for r in results.values())
        total_errors = sum(pr["errors"] for pr in platform_results.values())
        # Store per-platform results as JSON in last_sync_message
        sync_detail_json = json.dumps(results, ensure_ascii=False)
        write_sync_log(
            data_source_id,
            overall_status,
            total_rows,
            total_new,
            total_dup,
            total_errors,
            sync_detail_json,
        )

    return {
        "status": overall_status,
        "results": results,
        "message": summary_message,
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
