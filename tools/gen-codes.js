#!/usr/bin/env node
/*
 * 激活码哈希生成器（本地运行，不需要联网）
 *
 * 用法：
 *   node tools/gen-codes.js 2027-11-11 YLZ-8K3D-9F2A-8C41 YLZ-4M7Q-2B6H-1N9R
 *
 * 输出每一行形如：
 *   '69dc84f5...': '2027-11-11',   // YLZ-8K3D-9F2A-8C41
 * 把这些行粘到 h5.html / pc.html 里 PAY_CFG.codes 中即可。
 *
 * 明文激活码只保存在你自己的私有表格里；页面里只有哈希，
 * 别人拿到页面源码也无法生成有效激活码。
 */
const crypto = require('crypto');

const [, , exp, ...codes] = process.argv;
if (!exp || !/^\d{4}-\d{2}-\d{2}$/.test(exp) || !codes.length) {
  console.error('用法: node tools/gen-codes.js 2027-11-11 YLZ-XXXX-XXXX-XXXX [更多码...]');
  process.exit(1);
}

const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const seen = new Set();
for (const code of codes) {
  const n = norm(code);
  if (!n) { console.error('跳过空码:', JSON.stringify(code)); continue; }
  if (seen.has(n)) { console.error('跳过重复码:', code); continue; }
  seen.add(n);
  const hash = crypto.createHash('sha256').update(n).digest('hex');
  console.log(`    '${hash}': '${exp}',   // ${code}`);
}
