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
 *   setnote 修改备注：{ code, note }
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
/* 一个激活码最多绑定的设备数（手机 H5 / 平板 / 电脑），与 ylz-api 保持一致 */
const MAX_DEVICES = Math.min(Math.max(Number(process.env.MAX_DEVICES_PER_CODE) || 3, 1), 10);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLLECTIONS = ['activation_codes', 'devices', 'trial_fingerprints', 'visits', 'visitors', 'config'];

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
    ok: true, count: (r.data || []).length, maxDevices: MAX_DEVICES,
    items: (r.data || []).map(d => ({
      code: d.code || d._id, status: d.status, expireAt: d.expireAt,
      deviceId: d.deviceId || '', devices: boundDevices(d), usedAt: d.usedAt || null,
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
  const bound = boundDevices(doc);
  const target = normDevice(p.deviceId);

  // 只解绑指定设备，其余设备继续可用
  if (target) {
    if (!bound.some(x => x.id === target)) return { ok: false, msg: '该设备未绑定此激活码' };
    const devices = bound.filter(x => x.id !== target);
    const patch = { devices, unboundAt: Date.now() };
    if (devices.length) patch.deviceId = devices[0].id;
    else { patch.status = 'unused'; patch.deviceId = null; patch.usedAt = null; }
    await db.collection('activation_codes').doc(n).update(patch);
    try { await db.collection('devices').doc(target).update({ activated: false, code: null, unboundAt: Date.now() }); } catch (e) {}
    return { ok: true, code: formatCode(n), removed: target, remaining: devices.length, status: devices.length ? 'used' : 'unused' };
  }

  // 不指定设备：解绑全部
  const ids = bound.map(x => x.id);
  await db.collection('activation_codes').doc(n).update({
    status: 'unused', deviceId: null, devices: [], usedAt: null, unboundAt: Date.now()
  });
  for (const id of ids) {
    try { await db.collection('devices').doc(id).update({ activated: false, code: null, unboundAt: Date.now() }); } catch (e) {}
  }
  return { ok: true, code: formatCode(n), removed: ids, status: 'unused' };
}

async function rebindCode(p) {
  const n = normCode(p.code);
  const deviceId = normDevice(p.deviceId);
  if (n.length < 6) return { ok: false, msg: '缺少 code' };
  if (!deviceId) return { ok: false, msg: 'deviceId 格式不对' };
  const doc = await getDoc('activation_codes', n);
  if (!doc) return { ok: false, msg: '激活码不存在' };
  if (doc.status === 'revoked') return { ok: false, msg: '激活码已作废' };
  const bound = boundDevices(doc);
  let devices = bound;
  if (!bound.some(x => x.id === deviceId)) {
    if (bound.length >= MAX_DEVICES) return { ok: false, msg: '该码已绑定 ' + MAX_DEVICES + ' 台设备，请先解绑一台' };
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
  return { ok: true, code: formatCode(n), deviceId, devices: devices.map(x => x.id) };
}

/* 设置网页控制台的管理口令（只保存 sha256，明文不落库、不进仓库） */
async function setAdmin(p) {
  const token = String(p.token || '').trim();
  if (token.length < 8) return { ok: false, msg: '口令至少 8 位' };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.collection('config').doc('admin').set({ tokenHash, updatedAt: Date.now() });
  return { ok: true, msg: '管理口令已更新' };
}

async function delCode(p) {
  const id = String(p.code || p.id || '').trim();
  const n = normCode(id);
  if (!n) return { ok: false, msg: '缺少 code' };
  try {
    const doc = await getDoc('activation_codes', n);
    await db.collection('activation_codes').doc(n).remove();
    for (const dev of deviceIdsOf(doc)) {
      try { await db.collection('devices').doc(dev).update({ activated: false, code: null }); } catch (e) {}
    }
    return { ok: true, deleted: n };
  } catch (e) {
    return { ok: false, msg: '删除失败：' + (e.message || e) };
  }
}

/* 清理测试/异常访问数据：按 deviceId 删除该设备的访问记录与访客记录 */
async function delVisits(p) {
  const deviceId = normDevice(p.deviceId);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(p.day || '')) ? String(p.day) : '';
  if (!deviceId && !day) return { ok: false, msg: '请提供 deviceId 或 day' };
  const where = deviceId ? { deviceId } : { day };
  let removed = 0;
  try {
    const r = await db.collection('visits').where(where).limit(1000).get();
    for (const d of (r.data || [])) {
      try { await db.collection('visits').doc(d._id).remove(); removed++; } catch (e) {}
    }
  } catch (e) {
    return { ok: false, msg: '删除访问记录失败：' + (e.message || e) };
  }
  if (deviceId) {
    try { await db.collection('visitors').doc(deviceId).remove(); } catch (e) {}
  }
  return { ok: true, removed, deviceId: deviceId || '', day };
}

/* 修改已有激活码的备注 */
async function setNote(p) {
  const n = normCode(p.code || p.id);
  if (n.length < 6) return { ok: false, msg: '缺少 code' };
  const doc = await getDoc('activation_codes', n);
  if (!doc) return { ok: false, msg: '激活码不存在' };
  const note = String(p.note || '').slice(0, 100);
  await db.collection('activation_codes').doc(n).update({ note, noteUpdatedAt: Date.now() });
  return { ok: true, code: formatCode(n), note };
}

/* ---------------- IP 归属地（与 ylz-api 同一套逻辑，供 backfillRegion 使用） ---------------- */
const GEO_CACHE = new Map();
const GEO_TTL = 24 * 3600 * 1000;
function httpGetBuf(url, timeoutMs) {
  return new Promise(resolve => {
    const mod = url.indexOf('https:') === 0 ? require('https') : require('http');
    let done = false;
    const finish = b => { if (!done) { done = true; resolve(b); } };
    const req = mod.get(url, { timeout: timeoutMs }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; chunks.push(c); if (size > 16384) req.destroy(); });
      res.on('end', () => finish(Buffer.concat(chunks)));
      res.on('error', () => finish(null));
    });
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
    setTimeout(() => finish(null), timeoutMs + 1000);
  });
}
/* 按字符集解码（pconline 返回 GBK，必须显式解码，否则中文存库变乱码） */
function decodeText(buf, charset) {
  if (!buf) return '';
  try { return new TextDecoder(charset).decode(buf); }
  catch (e) { return buf.toString('utf8'); }
}
function cleanRegion(prov, city) {
  prov = String(prov || '').trim();
  city = String(city || '').trim();
  if (!prov) return '';
  if (!city || city === prov || prov.indexOf(city) >= 0) return prov;
  return prov + ' ' + city;
}
async function geoOf(ip) {
  const v = String(ip || '').trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return '';
  if (v === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v)) return '';
  const hit = GEO_CACHE.get(v);
  if (hit && Date.now() - hit.at < GEO_TTL) return hit.region;
  let region = '';
  try {
    const p = await httpGetBuf('https://whois.pconline.com.cn/ipJson.jsp?json=true&ip=' + encodeURIComponent(v), 2500);
    const m = decodeText(p, 'gbk').match(/\{[\s\S]*\}/);
    if (m) { const j = JSON.parse(m[0]); region = cleanRegion(j.pro, j.city); }
  } catch (e) {}
  if (!region) {
    try {
      const q = await httpGetBuf('http://ip-api.com/json/' + encodeURIComponent(v) + '?lang=zh-CN&fields=status,regionName,city', 2500);
      if (q) { const j = JSON.parse(decodeText(q, 'utf-8')); if (j.status === 'success') region = cleanRegion(j.regionName, j.city); }
    } catch (e) {}
  }
  if (region) GEO_CACHE.set(v, { at: Date.now(), region });   // 只缓存成功结果，失败下次重试
  return region;
}

