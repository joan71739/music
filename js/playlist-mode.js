/**
 * playlist-mode.js
 * 主題選歌模式
 * 流程：切到「主題選歌」tab → 抓 Spotify 帳號歌單 → 選一個 → 隨機抽一首播放
 * 播放設定（開始位置、限時）與 NFC 模式共用同一個設定面板
 * 依賴：auth.js（getToken）、player.js（playTrack）、nfc.js（loadSettings）
 */

/* ── 狀態 ── */
let _playlists      = [];   // 從 Spotify 抓回的歌單陣列
let _selectedId     = null; // 目前選中的歌單 id
let _playlistsLoaded = false;

/* ── Tab 切換（index.html 的 onclick 呼叫） ── */

function switchModeTab(tab) {
  const nfcBtn      = document.getElementById('tab-btn-nfc');
  const plBtn       = document.getElementById('tab-btn-playlist');
  const plPanel     = document.getElementById('playlist-mode-panel');
  const statusText  = document.getElementById('status-text');
  const ringIcon    = document.getElementById('status-ring-icon');

  if (tab === 'nfc') {
    nfcBtn.classList.add('active');
    plBtn.classList.remove('active');
    plPanel.style.display = 'none';
    // 圓環回到 NFC 待機狀態提示
    if (ringIcon) ringIcon.className = 'ti ti-nfc';
    if (statusText) statusText.textContent = '靠近 NFC 卡開始播放';
  } else {
    plBtn.classList.add('active');
    nfcBtn.classList.remove('active');
    plPanel.style.display = 'flex';
    // 圓環改成音樂圖示
    if (ringIcon) ringIcon.className = 'ti ti-music';
    if (statusText) statusText.textContent = '選擇主題包後隨機播放';
    // 第一次切過來才載入
    if (!_playlistsLoaded) _loadPlaylists();
  }
}

/* ── 載入 Spotify 歌單列表 ── */

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
    // 取得目前使用者自己的所有歌單（最多 50 個，足夠用）
    const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: 'Bearer ' + t }
    });

    if (!r.ok) {
      listEl.innerHTML = '<div class="pl-error">歌單載入失敗（' + r.status + '）</div>';
      return;
    }

    const d = await r.json();
    _playlists = (d.items || []).filter(p => p && p.id && p.name);

    if (_playlists.length === 0) {
      listEl.innerHTML = '<div class="pl-error">找不到任何歌單</div>';
      return;
    }

    _playlistsLoaded = true;
    _renderPlaylists();

  } catch (e) {
    listEl.innerHTML = '<div class="pl-error">網路錯誤，請稍後再試</div>';
    console.error('_loadPlaylists error:', e);
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
  // 取消舊選擇
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

  // 顯示播放按鈕
  const playBtn = document.getElementById('playlist-play-btn');
  if (playBtn) playBtn.style.display = 'flex';
}

/* ── 隨機播一首（index.html 的 onclick 呼叫） ── */

async function playFromPlaylist() {
  if (!_selectedId) return;

  const playBtn = document.getElementById('playlist-play-btn');
  if (playBtn) {
    playBtn.disabled = true;
    playBtn.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true" style="font-size:16px;"></i> 抽歌中...';
  }

  const t = await getToken();
  if (!t) {
    _resetPlayBtn();
    return;
  }

  try {
    // 先打 API 取得真實曲數（不信任 /me/playlists 快取的 total）
    const metaR = await fetch(
      `https://api.spotify.com/v1/playlists/${_selectedId}/tracks?limit=1&offset=0&fields=total`,
      { headers: { Authorization: 'Bearer ' + t } }
    );
    if (!metaR.ok) {
      setStatus('idle', '歌單讀取失敗（' + metaR.status + '）');
      _resetPlayBtn();
      return;
    }
    const meta = await metaR.json();
    const total = meta.total || 0;

    if (total === 0) {
      setStatus('idle', '這個歌單是空的');
      _resetPlayBtn();
      return;
    }

    // 隨機 offset，每次抓 1 首
    const offset = Math.floor(Math.random() * total);
    const r = await fetch(
      `https://api.spotify.com/v1/playlists/${_selectedId}/tracks?limit=1&offset=${offset}&fields=items(track(uri,name,artists))`,
      { headers: { Authorization: 'Bearer ' + t } }
    );

    if (!r.ok) {
      setStatus('idle', '抽歌失敗（' + r.status + '）');
      _resetPlayBtn();
      return;
    }

    const d = await r.json();
    const track = d.items && d.items[0] && d.items[0].track;

    // 防止抽到 null track（本地檔案或被刪除的歌）
    if (!track || !track.uri) {
      setStatus('idle', '抽到無效歌曲，請再試一次');
      _resetPlayBtn();
      return;
    }

    // 讀取設定面板的設定
    const s = loadSettings();
    const startMs    = s.startSec * 1000;
    const durationMs = s.limitMode ? s.durationSec * 1000 : null;

    // 呼叫 player.js 的核心播放函式
    await playTrack(track.uri, startMs, durationMs);

  } catch (e) {
    setStatus('idle', '播放失敗，請稍後再試');
    console.error('playFromPlaylist error:', e);
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

/* ── 工具：HTML 跳脫，防止歌單名稱含特殊字元破版 ── */

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
