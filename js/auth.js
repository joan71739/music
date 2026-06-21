/**
 * auth.js
 * Spotify OAuth 2.0 PKCE 流程
 * 負責：登入、登出、token 取得與自動更新
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

function _rand(n) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < n; i++) r += c[Math.floor(Math.random() * c.length)];
  return r;
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