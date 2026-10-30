/**
 * history.js
 * 今日已播放紀錄管理 + Toast 通知
 * 依賴：auth.js（getToken）、base.js（showToast）
 */

const PLAYED_PLAYLIST_ID = '7DHJnThdLdcwIn9soYyIpT';

/** 取得今日歌單所有歌曲的 URI（分頁讀完）。回傳 Set；讀取失敗回傳 null */
async function fetchPlayedUris(token) {
  const t = token || await getToken();
  if (!t) return null;
  const uris = new Set();
  let url = `https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items?limit=100&offset=0`;
  try {
    while (url) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) return null;
      const d = await r.json();
      (d.items || []).forEach(item => {
        const tr = item?.track || item?.item;
        if (tr?.uri) uris.add(tr.uri);
      });
      url = d.next || null;
    }
  } catch (e) {
    console.warn('讀取今日歌單失敗:', e);
    return null;
  }
  return uris;
}

async function addToPlayedPlaylist(trackUri) {
  const t = await getToken();
  if (!t) return;
  try {
    const played = await fetchPlayedUris(t);
    if (played === null) {
      showToast('played-toast', '讀取今日歌單失敗', false);
      return;
    }
    if (played.has(trackUri)) return;   // 已經在今日歌單，不重複加入

    const addR = await fetch(`https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [trackUri] })
    });
    const addBody = await addR.json();
    // 成功（201）不再跳「已加入今日歌單」提示；失敗才提示
    if (addR.status !== 201) {
      showToast('played-toast', '同步失敗 ' + addR.status + ': ' + (addBody.error?.message || ''), false);
    }
  } catch(e) {
    showToast('played-toast', '網路錯誤', false);
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
        .filter(item => item.track?.name)
        .map(item => `
          <div class="played-item">
            <div class="played-song">${item.track.name}</div>
            <div class="played-artist">${item.track.artists?.map(a => a.name).join(', ') || ''}</div>
          </div>
        `).join('') || '<div style="color:var(--muted);text-align:center">今天還沒播放任何歌曲</div>';
    }
  } catch(e) {
    box.innerHTML = '<div style="color:var(--muted);text-align:center">載入失敗</div>';
  }
}
