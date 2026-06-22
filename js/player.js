/**
 * player.js
 * 核心播放控制，跨模式共用。
 * 依賴：auth.js（getToken）、history.js（addToPlayedPlaylist）
 */

let currentTrackName = '';
let currentArtistName = '';

let _timerHandle = null;
let _tickHandle = null;
let _isTimerDone = false;
let _isPaused = false;
let _timerRemaining = 0;   // ms
let _timerStartedAt = 0;

let _isRevealed = false;

// ── 新增：記錄當前播放資訊 ──
let _currentUri = null;       // 目前播放的 URI
let _currentStartMs = 0;      // 播放開始位置（設定值）
let _pausedAtMs = null;       // 計時器斷點（毫秒）
let _endedBySong = false;     // true = 整首歌自然播完
let _pollHandle = null;       // polling interval handle

/* ── View 切換 ── */

function showView(name) {
  document.getElementById('login-view').style.display = name === 'login' ? 'block' : 'none';
  document.getElementById('player-view').style.display = name === 'player' ? 'flex' : 'none';
}

/* ── 狀態圓環 ── */

function setStatus(state, text) {
  const ring = document.getElementById('status-ring');
  const icon = document.getElementById('status-ring-icon');
  const pill = document.getElementById('ring-pill');
  const pState = document.getElementById('ring-pill-state');
  const pAction = document.getElementById('ring-pill-action');

  ring.classList.remove('playing', 'ended');

  if (state === 'playing') {
    ring.classList.add('playing');
    icon.className = 'ti ti-music';
    pill.style.display = 'flex';
    pState.textContent = '播放中 · ';
    pAction.textContent = '點我暫停';
  } else if (state === 'paused') {
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'flex';
    pState.textContent = '已暫停 · ';
    pAction.textContent = '點我繼續';
  } else if (state === 'ended') {
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'none';
  } else if (state === 'ended-timer') {
    // 我設定的時間到了，可從斷點繼續
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'flex';
    pState.textContent = '時間到 · ';
    pAction.textContent = '點我從斷點繼續';
  } else if (state === 'ended-song') {
    // 整首歌播完，可從頭重播
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'flex';
    pState.textContent = '播放完畢 · ';
    pAction.textContent = '點我重新播放';
  } else {
    icon.className = 'ti ti-nfc';
    pill.style.display = 'none';
  }

  document.getElementById('status-text').textContent = text;
}

function _showPlayPause(show) {
  const ring = document.getElementById('status-ring');
  if (show) ring.classList.add('clickable');
  else ring.classList.remove('clickable');
}

/** 圓環點擊：根據三種狀態分流 */
function ringTogglePlayPause() {
  if (!document.getElementById('status-ring').classList.contains('clickable')) return;

  if (_isTimerDone && _endedBySong) {
    // 整首歌播完 → 從設定的 start_ms 重頭播
    if (_currentUri) playTrack(_currentUri, _currentStartMs, null);
    return;
  }

  if (_isTimerDone && !_endedBySong) {
    // 我設定的時間到了 → 從斷點繼續播（不限時）
    if (_currentUri && _pausedAtMs !== null) {
      playTrack(_currentUri, _pausedAtMs, null, true); // true = 從斷點繼續
    }
    return;
  }

  // 一般播放中 / 暫停中 → 切換播放暫停
  _togglePlayPause();
}

async function _togglePlayPause() {
  if (_isTimerDone) return;
  const t = await getToken();
  if (!t) return;

  if (_isPaused) {
    await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + t },
    });
    _isPaused = false;
    setStatus('playing', '播放中');
    _resumeTimer();
  } else {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + t },
    });
    _isPaused = true;
    setStatus('paused', '已暫停');
    _pauseTimer();
  }
}

/* ── 計時器 ── */

function _pauseTimer() {
  if (!_timerStartedAt) return;
  _timerRemaining = Math.max(0, _timerRemaining - (Date.now() - _timerStartedAt));
  _timerStartedAt = 0;
  clearTimeout(_timerHandle);
  clearInterval(_tickHandle);

  const bar = document.getElementById('timer-bar');
  const currentWidth = window.getComputedStyle(bar).width;
  bar.style.transition = 'none';
  bar.style.width = currentWidth;

  document.getElementById('timer-label').textContent =
    Math.ceil(_timerRemaining / 1000) + ' 秒（暫停）';
}

function _resumeTimer() {
  if (_timerRemaining > 0) _runTimer(_timerRemaining);
}

