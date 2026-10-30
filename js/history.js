/**
 * history.js  v2
 * 今日已播放紀錄管理 + Toast 通知
 *
 * 【資料放哪裡】
 *   Firebase  played/{Spotify 歌曲ID} = { name, artist, ts }   ← 「播過了沒」以這裡為準
 *   Spotify   今日歌單（PLAYED_PLAYLIST_ID）                    ← 只是鏡像，方便在 Spotify 裡看
 *
 * 【流程】
 *   播放一首歌 → 先查 Firebase（本機快取）→ 沒播過 → 寫 Firebase
 *              → 若「同步到 Spotify 今日歌單」開關打開 → 再加進 Spotify 今日歌單
 *   同步（今日歌單頁）：讀完 Spotify 今日歌單 → 成功才覆蓋 Firebase（讀失敗不會動到 Firebase）
 *   清除（今日歌單頁）：清空 Firebase；並嘗試清空 Spotify 今日歌單（Spotify 失敗也照清 Firebase）
 *
 * 依賴：auth.js（getToken、appLog、spCooldownLeft）、base.js（showToast，可有可無）、
 *       track-notes.js（ensureNotesDb：取得 Firebase database，單人模式會自動補載 SDK）
 */

const PLAYED_PLAYLIST_ID = '7DHJnThdLdcwIn9soYyIpT';
const PLAYED_FB_PATH = 'played';
const PLAYED_LOAD_TIMEOUT_MS = 8000;

let _playedMap = null;            // { 歌曲ID: { name, artist, ts } }；null = 還沒載入
let _playedLoadPromise = null;
let _playedRef = null;
let _playedListeners = [];
let _lastSpotifyMirror = null;    // 最近一次動 Spotify 今日歌單的結果（除錯用）

/* ── 小工具 ── */

/** 'spotify:track:XXXX' → 'XXXX'；傳進來本來就是 ID 就原樣回傳；不是歌曲回傳 '' */
function trackIdOf(uriOrId) {
  const s = String(uriOrId || '');
  let id = s;
  if (s.includes(':')) {
    const p = s.split(':');
    id = (p[0] === 'spotify' && p[1] === 'track') ? (p[2] || '') : '';
  }
  return /^[A-Za-z0-9]+$/.test(id) ? id : '';   // Firebase key 不能有 . $ # [ ] /
}

function _playedToast(msg, ok) {
  if (typeof showToast === 'function') showToast('played-toast', msg, ok);
  else console.warn(msg);
}

function _playedDb() {
  if (typeof ensureNotesDb !== 'function') {
    return Promise.reject(new Error('缺少 track-notes.js，無法連到 Firebase'));
  }
  return ensureNotesDb();
}

/* ── 本機快取（用 Firebase 即時監聽保持最新，播放時不用再讀網路） ── */

/** 今日紀錄有變動時呼叫 cb(map)（今日歌單頁用來重畫列表） */
function onPlayedChange(cb) {
  _playedListeners.push(cb);
}

function _notifyPlayedChange() {
  _playedListeners.forEach(cb => {
    try { cb(_playedMap || {}); } catch (e) { console.warn('onPlayedChange callback 錯誤:', e); }
  });
}

/**
 * 載入今日紀錄並開始監聽。成功回傳 map；失敗（逾時、權限不足）會 throw。
 * 已載入過就直接回傳同一個 Promise；失敗後下次呼叫會重試。
 */
function loadPlayedRecords(force) {
  if (_playedLoadPromise && !force) return _playedLoadPromise;

  const p = (async () => {
    const db = await _playedDb();
    if (_playedRef) { try { _playedRef.off('value'); } catch (e) { /* 忽略 */ } }
    _playedRef = db.ref(PLAYED_FB_PATH);

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('讀取逾時')); }
      }, PLAYED_LOAD_TIMEOUT_MS);

      _playedRef.on('value', snap => {
        _playedMap = snap.val() || {};
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        _notifyPlayedChange();
      }, err => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); }
        else console.warn('今日紀錄監聽中斷:', err);
      });
    });

    appLog('紀錄', `今日紀錄已載入（Firebase）：${Object.keys(_playedMap).length} 首`);
    return _playedMap;
  })();

  _playedLoadPromise = p;
  p.catch(e => {
    if (_playedLoadPromise === p) _playedLoadPromise = null;
    appLog('紀錄', '讀取 Firebase 今日紀錄失敗：' + ((e && e.message) || e));
  });
  return p;
}

/** 這首歌今天播過了嗎（要先 await loadPlayedRecords() 才準） */
function isTrackPlayed(uriOrId) {
  const id = trackIdOf(uriOrId);
  return !!(id && _playedMap && _playedMap[id]);
}

/** 目前快取幾首；還沒載入回傳 null */
function playedCount() {
  return _playedMap ? Object.keys(_playedMap).length : null;
}

