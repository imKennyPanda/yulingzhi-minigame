#!/usr/bin/env node
/*
 * 玉灵之音 · CloudBase 激活码管理（本地脚本）
 *
 * 前提：已安装并登录 CloudBase CLI（cloudbase login），项目根目录有 cloudbaserc.json。
 * 本脚本只是把参数转成 `cloudbase fn invoke ylz-admin`，明文激活码只在你的终端/本地文件里出现。
 *
 * 用法：
 *   node tools/cloudbase-admin.js stats
 *   node tools/cloudbase-admin.js gen 50 --expire 2099-12-31 --note "第二批" --out ../private/激活码-第二批.txt
 *   node tools/cloudbase-admin.js import ../private/yulingzhi-activation-codes-500-2026-11-11.txt --expire 2099-12-31 --batch 2026-11
 *   node tools/cloudbase-admin.js list --status used --limit 20
 *   node tools/cloudbase-admin.js list --code AB12-CD34
 *   node tools/cloudbase-admin.js revoke AB12-CD34
 *   node tools/cloudbase-admin.js unbind AB12-CD34          # 用户换设备：解绑后可用新设备重新激活
 *   node tools/cloudbase-admin.js rebind AB12-CD34 <deviceId>
 *   ADMIN_TOKEN=你的口令 node tools/cloudbase-admin.js setadmin   # 设置网页后台管理口令
 *   node tools/cloudbase-admin.js delvisits <deviceId>             # 删除某设备的访问记录（清理测试数据）
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FN = 'ylz-admin';
const CLOUDBASE = process.platform === 'win32' ? 'cloudbase.cmd' : 'cloudbase';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function invoke(params) {
  const tmp = path.join(os.tmpdir(), 'ylz-admin-' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify(params));
  try {
    const r = spawnSync(CLOUDBASE, ['fn', 'invoke', FN, '-d', '@' + tmp, '--json'], {
      cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32'
    });
    if (r.error) throw r.error;
    const text = (r.stdout || '') + '\n' + (r.stderr || '');
    if (r.status !== 0) throw new Error('cloudbase 调用失败：\n' + text);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('无法解析返回：\n' + text);
    let obj;
    try { obj = JSON.parse(m[0]); } catch (e) { throw new Error('返回不是 JSON：\n' + text); }
    // CLI 返回 { data: { RetMsg: "<json>" } } 或 { result: ... }
    if (obj && obj.data && typeof obj.data.RetMsg === 'string') {
      try { return JSON.parse(obj.data.RetMsg); } catch (e) {}
    }
    if (obj && obj.data && obj.data.RetMsg && typeof obj.data.RetMsg === 'object') return obj.data.RetMsg;
    if (obj && obj.result && typeof obj.result === 'object') return obj.result;
    return obj;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function extractCodes(file) {
  const text = fs.readFileSync(file, 'utf8');
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const tok of line.split(/[\s,，]+/)) {
      const c = tok.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
      if (/XXXX/.test(c) || c === 'TEST-2345') continue;   // 跳过模板/示例码
      if (/^(?:YLZ-)?[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c) || /^YLZ-[A-Z0-9-]{8,}$/.test(c)) set.add(c);
    }
  }
  return [...set];
}

function print(obj) { console.log(JSON.stringify(obj, null, 2)); }

(function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = String(args._[0] || '').toLowerCase();
  if (!action) {
    console.log('用法见文件头注释。常用：stats / gen / import / list / revoke / unbind / rebind');
    process.exit(1);
  }
  if (action === 'stats') { print(invoke({ action: 'stats' })); return; }

  if (action === 'gen') {
    const count = Number(args._[1]) || 20;
    const r = invoke({
      action: 'gen', count, expireAt: args.expire || '2099-12-31',
      note: args.note || '', batch: args.batch || ''
    });
    print(r);
    if (r.ok && Array.isArray(r.codes)) {
      const outFile = args.out || path.resolve(ROOT, '..', 'private', '激活码-' + new Date().toISOString().slice(0, 10) + '.txt');
      const lines = [
        '玉灵之音 · 激活码批次 ' + (r.batch || ''),
        '生成时间：' + new Date().toLocaleString('zh-CN'),
        '有效期：' + r.expireAt,
        '数量：' + r.codes.length,
        '（本文件含明文激活码，不要提交到 GitHub）',
        ''
      ].concat(r.codes.map((c, i) => String(i + 1).padStart(3, '0') + '  ' + c));
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, lines.join('\n') + '\n');
      console.log('\n已写入：' + outFile);
    }
    return;
  }

  if (action === 'import') {
    const file = args._[1];
    if (!file) { console.error('请提供激活码 TXT 路径'); process.exit(1); }
    const codes = extractCodes(file);
    if (!codes.length) { console.error('文件里没有识别到激活码'); process.exit(1); }
    console.log('识别到 ' + codes.length + ' 个激活码，开始分批导入…');
    let added = 0, skipped = 0;
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = codes.slice(i, i + 100);
      const r = invoke({
        action: 'import', codes: chunk, expireAt: args.expire || '2099-12-31',
        note: args.note || '', batch: args.batch || ''
      });
      if (!r.ok) { print(r); process.exit(1); }
      added += r.added || 0; skipped += r.skipped || 0;
      console.log('  进度 ' + Math.min(i + 100, codes.length) + '/' + codes.length + '：新增 ' + r.added + '，跳过 ' + r.skipped);
    }
    console.log('导入完成：新增 ' + added + '，跳过 ' + skipped);
    return;
  }

  if (action === 'list') {
    print(invoke({
      action: 'list', status: args.status || '', batch: args.batch || '',
      code: args.code || '', limit: Number(args.limit) || 50
    }));
    return;
  }

  if (action === 'setadmin') {
    const token = process.env.ADMIN_TOKEN || args._[1];
    if (!token) { console.error('用法：ADMIN_TOKEN=你的口令 node tools/cloudbase-admin.js setadmin'); process.exit(1); }
    print(invoke({ action: 'setadmin', token }));
    return;
  }

  if (action === 'delvisits') {
    const deviceId = args._[1] || '';
    if (!deviceId && !args.day) { console.error('用法：delvisits <deviceId> 或 delvisits --day 2026-11-12'); process.exit(1); }
    print(invoke({ action: 'delvisits', deviceId, day: args.day || '' }));
    return;
  }

  if (action === 'del' || action === 'remove') {
    const code = args._[1];
    if (!code) { console.error('请提供激活码或 _id'); process.exit(1); }
    print(invoke({ action: 'del', code }));
    return;
  }

  if (action === 'revoke' || action === 'unbind') {
    const code = args._[1];
    if (!code) { console.error('请提供激活码'); process.exit(1); }
    print(invoke({ action, code }));
    return;
  }

  if (action === 'rebind') {
    const code = args._[1], deviceId = args._[2];
    if (!code || !deviceId) { console.error('用法：rebind <激活码> <deviceId>'); process.exit(1); }
    print(invoke({ action, code, deviceId }));
    return;
  }

  console.error('未知 action：' + action);
  process.exit(1);
})();
