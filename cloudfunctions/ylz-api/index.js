'use strict';
/*
 * 玉灵之音 · 云端校验 API（HTTP 访问服务）
 *
 * 客户端 POST 到 https://<env>.service.tcloudbase.com/ylz，body 为 JSON：
 *   { "action": "verify",   "deviceId": "...", "code": "ABCD-EFGH" }
 *   { "action": "activate", "deviceId": "...", "code": "ABCD-EFGH" }
 *
 * 云数据库集合：
 *   activation_codes   _id = 规范化激活码，字段：status(unused/used/revoked)
 *                      expireAt(YYYY-MM-DD) deviceId usedAt createdAt note batch
 *   devices            _id = 设备 ID，字段：activated code expireAt activatedAt lastSeen ip ua
 *   trial_fingerprints _id = sha256(IP|UA)，字段：firstSeen lastSeen ip ua
 *
 * 试用期以服务端时间为准，按 IP + UA 指纹记录首次访问时间；
 * 清 localStorage / 改本地时间都无法重置试用。
 */
const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = process.env.TCB_ENV || 'yulingzhi-prime-d3fjr5nn208b4464';
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV || ENV_ID });
const db = app.database();

const TRIAL_DAYS = 3;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRE = '2099-12-31';
const COLLECTIONS = ['activation_codes', 'devices', 'trial_fingerprints', 'visits', 'visitors'];

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
const isExpired = (dateStr, at) => {
  const end = Date.parse(String(dateStr || DEFAULT_EXPIRE) + 'T23:59:59+08:00');
  return !isFinite(end) || (at || Date.now()) > end;
};
const MSG = {
  INVALID: '激活码无效，请检查后重试',
  EXPIRED: '这个激活码已过期',
  USED_OTHER: '这个激活码已在其他设备使用，如需换设备请联系客服',
  REVOKED: '这个激活码已被停用，请联系客服',
  BAD_DEVICE: '设备标识异常，请刷新页面重试',
  SERVER_ERROR: '服务暂时不可用，请稍后重试'
};
const fail = (code, msg) => ({ ok: false, code, msg: msg || MSG[code] || '操作失败' });

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
  const origin = h.origin || h.referer || '';
  const ip = String(h['x-forwarded-for'] || '').split(',')[0].trim()
    || h['x-real-ip']
    || (e.requestContext && e.requestContext.sourceIp)
    || '';
  return { body, origin, ip, ua: h['user-agent'] || '', method: String(e.httpMethod || 'POST').toUpperCase() };
}
function resp(statusCode, obj, headers) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}),
    body: JSON.stringify(obj)
  };
}

/* ---------------- 数据操作 ---------------- */
async function getDoc(col, id) {
  try { return firstData(await db.collection(col).doc(id).get()); }
  catch (e) { return null; }
}
async function setDoc(col, id, data) {
  return db.collection(col).doc(id).set(data);
}

/* 试用指纹：同 IP + 同 UA 视为同一台“环境”，首次访问时间由服务端记录 */
async function touchTrial(ctx) {
  const fp = sha256('ylz-trial|' + (ctx.ip || '0.0.0.0') + '|' + (ctx.ua || ''));
  const t = Date.now();
  let doc = null;
  try { doc = firstData(await db.collection('trial_fingerprints').doc(fp).get()); } catch (e) { doc = null; }
  if (doc && doc.firstSeen) {
    try { await db.collection('trial_fingerprints').doc(fp).update({ lastSeen: t }); } catch (e) {}
    return doc.firstSeen + TRIAL_MS;
  }
  try {
    await setDoc('trial_fingerprints', fp, {
      firstSeen: t, lastSeen: t, ip: (ctx.ip || '').slice(0, 64), ua: (ctx.ua || '').slice(0, 200)
    });
  } catch (e) {}
  return t + TRIAL_MS;
}

/* 访问记录：visits 记 PV，visitors 按设备记 UV/新访客 */
async function recordVisit(body, ctx) {
  const t = Date.now();
  const page = body.page === 'pc' ? 'pc' : 'h5';
  const deviceId = normDevice(body.deviceId) || '';
  const ip = (ctx.ip || '').slice(0, 64);
  const ua = (ctx.ua || '').slice(0, 200);
  try {
    await db.collection('visits').add({
      ts: t, day: new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10),
      deviceId, page, ip, ua, ref: String(body.ref || '').slice(0, 200)
    });
  } catch (e) { console.error('[ylz-api] visit', e && (e.message || e)); }
  if (deviceId) {
    try {
      const v = await getDoc('visitors', deviceId);
      if (v) await db.collection('visitors').doc(deviceId).update({ lastSeen: t, page, ip, ua });
      else await db.collection('visitors').doc(deviceId).set({ firstSeen: t, lastSeen: t, page, ip, ua });
    } catch (e) {}
  }
}

