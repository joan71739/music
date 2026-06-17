/**
 * history.js
 * 今日已播放紀錄管理 + Toast 通知
 * 依賴：player.js（currentTrackName、currentArtistName）
 */

let _toastTimeout = null;

/* ── 今日已播放紀錄 ── */

function addToPlayedPlaylist(trackUri) {
  const today  = new Date().toDateString();
  const key    = 'played_' + today;

  // [修正歌單重複] 讀取時過濾掉格式不正確的舊資料（item 不是物件或沒有 uri 欄位）
  let played = [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    played = Array.isArray(raw)
      ? raw.filter(item => item && typeof item === 'object' && item.uri)
      : [];
  } catch(e) {
    played = [];
  }

  // uri 相同就跳過，不重複加入
  const exists = played.some(item => item.uri === trackUri);
  if (exists) return;

  played.push({
    uri:    trackUri,
    name:   currentTrackName,
    artist: currentArtistName,
  });
  localStorage.setItem(key, JSON.stringify(played));
  _showToast();
}

function togglePlayedList() {
  const box = document.getElementById('played-list-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }

  const today  = new Date().toDateString();
  let played = [];
  try {
    const raw = JSON.parse(localStorage.getItem('played_' + today) || '[]');
    played = Array.isArray(raw)
      ? raw.filter(item => item && typeof item === 'object' && item.uri)
      : [];
  } catch(e) {
    played = [];
  }

  if (played.length === 0) {
    box.innerHTML = '<div style="color:var(--muted);text-align:center">今天還沒播放任何歌曲</div>';
  } else {
    box.innerHTML = played.map(item => `
      <div class="played-item">
        <div class="played-song">${item.name || '（未知歌曲）'}</div>
        <div class="played-artist">${item.artist || ''}</div>
      </div>
    `).join('');
  }
  box.style.display = 'block';
}

/* ── Toast ── */

function _showToast() {
  const toast = document.getElementById('played-toast');
  toast.innerHTML = `<span class="toast-check">✓</span>已加入今日歌單`;
  toast.classList.add('show');

  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}
