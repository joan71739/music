/**
 * auth.js
 * Spotify OAuth 2.0 PKCE 流程
 * 負責：登入、登出、token 取得與自動更新
 * 另外（檔案最下方）：運作紀錄 appLog、Spotify API 的 429 冷卻保護與請求計數
 */

const CLIENT_ID = 'de45db7ad49b41efb68dbaa362f65f8c';
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

let _token = null;

/* ── 工具函式 ── */

// 使用 crypto.getRandomValues 產生密碼學安全的隨機字串
function _rand(n) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => c[b % c.length]).join('');
}

async function _challenge(verifier) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/* ── 公開 API ── */

function login() {
  const state = _rand(16);
  const verifier = _rand(64);
  sessionStorage.setItem('cv', verifier);
  sessionStorage.setItem('st', state);

  _challenge(verifier).then(ch => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      state,
      code_challenge_method: 'S256',
      code_challenge: ch,
      show_dialog: 'true',
    });
    window.location = 'https://accounts.spotify.com/authorize?' + params;
  });
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || state !== sessionStorage.getItem('st')) return false;

  window.history.replaceState({}, '', window.location.pathname);

  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: sessionStorage.getItem('cv'),
      }),
    });
    const d = await r.json();
    if (d.access_token) {
      _saveToken(d);
      return true;
    }
  } catch (e) {
    console.error('handleCallback error:', e);
  }
  return false;
}

function doLogout() {
  localStorage.clear();
  _token = null;
  window.location.href = 'login.html';
}

async function getToken() {
  if (_token) return _token;

  const t = localStorage.getItem('spotify_token');
  const exp = localStorage.getItem('spotify_expires');
  if (t && exp && Date.now() < parseInt(exp, 10) - 60000) {
    _token = t;
    return _token;
  }

  return (await _refreshToken()) ? _token : null;
}

/* ── 內部 ── */

function _saveToken(d) {
  _token = d.access_token;
  localStorage.setItem('spotify_token', _token);
  localStorage.setItem('spotify_refresh', d.refresh_token);
  localStorage.setItem('spotify_expires', Date.now() + d.expires_in * 1000);
}

async function _refreshToken() {
  const refresh = localStorage.getItem('spotify_refresh');
  if (!refresh) return false;

  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: CLIENT_ID,
      }),
    });
    const d = await r.json();
    if (d.access_token) {
      _token = d.access_token;
      localStorage.setItem('spotify_token', _token);
      localStorage.setItem('spotify_expires', Date.now() + d.expires_in * 1000);
      if (d.refresh_token) {
        localStorage.setItem('spotify_refresh', d.refresh_token);
      }
      return true;
    }
  } catch (e) {
    console.error('_refreshToken error:', e);
  }
  return false;
}

/* ═══════════════════════════════════════════
   運作紀錄（appLog）
   各檔案用 appLog('分類', '訊息') 記一筆，「測試連線」會顯示最近的紀錄。
   存在 sessionStorage：換頁（例如 今日歌單頁 → 播放頁）也看得到。
   連續兩筆完全相同的紀錄會合併成「×N」，避免輪詢把紀錄洗掉。
═══════════════════════════════════════════ */

const APP_LOG_KEY = 'app_log';
const APP_LOG_MAX = 80;
let _appLog = [];

try {
  const _rawLog = sessionStorage.getItem(APP_LOG_KEY);
  if (_rawLog) {
    const _arrLog = JSON.parse(_rawLog);
    if (Array.isArray(_arrLog)) _appLog = _arrLog.slice(-APP_LOG_MAX);
  }
} catch (e) { /* 讀不到就從空的開始 */ }

function appLog(tag, msg) {
  const now = Date.now();
  const text = String(msg);
  const last = _appLog[_appLog.length - 1];
  if (last && last.tag === tag && last.msg === text) {
    last.n = (last.n || 1) + 1;
    last.t = now;
  } else {
    _appLog.push({ t: now, tag, msg: text, n: 1 });
    if (_appLog.length > APP_LOG_MAX) _appLog.shift();
  }
  try { sessionStorage.setItem(APP_LOG_KEY, JSON.stringify(_appLog)); } catch (e) { /* 忽略 */ }
}

