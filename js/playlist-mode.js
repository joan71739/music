/**
 * playlist-mode.js
 * 主題選歌模式
 * 依賴：auth.js（getToken）、player.js（playTrack、setStatus）、nfc.js（loadSettings）
 *
 * 修正說明：
 * - ringTogglePlayPause() 不再觸發 playFromPlaylist()
 *   圓圈只負責暫停/繼續，下一首只由 btn-next 按鈕觸發
 */

let _playlists = [];
let _selectedId = null;
let _selectedName = null;
let _playlistsLoaded = false;
let _dropdownOpen = false;

/* ── 圓圈點擊：只做暫停 / 繼續 ── */

function ringTogglePlayPause() {
  if (_isTimerDone) return;
  if (!document.getElementById('status-ring').classList.contains('clickable')) return;
  _togglePlayPause();
}

/* ── 載入歌單列表 ── */

async function _loadPlaylists() {
  const trigger = document.getElementById('pl-trigger-text');
  if (trigger) trigger.textContent = '載入中...';

  const t = await getToken();
  if (!t) {
    if (trigger) trigger.textContent = '請重新登入';
    return;
  }

  try {
    const meR = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: 'Bearer ' + t }
    });
    const me = await meR.json();
    const myId = me.id;

    const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: 'Bearer ' + t }
    });

    if (!r.ok) {
      if (trigger) trigger.textContent = '載入失敗（' + r.status + '）';
      return;
    }

    const d = await r.json();
    _playlists = (d.items || []).filter(p => p && p.id && p.name && p.owner && p.owner.id === myId);

    if (_playlists.length === 0) {
      if (trigger) trigger.textContent = '找不到自己建立的歌單';
      return;
    }

    _playlistsLoaded = true;
    if (trigger) trigger.textContent = '尚未選擇主題包';
    _renderDropdown();

  } catch (e) {
    if (trigger) trigger.textContent = '網路錯誤：' + e.message;
  }
}

/* ── 渲染下拉選單內容 ── */

function _renderDropdown() {
  const listEl = document.getElementById('playlist-list');
  if (!listEl) return;

  listEl.innerHTML = _playlists.map(p => `
    <div class="pl-option" onclick="selectPlaylist('${p.id}', '${_esc(p.name)}')">
      <div class="pl-option-name">${_esc(p.name)}</div>
      <div class="pl-option-meta">${p.tracks ? p.tracks.total + ' 首' : ''}</div>
    </div>
  `).join('');
}

/* ── 展開 / 收合下拉 ── */

function toggleDropdown() {
  if (!_playlistsLoaded) return;
  _dropdownOpen = !_dropdownOpen;
  const listEl = document.getElementById('playlist-list');
  const arrow = document.getElementById('pl-arrow');
  const trigger = document.getElementById('pl-trigger');
  if (listEl) listEl.classList.toggle('open', _dropdownOpen);
  if (arrow) arrow.style.transform = _dropdownOpen ? 'rotate(180deg)' : '';
  if (trigger) trigger.classList.toggle('open', _dropdownOpen);
}

/* ── 選擇歌單 ── */

function selectPlaylist(id, name) {
  _selectedId = id;
  _selectedName = name;

  // 更新觸發器文字
  const triggerText = document.getElementById('pl-trigger-text');
  if (triggerText) triggerText.textContent = name;

  // 收合下拉
  _dropdownOpen = false;
  const listEl = document.getElementById('playlist-list');
  const arrow = document.getElementById('pl-arrow');
  const trigger = document.getElementById('pl-trigger');
  if (listEl) listEl.classList.remove('open');
  if (arrow) arrow.style.transform = '';
  if (trigger) trigger.classList.remove('open');

  // 更新提示文字
  const statusText = document.getElementById('status-text');
  if (statusText) statusText.textContent = '點「下一首」開始隨機播放';

  // 顯示下一首按鈕
  const btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.style.display = 'block';
}

/* ── 隨機播一首（只由 btn-next 觸發） ── */

async function playFromPlaylist() {
  if (!_selectedId) return;

  const ring = document.getElementById('status-ring');
  if (ring) ring.classList.remove('clickable');

  const t = await getToken();
  if (!t) {
    setStatus('idle', '請重新登入');
    if (ring) ring.classList.add('clickable');
    return;
  }

  try {
    setStatus('idle', '讀取歌單...');
    const r1 = await fetch(
      `https://api.spotify.com/v1/playlists/${_selectedId}/items?limit=100&offset=0`,
      { headers: { Authorization: 'Bearer ' + t } }
    );

    if (!r1.ok) {
      const errText = await r1.text();
      setStatus('idle', '歌單失敗 ' + r1.status + '：' + errText.slice(0, 60));
      if (ring) ring.classList.add('clickable');
      return;
    }

    const d1 = await r1.json();
    let tracks = (d1.items || [])
      .map(item => item && (item.track || item.item))
      .filter(tr => tr && tr.uri && tr.uri.startsWith('spotify:track:'));

    if (tracks.length === 0) {
      setStatus('idle', '這個歌單沒有可播放的歌曲');
      if (ring) ring.classList.add('clickable');
      return;
    }

    const track = tracks[Math.floor(Math.random() * tracks.length)];
    const s = loadSettings();
    const startMs = s.startSec * 1000;
    const durationMs = s.limitMode ? s.durationSec * 1000 : null;

    await playTrack(track.uri, startMs, durationMs);

  } catch (e) {
    setStatus('idle', '錯誤：' + e.message);
    if (ring) ring.classList.add('clickable');
  }
}

/* ── HTML 跳脫 ── */

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}