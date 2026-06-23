/**
 * player.js
 * 核心播放控制，跨模式共用。
 * 依賴：auth.js（getToken）、history.js（addToPlayedPlaylist）
 */

// ── 多人模式：房間碼 & currentTrack 同步 ──
const _roomCode = new URLSearchParams(window.location.search).get('room');

async function syncCurrentTrack(name, artist, uri) {
  if (!_roomCode) return;
  try {
    await currentTrackRef(_roomCode).set({ name, artist, uri });
    await buzzerRef(_roomCode).set({
      status: 'idle',
      playerId: null,
      playerName: null,
      playerEmoji: null,
      buzzerTime: null,
      answeredWrong: [],
    });
  } catch (e) {
    console.warn('syncCurrentTrack 失敗:', e);
  }
}
// ─────────────────────────────────────────

let currentTrackName = '';
let currentArtistName = '';

let _timerHandle = null;
let _tickHandle = null;
let _isTimerDone = false;
let _isPaused = false;
let _timerRemaining = 0;   // ms
let _timerStartedAt = 0;

let _isRevealed = false;

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
  } else if (state === 'ended-timer') {
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'flex';
    pState.textContent = '時間到 · ';
    pAction.textContent = '點我從斷點繼續';
  } else if (state === 'ended-song') {
    ring.classList.add('ended');
    icon.className = 'ti ti-player-pause';
    pill.style.display = 'flex';
    pState.textContent = '播放完畢 · ';
    pAction.textContent = '點我重新播放';
  } else {
    // idle / ended
    icon.className = 'ti ti-nfc';
    pill.style.display = 'none';
  }

  const statusText = document.getElementById('status-text');
  if (text && statusText) statusText.textContent = text;
}

/* ── 播放/暫停 按鈕顯示控制 ── */

function _showPlayPause(show) {
  const btn = document.getElementById('btn-next');
  if (btn) btn.style.display = show ? 'flex' : 'none';
}

/* ── 圓環點擊：播放/暫停 切換 ── */

async function ringTogglePlayPause() {
  if (_isTimerDone || _endedBySong) {
    // 時間到或播完 → 從斷點接續
    if (_pausedAtMs !== null && _currentUri) {
      await playTrack(_currentUri, _pausedAtMs, null, true);
    } else if (_currentUri) {
      await playTrack(_currentUri, _currentStartMs, null, false);
    }
    return;
  }

  if (_isPaused) {
    await _resumePlay();
  } else {
    await _pausePlay();
  }
}

async function _pausePlay() {
  const t = await getToken();
  if (!t) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + t },
    });
    _isPaused = true;
    _pauseTimer();
    setStatus('paused', '已暫停');
  } catch (e) {
    console.error('pause error:', e);
  }
}

async function _resumePlay() {
  const t = await getToken();
  if (!t) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + t },
    });
    _isPaused = false;
    _resumeTimer();
    setStatus('playing', '播放中');
  } catch (e) {
    console.error('resume error:', e);
  }
}

/* ── 計時器 ── */

function startTimer(durationMs) {
  _resetTimer();
  _timerRemaining = durationMs;
  _timerStartedAt = Date.now();

  const bar = document.getElementById('timer-bar');
  const label = document.getElementById('timer-label');
  const wrap = document.getElementById('timer-wrap');
  if (wrap) wrap.style.display = 'block';

  bar.style.transition = 'none';
  bar.style.width = '100%';

  _tickHandle = setInterval(() => {
    const elapsed = Date.now() - _timerStartedAt;
    const remaining = _timerRemaining - elapsed;

    if (remaining <= 0) {
      _onTimerDone();
      return;
    }

    const pct = (remaining / durationMs) * 100;
    bar.style.transition = 'width 0.5s linear';
    bar.style.width = pct + '%';
    if (label) label.textContent = Math.ceil(remaining / 1000) + ' 秒';
  }, 200);

  _timerHandle = setTimeout(() => _onTimerDone(), durationMs);
}