function _runTimer(durationMs) {
  clearTimeout(_timerHandle);
  clearInterval(_tickHandle);
  _timerRemaining = durationMs;
  _timerStartedAt = Date.now();

  const bar = document.getElementById('timer-bar');
  const label = document.getElementById('timer-label');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bar.style.transition = `width ${durationMs}ms linear`;
      bar.style.width = '0%';
    });
  });

  let remaining = Math.ceil(durationMs / 1000);
  label.textContent = remaining + ' 秒';

  _tickHandle = setInterval(() => {
    remaining--;
    label.textContent = remaining <= 0 ? '時間到！' : remaining + ' 秒';
    if (remaining <= 0) clearInterval(_tickHandle);
  }, 1000);

  _timerHandle = setTimeout(async () => {
    clearInterval(_tickHandle);
    _isTimerDone = true;
    _endedBySong = false;
    _timerStartedAt = 0;

    const t = await getToken();

    // 取得斷點位置
    try {
      if (t) {
        const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          headers: { Authorization: 'Bearer ' + t },
        });
        if (r.status === 200) {
          const d = await r.json();
          if (d && d.progress_ms != null) {
            _pausedAtMs = d.progress_ms;
          }
        }
      }
    } catch (e) {
      console.error('取得斷點失敗:', e);
    }

    if (t) {
      await fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + t },
      });
    }

    _showPlayPause(true);
    setStatus('ended-timer', '音樂結束，等待揭曉');

  }, durationMs);
}

function startTimer(durationMs) {
  document.getElementById('timer-wrap').classList.add('show');
  const bar = document.getElementById('timer-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  _runTimer(durationMs);
}

function _resetTimer() {
  clearTimeout(_timerHandle);
  clearInterval(_tickHandle);
  _isTimerDone = false;
  _endedBySong = false;
  _pausedAtMs = null;
  _isPaused = false;
  _timerRemaining = 0;
  _timerStartedAt = 0;
  _showPlayPause(false);

  document.getElementById('timer-wrap').classList.remove('show');
  const bar = document.getElementById('timer-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
}

/* ── Polling：偵測整首歌播完 ── */

function _startPolling() {
  _stopPolling();
  _pollHandle = setInterval(_checkSongEnded, 3000);
}

function _stopPolling() {
  if (_pollHandle) {
    clearInterval(_pollHandle);
    _pollHandle = null;
  }
}

async function _checkSongEnded() {
  // 如果已經被計時器結束、或使用者暫停中，不需要 polling 判斷
  if (_isTimerDone || _isPaused) return;

  const t = await getToken();
  if (!t) return;

  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: 'Bearer ' + t },
    });

    // 204 = 沒有在播放任何東西
    if (r.status === 204) {
      _onSongEnded();
      return;
    }

    if (r.status === 200) {
      const d = await r.json();
      if (!d) return;

      // is_playing = false 且進度接近結尾（最後 3 秒內）→ 視為播完
      const nearEnd = d.item && d.progress_ms >= (d.item.duration_ms - 3000);
      if (!d.is_playing && nearEnd) {
        _onSongEnded();
      }
    }
  } catch (e) {
    console.error('polling error:', e);
  }
}

function _onSongEnded() {
  _stopPolling();
  if (_isTimerDone) return; // 已經被計時器處理過，不重複觸發

  _isTimerDone = true;
  _endedBySong = true;
  _showPlayPause(true);
  setStatus('ended-song', '音樂結束，等待揭曉');
}

/* ── 答案揭曉 ── */

function toggleReveal() {
  _isRevealed = !_isRevealed;
  const hidden = document.getElementById('answer-hidden');
  const revealed = document.getElementById('answer-revealed');

  if (_isRevealed) {
    document.getElementById('answer-song-name').textContent = currentTrackName || '（未知歌曲）';
    document.getElementById('answer-artist-name').textContent = currentArtistName || '';
    hidden.classList.add('hide');
    revealed.classList.add('show');
  } else {
    hidden.classList.remove('hide');
    revealed.classList.remove('show');
  }
}

function _resetAnswer() {
  _isRevealed = false;
  document.getElementById('answer-hidden').classList.remove('hide');
  document.getElementById('answer-revealed').classList.remove('show');
  document.getElementById('answer-song-name').textContent = '';
  document.getElementById('answer-artist-name').textContent = '';
  currentTrackName = '';
  currentArtistName = '';
}

/* ── 取得目前播放曲目資訊 ── */

async function _fetchTrackInfo() {
  const t = await getToken();
  if (!t) return;

  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: 'Bearer ' + t },
    });
    if (r.status === 200) {
      const d = await r.json();
      if (d && d.item) {
        currentTrackName = d.item.name;
        currentArtistName = d.item.artists.map(a => a.name).join(', ');
      }
    }
  } catch (e) {
    console.error('_fetchTrackInfo error:', e);
  }
}

/* ── 核心播放函式（跨模式共用） ── */

/**
 * 播放指定曲目。
 * @param {string} uri             Spotify track URI
 * @param {number|null} startMs    開始位置（毫秒），null = 從頭
 * @param {number|null} durationMs 限時長度（毫秒），null = 完整播放
 */
