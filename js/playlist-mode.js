/**
 * playlist-mode.js  v5
 * 主題選歌模式：膠囊 + 格狀選單（橫式格）
 * 依賴：auth.js（getToken、spCooldownLeft）、player.js（playTrack、setStatus、startCooldownUI）、
 *       nfc.js（loadSettings）、history.js（loadPlayedRecords、isTrackPlayed）
 *
 * 請求減量：
 *   - 主題歌單的曲目只讀一次（記憶體快取）；重新選一次主題會重讀，所以在 Spotify 改完歌單後，
 *     按「結束」再選一次主題就會拿到最新內容。
 *   - 「今日已播過」改查 Firebase 本機快取，不再讀 Spotify 今日歌單。
 */

let _playlists = [];
let _selectedId = null;
let _selectedName = null;
let _selectedImg = null;
let _selectedTotal = null;
let _playlistsLoaded = false;
let _dropdownOpen = false;

const _tracksCache = new Map();      // 歌單 ID → 曲目清單（{ uri, id, name, artist }）
const _tracksInflight = new Map();   // 歌單 ID → 正在讀取中的 Promise（避免同時重複讀）
let _nextBusy = false;               // 「下一首」處理中，避免連點送出多份請求

/* ── 載入歌單列表 ── */

// 429 冷卻中：先不送請求，等冷卻結束自動重試。回傳 true = 已排好重試
function _retryPlaylistsAfterCooldown(emptyText) {
  const cd = spCooldownLeft();
  if (cd <= 0) return false;
  if (emptyText) emptyText.textContent = `請求過多，${cd} 秒後自動重試`;
  setTimeout(_loadPlaylists, (cd + 1) * 1000);
  return true;
}

async function _loadPlaylists() {
  const emptyText = document.getElementById('pl-capsule-empty-text');
  if (_retryPlaylistsAfterCooldown(emptyText)) return;
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
    if (!meR.ok) {
      if (_retryPlaylistsAfterCooldown(emptyText)) return;
      if (emptyText) emptyText.textContent = '載入失敗（' + meR.status + '）';
      return;
    }
    const me = await meR.json();
    const myId = me.id;

    const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: 'Bearer ' + t }
    });

    if (!r.ok) {
      if (_retryPlaylistsAfterCooldown(emptyText)) return;
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
  _tracksCache.delete(id);   // 重新選一次主題 = 下次播放重新讀最新曲目
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
      .filter(tr => tr && tr.uri && tr.uri.startsWith('spotify:track:'))
      .map(tr => ({
        uri: tr.uri,
        id: tr.id || tr.uri.split(':')[2],
        name: tr.name || '',
        artist: (tr.artists || []).map(a => a.name).join(', '),
      }));
    tracks.push(...page);
    // next 有值代表還有下一頁，null 代表結束
    url = d.next || null;
  }

  return tracks;
}

/* ── 取得歌單曲目（有快取就不再讀 Spotify） ── */

async function _getPlaylistTracks(playlistId, token) {
  if (_tracksCache.has(playlistId)) {
    appLog('歌單', `使用快取曲目（${_tracksCache.get(playlistId).length} 首），沒有重讀 Spotify`);
    return _tracksCache.get(playlistId);
  }
  if (_tracksInflight.has(playlistId)) return _tracksInflight.get(playlistId);

  const p = _fetchAllTracks(playlistId, token)
    .then(list => {
      _tracksCache.set(playlistId, list);
      appLog('歌單', `已讀取並快取曲目：${list.length} 首`);
      return list;
    })
    .finally(() => _tracksInflight.delete(playlistId));
  _tracksInflight.set(playlistId, p);
  return p;
}

/* ── 隨機播一首 ── */

async function playFromPlaylist() {
  if (!_selectedId || _nextBusy) return;   // 上一次「下一首」還在處理中 → 不重複送

  // 429 冷卻中：不送請求，只提示（正在播的歌不受影響）
  if (spCooldownLeft() > 0) { startCooldownUI(); return; }

  _nextBusy = true;
  const ring = document.getElementById('status-ring');
  if (ring) ring.classList.remove('clickable');

  try {
    const t = await getToken();
    if (!t) {
      setStatus('idle', '請重新登入');
      return;
    }

    setStatus('idle', '讀取歌單...');
    const tracks = await _getPlaylistTracks(_selectedId, t);

    if (tracks.length === 0) {
      setStatus('idle', '這個歌單沒有可播放的歌曲');
      return;
    }

    const s = loadSettings();

    // 重複播放關閉：排除今日已播過的歌（與「同步到 Spotify 今日歌單」開關無關，一律要判斷）
    // 資料來源是 Firebase（本機快取），不再讀 Spotify 今日歌單
    let candidates = tracks;
    if (!s.allowRepeat) {
      setStatus('idle', '檢查今日歌單...');
      let loaded = true;
      try {
        await loadPlayedRecords();
      } catch (e) {
        loaded = false;
        console.warn('今日紀錄讀取失敗，略過重複檢查:', e);
      }
      if (loaded) candidates = tracks.filter(tr => !isTrackPlayed(tr.id));
      if (candidates.length === 0) {
        setStatus('idle', '這個主題的歌都播過了');
        return;
      }
    }

    const track = candidates[Math.floor(Math.random() * candidates.length)];
    const startMs    = s.startSec * 1000;
    const durationMs = s.limitMode ? s.durationSec * 1000 : null;

    // 把歌名、歌手一起帶進去，今日紀錄就不用等 /tracks 查詢
    await playTrack(track.uri, startMs, durationMs, false, { name: track.name, artist: track.artist });

  } catch (e) {
    if (spCooldownLeft() > 0) {
      setStatus('idle', '請求過多，請稍後再按「下一首」');
      startCooldownUI();
    } else {
      setStatus('idle', '錯誤：' + e.message);
    }
  } finally {
    if (ring) ring.classList.add('clickable');
    _nextBusy = false;
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
