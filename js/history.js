/**
 * history.js
 * 今日已播放紀錄管理 + Toast 通知
 * 依賴：player.js（currentTrackName、currentArtistName、getToken）
 */

const PLAYED_PLAYLIST_ID = '7DHJnThdLdcwIn9soYyIpT';
let _toastTimeout = null;

async function addToPlayedPlaylist(trackUri) {
  const t = await getToken();
  if (!t) return;
  try {
    const r = await fetch(`https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items?limit=100`, {
      headers: { Authorization: 'Bearer ' + t }
    });
    const d = await r.json();
    const items = d.items || [];
    const exists = items.find(item => (item.item?.uri || item.track?.uri) === trackUri);
    if (exists) return;

    const addR = await fetch(`https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [trackUri] })
    });
    const addBody = await addR.json();
    if (addR.status === 201) {
      _showToast('已加入今日歌單', true);
    } else {
      _showToast('同步失敗 ' + addR.status + ': ' + (addBody.error?.message || ''), false);
    }
  } catch(e) {
    _showToast('網路錯誤', false);
  }
}

async function togglePlayedList() {
  const box = document.getElementById('played-list-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = '<div style="color:var(--muted);text-align:center">載入中...</div>';

  const t = await getToken();
  if (!t) { box.innerHTML = '<div style="color:var(--muted);text-align:center">請重新登入</div>'; return; }

  try {
    const r = await fetch(`https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items?limit=100`, {
      headers: { Authorization: 'Bearer ' + t }
    });
    const d = await r.json();
    const items = d.items || [];
    if (items.length === 0) {
      box.innerHTML = '<div style="color:var(--muted);text-align:center">今天還沒播放任何歌曲</div>';
    } else {
      box.innerHTML = items
        .filter(item => item.item?.name || item.track?.name)
        .map(item => `
          <div class="played-item">
            <div class="played-song">${item.item?.name || item.track?.name}</div>
            <div class="played-artist">${item.item?.artists?.map(a => a.name).join(', ') || item.track?.artists?.map(a => a.name).join(', ') || ''}</div>
          </div>
        `).join('') || '<div style="color:var(--muted);text-align:center">今天還沒播放任何歌曲</div>';
    }
  } catch(e) {
    box.innerHTML = '<div style="color:var(--muted);text-align:center">載入失敗</div>';
  }
}

function _showToast(msg, isOk = true) {
  const toast = document.getElementById('played-toast');
  toast.innerHTML = `<span class="toast-check" style="background:${isOk ? 'var(--green)' : '#e74c3c'}">${isOk ? '✓' : '!'}</span>${msg}`;
  toast.classList.add('show');
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}
