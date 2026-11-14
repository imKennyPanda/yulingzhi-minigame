'use strict';
/*
 * 玉灵之音 · 网页管理后台 API（HTTP 访问服务，路径 /console）
 *
 * 所有请求都带 { action, token, ... }，token 与 config/admin.tokenHash 比对。
 * 管理口令通过 `node tools/cloudbase-admin.js setadmin <口令>` 设置（只存 sha256）。
 *
 * actions:
 *   login     校验口令
 *   overview  激活码统计 + PV/UV/新访客（今日 / 7 天 / 30 天 / 全部）
 *   codes     查询激活码：{ status?, code?, batch?, skip?, limit? }
 *   gen       生成：{ count(1-200), expireAt, note, batch }，明文只返回一次
 *   revoke    作废：{ code }
 *   unbind    解绑：{ code }
 *   rebind    换绑：{ code, deviceId }
 *   del       删除：{ code }
 *   setnote   修改备注：{ code, note }
 *   visits    访问明细：{ range?, page?, deviceId?, skip?, limit? }
 */
const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = process.env.TCB_ENV || 'yulingzhi-prime-d3fjr5nn208b4464';
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV || ENV_ID });
const db = app.database();

const DEFAULT_EXPIRE = '2099-12-31';
/* 一个激活码最多绑定的设备数（手机 H5 / 平板 / 电脑），与 ylz-api 保持一致 */
const MAX_DEVICES = Math.min(Math.max(Number(process.env.MAX_DEVICES_PER_CODE) || 3, 1), 10);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLLECTIONS = ['activation_codes', 'devices', 'trial_fingerprints', 'visits', 'visitors', 'config'];
const DAY = 24 * 3600 * 1000;

let collectionsReady = false;
async function ensureCollections() {
  if (collectionsReady) return;
  for (const name of COLLECTIONS) {
    try { await db.createCollection(name); } catch (e) { /* 已存在 */ }
  }
  collectionsReady = true;
}

/* ---------------- 工具 ---------------- */
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
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

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'https://imkennypanda.github.io,http://localhost:8080,http://127.0.0.1:8080,null')
    .split(',').map(s => s.trim()).filter(Boolean);
}
function corsHeaders(origin) {
  const list = allowedOrigins();
  const allow = (origin && list.includes(origin)) ? origin : list[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function parseHttpEvent(event) {
  const e = event || {};
  let body = e.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(e.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body); }
    catch (_) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};
  const raw = e.headers || {};
  const h = {};
  for (const k of Object.keys(raw)) h[k.toLowerCase()] = raw[k];
  return { body, origin: h.origin || h.referer || '', method: String(e.httpMethod || 'POST').toUpperCase() };
}
function resp(statusCode, obj, headers) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}),
    body: JSON.stringify(obj)
  };
}
const fail = (code, msg) => ({ ok: false, code, msg: msg || '操作失败' });

async function getDoc(col, id) {
  try { return firstData(await db.collection(col).doc(id).get()); }
  catch (e) { return null; }
}

/* 兼容旧数据：devices 数组 + 单个 deviceId 字段 */
function boundDevices(doc) {
  const out = [];
  const seen = new Set();
  const add = v => {
    const id = typeof v === 'string' ? v : (v && (v.id || v.deviceId));
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(typeof v === 'string'
      ? { id, at: null, ip: '', ua: '' }
      : { id, at: v.at || null, ip: v.ip || '', ua: v.ua || '' });
  };
  if (doc && Array.isArray(doc.devices)) doc.devices.forEach(add);
  if (doc && doc.deviceId) add(doc.deviceId);
  return out;
}
const deviceIdsOf = doc => boundDevices(doc).map(x => x.id);