/* 回填历史访问/访客记录的归属地（每次最多 30 条；region 缺失或为空才算；reset:true 先清空已有值重新解析） */
async function backfillRegion(p) {
  const max = Math.min(Math.max(Number(p.limit) || 15, 1), 30);
  const out = { ok: true, visits: 0, visitors: 0, reset: 0, details: [] };
  if (p.reset) {
    for (const col of ['visits', 'visitors']) {
      for (;;) {
        let r;
        try { r = await db.collection(col).where({ region: db.command.neq('') }).limit(100).get(); }
        catch (e) { break; }
        const docs = r.data || [];
        if (!docs.length) break;
        for (const d of docs) {
          try { await db.collection(col).doc(d._id).update({ region: '' }); out.reset++; } catch (e) {}
        }
        if (docs.length < 100) break;
      }
    }
  }
  const missing = db.command.or(db.command.exists(false), db.command.eq(''));
  async function fillCol(col) {
    let n = 0;
    let r;
    try {
      r = await db.collection(col).where({ region: missing }).limit(max).get();
    } catch (e) { return 0; }
    for (const d of (r.data || [])) {
      const region = d.ip ? await geoOf(d.ip) : '';
      try { await db.collection(col).doc(d._id).update({ region: region || '' }); } catch (e) { continue; }
      n++;
      out.details.push({ col, ip: d.ip || '', region: region || '' });
    }
    return n;
  }
  out.visits = await fillCol('visits');
  out.visitors = await fillCol('visitors');
  return out;
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
    if (action === 'setnote') return await setNote(e);
    if (action === 'backfillregion') return await backfillRegion(e);
    if (action === 'unbind') return await unbindCode(e);
    if (action === 'rebind') return await rebindCode(e);
    if (action === 'stats') return await stats();
    if (action === 'del') return await delCode(e);
    if (action === 'setadmin') return await setAdmin(e);
    if (action === 'delvisits') return await delVisits(e);
    if (action === 'ping') return await ping();
    return { ok: false, msg: '未知 action：' + action };
  } catch (err) {
    console.error('[ylz-admin]', err && (err.stack || err.message || err));
    return { ok: false, msg: '服务端错误：' + (err && err.message ? err.message : 'unknown') };
  }
};