/** 已播清單（依播放時間：舊 → 新） */
function getPlayedList() {
  const m = _playedMap || {};
  return Object.keys(m)
    .map(id => ({
      id,
      name: (m[id] && m[id].name) || '',
      artist: (m[id] && m[id].artist) || '',
      ts: (m[id] && m[id].ts) || 0,
    }))
    .sort((a, b) => a.ts - b.ts);
}

/** 最近一次動 Spotify 今日歌單的結果：{ at, ok, msg }（除錯用） */
function getLastSpotifyMirror() {
  return _lastSpotifyMirror;
}

/* ── 記錄「這首歌播過了」 ── */

/**
 * 播放一首歌後呼叫。
 * 1) Firebase 一律記錄（本機快取已有就略過）
 * 2) 這首是「新記錄」且 syncToSpotify = true → 才加進 Spotify 今日歌單
 * Firebase 寫入失敗時不會碰 Spotify（沒辦法確定有沒有重複），只提示。
 */
async function recordTrackPlayed(uri, name, artist, syncToSpotify) {
  const id = trackIdOf(uri);
  if (!id) return;
  const label = name || id;
  let isNew = false;
  let fbOk = true;

  try {
    await loadPlayedRecords().catch(() => null);   // 通常已預載；載入失敗也繼續嘗試寫入

    if (_playedMap && _playedMap[id]) {
      appLog('紀錄', `已在今日紀錄，略過：${label}`);
    } else {
      const db = await _playedDb();
      const rec = { name: name || '', artist: artist || '', ts: Date.now() };
      await db.ref(`${PLAYED_FB_PATH}/${id}`).set(rec);
      if (_playedMap) _playedMap[id] = rec;
      isNew = true;
      appLog('紀錄', `已寫入 Firebase：${label}`);
      _notifyPlayedChange();
    }
  } catch (e) {
    fbOk = false;
    appLog('紀錄', `寫入 Firebase 失敗：${label}（${(e && e.message) || e}）`);
    _playedToast('今日紀錄寫入失敗', false);
  }

  if (fbOk && isNew && syncToSpotify) {
    await addTrackToSpotifyPlayed(uri, label);
  }
}

