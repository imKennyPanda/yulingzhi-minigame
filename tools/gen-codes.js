#!/usr/bin/env node
/*
 * 激活码哈希生成器（本地运行，不需要联网）
 *
 * 用法：
 *   node tools/gen-codes.js 2099-12-31 A7K2-9QMX B3DF-7K2M
 *   node tools/gen-codes.js 2099-12-31 --count 20
 *
 * 随机码格式：8 位无歧义字母数字（两组 4 位，如 A7K2-9QMX）。
 * 买断/永久畅玩用日期 2099-12-31；需要限时码时再填具体到期日。
 *
 * 输出分两段：
 *   1. 可直接粘贴到 h5.html / pc.html 的 PAY_CFG.codes 的哈希行（不含明文）
 *   2. 明文激活码清单，自己保存，不要提交到仓库
 *
 * 页面只存哈希；别人拿到源码也无法反推出明文码。
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashOf = s => crypto.createHash('sha256').update(norm(s)).digest('hex');
const randomCode = () => {
  const chars = Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return chars.match(/.{4}/g).join('-');
};

const [, , exp, ...args] = process.argv;
const usage = [
  '用法:',
  '  node tools/gen-codes.js 2099-12-31 XXXX-XXXX [更多码...]',
  '  node tools/gen-codes.js 2099-12-31 --count 20'
].join('\n');
if (!exp || !/^\d{4}-\d{2}-\d{2}$/.test(exp) || !args.length || !isFinite(Date.parse(exp + 'T23:59:59'))) {
  console.error(usage);
  process.exit(1);
}

let codes;
if (args[0] === '--count') {
  const n = Number(args[1]);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    console.error('--count 后面的数量需为 1-1000 的整数\n' + usage);
    process.exit(1);
  }
  const set = new Set();
  while (set.size < n) set.add(randomCode());
  codes = [...set];
  console.log('===== 明文激活码（自己保存，不要提交到仓库）=====');
  codes.forEach(c => console.log(c));
  console.log('');
} else {
  codes = args;
}

const seen = new Set();
const valid = [];
for (const code of codes) {
  const n = norm(code);
  if (!n) { console.error('跳过空码:', JSON.stringify(code)); continue; }
  if (seen.has(n)) { console.error('跳过重复码:', code); continue; }
  seen.add(n);
  valid.push(code);
}

console.log('===== 粘贴到 h5.html / pc.html 的 PAY_CFG.codes（只有哈希）=====');
for (const code of valid) {
  console.log(`    '${hashOf(code)}': '${exp}',`);
}

if (args[0] !== '--count') {
  console.log('\n===== 明文激活码（自己保存，不要提交到仓库）=====');
  valid.forEach(c => console.log(c));
}