async function adminHash() {
  const c = await getDoc('config', 'admin');
  return (c && c.tokenHash) || '';
}
function authOk(token, hash) {
  if (!hash || !token) return false;
  const a = Buffer.from(sha256(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- 激活码 ---------------- */
async function listCodes(p) {
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
  const skip = Math.min(Math.max(Number(p.skip) || 0, 0), 10000);
  const where = {};
  if (p.code) where._id = normCode(p.code);
  else if (p.expired) {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    where.expireAt = db.command.lt(today);
  } else {
    if (p.status) where.status = String(p.status);
    if (p.batch) where.batch = String(p.batch);
  }
  const total = await countWhere('activation_codes', Object.keys(where).length ? where : null);
  let q = db.collection('activation_codes');
  if (Object.keys(where).length) q = q.where(where);
  const r = await q.orderBy('createdAt', 'desc').skip(skip).limit(limit).get();
  return {
    ok: true, skip, limit, total, count: (r.data || []).length, maxDevices: MAX_DEVICES,
    items: (r.data || []).map(d => ({
      id: d._id,
      code: String(d._id || '').length === 8 ? formatCode(d._id) : (d.code || d._id),
      status: d.status, expireAt: d.expireAt,
      deviceId: d.deviceId || '', devices: boundDevices(d),
      usedAt: d.usedAt || null, createdAt: d.createdAt || null,
      note: d.note || '', batch: d.batch || ''
    }))
  };
}

async function genCodes(p) {
  let count = Math.floor(Number(p.count) || 0);
  if (count < 1 || count > 200) return fail('BAD_COUNT', '一次最多生成 200 个');
  const expireAt = validDate(p.expireAt) ? p.expireAt : DEFAULT_EXPIRE;
  const note = String(p.note || '').slice(0, 100);
  const batch = String(p.batch || ('B' + new Date().toISOString().slice(0, 10).replace(/-/g, ''))).slice(0, 40);
  const made = [];
  let guard = 0;
  while (made.length < count && guard < count * 20) {
    guard++;
    const n = randomCode();
    if (await getDoc('activation_codes', n)) continue;
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

async function revokeCode(p) {
  const n = normCode(p.code);
  if (n.length < 6) return fail('BAD_CODE', '缺少激活码');
  const doc = await getDoc('activation_codes', n);
  if (!doc) return fail('NOT_FOUND', '激活码不存在');
  await db.collection('activation_codes').doc(n).update({ status: 'revoked', revokedAt: Date.now() });
  return { ok: true, code: n.length === 8 ? formatCode(n) : n, status: 'revoked' };
}

async function unbindCode(p) {
  const n = normCode(p.code);
  if (n.length < 6) return fail('BAD_CODE', '缺少激活码');
  const doc = await getDoc('activation_codes', n);
  if (!doc) return fail('NOT_FOUND', '激活码不存在');
  const bound = boundDevices(doc);
  const target = normDevice(p.deviceId);

  // 只解绑指定设备，其余设备继续可用
  if (target) {
    if (!bound.some(x => x.id === target)) return fail('NOT_BOUND', '该设备未绑定此激活码');
    const devices = bound.filter(x => x.id !== target);
    const patch = { devices, unboundAt: Date.now() };
    if (devices.length) patch.deviceId = devices[0].id;
    else { patch.status = 'unused'; patch.deviceId = null; patch.usedAt = null; }
    await db.collection('activation_codes').doc(n).update(patch);
    try { await db.collection('devices').doc(target).update({ activated: false, code: null, unboundAt: Date.now() }); } catch (e) {}
    return {
      ok: true, code: n.length === 8 ? formatCode(n) : n,
      removed: target, remaining: devices.length, status: devices.length ? 'used' : 'unused'
    };
  }

  // 不指定设备：解绑全部
  const ids = bound.map(x => x.id);
  await db.collection('activation_codes').doc(n).update({
    status: 'unused', deviceId: null, devices: [], usedAt: null, unboundAt: Date.now()
  });
  for (const id of ids) {
    try { await db.collection('devices').doc(id).update({ activated: false, code: null, unboundAt: Date.now() }); } catch (e) {}
  }
  return { ok: true, code: n.length === 8 ? formatCode(n) : n, removed: ids, status: 'unused' };
}

async function rebindCode(p) {
  const n = normCode(p.code);
  const deviceId = normDevice(p.deviceId);
  if (n.length < 6) return fail('BAD_CODE', '缺少激活码');
  if (!deviceId) return fail('BAD_DEVICE', 'deviceId 格式不对');
  const doc = await getDoc('activation_codes', n);
  if (!doc) return fail('NOT_FOUND', '激活码不存在');
  if (doc.status === 'revoked') return fail('REVOKED', '激活码已作废');
  const bound = boundDevices(doc);
  let devices = bound;
  if (!bound.some(x => x.id === deviceId)) {
    if (bound.length >= MAX_DEVICES) return fail('LIMIT', '该码已绑定 ' + MAX_DEVICES + ' 台设备，请先解绑一台');
    devices = bound.concat([{ id: deviceId, at: Date.now(), ip: '', ua: '' }]);
  }
  await db.collection('activation_codes').doc(n).update({
    status: 'used', devices, deviceId: doc.deviceId || deviceId, usedAt: doc.usedAt || Date.now()
  });
  try {
    await db.collection('devices').doc(deviceId).set({
      activated: true, code: n, expireAt: doc.expireAt || DEFAULT_EXPIRE,
      activatedAt: Date.now(), lastSeen: Date.now()
    });
  } catch (e) {}
  return { ok: true, code: n.length === 8 ? formatCode(n) : n, deviceId, devices: devices.map(x => x.id) };
}

async function delCode(p) {
  const n = normCode(p.code || p.id);
  if (!n) return fail('BAD_CODE', '缺少激活码');
  const doc = await getDoc('activation_codes', n);
  if (!doc) return fail('NOT_FOUND', '激活码不存在');
  await db.collection('activation_codes').doc(n).remove();
  for (const dev of deviceIdsOf(doc)) {
    try { await db.collection('devices').doc(dev).update({ activated: false, code: null }); } catch (e) {}
  }
  return { ok: true, deleted: n };
}

/* 修改已有激活码的备注（批次保留不动） */
async function setNote(p) {
  const n = normCode(p.code || p.id);
  if (n.length < 6) return fail('BAD_CODE', '缺少激活码');
  const doc = await getDoc('activation_codes', n);
  if (!doc) return fail('NOT_FOUND', '激活码不存在');
  const note = String(p.note || '').slice(0, 100);
  await db.collection('activation_codes').doc(n).update({ note, noteUpdatedAt: Date.now() });
  return { ok: true, code: n.length === 8 ? formatCode(n) : n, note };
}

/* ---------------- 统计 ---------------- */
function rangeStart(key) {
  const now = Date.now();
  if (key === 'today') {
    const d = new Date(now + 8 * 3600 * 1000);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() - 8 * 3600 * 1000;
  }
  if (key === '7d') return now - 7 * DAY;
  if (key === '30d') return now - 30 * DAY;
  return 0;
}
async function countWhere(col, where) {
  try {
    let q = db.collection(col);
    if (where) q = q.where(where);
    const r = await q.count();
    return r.total;
  } catch (e) { return -1; }
}
async function overview() {
  const ranges = {};
  for (const key of ['today', '7d', '30d', 'all']) {
    const start = rangeStart(key);
    const pvW = key === 'all' ? null : { ts: db.command.gte(start) };
    const uvW = key === 'all' ? null : { lastSeen: db.command.gte(start) };
    const nvW = key === 'all' ? null : { firstSeen: db.command.gte(start) };
    const [pv, uv, nv] = await Promise.all([
      countWhere('visits', pvW), countWhere('visitors', uvW), countWhere('visitors', nvW)
    ]);
    ranges[key] = { pv, uv, newVisitors: nv, since: start };
  }
  const codes = {};
  for (const s of ['unused', 'used', 'revoked']) {
    codes[s] = await countWhere('activation_codes', { status: s });
  }
  return { ok: true, ranges, codes, serverNow: Date.now() };
}

async function visits(p) {
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
  const skip = Math.min(Math.max(Number(p.skip) || 0, 0), 5000);
  const start = rangeStart(p.range || '7d');
  const where = {};
  if (String(p.range || '7d') !== 'all') where.ts = db.command.gte(start);
  if (p.page === 'h5' || p.page === 'pc') where.page = p.page;
  const verified = normDevice(p.deviceId);
  if (verified) where.deviceId = verified;
  const total = await countWhere('visits', Object.keys(where).length ? where : null);
  const r = await db.collection('visits').where(where).orderBy('ts', 'desc').skip(skip).limit(limit).get();
  return {
    ok: true, skip, limit, total, since: start, count: (r.data || []).length,
    items: (r.data || []).map(d => ({
      ts: d.ts, day: d.day || '', page: d.page || '',
      deviceId: d.deviceId || '', ip: d.ip || '', region: d.region || '', ua: d.ua || '', ref: d.ref || ''
    }))
  };
}

/* ---------------- 入口 ---------------- */
async function handle(event) {
  const req = parseHttpEvent(event);
  const cors = corsHeaders(req.origin);
  if (req.method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  await ensureCollections();
  const body = req.body;
  const action = String(body.action || '').toLowerCase();
  const hash = await adminHash();
  if (!authOk(body.token, hash)) {
    return resp(200, fail('AUTH', '口令错误或未登录'), cors);
  }

  let out;
  try {
    if (action === 'login') out = await overview();
    else if (action === 'overview') out = await overview();
    else if (action === 'codes') out = await listCodes(body);
    else if (action === 'gen') out = await genCodes(body);
    else if (action === 'revoke') out = await revokeCode(body);
    else if (action === 'unbind') out = await unbindCode(body);
    else if (action === 'rebind') out = await rebindCode(body);
    else if (action === 'del') out = await delCode(body);
    else if (action === 'setnote') out = await setNote(body);
    else if (action === 'visits') out = await visits(body);
    else out = fail('BAD_ACTION', '未知操作');
  } catch (err) {
    console.error('[ylz-console]', err && (err.stack || err.message || err));
    out = fail('SERVER_ERROR', '服务暂时不可用，请稍后重试');
  }
  return resp(200, out, cors);
}
exports.handle = handle;
exports.main = async (event) => handle(event);

if (require.main === module) {
  const http = require('http');
  const PORT = Number(process.env.PORT) || 9000;
  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      let out;
      try {
        out = await handle({
          httpMethod: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      } catch (e) {
        console.error('[ylz-console] server', e && (e.stack || e.message || e));
        out = { statusCode: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(fail('SERVER_ERROR')) };
      }
      res.writeHead(out.statusCode || 200, out.headers || {});
      res.end(out.body || '');
    });
  });
  server.listen(PORT, '0.0.0.0', () => console.log('[ylz-console] listening on ' + PORT));
}