/** 時間戳 → HH:MM:SS */
function appClock(ts) {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

/** 最近 limit 筆紀錄（舊的在上、新的在下），每筆一行 */
function getAppLogText(limit) {
  return _appLog.slice(-(limit || 25)).map(e =>
    `[${appClock(e.t)}] ${e.tag} ${e.msg}${e.n > 1 ? ' ×' + e.n : ''}`
  ).join('\n');
}


/* ═══════════════════════════════════════════
   Spotify API 請求保護層（429 冷卻 + 請求計數）
   只攔截打到 https://api.spotify.com/ 的 fetch，其他請求（Firebase、
   accounts.spotify.com 換 token 等）完全不受影響，所以其他檔案不用改寫法。

   - 收到 429：讀 Retry-After（秒）；瀏覽器讀不到就用預設 30 秒（＝官方限流視窗長度）。
   - 冷卻期間：不再送出請求，直接回一個假的 429（標頭 X-Local-Cooldown: 1），
     免得越撞越久。例外：暫停 / 播放（pause、play），因為「時間到要能暫停」。
   - 冷卻狀態存 localStorage，換頁、重新整理都還在。
   - 同時記錄「最近 30 秒送了幾次請求」，429 發生時一併記下，
     之後可以實測出你的 App 大約幾次會被擋。
═══════════════════════════════════════════ */

const SP_API_PREFIX = 'https://api.spotify.com/';
const SP_COOLDOWN_KEY = 'sp_cooldown_until';
const SP_LAST429_KEY = 'sp_last429';
const SP_DEFAULT_WAIT_SEC = 30;
const SP_MAX_WAIT_SEC = 3600;
const SP_STREAK_KEY = 'sp_429_streak';
const SP_BACKOFF_MAX_SEC = 900;       // 讀不到 Retry-After 時，連續 429 的等待上限（15 分鐘）

let _spCooldownUntil = 0;     // 冷卻到什麼時候（毫秒時間戳）
let _spLast429 = null;        // 最近一次 429 的資訊
let _spReqTimes = [];         // 最近送出的請求時間（用來算 30 秒內幾次）
let _spReqTotal = 0;          // 本頁累計送出的請求數
let _spPeak30 = 0;            // 本頁出現過的「30 秒內最高請求數」
let _spStreak = 0;            // 連續 429 次數（讀不到 Retry-After 時用來拉長等待，避免每 30 秒固定去撞）

try {
  _spCooldownUntil = parseInt(localStorage.getItem(SP_COOLDOWN_KEY) || '0', 10) || 0;
  const _l429 = localStorage.getItem(SP_LAST429_KEY);
  if (_l429) _spLast429 = JSON.parse(_l429);
  _spStreak = parseInt(localStorage.getItem(SP_STREAK_KEY) || '0', 10) || 0;
} catch (e) { /* 讀不到就當作沒有冷卻 */ }

/** 冷卻還剩幾秒；0 = 沒有冷卻 */
function spCooldownLeft() {
  const left = Math.ceil((_spCooldownUntil - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/** 請求統計：{ last30s, total, peak30s } */
function spRequestStats() {
  const cut = Date.now() - 30000;
  while (_spReqTimes.length && _spReqTimes[0] < cut) _spReqTimes.shift();
  return { last30s: _spReqTimes.length, total: _spReqTotal, peak30s: _spPeak30 };
}

/** 最近一次 429 的資訊：{ at, path, countIn30s, retryAfter, waitSec }；沒有就是 null */
function spLast429Info() {
  return _spLast429;
}

// 冷卻期間仍然放行的請求：暫停 / 播放
function _spAllowedInCooldown(fullPath) {
  return fullPath.startsWith('/v1/me/player/pause') || fullPath.startsWith('/v1/me/player/play');
}

function _spOn429(res, shortPath, countIn30s) {
  let raw = null;
  try { raw = res.headers.get('Retry-After'); } catch (e) { /* 讀不到 */ }
  let sec = parseInt(raw, 10);
  const readable = Number.isFinite(sec) && sec > 0;
  // 連續 429：30 分鐘內又被擋就算連續；超過就當作新的一輪
  const recent = _spLast429 && (Date.now() - _spLast429.at) < 30 * 60 * 1000;
  _spStreak = recent ? _spStreak + 1 : 1;
  if (!readable) {
    // 瀏覽器讀不到 Retry-After（Spotify 沒開放跨網域讀取）→ 30、60、120、240、480、900 秒…逐次拉長
    sec = Math.min(SP_DEFAULT_WAIT_SEC * Math.pow(2, _spStreak - 1), SP_BACKOFF_MAX_SEC);
  }
  sec = Math.min(Math.max(sec, 1), SP_MAX_WAIT_SEC);

  const until = Date.now() + (sec + 1) * 1000;   // 多留 1 秒緩衝
  if (until > _spCooldownUntil) _spCooldownUntil = until;

  _spLast429 = {
    at: Date.now(),
    path: shortPath,
    countIn30s,
    retryAfter: readable ? sec : null,
    waitSec: sec,
  };
  try {
    localStorage.setItem(SP_COOLDOWN_KEY, String(_spCooldownUntil));
    localStorage.setItem(SP_LAST429_KEY, JSON.stringify(_spLast429));
    localStorage.setItem(SP_STREAK_KEY, String(_spStreak));
  } catch (e) { /* 忽略 */ }

  appLog('429', `Spotify 限流（${shortPath}）：30 秒內已送 ${countIn30s} 次；` +
    `Retry-After ${readable ? sec + ' 秒' : '讀不到'}，冷卻 ${sec} 秒（連續第 ${_spStreak} 次）`);

  try {
    window.dispatchEvent(new CustomEvent('sp-cooldown', { detail: { seconds: spCooldownLeft() } }));
  } catch (e) { /* 忽略 */ }
}

const _origFetch = window.fetch.bind(window);

window.fetch = async function (input, init) {
  const url = (typeof input === 'string') ? input
    : (input && input.url) ? input.url
    : String(input);
  if (!url.startsWith(SP_API_PREFIX)) return _origFetch(input, init);

  const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  const fullPath = url.slice(SP_API_PREFIX.length - 1);               // /v1/me/player/...
  const shortPath = fullPath.replace(/^\/v1/, '').slice(0, 90);       // /me/player/...

  // 冷卻中：不送出，直接回假 429
  if (spCooldownLeft() > 0 && !_spAllowedInCooldown(fullPath)) {
    appLog('API', `${method} ${shortPath} → 已擋下（429 冷卻中，沒有送出）`);
    return new Response(
      JSON.stringify({ error: { status: 429, message: 'Local cooldown: Spotify rate limit' } }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'X-Local-Cooldown': '1' } }
    );
  }

  _spReqTimes.push(Date.now());
  _spReqTotal++;
  const count30 = spRequestStats().last30s;
  if (count30 > _spPeak30) _spPeak30 = count30;

  let res;
  try {
    res = await _origFetch(input, init);
  } catch (e) {
    appLog('API', `${method} ${shortPath} → 網路錯誤`);
    throw e;
  }

  appLog('API', `${method} ${shortPath} → ${res.status}`);
  if (res.status === 429) _spOn429(res, shortPath, count30);
  else if (res.ok && _spStreak > 0 && _spLast429 && _spLast429.path &&
           _spLast429.path.split('?')[0] === shortPath.split('?')[0]) {
    // 之前被擋的那支 API 成功了 → 連續次數歸零
    _spStreak = 0;
    try { localStorage.setItem(SP_STREAK_KEY, '0'); } catch (e) { /* 忽略 */ }
  }
  return res;
};
