#!/usr/bin/env python3
"""
Fetch bill emails from IMAP, parse attachments, and insert into local FinPad SQLite DB.
Reuses parsing logic from personal-finance-automation.
"""
import csv
import email
import hashlib
import imaplib
import json
import os
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from email.header import decode_header
from pathlib import Path
from zipfile import ZipFile
from zoneinfo import ZoneInfo

import requests

IMAP_HOST = os.getenv('BILL_EMAIL_IMAP_HOST', 'imap.126.com')
IMAP_PORT = int(os.getenv('BILL_EMAIL_IMAP_PORT', '993'))
IMAP_USER = os.getenv('BILL_EMAIL_IMAP_USER')
IMAP_PASS = os.getenv('BILL_EMAIL_IMAP_PASS')

PWD_ALIPAY = os.getenv('BILL_ZIP_PASSWORD_ALIPAY', '')
PWD_WECHAT = os.getenv('BILL_ZIP_PASSWORD_WECHAT', '')
PWD_CMB = os.getenv('BILL_ZIP_PASSWORD_CMB', '')
PWD_ICBC = os.getenv('BILL_ZIP_PASSWORD_ICBC', '')

FINPAD_DB = Path(os.getenv('FINPAD_DB', '/root/.openclaw/workspace/projects/finpad/data/finpad.db'))
WORK_DIR = Path('/tmp/finpad_ingest')

NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}


def decode_mime(s):
    if not s: return ''
    out = []
    for txt, enc in decode_header(s):
        if isinstance(txt, bytes): out.append(txt.decode(enc or 'utf-8', errors='ignore'))
        else: out.append(txt)
    return ''.join(out)


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name)[:180]


def tx_hash(prefix, raw):
    return prefix + hashlib.sha1(raw.encode('utf-8')).hexdigest()[:20]


# --- Parsers (copied from auto_ingest_and_sync.py) ---

def parse_alipay_csv(csv_file):
    text = csv_file.read_bytes().decode('gb18030', errors='ignore').splitlines()
    header_idx = None
    for i, line in enumerate(text):
        if line.startswith('交易时间,交易分类,交易对方'):
            header_idx = i
            break
    if header_idx is None:
        return []
    rows = []
    for r in csv.DictReader(text[header_idx:]):
        tx_time_raw = (r.get('交易时间') or '').strip()
        if not tx_time_raw: continue
        dt = datetime.strptime(tx_time_raw, '%Y-%m-%d %H:%M:%S').replace(tzinfo=ZoneInfo('Asia/Shanghai'))
        order_no = (r.get('交易订单号') or '').strip()
        txid = f'alipay_{order_no}' if order_no else tx_hash('alipay_', f"{tx_time_raw}|{r.get('金额','')}|{r.get('交易对方','')}|alipay")
        note = (r.get('商品说明') or '').strip()
        remark = (r.get('备注') or '').strip()
        if remark: note = f"{note} | 备注:{remark}" if note else f"备注:{remark}"
        direction = '支出' if '支出' in (r.get('收/支') or '') else ('收入' if '收入' in (r.get('收/支') or '') else '不计收支')
        rows.append({
            'tx_id': txid, 'tx_time': tx_time_raw, 'platform': '支付宝',
            'account': (r.get('收/付款方式') or '').strip(), 'direction': direction,
            'amount': float((r.get('金额') or '0').replace(',', '').strip() or 0),
            'category': (r.get('交易分类') or '其他').strip() or '其他',
            'counterparty': (r.get('交易对方') or '').strip(), 'note': note,
        })
    return rows


