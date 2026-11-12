'use strict';
/*
 * 玉灵之音 · 激活码管理（Event 类型云函数，不开放 HTTP，只能通过 CloudBase CLI / 控制台调用）
 *
 * 用法（在项目根目录，需先 cloudbase login）：
 *   cloudbase fn invoke ylz-admin --params '{"action":"stats"}'
 *   cloudbase fn invoke ylz-admin -d @admin-gen.json
 *
 * actions:
 *   gen     生成激活码并写入云端：{ count, expireAt, note, batch }
 *           返回明文码（只返回这一次，请立刻保存到 private/*.txt）
 *   import  导入已有明文码：{ codes:["XXXX-XXXX",...], expireAt, note, batch }
 *   list    查询：{ status?, batch?, code?, limit? }
 *   revoke  作废：{ code }
 *   unbind  解绑设备（恢复为未使用，可给换设备的用户重新激活）：{ code }
 *   rebind  直接绑到指定设备：{ code, deviceId }
 *   stats   统计各状态数量
 */
const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = process.env.TCB_ENV || 'yulingzhi-prime-d3fjr5nn208b4464';
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV || ENV_ID });
const db = app.database();

const DEFAULT_EXPIRE = '2099-12-31';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLLECTIONS = ['activation_codes', 'devices', 'trial_fingerprints'];

let collectionsReady = false;
async function ensureCollections() {
  if (collectionsReady) return;
  for (const name of COLLECTIONS) {
    try { await db.createCollection(name); } catch (e) {}
  }
  collectionsReady = true;
}