function _onTimerDone() {
  clearInterval(_tickHandle);
  clearTimeout(_timerHandle);
  _tickHandle = null;
  _timerHandle = null;
  _isTimerDone = true;
  _pausedAtMs = _currentStartMs + (_timerRemaining);

  const bar = document.getElementById('timer-bar');
  const label = document.getElementById('timer-label');
  if (bar) { bar.style.transition = 'width 0.3s'; bar.style.width = '0%'; }
  if (label) label.textContent = '時間到！';

  setStatus('ended-timer', '時間到！');
  _showPlayPause(true);

  // 暫停 Spotify
  getToken().then(t => {
    if (t) fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + t },
    }).catch(() => { });
  });
}

function _pauseTimer() {
  if (_tickHandle) { clearInterval(_tickHandle); _tickHandle = null; }
  if (_timerHandle) { clearTimeout(_timerHandle); _timerHandle = null; }
  _timerRemaining = _timerRemaining - (Date.now() - _timerStartedAt);
  _pausedAtMs = _currentStartMs + ((_timerRemaining > 0 ? 0 : 0));
}

function _resumeTimer() {
  if (_isTimerDone) return;
  _timerStartedAt = Date.now();
  const bar = document.getElementById('timer-bar');
  const durationMs = _timerRemaining;

  _tickHandle = setInterval(() => {
    const elapsed = Date.now() - _timerStartedAt;
    const remaining = _timerRemaining - elapsed;
    if (remaining <= 0) { _onTimerDone(); return; }
    const pct = (remaining / durationMs) * 100;
    if (bar) { bar.style.transition = 'width 0.5s linear'; bar.style.width = pct + '%'; }
    const label = document.getElementById('timer-label');
    if (label) label.textContent = Math.ceil(remaining / 1000) + ' 秒';
  }, 200);

  _timerHandle = setTimeout(() => _onTimerDone(), _timerRemaining);
}

function _resetTimer() {
  clearInterval(_tickHandle);
  clearTimeout(_timerHandle);
  _tickHandle = null;
  _timerHandle = null;
  _isTimerDone = false;
  _isPaused = false;
  _timerRemaining = 0;
  _timerStartedAt = 0;
  _pausedAtMs = null;
  _endedBySong = false;

  const bar = document.getElementById('timer-bar');
  const label = document.getElementById('timer-label');
  const wrap = document.getElementById('timer-wrap');
  if (wrap) wrap.style.display = 'none';
  if (label) label.textContent = '';
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
  }
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
  if (_isTimerDone || _isPaused) return;

  const t = await getToken();
  if (!t) return;

  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: 'Bearer ' + t },
    });

    if (r.status === 204) { _onSongEnded(); return; }

    if (r.status === 200) {
      const d = await r.json();
      if (!d) return;
      const nearEnd = d.item && d.progress_ms >= (d.item.duration_ms - 3000);
      if (!d.is_playing && nearEnd) _onSongEnded();
    }
  } catch (e) {
    console.error('polling error:', e);
  }
}

