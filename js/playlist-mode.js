/**
 * playlist-mode.js  v5
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
        total: p.items?.total ?? 0,
        img: (p.images && p.images.length > 0) ? p.images[0].url : null,
      }));

    if (_playlists.length === 0) {
      if (emptyText) emptyText.textContent = '找不到自己建立的歌單';
      return;
    }

    _playlistsLoaded = true;
    if (emptyText) emptyText.textContent = '尚未選擇主題';
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
         data-id="${p.id}"
         data-name="${_esc(p.name)}"
         data-img="${p.img || ''}"
         data-total="${p.total}">
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

  grid.onclick = (e) => {
    const cell = e.target.closest('.pl-cell');
    if (!cell) return;
    selectPlaylist(
      cell.dataset.id,
      cell.dataset.name,
      cell.dataset.img,
      parseInt(cell.dataset.total, 10)
    );
  };
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
  const selCapsule   = document.getElementById('pl-capsule-sel-row');
  const selDot       = document.getElementById('pl-capsule-sel-dot');
  const selName      = document.getElementById('pl-capsule-sel-name');
  const sheet        = document.getElementById('playlist-grid-sheet');
  const btnNext      = document.getElementById('btn-next');

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
  if (selName) selName.textContent = '目前主題： ' + name;
  if (sheet) sheet.classList.remove('open');
  if (btnNext) btnNext.style.display = 'flex';

  _renderGrid();

  const statusText = document.getElementById('status-text');
  const ringIcon   = document.getElementById('status-ring-icon');
  if (statusText) statusText.textContent = '點圓圈隨機播放';
  if (ringIcon)   ringIcon.className = 'ti ti-music';
}

/* ── 抓歌單所有歌曲（支援分頁） ── */

async function _fetchAllTracks(playlistId, token) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100&offset=0`;

  while (url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error('歌單讀取失敗 ' + r.status + '：' + errText.slice(0, 60));
    }
    const d = await r.json();
    const page = (d.items || [])
      .map(item => item?.track || item?.item)
      .filter(tr => tr && tr.uri && tr.uri.startsWith('spotify:track:'));
    tracks.push(...page);
    // next 有值代表還有下一頁，null 代表結束
    url = d.next || null;
  }

  return tracks;
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
    const tracks = await _fetchAllTracks(_selectedId, t);

    if (tracks.length === 0) {
      setStatus('idle', '這個歌單沒有可播放的歌曲');
      if (ring) ring.classList.add('clickable');
      return;
    }

    const track = tracks[Math.floor(Math.random() * tracks.length)];
    const s = loadSettings();
    const startMs    = s.startSec * 1000;
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

/* ── 清除主題包 ── */

async function clearPlaylist(e) {
  if (e) e.stopPropagation();

  _selectedId    = null;
  _selectedName  = null;
  _selectedImg   = null;
  _selectedTotal = null;
  _dropdownOpen  = false;

  const t = await getToken();
  if (t) {
    fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + t },
    }).catch(() => {});
  }
  _resetTimer();
  _resetAnswer();
  _stopPolling();

  const emptyCapsule = document.getElementById('pl-capsule-empty');
  const selCapsule   = document.getElementById('pl-capsule-sel-row');
  const sheet        = document.getElementById('playlist-grid-sheet');
  const btnNext      = document.getElementById('btn-next');
  const emptyText    = document.getElementById('pl-capsule-empty-text');
  const ring         = document.getElementById('status-ring');

  if (emptyCapsule) emptyCapsule.style.display = 'flex';
  if (selCapsule)   selCapsule.style.display   = 'none';
  if (sheet)        sheet.classList.remove('open');
  if (btnNext)      btnNext.style.display       = 'none';
  if (emptyText)    emptyText.textContent        = '尚未選擇主題';
  if (ring)         ring.classList.remove('clickable');

  setStatus('idle', '靠近 NFC 卡開始播放');
  _renderGrid();
}
