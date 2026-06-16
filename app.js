const CLIENT_ID    = 'de45db7ad49b41efb68dbaa362f65f8c';
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';

let token = null, currentTrackName = '', currentArtistName = '';
let timerHandle = null, isTimerDone = false, isPaused = false;
let timerRemainingMs = 0, timerStartedAt = 0, tickHandle = null;
let isRevealed = false;

function loadSettings() {
  const raw = localStorage.getItem('player_settings');
  const d = { limitMode: false, durationSec: 30, startSec: 0 };
  if (!raw) return d;
  try { return { ...d, ...JSON.parse(raw) }; } catch(e) { return d; }
}

function applySettingsToUI(s) {
  document.getElementById('setting-limit').checked = s.limitMode;
  document.getElementById('display-start').textContent = s.startSec + ' 秒';
  document.getElementById('display-dur').textContent   = s.durationSec + ' 秒';
  const durRow = document.getElementById('row-duration');
  if (durRow) durRow.classList.toggle('disabled', !s.limitMode);
  const parts = [];
  if (s.startSec > 0) parts.push('從' + s.startSec + '秒');
  if (s.limitMode) parts.push('限時' + s.durationSec + '秒');
  const el = document.getElementById('settings-summary');
  if (el) el.textContent = parts.join(' · ');
}

function stepSetting(key, delta) {
  const s = loadSettings();
  if (key === 'start') s.startSec    = Math.max(0,  Math.min(600, s.startSec + delta));
  else                 s.durationSec = Math.max(5,  Math.min(300, s.durationSec + delta));
  localStorage.setItem('player_settings', JSON.stringify(s));
  applySettingsToUI(s);
}

function onLimitToggle() {
  const s = loadSettings();
  s.limitMode = document.getElementById('setting-limit').checked;
  localStorage.setItem('player_settings', JSON.stringify(s));
  applySettingsToUI(s);
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const btn   = document.getElementById('settings-toggle-btn');
  const open  = panel.classList.toggle('open');
  btn.classList.toggle('open', open);
}

function showView(name) {
  document.getElementById('login-view').style.display  = name === 'login'  ? 'block' : 'none';
  document.getElementById('player-view').style.display = name === 'player' ? 'flex'  : 'none';
}

function setStatus(state, text) {
  const ring   = document.getElementById('status-ring');
  const icon   = document.getElementById('status-ring-icon');
  const pill   = document.getElementById('ring-pill');
  const pState = document.getElementById('ring-pill-state');
  const pAction= document.getElementById('ring-pill-action');
  ring.classList.remove('playing', 'ended');

  if (state === 'playing') {
    ring.classList.add('playing');
    icon.className = 'ti ti-music';
    pill.style.display = 'flex';
    pState.textContent  = '播放中 · ';
    pAction.textContent = '點我暫停';
  } else if (state === 'paused') {
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'flex';
    pState.textContent  = '已暫停 · ';
    pAction.textContent = '點我繼續';
  } else if (state === 'ended') {
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'none';
  } else {
    icon.className = 'ti ti-nfc';
    pill.style.display = 'none';
  }
  document.getElementById('status-text').textContent = text;
}

function login() {
  const state = rand(16), verifier = rand(64);
  sessionStorage.setItem('cv', verifier); sessionStorage.setItem('st', state);
  challenge(verifier).then(ch => {
    const p = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, scope: SCOPES, redirect_uri: REDIRECT_URI, state, code_challenge_method: 'S256', code_challenge: ch, show_dialog: 'true' });
    window.location = 'https://accounts.spotify.com/authorize?' + p;
  });
}

function doLogout() {
  localStorage.clear();
  token = null; showView('login');
}

function rand(n) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let r = ''; for (let i = 0; i < n; i++) r += c[Math.floor(Math.random() * c.length)]; return r;
}

async function challenge(v) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function handleCallback() {
  const p = new URLSearchParams(window.location.search);
  const code = p.get('code'), state = p.get('state');
  if (!code || state !== sessionStorage.getItem('st')) return false;
  window.history.replaceState({}, '', window.location.pathname);
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: sessionStorage.getItem('cv') })
  });
  const d = await r.json();
  if (d.access_token) {
    token = d.access_token;
    localStorage.setItem('spotify_token', token); localStorage.setItem('spotify_refresh', d.refresh_token);
    localStorage.setItem('spotify_expires', Date.now() + d.expires_in * 1000);
    return true;
  }
  return false;
}

async function refreshToken() {
  const refresh = localStorage.getItem('spotify_refresh');
  if (!refresh) return false;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLIENT_ID })
  });
  const d = await r.json();
  if (d.access_token) { token = d.access_token; localStorage.setItem('spotify_token', token); localStorage.setItem('spotify_expires', Date.now() + d.expires_in * 1000); return true; }
  return false;
}

async function getToken() {
  if (token) return token;
  const t = localStorage.getItem('spotify_token'), exp = localStorage.getItem('spotify_expires');
  if (t && exp && Date.now() < parseInt(exp) - 60000) { token = t; return token; }
  return await refreshToken() ? token : null;
}