const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normDevice = s => {
  const v = String(s || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : '';
};
const firstData = res => {
  const d = res && res.data;
  if (Array.isArray(d)) return d[0] || null;
  return d || null;
};
const formatCode = n => n.slice(0, 4) + '-' + n.slice(4, 8);
const randomCode = () => {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
};
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && isFinite(Date.parse(s + 'T00:00:00+08:00'));

async function getDoc(col, id) {
  try { return firstData(await db.collection(col).doc(id).get()); }
  catch (e) { return null; }
}

/* ---------------- actions ---------------- */
async function genCodes(p) {
  let count = Math.floor(Number(p.count) || 0);
  if (count < 1 || count > 500) return { ok: false, msg: 'count 需在 1–500 之间' };
  const expireAt = validDate(p.expireAt) ? p.expireAt : DEFAULT_EXPIRE;
  const note = String(p.note || '').slice(0, 100);
  const batch = String(p.batch || ('B' + new Date().toISOString().slice(0, 10).replace(/-/g, ''))).slice(0, 40);
  const made = [];
  let guard = 0;
  while (made.length < count && guard < count * 20) {
    guard++;
    const n = randomCode();
    const exist = await getDoc('activation_codes', n);
    if (exist) continue;
    try {
      await db.collection('activation_codes').doc(n).set({
        code: formatCode(n), status: 'unused', expireAt, note, batch,
        createdAt: Date.now(), deviceId: null, usedAt: null
      });
      made.push(formatCode(n));
    } catch (e) { /* 重试下一个 */ }
  }
  return { ok: true, count: made.length, expireAt, batch, codes: made };
}

async function importCodes(p) {
  const list = Array.isArray(p.codes) ? p.codes : [];
  if (!list.length) return { ok: false, msg: 'codes 为空' };
  const expireAt = validDate(p.expireAt) ? p.expireAt : DEFAULT_EXPIRE;
  const note = String(p.note || '').slice(0, 100);
  const batch = String(p.batch || 'IMPORT' + new Date().toISOString().slice(0, 10).replace(/-/g, '')).slice(0, 40);
  const uniq = [...new Set(list.map(normCode).filter(n => n.length >= 6))];
  let added = 0, skipped = 0;
  for (let i = 0; i < uniq.length; i += 20) {
    const chunk = uniq.slice(i, i + 20);
    const exists = new Set();
    try {
      const r = await db.collection('activation_codes').where({ _id: db.command.in(chunk) }).limit(20).get();
      for (const d of (r.data || [])) exists.add(d._id);
    } catch (e) {}
    await Promise.all(chunk.map(async n => {
      if (exists.has(n)) { skipped++; return; }
      try {
        await db.collection('activation_codes').doc(n).set({
          code: formatCode(n), status: 'unused', expireAt, note, batch,
          createdAt: Date.now(), deviceId: null, usedAt: null
        });
        added++;
      } catch (e) { skipped++; }
    }));
  }
  return { ok: true, total: uniq.length, added, skipped, expireAt, batch };
}

async function listCodes(p) {
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
  const where = {};
  if (p.code) where._id = normCode(p.code);
  else {
    if (p.status) where.status = String(p.status);
    if (p.batch) where.batch = String(p.batch);
  }
  let q = db.collection('activation_codes');
  if (Object.keys(where).length) q = q.where(where);
  const r = await q.orderBy('createdAt', 'desc').limit(limit).get();
  return {
    ok: true, count: (r.data || []).length,
    items: (r.data || []).map(d => ({
      code: d.code || d._id, status: d.status, expireAt: d.expireAt,
      deviceId: d.deviceId || '', usedAt: d.usedAt || null,
      note: d.note || '', batch: d.batch || ''
    }))
  };
}

async function revokeCode(p) {
  const n = normCode(p.code);
  if (n.length < 6) return { ok: false, msg: '缺少 code' };
  const doc = await getDoc('activation_codes', n);
  if (!doc) return { ok: false, msg: '激活码不存在' };
  await db.collection('activation_codes').doc(n).update({ status: 'revoked', revokedAt: Date.now() });
  return { ok: true, code: formatCode(n), status: 'revoked' };
}

async function unbindCode(p) {
  const n = normCode(p.code);
  if (n.length < 6) return { ok: false, msg: '缺少 code' };
  const doc = await getDoc('activation_codes', n);
  if (!doc) return { ok: false, msg: '激活码不存在' };
  const oldDevice = doc.deviceId || '';
  await db.collection('activation_codes').doc(n).update({
    status: 'unused', deviceId: null, usedAt: null, unboundAt: Date.now()
  });
  // 原设备立即失效，避免解绑后新旧设备同时可用
  if (oldDevice) {
    try { await db.collection('devices').doc(oldDevice).update({ activated: false, code: null, unboundAt: Date.now() }); } catch (e) {}
  }
  return { ok: true, code: formatCode(n), status: 'unused' };
}

async function rebindCode(p) {
  const n = normCode(p.code);
  const deviceId = normDevice(p.deviceId);
  if (n.length < 6) return { ok: false, msg: '缺少 code' };
  if (!deviceId) return { ok: false, msg: 'deviceId 格式不对' };
  const doc = await getDoc('activation_codes', n);
  if (!doc) return { ok: false, msg: '激活码不存在' };
  if (doc.status === 'revoked') return { ok: false, msg: '激活码已作废' };
  const oldDevice = doc.deviceId || '';
  await db.collection('activation_codes').doc(n).update({ status: 'used', deviceId, usedAt: Date.now() });
  if (oldDevice && oldDevice !== deviceId) {
    try { await db.collection('devices').doc(oldDevice).update({ activated: false, code: null, movedAt: Date.now() }); } catch (e) {}
  }
  try {
    await db.collection('devices').doc(deviceId).set({
      activated: true, code: n, expireAt: doc.expireAt || DEFAULT_EXPIRE,
      activatedAt: Date.now(), lastSeen: Date.now()
    });
  } catch (e) {}
  return { ok: true, code: formatCode(n), deviceId };
}

async function delCode(p) {
  const id = String(p.code || p.id || '').trim();
  const n = normCode(id);
  if (!n) return { ok: false, msg: '缺少 code' };
  try {
    await db.collection('activation_codes').doc(n).remove();
    return { ok: true, deleted: n };
  } catch (e) {
    return { ok: false, msg: '删除失败：' + (e.message || e) };
  }
}

async function ping() {
  const steps = [];
  try { await db.createCollection('activation_codes'); steps.push('createCollection ok'); }
  catch (e) { steps.push('createCollection err: ' + (e.code || '') + ' ' + (e.message || e)); }
  try { await db.collection('activation_codes').doc('PINGTEST').set({ t: 1 }); steps.push('set ok'); }
  catch (e) { steps.push('set err: ' + (e.code || '') + ' ' + (e.message || e)); }
  try { const r = await db.collection('activation_codes').doc('PINGTEST').get(); steps.push('get ok: ' + JSON.stringify(r && r.data)); }
  catch (e) { steps.push('get err: ' + (e.code || '') + ' ' + (e.message || e)); }
  try { const r = await db.collection('activation_codes').where({ status: 'unused' }).count(); steps.push('count ok: ' + JSON.stringify(r)); }
  catch (e) { steps.push('count err: ' + (e.code || '') + ' ' + (e.message || e)); }
  return { ok: true, steps };
}

async function stats() {
  const out = {};
  for (const s of ['unused', 'used', 'revoked']) {
    try { const r = await db.collection('activation_codes').where({ status: s }).count(); out[s] = r.total; }
    catch (e) { out[s] = -1; }
  }
  return { ok: true, stats: out };
}

exports.main = async (event) => {
  const e = event || {};
  const action = String(e.action || '').toLowerCase();
  try {
    await ensureCollections();
    if (action === 'gen') return await genCodes(e);
    if (action === 'import') return await importCodes(e);
    if (action === 'list') return await listCodes(e);
    if (action === 'revoke') return await revokeCode(e);
    if (action === 'unbind') return await unbindCode(e);
    if (action === 'rebind') return await rebindCode(e);
    if (action === 'stats') return await stats();
    if (action === 'del') return await delCode(e);
    if (action === 'ping') return await ping();
    return { ok: false, msg: '未知 action：' + action };
  } catch (err) {
    console.error('[ylz-admin]', err && (err.stack || err.message || err));
    return { ok: false, msg: '服务端错误：' + (err && err.message ? err.message : 'unknown') };
  }
};
