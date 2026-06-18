/**
 * playlist-mode.js
 * 主題選歌模式
 * 依賴：auth.js（getToken）、player.js（playTrack、setStatus）、nfc.js（loadSettings）
 */

let _playlists = [];
let _selectedId = null;
let _selectedName = null;
let _selectedImg = null;
let _selectedTotal = null;
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
    _playlists = (d.items || [])
      .filter(p => p && p.id && p.name && p.owner && p.owner.id === myId)
      .map(p => ({
        id: p.id,
        name: p.name,
        total: p.tracks ? p.tracks.total : 0,
        img: (p.images && p.images.length > 0) ? p.images[0].url : null,
      }));

    if (_playlists.length === 0) {
      if (trigger) trigger.textContent = '找不到自己建立的歌單';
      return;
    }

    _playlistsLoaded = true;
    if (trigger) trigger.textContent = '選擇主題歌單';
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
    <div class="pl-option" onclick="selectPlaylist('${p.id}', '${_esc(p.name)}', '${p.img || ''}', ${p.total})">
      <div class="pl-option-img">
        ${p.img
      ? `<img src="${p.img}" alt="" width="36" height="36" style="border-radius:6px;display:block;">`
      : `<i class="ti ti-music" aria-hidden="true" style="font-size:18px;color:#555;"></i>`
    }
      </div>
      <div class="pl-option-info">
        <div class="pl-option-name">${_esc(p.name)}</div>
        <div class="pl-option-meta">${p.total} 首</div>
      </div>
      ${p.id === _selectedId ? `<i class="ti ti-check pl-option-check" aria-hidden="true"></i>` : ''}
    </div>
  `).join('');
}

/* ── 展開 / 收合下拉（觸發器 or 已選卡片都呼叫這個） ── */

function toggleDropdown() {
  if (!_playlistsLoaded) return;
  _dropdownOpen = !_dropdownOpen;

  const listEl = document.getElementById('playlist-list');
  const trigger = document.getElementById('pl-trigger');
  const card = document.getElementById('pl-selected-card');
  const arrow = document.getElementById('pl-arrow');
  const cardArrow = document.getElementById('pl-sel-arrow');

  if (listEl) listEl.classList.toggle('open', _dropdownOpen);

  if (trigger && trigger.style.display !== 'none') {
    if (arrow) arrow.style.transform = _dropdownOpen ? 'rotate(180deg)' : '';
    trigger.classList.toggle('open', _dropdownOpen);
  }

  if (card && card.style.display !== 'none') {
    card.classList.toggle('open', _dropdownOpen);
    if (cardArrow) cardArrow.style.transform = _dropdownOpen ? 'rotate(180deg)' : '';
  }
}

/* ── 選擇歌單 ── */

function selectPlaylist(id, name, img, total) {
  _selectedId = id;
  _selectedName = name;
  _selectedImg = img || null;
  _selectedTotal = total || 0;

  _dropdownOpen = false;

  const trigger = document.getElementById('pl-trigger');
  const listEl = document.getElementById('playlist-list');
  const btnNext = document.getElementById('btn-next');
  const card = document.getElementById('pl-selected-card');
  const cardArrow = document.getElementById('pl-sel-arrow');

  if (listEl) listEl.classList.remove('open');

  if (trigger) trigger.style.display = 'none';

  if (card) {
    card.style.display = 'flex';
    card.classList.remove('open');
    if (cardArrow) cardArrow.style.transform = '';

    document.getElementById('pl-sel-img-wrap').innerHTML = _selectedImg
      ? `<img src="${_selectedImg}" alt="" width="36" height="36" style="border-radius:6px;display:block;">`
      : `<i class="ti ti-music" aria-hidden="true" style="font-size:18px;color:#1DB954;"></i>`;
    document.getElementById('pl-sel-name').textContent = name;
    document.getElementById('pl-sel-meta').textContent = `${_selectedTotal} 首`;
  }

  if (btnNext) btnNext.style.display = 'block';

  _renderDropdown();

  const ring = document.getElementById('status-ring');
  const statusText = document.getElementById('status-text');
  const ringIcon = document.getElementById('status-ring-icon');
  if (ring) ring.classList.add('clickable');
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