async function playTrack(uri, startMs, durationMs, isResume = false) {
  _stopPolling();
  _resetTimer();
  _resetAnswer();
  setStatus('idle', '連線中...');
  document.getElementById('mode-badge').classList.remove('show');

  // 記錄當前播放資訊
  _currentUri = uri;
  _currentStartMs = startMs || 0;

  const t = await getToken();
  if (!t) { setStatus('idle', '請重新登入'); showView('login'); return; }

  setStatus('idle', '尋找裝置...');

  let devices = [];
  try {
    const dr = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: 'Bearer ' + t },
    });
    if (dr.status === 401) { setStatus('idle', '登入過期，請重新登入'); doLogout(); return; }
    if (!dr.ok) { setStatus('idle', `裝置查詢失敗（${dr.status}），請稍後再試`); return; }
    const dd = await dr.json();
    devices = dd.devices || [];
  } catch (e) {
    setStatus('idle', '網路錯誤，請確認連線');
    console.error('devices fetch error:', e);
    return;
  }

  if (devices.length === 0) {
    setStatus('idle', '找不到裝置！請先開啟 Spotify app');
    return;
  }

  const dev = devices.find(d => d.is_active) || devices[0];
  const body = { uris: [uri] };
  if (startMs && startMs > 0) body.position_ms = startMs;

  setStatus('idle', '切換歌曲...');

  try {
    const pr = await fetch('https://api.spotify.com/v1/me/player/play?device_id=' + dev.id, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (pr.status === 403) { setStatus('idle', '需要 Spotify Premium'); return; }

    if (pr.status === 204 || pr.status === 200) {
      _isPaused = false;
      setStatus('playing', '播放中');
      _showPlayPause(true);

      const badgeParts = [];
    if (startMs && startMs > 0) {
        if (isResume) {
          badgeParts.push('從斷點接續播放中');
        } else {
          badgeParts.push(`從 ${Math.round(startMs / 1000)} 秒開始`);
        }
      }
      if (durationMs) badgeParts.push(`限時 ${Math.round(durationMs / 1000)} 秒`);
      const badge = document.getElementById('mode-badge');
      if (badgeParts.length > 0) {
        badge.textContent = badgeParts.join(' · ');
        badge.classList.add('show');
      }

      if (durationMs) {
        // 有限時 → 啟動計時器，計時結束後處理斷點
        setTimeout(() => startTimer(durationMs), 500);
      } else {
        // 沒有限時 → 啟動 polling 偵測整首歌播完
        setTimeout(() => _startPolling(), 3000); // 延遲 3 秒再開始偵測，避免剛播就誤判
      }

      setTimeout(async () => {
        await _fetchTrackInfo();
        addToPlayedPlaylist(uri);
      }, 1000);

    } else {
      setStatus('idle', '播放失敗（狀態碼 ' + pr.status + '）');
    }
  } catch (e) {
    setStatus('idle', '播放請求失敗，請稍後再試');
    console.error('playTrack error:', e);
  }
}

/* ── Debug ── */

async function doDebug() {
  const box = document.getElementById('debug-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.textContent = '測試中...\n';

  const t = localStorage.getItem('spotify_token');
  const exp = localStorage.getItem('spotify_expires');
  box.textContent += 'Token: ' + (t ? t.substring(0, 15) + '...' : '無') + '\n';
  box.textContent += 'Token 有效: ' + (exp ? (Date.now() < parseInt(exp, 10) ? '是' : '已過期') : '無') + '\n';
  const runtimeOk = await getToken();
  box.textContent += 'Runtime token: ' + (runtimeOk ? '有' : '無') + '\n\n';

  const s = loadSettings();
  box.textContent += `限時模式: ${s.limitMode}\n播放秒數: ${s.durationSec}\n開始位置: ${s.startSec}秒\n\n`;
  box.textContent += `當前 URI: ${_currentUri || '無'}\n`;
  box.textContent += `斷點位置: ${_pausedAtMs !== null ? Math.round(_pausedAtMs / 1000) + ' 秒' : '無'}\n\n`;

  if (!runtimeOk) { box.textContent += '沒有有效 Token，請重新登入'; return; }

  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: 'Bearer ' + runtimeOk },
    });
    box.textContent += 'API 狀態: ' + r.status + '\n';
    const d = await r.json();
    box.textContent += '裝置數量: ' + (d.devices ? d.devices.length : 0) + '\n';
    (d.devices || []).forEach(dev => {
      box.textContent += `- ${dev.name} (${dev.type}) 活躍:${dev.is_active}\n`;
    });
    if (!d.devices || d.devices.length === 0) box.textContent += JSON.stringify(d) + '\n';
  } catch (e) {
    box.textContent += '錯誤: ' + e.message;
  }
}

// player.js 底部
function isPlaying() { return !_isPaused && !_isTimerDone; }
function isPaused() { return _isPaused && !_isTimerDone; }
function isTimerDone() { return _isTimerDone; }