/** 把一首歌加進 Spotify 今日歌單（成功不提示；失敗才提示） */
async function addTrackToSpotifyPlayed(uri, label) {
  const t = await getToken();
  if (!t) return false;

  try {
    const r = await fetch(`https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    });

    if (r.ok) {
      _lastSpotifyMirror = { at: Date.now(), ok: true, msg: `已加入 Spotify 今日歌單：${label}` };
      appLog('Spotify歌單', `已加入今日歌單：${label}`);
      return true;
    }

    const body = await r.json().catch(() => ({}));
    const reason = (body && body.error && body.error.message) || '';
    _lastSpotifyMirror = { at: Date.now(), ok: false, msg: `加入失敗 ${r.status} ${reason}`.trim() };
    appLog('Spotify歌單', `加入今日歌單失敗：${label}（${r.status} ${reason}）`);
    if (r.headers.get('X-Local-Cooldown')) {
      _playedToast('Spotify 請求過多，這首沒有同步到 Spotify 今日歌單', false);
    } else {
      _playedToast('同步 Spotify 今日歌單失敗 ' + r.status + (reason ? ': ' + reason : ''), false);
    }
    return false;
  } catch (e) {
    _lastSpotifyMirror = { at: Date.now(), ok: false, msg: '網路錯誤' };
    appLog('Spotify歌單', `加入今日歌單失敗：${label}（網路錯誤）`);
    _playedToast('網路錯誤', false);
    return false;
  }
}

/* ── 讀 Spotify 今日歌單（同步、備案清除共用） ── */

/** 讀完 Spotify 今日歌單所有歌曲（分頁）。任何一頁失敗都會 throw。 */
async function fetchSpotifyPlayedTracks(token) {
  const out = [];
  let url = `https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items?limit=100&offset=0`;

  while (url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      throw new Error(r.status === 429
        ? 'Spotify 請求過多（429），請稍後再試'
        : `讀取 Spotify 今日歌單失敗（${r.status}）`);
    }
    const d = await r.json();
    (d.items || []).forEach(item => {
      const tr = item && (item.track || item.item);
      if (!tr || !tr.uri || !tr.uri.startsWith('spotify:track:')) return;
      out.push({
        id: tr.id || tr.uri.split(':')[2],
        name: tr.name || '',
        artist: (tr.artists || []).map(a => a.name).join(', '),
        addedAt: item.added_at ? Date.parse(item.added_at) : 0,
      });
    });
    url = d.next || null;
  }
  return out;
}

/* ── 同步：Spotify 今日歌單 → Firebase ── */

/**
 * 以 Spotify 今日歌單為準，重建 Firebase 紀錄。
 * 先把 Spotify 讀完，全部成功才一次覆蓋 Firebase；中途失敗 Firebase 原樣不動。
 * 回傳同步後的歌曲數。
 */
async function syncPlayedFromSpotify() {
  const left = spCooldownLeft();
  if (left > 0) throw new Error(`Spotify 請求過多，請等 ${left} 秒後再試`);

  const t = await getToken();
  if (!t) throw new Error('請重新登入 Spotify');

  appLog('同步', '開始：讀取 Spotify 今日歌單…');
  const tracks = await fetchSpotifyPlayedTracks(t);   // 失敗就 throw，不會動到 Firebase

  const obj = {};
  const base = Date.now() - tracks.length;            // 萬一沒有 added_at，用遞增時間維持順序
  tracks.forEach((tr, i) => {
    if (!tr.id || obj[tr.id]) return;                 // 同一首重複出現只留第一次
    obj[tr.id] = { name: tr.name, artist: tr.artist, ts: tr.addedAt || (base + i) };
  });
  const n = Object.keys(obj).length;

  const db = await _playedDb();
  const ref = db.ref(PLAYED_FB_PATH);
  if (n > 0) await ref.set(obj);
  else await ref.remove();

  if (_playedMap) { _playedMap = obj; _notifyPlayedChange(); }
  _lastSpotifyMirror = { at: Date.now(), ok: true, msg: `同步完成：Spotify ${tracks.length} 首 → Firebase ${n} 首` };
  appLog('同步', `完成：Spotify ${tracks.length} 首 → Firebase ${n} 首`);
  return n;
}

/* ── 清除：Firebase + Spotify 今日歌單 ── */

/** 清空 Spotify 今日歌單。失敗會 throw。回傳用了哪種做法。 */
async function clearSpotifyPlayedPlaylist(token) {
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const url = `https://api.spotify.com/v1/playlists/${PLAYED_PLAYLIST_ID}/items`;

  // ① 優先：PUT 空陣列 = 一次清空（官方 Update Playlist Items 說明可用來清空歌單）
  const r = await fetch(url, { method: 'PUT', headers: H, body: JSON.stringify({ uris: [] }) });
  if (r.ok) return 'PUT 空陣列';

  if (r.status === 429) throw new Error('Spotify 請求過多（429）');
  if (r.status === 401 || r.status === 403) throw new Error(`沒有權限清空歌單（${r.status}）`);
  appLog('清除', `PUT 空陣列失敗（${r.status}），改用逐批刪除`);

  // ② 備案：讀出全部歌曲，每 100 首一批 DELETE
  const tracks = await fetchSpotifyPlayedTracks(token);
  for (let i = 0; i < tracks.length; i += 100) {
    const items = tracks.slice(i, i + 100).map(x => ({ uri: 'spotify:track:' + x.id }));
    const dr = await fetch(url, { method: 'DELETE', headers: H, body: JSON.stringify({ items }) });
    if (!dr.ok) throw new Error(`逐批刪除失敗（${dr.status}）`);
  }
  return '逐批刪除';
}

/**
 * 清除今日歌單：Firebase 一定會清；Spotify 盡量清，失敗不影響 Firebase。
 * 回傳 { firebase, firebaseMsg, spotify, spotifyMsg }
 */
async function clearPlayedAll() {
  const result = { firebase: false, firebaseMsg: '', spotify: false, spotifyMsg: '' };

  // 1) Firebase
  try {
    const db = await _playedDb();
    await db.ref(PLAYED_FB_PATH).remove();
    if (_playedMap) { _playedMap = {}; _notifyPlayedChange(); }
    result.firebase = true;
    appLog('清除', 'Firebase 今日紀錄已清除');
  } catch (e) {
    result.firebaseMsg = (e && e.message) || String(e);
    appLog('清除', 'Firebase 清除失敗：' + result.firebaseMsg);
  }

  // 2) Spotify
  const left = spCooldownLeft();
  if (left > 0) {
    result.spotifyMsg = `Spotify 請求過多（還要等 ${left} 秒），歌單沒有清`;
    appLog('清除', 'Spotify 今日歌單未清除：冷卻中');
    _lastSpotifyMirror = { at: Date.now(), ok: false, msg: '清除失敗：冷卻中' };
    return result;
  }

  try {
    const t = await getToken();
    if (!t) throw new Error('請重新登入 Spotify');
    const how = await clearSpotifyPlayedPlaylist(t);
    result.spotify = true;
    _lastSpotifyMirror = { at: Date.now(), ok: true, msg: `Spotify 今日歌單已清空（${how}）` };
    appLog('清除', `Spotify 今日歌單已清空（${how}）`);
  } catch (e) {
    result.spotifyMsg = (e && e.message) || String(e);
    _lastSpotifyMirror = { at: Date.now(), ok: false, msg: '清除失敗：' + result.spotifyMsg };
    appLog('清除', 'Spotify 今日歌單清除失敗：' + result.spotifyMsg);
  }
  return result;
}
