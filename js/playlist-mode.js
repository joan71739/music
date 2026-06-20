/**
 * playlist-mode.js  v3
 * 主題選歌模式：膠囊 + 格狀選單（橫式格）
 * 依賴：auth.js（getToken）、player.js（playTrack、setStatus）、nfc.js（loadSettings）
 */

let _playlists = [];
let _selectedId = null;
let _selectedName = null;
let _selectedImg = null;
let _selectedTotal = null;
let _playlistsLoaded = false;
let _dropdownOpen = false;

/* ── 載入歌單列表 ── */

async function _loadPlaylists() {
  const emptyText = document.getElementById('pl-capsule-empty-text');
  if (emptyText) emptyText.textContent = '載入中...';

  const t = await getToken();
  if (!t) {
    if (emptyText) emptyText.textContent = '請重新登入';
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
      if (emptyText) emptyText.textContent = '載入失敗（' + r.status + '）';
      return;
    }

    const d = await r.json();
    _playlists = (d.items || [])
      .filter(p => p && p.id && p.name && p.owner && p.owner.id === myId)
      .map(p => ({
        id: p.id,
        name: p.name,
        total: p.items?.total ?? p.tracks?.total ?? 0,
        img: (p.images && p.images.length > 0) ? p.images[0].url : null,
      }));

    if (_playlists.length === 0) {
      if (emptyText) emptyText.textContent = '找不到自己建立的歌單';
      return;
    }

    _playlistsLoaded = true;
    if (emptyText) emptyText.textContent = '選擇主題歌單';
    _renderGrid();

  } catch (e) {
    if (emptyText) emptyText.textContent = '網路錯誤：' + e.message;
  }
}

/* ── 渲染格狀選單 ── */

function _renderGrid() {
  const grid = document.getElementById('playlist-grid');
  if (!grid) return;

  grid.innerHTML = _playlists.map(p => `
    <div class="pl-cell ${p.id === _selectedId ? 'active' : ''}"
         onclick="selectPlaylist('${p.id}', '${_esc(p.name)}', '${p.img || ''}', ${p.total})">
      <div class="pl-cell-img">
        ${p.img
      ? `<img src="${p.img}" alt="">`
      : `<i class="ti ti-music" aria-hidden="true"></i>`
    }
      </div>
      <div class="pl-cell-info">
        <div class="pl-cell-name">${_esc(p.name)}</div>
        <div class="pl-cell-count">${p.total} 首</div>
      </div>
    </div>
  `).join('');
}

/* ── 展開 / 收合格狀選單 ── */

function toggleDropdown() {
  if (!_playlistsLoaded) return;
  _dropdownOpen = !_dropdownOpen;

  const sheet = document.getElementById('playlist-grid-sheet');
  const selCapsule = document.getElementById('pl-capsule-sel');

  if (sheet) sheet.classList.toggle('open', _dropdownOpen);
  if (selCapsule) selCapsule.classList.toggle('open', _dropdownOpen);
}

/* ── 選擇歌單 ── */

function selectPlaylist(id, name, img, total) {
  _selectedId = id;
  _selectedName = name;
  _selectedImg = img || null;
  _selectedTotal = total || 0;

  _dropdownOpen = false;

  const emptyCapsule = document.getElementById('pl-capsule-empty');
  const selCapsule = document.getElementById('pl-capsule-sel');
  const selDot = document.getElementById('pl-capsule-sel-dot');
  const selName = document.getElementById('pl-capsule-sel-name');
  const sheet = document.getElementById('playlist-grid-sheet');
  const btnNext = document.getElementById('btn-next');

  if (emptyCapsule) emptyCapsule.style.display = 'none';

  if (selCapsule) {
    selCapsule.style.display = 'flex';
    selCapsule.classList.remove('open');
  }

  if (selDot) {
    selDot.innerHTML = _selectedImg
      ? `<img src="${_selectedImg}" alt="">`
      : `<i class="ti ti-music" aria-hidden="true"></i>`;
  }

  if (selName) selName.textContent = name;
  if (sheet) sheet.classList.remove('open');
  if (btnNext) btnNext.style.display = 'flex';

  _renderGrid();

  const statusText = document.getElementById('status-text');
  const ringIcon = document.getElementById('status-ring-icon');
  if (statusText) statusText.textContent = '點圓圈隨機播放';
  if (ringIcon) ringIcon.className = 'ti ti-music';
}

/* ── 隨機播一首 ── */

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
    const tracks = (d1.items || [])
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

    if (ring) ring.classList.add('clickable');

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