function parsePlayParams() {
  const p = new URLSearchParams(window.location.search), uri = p.get('uri');
  if (!uri) return null;
  const s = loadSettings();
  const startMs    = p.has('start_ms')    ? parseInt(p.get('start_ms'))    : null;
  const durationMs = p.has('duration_ms') ? parseInt(p.get('duration_ms')) : null;
  return { uri, startMs: startMs !== null ? startMs : s.startSec * 1000, durationMs: durationMs !== null ? durationMs : (s.limitMode ? s.durationSec * 1000 : null) };
}

function showPlayPause(show) {
  const ring = document.getElementById('status-ring');
  if (show) ring.classList.add('clickable'); else ring.classList.remove('clickable');
}

function ringTogglePlayPause() {
  if (isTimerDone) return;
  if (!document.getElementById('status-ring').classList.contains('clickable')) return;
  togglePlayPause();
}

async function togglePlayPause() {
  if (isTimerDone) return;
  const t = await getToken(); if (!t) return;
  if (isPaused) {
    await fetch('https://api.spotify.com/v1/me/player/play', { method: 'PUT', headers: { Authorization: 'Bearer ' + t } });
    isPaused = false; setStatus('playing', '播放中'); resumeTimer();
  } else {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { Authorization: 'Bearer ' + t } });
    isPaused = true; setStatus('paused', '已暫停'); pauseTimer();
  }
}

function pauseTimer() {
  if (!timerStartedAt) return;
  timerRemainingMs = Math.max(0, timerRemainingMs - (Date.now() - timerStartedAt));
  timerStartedAt = 0; 
  clearTimeout(timerHandle); 
  clearInterval(tickHandle);
  
  const bar = document.getElementById('timer-bar');
  
  // 關鍵修正：先取得當下的實際寬度，再把動畫關掉
  const currentWidth = window.getComputedStyle(bar).width;
  bar.style.transition = 'none'; 
  bar.style.width = currentWidth;
  
  document.getElementById('timer-label').textContent = Math.ceil(timerRemainingMs / 1000) + ' 秒（暫停）';
}

function resumeTimer() { if (timerRemainingMs > 0) runTimer(timerRemainingMs); }

function runTimer(durationMs) {
  clearTimeout(timerHandle); clearInterval(tickHandle);
  timerRemainingMs = durationMs; timerStartedAt = Date.now();
  const bar = document.getElementById('timer-bar'), label = document.getElementById('timer-label');
  requestAnimationFrame(() => { requestAnimationFrame(() => { bar.style.transition = `width ${durationMs}ms linear`; bar.style.width = '0%'; }); });
  let remaining = Math.ceil(durationMs / 1000); label.textContent = remaining + ' 秒';
  tickHandle = setInterval(() => { remaining--; label.textContent = remaining <= 0 ? '時間到！' : remaining + ' 秒'; if (remaining <= 0) clearInterval(tickHandle); }, 1000);
  timerHandle = setTimeout(async () => {
    clearInterval(tickHandle); isTimerDone = true; timerStartedAt = 0; showPlayPause(false);
    const t = await getToken();
    if (t) await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { Authorization: 'Bearer ' + t } });
    setStatus('ended', '音樂結束，等待揭曉');
  }, durationMs);
}

function startTimer(durationMs) {
  document.getElementById('timer-wrap').classList.add('show');
  const bar = document.getElementById('timer-bar'); bar.style.transition = 'none'; bar.style.width = '100%';
  runTimer(durationMs);
}

function resetTimer() {
  clearTimeout(timerHandle); clearInterval(tickHandle);
  isTimerDone = false; isPaused = false; timerRemainingMs = 0; timerStartedAt = 0;
  showPlayPause(false);
  document.getElementById('timer-wrap').classList.remove('show');
  const bar = document.getElementById('timer-bar'); bar.style.transition = 'none'; bar.style.width = '100%';
}

