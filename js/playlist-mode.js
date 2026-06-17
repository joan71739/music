/**
 * playlist-mode.js
 * 主題選歌模式
 * 依賴：auth.js（getToken）、player.js（playTrack、setStatus）、nfc.js（loadSettings）
 */

let _playlists       = [];
let _selectedId      = null;
let _playlistsLoaded = false;

/* ── Tab 切換 ── */

function switchModeTab(tab) {
  const nfcBtn    = document.getElementById('tab-btn-nfc');
  const plBtn     = document.getElementById('tab-btn-playlist');
  const plPanel   = document.getElementById('playlist-mode-panel');
  const statusText = document.getElementById('status-text');
  const ringIcon  = document.getElementById('status-ring-icon');

  if (tab === 'nfc') {
    nfcBtn.classList.add('active');
    plBtn.classList.remove('active');
    plPanel.style.display = 'none';
    if (ringIcon)   ringIcon.className = 'ti ti-nfc';
    if (statusText) statusText.textContent = '靠近 NFC 卡開始播放';
  } else {
    plBtn.classList.add('active');
    nfcBtn.classList.remove('active');
    plPanel.style.display = 'flex';
    if (ringIcon)   ringIcon.className = 'ti ti-music';
    if (statusText) statusText.textContent = '選擇主題包後隨機播放';
    if (!_playlistsLoaded) _loadPlaylists();
  }
}

/* ── 載入歌單列表 ── */

async function _loadPlaylists() {
  const listEl = document.getElementById('playlist-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="pl-loading"><i class="ti ti-loader-2" aria-hidden="true"></i> 載入中...</div>';

  const t = await getToken();
  if (!t) {
    listEl.innerHTML = '<div class="pl-error">請重新登入</div>';
    return;
  }

  try {
    // 先取得自己的 user id，才能過濾出自己建立的歌單
    const meR = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: 'Bearer ' + t }
    });
    const me = await meR.json();
    const myId = me.id;

    const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: 'Bearer ' + t }
    });

    if (!r.ok) {
      listEl.innerHTML = '<div class="pl-error">歌單載入失敗（' + r.status + '）</div>';
      return;
    }

    const d = await r.json();
    // 只保留自己建立的歌單（owner.id === 自己），避免抓別人的歌單內容時 403
    _playlists = (d.items || []).filter(p => p && p.id && p.name && p.owner && p.owner.id === myId);

    if (_playlists.length === 0) {
      listEl.innerHTML = '<div class="pl-error">找不到你自己建立的歌單<br><small>儲存別人的歌單無法讀取，請自己新建歌單</small></div>';
      return;
    }

    _playlistsLoaded = true;
    _renderPlaylists();

  } catch (e) {
    listEl.innerHTML = '<div class="pl-error">網路錯誤：' + e.message + '</div>';
  }
}

/* ── 渲染歌單卡片 ── */

function _renderPlaylists() {
  const listEl = document.getElementById('playlist-list');
  if (!listEl) return;

  listEl.innerHTML = _playlists.map(p => `
    <div class="pl-card" id="plcard-${p.id}" onclick="selectPlaylist('${p.id}')">
      <div class="pl-dot" id="pldot-${p.id}"></div>
      <div class="pl-info">
        <div class="pl-name">${_esc(p.name)}</div>
        <div class="pl-meta">${p.tracks ? p.tracks.total + ' 首' : ''}</div>
      </div>
    </div>
  `).join('');
}

/* ── 選擇歌單 ── */

function selectPlaylist(id) {
  if (_selectedId) {
    const oldCard = document.getElementById('plcard-' + _selectedId);
    const oldDot  = document.getElementById('pldot-'  + _selectedId);
    if (oldCard) oldCard.classList.remove('selected');
    if (oldDot)  oldDot.classList.remove('selected');
  }

  _selectedId = id;

  const card = document.getElementById('plcard-' + id);
  const dot  = document.getElementById('pldot-'  + id);
  if (card) card.classList.add('selected');
  if (dot)  dot.classList.add('selected');

  const playBtn = document.getElementById('playlist-play-btn');
  if (playBtn) playBtn.style.display = 'flex';
}

/* ── 隨機播一首 ── */

async function playFromPlaylist() {
  if (!_selectedId) return;

  const playBtn = document.getElementById('playlist-play-btn');
  if (playBtn) {
    playBtn.disabled = true;
    playBtn.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true" style="font-size:16px;"></i> 抽歌中...';
  }

  const t = await getToken();
  if (!t) {
    setStatus('idle', '請重新登入');
    _resetPlayBtn();
    return;
  }

  try {
    // Step 1：抓歌單，limit=100 全撈，處理 total
    setStatus('idle', '讀取歌單...');
    const r1 = await fetch(
      `https://api.spotify.com/v1/playlists/${_selectedId}/items?limit=100&offset=0`,
      { headers: { Authorization: 'Bearer ' + t } }
    );

    setStatus('idle', '歌單回應：' + r1.status);

    if (!r1.ok) {
      const errText = await r1.text();
      setStatus('idle', '歌單失敗 ' + r1.status + '：' + errText.slice(0, 60));
      _resetPlayBtn();
      return;
    }

    const d1 = await r1.json();
    setStatus('idle', 'total=' + d1.total + ' items=' + (d1.items ? d1.items.length : 'null'));

    // 把有效 track 全部收集起來
    let tracks = (d1.items || [])
      .map(item => item && item.track)
      .filter(tr => tr && tr.uri && tr.uri.startsWith('spotify:track:'));

    setStatus('idle', '有效歌曲：' + tracks.length + ' 首');

    if (tracks.length === 0) {
      setStatus('idle', '這個歌單沒有可播放的歌曲');
      _resetPlayBtn();
      return;
    }

    // Step 2：隨機抽一首
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    setStatus('idle', '抽到：' + (track.name || track.uri));

    // Step 3：套用設定播放
    const s = loadSettings();
    const startMs    = s.startSec * 1000;
    const durationMs = s.limitMode ? s.durationSec * 1000 : null;

    await playTrack(track.uri, startMs, durationMs);

  } catch (e) {
    setStatus('idle', '錯誤：' + e.message);
  }

  _resetPlayBtn();
}

/* ── 重設播放按鈕 ── */

function _resetPlayBtn() {
  const playBtn = document.getElementById('playlist-play-btn');
  if (!playBtn) return;
  playBtn.disabled = false;
  playBtn.innerHTML = '<i class="ti ti-arrows-shuffle" aria-hidden="true" style="font-size:16px;"></i> 隨機播一首';
}

/* ── HTML 跳脫 ── */

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
