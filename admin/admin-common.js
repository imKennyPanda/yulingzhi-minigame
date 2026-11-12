/* 玉灵之音 · 管理后台公共脚本（登录 / 请求 / 格式化） */
(function () {
  'use strict';

  var CONSOLE_URL = 'https://yulingzhi-prime-d3fjr5nn208b4464-1259601048.ap-shanghai.app.tcloudbase.com/console';
  var SESSION_KEY = 'ylz.admin.session';
  var LOCAL_KEY = 'ylz.admin.remember';

  function getToken() {
    try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(LOCAL_KEY) || ''; } catch (e) { return ''; }
  }
  function saveToken(token, remember) {
    try {
      if (remember) {
        localStorage.setItem(LOCAL_KEY, token);
        sessionStorage.removeItem(SESSION_KEY);
      } else {
        sessionStorage.setItem(SESSION_KEY, token);
        localStorage.removeItem(LOCAL_KEY);
      }
    } catch (e) {}
  }
  function clearToken() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { localStorage.removeItem(LOCAL_KEY); } catch (e) {}
  }

  var authLostHandler = null;

  function call(action, params, token) {
    var tk = token !== undefined ? token : getToken();
    var body = Object.assign({ action: action, token: tk }, params || {});
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : 0;
    return fetch(CONSOLE_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json();
    }).then(function (j) {
      if (!j || typeof j !== 'object') throw new Error('返回异常');
      if (!j.ok && j.code === 'AUTH') {
        clearToken();
        if (authLostHandler) authLostHandler();
      }
      return j;
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fmtDay(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  var toastEl = null, toastTimer = 0;
  function toast(msg, isErr) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2400);
  }

  function copy(text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('已复制');
      } catch (e) { toast('复制失败，请手动选择', true); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }).catch(fallback);
    } else fallback();
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------- 登录 ---------------- */
  var loginMask = null;
  function buildLogin() {
    if (loginMask) return loginMask;
    loginMask = document.createElement('div');
    loginMask.className = 'login-mask';
    loginMask.innerHTML =
      '<form class="login-card" autocomplete="on">' +
      '<h1>玉灵之音 · 管理后台</h1>' +
      '<p>请输入管理口令</p>' +
      '<input class="input" type="password" autocomplete="current-password" placeholder="管理口令" aria-label="管理口令">' +
      '<label><input type="checkbox"> 记住这台设备</label>' +
      '<button class="btn primary" type="submit">进入</button>' +
      '<div class="login-msg"></div>' +
      '</form>';
    document.body.appendChild(loginMask);
    var form = loginMask.querySelector('form');
    var input = loginMask.querySelector('input[type="password"]');
    var remember = loginMask.querySelector('input[type="checkbox"]');
    var msg = loginMask.querySelector('.login-msg');
    var btn = loginMask.querySelector('button');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var token = input.value.trim();
      if (!token) { msg.textContent = '请输入管理口令'; return; }
      btn.disabled = true;
      msg.textContent = '';
      call('login', {}, token).then(function (r) {
        if (r && r.ok) {
          saveToken(token, remember.checked);
          finishLogin(r);
        } else {
          msg.textContent = (r && r.msg) || '口令错误';
        }
      }).catch(function () {
        msg.textContent = '网络异常，请稍后重试';
      }).finally(function () { btn.disabled = false; });
    });
    return loginMask;
  }

  var onReady = null, readyData = null;
  function finishLogin(data) {
    readyData = data;
    if (loginMask) loginMask.classList.add('hide');
    if (onReady) { var cb = onReady; onReady = null; cb(data); }
  }

  function requireLogin(cb) {
    onReady = cb;
    authLostHandler = function () {
      if (loginMask) loginMask.classList.remove('hide');
      toast('登录已失效，请重新输入口令', true);
    };
    var mask = buildLogin();
    var token = getToken();
    if (!token) { mask.classList.remove('hide'); return; }
    // 有保存的口令：先静默验证
    mask.classList.remove('hide');
    var msg = mask.querySelector('.login-msg');
    msg.textContent = '正在验证…';
    call('login', {}, token).then(function (r) {
      if (r && r.ok) { msg.textContent = ''; finishLogin(r); }
      else { msg.textContent = '口令已失效，请重新输入'; }
    }).catch(function () {
      msg.textContent = '网络异常，请稍后重试';
    });
  }

  function logout() {
    clearToken();
    location.reload();
  }

  window.Admin = {
    url: CONSOLE_URL,
    call: call,
    requireLogin: requireLogin,
    logout: logout,
    getToken: getToken,
    esc: esc,
    fmtTime: fmtTime,
    fmtDay: fmtDay,
    toast: toast,
    copy: copy,
    download: download
  };
})();