def read_xlsx_rows(xlsx_path):
    with ZipFile(xlsx_path) as z:
        sst = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in root.findall('a:si', NS):
                sst.append(''.join(t.text or '' for t in si.findall('.//a:t', NS)))
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rid_to_target = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels}
        rid = wb.find('a:sheets', NS).findall('a:sheet', NS)[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        ws = ET.fromstring(z.read('xl/' + rid_to_target[rid]))
        out = []
        for row in ws.findall('.//a:sheetData/a:row', NS):
            vals = []
            for c in row.findall('a:c', NS):
                t = c.attrib.get('t')
                v = c.find('a:v', NS)
                val = '' if v is None else (v.text or '')
                if t == 's' and val != '': val = sst[int(val)]
                vals.append(val)
            out.append(vals)
        return out


def parse_wechat_xlsx(xlsx_file):
    rows = read_xlsx_rows(xlsx_file)
    header_idx = None
    for i, r in enumerate(rows):
        if r and r[0] == '交易时间': header_idx = i; break
    if header_idx is None: return []
    headers = rows[header_idx]
    out = []
    for r in rows[header_idx + 1:]:
        if not r: continue
        if len(r) < len(headers): r += [''] * (len(headers) - len(r))
        d = {headers[i]: r[i] for i in range(len(headers))}
        tx_time_raw = (d.get('交易时间') or '').strip()
        if not re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', tx_time_raw): continue
        amt_raw = (d.get('金额(元)') or '').strip().replace('¥', '').replace(',', '')
        direction = '支出' if '支出' in (d.get('收/支') or '') else ('收入' if '收入' in (d.get('收/支') or '') else '不计收支')
        tx_no = (d.get('交易单号') or '').strip()
        note = (d.get('商品') or '').strip()
        status = (d.get('当前状态') or '').strip()
        if status: note = f"{note} | 状态:{status}" if note else f"状态:{status}"
        out.append({
            'tx_id': f'wechat_{tx_no}' if tx_no else tx_hash('wechat_', f"{tx_time_raw}|{amt_raw}|{d.get('交易对方','')}|wechat"),
            'tx_time': tx_time_raw, 'platform': '微信',
            'account': (d.get('支付方式') or '').strip(), 'direction': direction,
            'amount': abs(float(amt_raw or 0)),
            'category': (d.get('交易类型') or '其他').strip() or '其他',
            'counterparty': (d.get('交易对方') or '').strip(), 'note': note,
        })
    return out


def extract_wechat_link(msg):
    html = ''; text = ''
    for part in msg.walk():
        ctype = part.get_content_type()
        payload = part.get_payload(decode=True)
        if not payload: continue
        content = payload.decode(part.get_content_charset() or 'utf-8', errors='ignore')
        if ctype == 'text/html': html += content
        elif ctype == 'text/plain': text += content
    merged = html + '\n' + text
    m = re.search(r'https://tenpay\.wechatpay\.cn/userroll/userbilldownload/downloadfilefromemail\?[^"\s<]+', merged)
    return m.group(0) if m else None


def unzip_first(zip_path, out_dir, pwd):
    out_dir.mkdir(parents=True, exist_ok=True)
    with ZipFile(zip_path) as z:
        if pwd: z.extractall(out_dir, pwd=pwd.encode('utf-8'))
        else: z.extractall(out_dir)
        return [out_dir / n for n in z.namelist()]


# --- DB insertion ---

def get_user_id(db):
    row = db.execute("SELECT id FROM users WHERE username='admin'").fetchone()
    return row[0] if row else 1


def insert_transactions(db, rows, user_id):
    inserted = 0; skipped = 0
    for r in rows:
        existing = db.execute("SELECT id FROM transactions WHERE tx_id=? AND user_id=?", (r['tx_id'], user_id)).fetchone()
        if existing:
            skipped += 1; continue
        db.execute("""
            INSERT INTO transactions (user_id, tx_id, tx_time, platform, account, direction, amount, category, counterparty, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, r['tx_id'], r['tx_time'], r['platform'], r.get('account', ''),
            r['direction'], r['amount'], r.get('category', '其他'),
            r.get('counterparty', ''), r.get('note', ''),
            datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y-%m-%d %H:%M:%S')
        ))
        inserted += 1
    db.commit()
    return inserted, skipped


# --- Main ---

def main():
    if not IMAP_USER or not IMAP_PASS:
        raise SystemExit('Set BILL_EMAIL_IMAP_USER and BILL_EMAIL_IMAP_PASS')

    WORK_DIR.mkdir(parents=True, exist_ok=True)

    print(f'Connecting to {IMAP_HOST}...')
    m = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    m.login(IMAP_USER, IMAP_PASS)
    try:
        tag = m._new_tag()
        cmd = f'{tag} ID ("name" "finpad" "version" "1.0" "vendor" "openclaw")\r\n'
        m.send(cmd.encode('utf-8'))
        m._get_tagged_response(tag)
    except: pass
    m.select('INBOX')

    status, data = m.search(None, 'ALL')
    ids = data[0].split() if status == 'OK' and data and data[0] else []
    print(f'Total emails: {len(ids)}')

    db = sqlite3.connect(str(FINPAD_DB))
    user_id = get_user_id(db)
    total_inserted = 0; total_skipped = 0; results = []

    for eid in ids:
        eid_s = eid.decode()
        st, msg_data = m.fetch(eid, '(RFC822)')
        if st != 'OK': continue
        msg = email.message_from_bytes(msg_data[0][1])
        subject = decode_mime(msg.get('Subject', ''))

        platform = None
        if '支付宝' in subject and '交易流水' in subject: platform = 'alipay'
        elif '微信支付-账单流水文件' in subject: platform = 'wechat'
        elif '招商银行交易流水' in subject: platform = 'cmb'
        elif '工商银行历史明细' in subject: platform = 'icbc'
        else: continue

        email_dir = WORK_DIR / eid_s
        email_dir.mkdir(parents=True, exist_ok=True)
        print(f'\n[{eid_s}] {platform}: {subject[:50]}')

        try:
            rows = []
            if platform == 'wechat':
                url = extract_wechat_link(msg)
                if not url: raise RuntimeError('No wechat download url')
                zip_path = email_dir / 'wechat_bill.zip'
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                zip_path.write_bytes(r.content)
                extracted = unzip_first(zip_path, email_dir / 'unzipped', PWD_WECHAT)
                xlsx = next((p for p in extracted if p.suffix.lower() == '.xlsx'), None)
                if not xlsx: raise RuntimeError('No xlsx in wechat zip')
                rows = parse_wechat_xlsx(xlsx)

            elif platform == 'alipay':
                for part in msg.walk():
                    cdisp = str(part.get('Content-Disposition', ''))
                    if 'attachment' not in cdisp.lower(): continue
                    filename = safe_name(decode_mime(part.get_filename() or 'att.bin'))
                    payload = part.get_payload(decode=True)
                    if not payload: continue
                    p = email_dir / filename
                    p.write_bytes(payload)
                    if p.suffix.lower() == '.zip':
                        extracted = unzip_first(p, email_dir / 'unzipped', PWD_ALIPAY)
                        csv_file = next((f for f in extracted if f.suffix.lower() == '.csv'), None)
                        if csv_file: rows = parse_alipay_csv(csv_file)

            elif platform in ('cmb', 'icbc'):
                # CMB/ICBC need node parsers - skip for now, just note it
                print(f'  ⚠ {platform} PDF parsing requires node scripts - skipped for now')
                continue

            if rows:
                inserted, skipped = insert_transactions(db, rows, user_id)
                total_inserted += inserted; total_skipped += skipped
                results.append({'email': eid_s, 'platform': platform, 'parsed': len(rows), 'inserted': inserted, 'skipped': skipped})
                print(f'  ✅ parsed={len(rows)}, inserted={inserted}, skipped={skipped}')
            else:
                print(f'  ⚠ No rows parsed')

        except Exception as e:
            print(f'  ❌ Error: {e}')
            results.append({'email': eid_s, 'platform': platform, 'error': str(e)})

    m.logout()
    db.close()

    print(f'\n{"="*50}')
    print(f'Summary: inserted={total_inserted}, skipped={total_skipped}')
    for r in results:
        print(f'  {r}')


if __name__ == '__main__':
    main()