function _onSongEnded() {
  _stopPolling();
  if (_isTimerDone) return;

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

/* ── 從 URI 直接預取歌曲資訊（方案 B：0 延遲，不依賴 currently-playing 更新） ── */

async function _fetchTrackInfo(uri) {
  const trackId = uri.split(':')[2];  // 'spotify:track:XXXX' → 'XXXX'
  if (!trackId) return;

  const t = await getToken();
  if (!t) return;

  try {
    const r = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: 'Bearer ' + t },
    });
    if (r.ok) {
      const d = await r.json();
      currentTrackName = d.name || '';
      currentArtistName = d.artists?.map(a => a.name).join(', ') || '';
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
 * @param {boolean} isResume       true = 從斷點接續播放
 */
async function playTrack(uri, startMs, durationMs, isResume = false) {
  _stopPolling();
  _resetTimer();   // 內部已包含 _isPaused = false
  _resetAnswer();
  setStatus('idle', '連線中...');
  document.getElementById('mode-badge').classList.remove('show');

  _currentUri = uri;
  _currentStartMs = startMs || 0;

  const t = await getToken();
  if (!t) { setStatus('idle', '請重新登入'); showView('login'); return; }

  // 預取歌曲資訊（從 URI 直接解 track id，不需等播放狀態更新）
  _fetchTrackInfo(uri);

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
      setStatus('playing', '播放中');
      _showPlayPause(true);

      const badgeParts = [];
      if (startMs && startMs > 0) {
        badgeParts.push(isResume
          ? '從斷點接續播放中'
          : `從 ${Math.round(startMs / 1000)} 秒開始`
        );
      }
      if (durationMs) badgeParts.push(`限時 ${Math.round(durationMs / 1000)} 秒`);
      const badge = document.getElementById('mode-badge');
      if (badgeParts.length > 0) {
        badge.textContent = badgeParts.join(' · ');
        badge.classList.add('show');
      }

      if (durationMs) {
        setTimeout(() => startTimer(durationMs), 500);
      } else {
        setTimeout(() => _startPolling(), 3000);
      }

      // 加入今日歌單（不影響播放流程，fire-and-forget）
      addToPlayedPlaylist(uri);

      // 多人模式：同步 currentTrack 到 Firebase（延遲 1 秒讓 _fetchTrackInfo 跑完）
      setTimeout(() => syncCurrentTrack(currentTrackName, currentArtistName, uri), 1000);

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
  box.textContent += `歌曲名稱: ${currentTrackName || '未取得'}\n`;
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

/* ═══════════════════════════════════════════
   多人模式：Firebase buzzer + 分數板監聽
   只在有 room 參數時才會被呼叫
═══════════════════════════════════════════ */

let _prevBuzzerStatus = null;  // 防止重複觸發

function initMultiplayerListeners() {
  if (!_roomCode) return;

  // ── 監聽 buzzer ──
  buzzerRef(_roomCode).on('value', async snap => {
    const buzzer = snap.val() || {};
    const status = buzzer.status || 'idle';
    const name = buzzer.playerName || '';
    const emoji = buzzer.playerEmoji || '';

    // 更新搶答狀態列
    _renderBuzzerStatusBar(status, name, emoji);

    // ▼ 新增：同步更新判定按鈕的 enable/disable
    _updatePlayJudgeBtns(status);

    // buzzing：自動暫停音樂 + 圓環聯動
    if (status === 'buzzing' && _prevBuzzerStatus !== 'buzzing') {
      if (!_isPaused && !_isTimerDone) {
        const t = await getToken();
        if (t) {
          try {
            await fetch('https://api.spotify.com/v1/me/player/pause', {
              method: 'PUT', headers: { Authorization: 'Bearer ' + t },
            });
            _isPaused = true;
            _pauseTimer();
            setStatus('paused', `🔴 ${emoji}${name} 搶答中！`);
            _showPlayPause(true);
          } catch (e) {
            console.warn('搶答暫停失敗:', e);
          }
        }
      }
    }

    // waiting-next：host 按跳過 → 自動播下一首
    if (status === 'waiting-next' && _prevBuzzerStatus !== 'waiting-next') {
      setTimeout(() => {
        if (typeof playFromPlaylist === 'function') {
          playFromPlaylist();
        }
      }, 500);
    }

    _prevBuzzerStatus = status;
  });

  // ── 監聽 players 分數板 ──
  playersRef(_roomCode).on('value', snap => {
    _renderScoreboard(snap.val() || {});
  });
}

function _renderBuzzerStatusBar(status, name, emoji) {
  const el = document.getElementById('play-buzzer-status');
  if (!el) return;
  const map = {
    'idle': '🎤 等待搶答中...',
    'buzzing': `🔴 ${emoji}${name} 搶答中！請回答`,
    'locked': `❌ ${emoji}${name} 答錯，其他人倒數中...`,
    'judged': `✅ ${emoji}${name} 答對！等待下一首`,
    'waiting-next': '⏭ 等待下一首...',
  };
  el.textContent = map[status] || '';
}

function _renderScoreboard(players) {
  const el = document.getElementById('play-scoreboard');
  if (!el) return;
  const sorted = Object.values(players)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  if (sorted.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = sorted.map(p =>
    `<div class="play-score-item">
      <span class="play-score-avatar">${p.emoji || p.avatar || '🎵'}</span>
      <span class="play-score-name">${_escHtml(p.name || '玩家')}</span>
      <span class="play-score-pts">${p.score || 0}分</span>
    </div>`
  ).join('');
}

function _escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ═══════════════════════════════════════════
   判定按鈕（play.html 多人模式，筆電端操作）
═══════════════════════════════════════════ */

/**
 * 根據 buzzer 狀態控制判定按鈕 enable/disable。
 * 只有 buzzing 時才能按，其他狀態全部 disabled。
 */
function _updatePlayJudgeBtns(status) {
  const canJudge = (status === 'buzzing');
  ['pj-btn-1', 'pj-btn-2', 'pj-btn-3', 'pj-btn-wrong'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canJudge;
  });
}

/**
 * 答對：給搶答者加分 + buzzer → judged
 * @param {number} pts 加分數（1/2/3）
 */
async function playJudgeCorrect(pts) {
  if (!_roomCode) return;

  // 先讀目前搶答者（避免 race condition）
  let buzzer;
  try {
    const snap = await buzzerRef(_roomCode).get();
    buzzer = snap.val() || {};
  } catch (e) {
    console.error('playJudgeCorrect 讀取失敗:', e);
    return;
  }

  if (buzzer.status !== 'buzzing' || !buzzer.playerId) return;

  // 立即鎖住按鈕，防止重複點擊
  _updatePlayJudgeBtns('judged');

  try {
    // 更新分數（transaction 確保原子性）
    await playersRef(_roomCode).child(buzzer.playerId).child('score')
      .transaction(cur => (cur || 0) + pts);

    // buzzer → judged
    await buzzerRef(_roomCode).update({ status: 'judged' });
  } catch (e) {
    console.error('playJudgeCorrect 失敗:', e);
    // 失敗時恢復按鈕（重新監聽狀態自然會更新）
  }
}

/**
 * 答錯：將此玩家加入 answeredWrong + buzzer → locked
 * play.html 自己負責倒數 3 秒後把 status 改回 idle
 */
async function playJudgeWrong() {
  if (!_roomCode) return;

  let buzzer;
  try {
    const snap = await buzzerRef(_roomCode).get();
    buzzer = snap.val() || {};
  } catch (e) {
    console.error('playJudgeWrong 讀取失敗:', e);
    return;
  }

  if (buzzer.status !== 'buzzing' || !buzzer.playerId) return;

  // 立即鎖住按鈕，防止重複點擊
  _updatePlayJudgeBtns('locked');

  try {
    const wrongList = Array.isArray(buzzer.answeredWrong) ? buzzer.answeredWrong : [];
    if (!wrongList.includes(buzzer.playerId)) {
      wrongList.push(buzzer.playerId);
    }

    // 一次更新：answeredWrong + status → locked
    await buzzerRef(_roomCode).update({
      status: 'locked',
      answeredWrong: wrongList,
    });

    // play.html 負責倒數 3 秒後重置 status → idle（answeredWrong 保留）
    setTimeout(async () => {
      try {
        await buzzerRef(_roomCode).update({ status: 'idle' });
      } catch (e) {
        console.warn('倒數重置 idle 失敗:', e);
      }
    }, 3000);

  } catch (e) {
    console.error('playJudgeWrong 失敗:', e);
  }
}