async function playTrack(uri, startMs, durationMs) {
  resetTimer(); setStatus('idle', '連線中...');
  document.getElementById('mode-badge').classList.remove('show');
  const t = await getToken(); if (!t) { setStatus('idle', '請重新登入'); showView('login'); return; }
  setStatus('idle', '尋找裝置...');
  const dr = await fetch('https://api.spotify.com/v1/me/player/devices', { headers: { Authorization: 'Bearer ' + t } });
  if (dr.status === 401) { setStatus('idle', '登入過期，請重新登入'); doLogout(); return; }
  const dd = await dr.json(), devices = dd.devices || [];
  if (devices.length === 0) { setStatus('idle', '找不到裝置！請先開啟 Spotify app'); return; }
  const dev = devices.find(d => d.is_active) || devices[0];
  setStatus('idle', '切換歌曲...');
  const body = { uris: [uri] }; if (startMs && startMs > 0) body.position_ms = startMs;
  const pr = await fetch('https://api.spotify.com/v1/me/player/play?device_id=' + dev.id, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (pr.status === 403) { setStatus('idle', '需要 Spotify Premium'); return; }
  if (pr.status === 204 || pr.status === 200) {
    setStatus('playing', '播放中'); isPaused = false; showPlayPause(true);
    
    // 關鍵修正：動態組合 startMs 與 durationMs 的顯示文字
    const badgeParts = [];
    if (startMs && startMs > 0) {
      badgeParts.push(`從 ${Math.round(startMs / 1000)} 秒開始`);
    }
    if (durationMs) {
      badgeParts.push(`限時 ${Math.round(durationMs / 1000)} 秒`);
      // 只有在有限時的情況下才啟動計時器
      setTimeout(() => startTimer(durationMs), 500);
    }

    // 如果有任何設定，就顯示標籤
    const badge = document.getElementById('mode-badge');
    if (badgeParts.length > 0) {
      badge.textContent = badgeParts.join(' · ');
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
    
    setTimeout(async () => {
      await getTrackInfo();
      await addToPlayedPlaylist(uri);
    }, 1000);
    
    } else { setStatus('idle', '播放失敗（狀態碼 ' + pr.status + '）'); }
}

async function getTrackInfo() {
  const t = await getToken(); if (!t) return;
  const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 200) { const d = await r.json(); if (d && d.item) { currentTrackName = d.item.name; currentArtistName = d.item.artists.map(a => a.name).join(', '); } }
}

function toggleReveal() {
  isRevealed = !isRevealed;
  const hidden = document.getElementById('answer-hidden'), revealed = document.getElementById('answer-revealed');
  if (isRevealed) {
    document.getElementById('answer-song-name').textContent   = currentTrackName  || '（未知歌曲）';
    document.getElementById('answer-artist-name').textContent = currentArtistName || '';
    hidden.classList.add('hide'); revealed.classList.add('show');
  } else { hidden.classList.remove('hide'); revealed.classList.remove('show'); }
}

function checkNFC() {
  const params = parsePlayParams(); if (!params || !token) return;
  window.history.replaceState({}, '', window.location.pathname);
  isRevealed = false;
  document.getElementById('answer-hidden').classList.remove('hide');
  document.getElementById('answer-revealed').classList.remove('show');
  document.getElementById('answer-song-name').textContent = '';
  document.getElementById('answer-artist-name').textContent = '';
  currentTrackName = ''; currentArtistName = '';
  setTimeout(() => playTrack(params.uri, params.startMs, params.durationMs), 300);
}

async function doDebug() {
  const box = document.getElementById('debug-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  box.style.display = 'block'; box.textContent = '測試中...\n';
  const t = localStorage.getItem('spotify_token'), exp = localStorage.getItem('spotify_expires');
  box.textContent += 'Token: ' + (t ? t.substring(0,15) + '...' : '無') + '\n';
  box.textContent += 'Token 有效: ' + (exp ? (Date.now() < parseInt(exp) ? '是' : '已過期') : '無') + '\n';
  box.textContent += 'accessToken 變數: ' + (token ? '有' : '無') + '\n\n';
  const s = loadSettings();
  box.textContent += '限時模式: ' + s.limitMode + '\n播放秒數: ' + s.durationSec + '\n開始位置: ' + s.startSec + '秒\n\n';
  if (!t) { box.textContent += '沒有 Token，請重新登入'; return; }
  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/devices', { headers: { Authorization: 'Bearer ' + t } });
    box.textContent += 'API 狀態: ' + r.status + '\n';
    const d = await r.json();
    box.textContent += '裝置數量: ' + (d.devices ? d.devices.length : 0) + '\n';
    (d.devices || []).forEach(dev => { box.textContent += `- ${dev.name} (${dev.type}) 活躍:${dev.is_active}\n`; });
    if (!d.devices || d.devices.length === 0) box.textContent += JSON.stringify(d) + '\n';  
  } catch(e) { box.textContent += '錯誤: ' + e.message; }
}

function addToPlayedPlaylist(trackUri) {
  const today = new Date().toDateString();
  const key = 'played_' + today;
  const played = JSON.parse(localStorage.getItem(key) || '[]');
  const exists = played.find(item => item.uri === trackUri);
  if (!exists) {
    played.push({ uri: trackUri, name: currentTrackName, artist: currentArtistName });
    localStorage.setItem(key, JSON.stringify(played));
    showToast();
  }
}

function showToast() {
  const toast = document.getElementById('played-toast');
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

async function init() {
  applySettingsToUI(loadSettings());
  const ok = await handleCallback();
  if (ok) { showView('player'); checkNFC(); return; }
  const t = await getToken();
  if (t) { showView('player'); checkNFC(); return; }
  showView('login');
} 

function togglePlayedList() {
  const box = document.getElementById('played-list-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  
  const today = new Date().toDateString();
  const played = JSON.parse(localStorage.getItem('played_' + today) || '[]');
  
  if (played.length === 0) {
    box.innerHTML = '<div style="color:var(--muted);text-align:center">今天還沒播放任何歌曲</div>';
  } else {
    box.innerHTML = played.map(item => `
      <div class="played-item">
        <div class="played-song">${item.name || item}</div>
        <div class="played-artist">${item.artist || ''}</div>
      </div>
    `).join('');
  }
  box.style.display = 'block';
}

init();