/* 激活码认领：unused -> used 并绑定设备；同设备重复激活幂等 */
async function claimCode(code, deviceId) {
  const col = db.collection('activation_codes');
  const ref = col.doc(code);
  const doc = await getDoc('activation_codes', code);
  if (!doc) return { error: 'INVALID' };
  if (doc.status === 'revoked') return { error: 'REVOKED' };
  const expireAt = doc.expireAt || DEFAULT_EXPIRE;
  if (isExpired(expireAt)) return { error: 'EXPIRED', expireAt };
  if (doc.status === 'used') {
    if (doc.deviceId && doc.deviceId !== deviceId) return { error: 'USED_OTHER' };
    return { ok: true, expireAt };
  }
  let r = null;
  try {
    r = await col.where({ _id: code, status: 'unused' }).update({ status: 'used', deviceId, usedAt: Date.now() });
  } catch (e) {
    r = null;
  }
  if (!r || !r.updated) {
    const latest = await getDoc('activation_codes', code);
    if (!latest) return { error: 'INVALID' };
    if (latest.status === 'unused') return { error: 'SERVER_ERROR' };
    if (latest.status === 'revoked') return { error: 'REVOKED' };
    if (latest.deviceId && latest.deviceId !== deviceId) return { error: 'USED_OTHER' };
  }
  return { ok: true, expireAt };
}

async function bindDevice(deviceId, code, expireAt, ctx) {
  try {
    await setDoc('devices', deviceId, {
      activated: true,
      code,
      expireAt: expireAt || DEFAULT_EXPIRE,
      activatedAt: Date.now(),
      lastSeen: Date.now(),
      ip: (ctx.ip || '').slice(0, 64),
      ua: (ctx.ua || '').slice(0, 200)
    });
  } catch (e) {}
}

/* ---------------- actions ---------------- */
async function onActivate(body, ctx) {
  const deviceId = normDevice(body.deviceId);
  if (!deviceId) return fail('BAD_DEVICE');
  const code = normCode(body.code);
  if (code.length < 6) return fail('INVALID', '请输入激活码');
  const res = await claimCode(code, deviceId);
  if (!res.ok) return fail(res.error);
  await bindDevice(deviceId, code, res.expireAt, ctx);
  return { ok: true, activated: true, expireAt: res.expireAt, serverNow: Date.now() };
}

async function onVerify(body, ctx) {
  const deviceId = normDevice(body.deviceId);
  if (!deviceId) return fail('BAD_DEVICE');
  const srvNow = Date.now();
  const trialEnd = await touchTrial(ctx);
  if (body.visit) await recordVisit(body, ctx);

  // 老用户迁移 / 本地已保存激活码：自动认领一次（幂等，不影响他人已绑定的码）
  const code = normCode(body.code);
  if (code.length >= 6) {
    const res = await claimCode(code, deviceId);
    if (res.ok) await bindDevice(deviceId, code, res.expireAt, ctx);
  }

  let activated = false, expired = false, expireAt = null, status = 'trial';
  const dev = await getDoc('devices', deviceId);
  if (dev && dev.activated && dev.code) {
    const c = await getDoc('activation_codes', dev.code);
    if (!c) {
      status = 'unknown';
    } else if (c.status === 'revoked') {
      status = 'revoked';
    } else if (c.deviceId && c.deviceId !== deviceId) {
      status = 'moved';
    } else {
      expireAt = c.expireAt || dev.expireAt || DEFAULT_EXPIRE;
      if (isExpired(expireAt, srvNow)) { expired = true; status = 'expired'; }
      else { activated = true; status = 'active'; }
    }
  }
  return { ok: true, activated, expired, expireAt, trialEnd, serverNow: srvNow, status, trialDays: TRIAL_DAYS };
}

async function handle(event) {
  const req = parseHttpEvent(event);
  const cors = corsHeaders(req.origin);
  if (req.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  let out;
  try {
    await ensureCollections();
    const action = String(req.body.action || '').toLowerCase();
    if (action === 'verify') out = await onVerify(req.body, req);
    else if (action === 'activate') out = await onActivate(req.body, req);
    else out = { ok: false, code: 'BAD_ACTION', msg: '未知操作' };
  } catch (err) {
    console.error('[ylz-api]', err && (err.stack || err.message || err));
    out = fail('SERVER_ERROR');
  }
  return resp(200, out, cors);
}
exports.handle = handle;

/* Event 类型云函数入口（保留兼容） */
exports.main = async (event) => handle(event);

/* Web 函数（HTTP 访问服务）入口：scf_bootstrap 里 `node index.js` 启动 */
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
        console.error('[ylz-api] server', e && (e.stack || e.message || e));
        out = { statusCode: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(fail('SERVER_ERROR')) };
      }
      res.writeHead(out.statusCode || 200, out.headers || {});
      res.end(out.body || '');
    });
  });
  server.listen(PORT, '0.0.0.0', () => console.log('[ylz-api] listening on ' + PORT));
}
