#!/usr/bin/env node
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

function safeNum(s) {
  return parseFloat((s || '0').replace(/,/g, '')) || 0;
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('usage: parse_icbc_pdf.js <input.pdf> <output.json>');
    process.exit(1);
  }

  const data = fs.readFileSync(input);
  const parser = new PDFParse({ data });
  const txt = (await parser.getText()).text;
  await parser.destroy();

  const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const chunks = [];
  let currentDate = null;
  let bucket = [];
  for (const ln of lines) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(ln)) {
      if (currentDate && bucket.length) chunks.push({ date: currentDate, text: bucket.join(' ') });
      currentDate = ln;
      bucket = [];
      continue;
    }
    if (/^本页支出算术合计/.test(ln) || /^本页交易笔数/.test(ln) || /^本页收入算术合计/.test(ln) || /^共\s*\d+\s*页/.test(ln) || /^--\s*\d+\s*of\s*\d+\s*--/.test(ln)) {
      continue;
    }
    if (currentDate) bucket.push(ln);
  }
  if (currentDate && bucket.length) chunks.push({ date: currentDate, text: bucket.join(' ') });

  const out = [];
  chunks.forEach((c, idx) => {
    const t = c.text.replace(/\s+/g, ' ').trim();
    const tm = t.match(/(\d{2}:\d{2}:\d{2})/);
    const am = t.match(/([+-][\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
    if (!tm || !am) return;

    const time = tm[1];
    const signed = safeNum(am[1]);
    const balance = safeNum(am[2]);
    const direction = signed < 0 ? '支出' : (signed > 0 ? '收入' : '不计收支');
    const amount = Math.abs(signed);

    let category = '银行卡流水';
    const cm = t.match(/人民币\s+\S+\s+(.+?)\s+\d{4}\s+[+-][\d,]+\.\d{2}/);
    if (cm) category = cm[1].replace(/\s+/g, '');

    let tail = t.split(am[0])[1] || '';
    tail = tail.replace(/\s+/g, ' ').trim();

    out.push({
      tx_id: `icbc_${c.date.replace(/-/g, '')}_${idx}_${Math.round(amount * 100)}`,
      tx_time_text: `${c.date} ${time}`,
      platform: '工商银行',
      account: '工商银行',
      direction,
      amount,
      category,
      counterparty: '',
      note: `${tail} | 余额:${balance.toFixed(2)}`,
    });
  });

  fs.writeFileSync(output, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ parsed_count: out.length, output }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
