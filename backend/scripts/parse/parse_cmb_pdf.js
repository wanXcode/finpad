#!/usr/bin/env node
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('usage: parse_cmb_pdf.js <input.pdf> <output.json>');
    process.exit(1);
  }

  const data = fs.readFileSync(input);
  const parser = new PDFParse({ data });
  const txt = (await parser.getText()).text;
  await parser.destroy();

  const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let inTable = false;
  const rows = [];

  for (const ln of lines) {
    if (ln.includes('记账日期') && ln.includes('交易金额')) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (ln.startsWith('-- 1 of') || ln.startsWith('—') || ln.startsWith('温馨提示') || ln.startsWith('2/2')) break;

    const m = ln.match(/^(\d{4}-\d{2}-\d{2})\s+CNY\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(.+)$/);
    if (!m) continue;
    const [, date, amount, balance, tail] = m;
    rows.push({
      date,
      amount: parseFloat(amount.replace(/,/g, '')),
      balance: parseFloat(balance.replace(/,/g, '')),
      tail,
    });
  }

  const out = rows.map((r, idx) => {
    const abs = Math.abs(r.amount);
    const direction = r.amount < 0 ? '支出' : (r.amount > 0 ? '收入' : '不计收支');
    return {
      tx_id: `cmb_${r.date.replace(/-/g, '')}_${idx}_${Math.round(abs * 100)}`,
      tx_time_text: `${r.date} 12:00:00`,
      platform: '招商银行',
      account: '招商银行',
      direction,
      amount: abs,
      category: '银行卡流水',
      counterparty: '',
      note: `${r.tail} | 余额:${r.balance.toFixed(2)}`,
    };
  });

  fs.writeFileSync(output, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ parsed_count: out.length, output }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
