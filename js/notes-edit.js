/**
 * notes-edit.js
 * 備註編輯頁：選主題歌單 → 選歌曲 → 編輯備註（存 Firebase trackNotes/{歌曲ID}）
 * 依賴：base.js、firebase.js、auth.js（getToken）、track-notes.js
 */

let _nePlaylists = [];
let _neTracks = [];          // 目前歌單的歌曲 [{ id, name, artist }]
let _neNotes = {};           // 所有已有的備註 { trackId: text }（用來在選單標 📝）
let _neCurrentId = null;     // 目前選的歌曲 ID
let _neLoadedNote = '';      // 載入時的備註（用來判斷有沒有修改）

/* ──────────────────────────────────────
   小工具
────────────────────────────────────── */

function _neEl(id) {
  return document.getElementById(id);
}

function _neNormalize(text) {
  return (text || '').replace(/\s*\n\s*/g, ' ').trim();
}

function _neShowError(msg) {
  const box = _neEl('ne-error');
  box.textContent = msg;
  box.style.display = 'block';
}

function _neClearError() {
  const box = _neEl('ne-error');
  box.textContent = '';
  box.style.display = 'none';
}

function _neSetStatus(text, kind) {
  const el = _neEl('ne-status');
  el.textContent = text || '';
  el.className = 'ne-status' + (kind ? ' ne-status-' + kind : '');
}

function _neGoLogin() {
  sessionStorage.setItem('loginRedirect', 'notes-edit.html');
  window.location.href = 'login.html';
}

/* ──────────────────────────────────────
   初始化
────────────────────────────────────── */

async function init() {
  const t = await getToken();
  if (!t) { _neGoLogin(); return; }

  initFirebase();

  _neEl('ne-playlist').addEventListener('change', _neOnPlaylistChange);
  _neEl('ne-track').addEventListener('change', _neOnTrackChange);
  _neEl('ne-note').addEventListener('input', () => {
    _neSetStatus('');
    _neUpdateSaveBtn();
  });

  await Promise.all([_neLoadPlaylists(t), _neLoadNotes()]);
}

/* ──────────────────────────────────────
   載入：歌單 / 既有備註
────────────────────────────────────── */

async function _neLoadNotes() {
  try {
    _neNotes = await fetchAllTrackNotes();
  } catch (e) {
    console.warn('備註讀取失敗:', e);
    _neShowError('備註讀取失敗：' + e.message + '（請確認 Firebase 規則有開放 trackNotes）');
  }
}

async function _neLoadPlaylists(t) {
  const sel = _neEl('ne-playlist');
  try {
    const H = { Authorization: 'Bearer ' + t };

    const meR = await fetch('https://api.spotify.com/v1/me', { headers: H });
    if (!meR.ok) throw new Error('取得帳號失敗（' + meR.status + '）');
    const me = await meR.json();

    // 只列自己建立的歌單（別人的歌單讀不到歌曲）
    const list = [];
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (url) {
      const r = await fetch(url, { headers: H });
      if (!r.ok) throw new Error('歌單載入失敗（' + r.status + '）');
      const d = await r.json();
      (d.items || []).forEach(p => {
        if (p && p.id && p.name && p.owner && p.owner.id === me.id) {
          list.push({ id: p.id, name: p.name, total: p.items?.total ?? p.tracks?.total ?? 0 });
        }
      });
      url = d.next || null;
    }

    _nePlaylists = list;
    sel.innerHTML = '';

    if (list.length === 0) {
      sel.appendChild(new Option('找不到自己建立的歌單', ''));
      return;
    }

    sel.appendChild(new Option('請選擇主題歌單', ''));
    list.forEach(p => sel.appendChild(new Option(`${p.name}（${p.total} 首）`, p.id)));
    sel.disabled = false;

  } catch (e) {
    console.error('_neLoadPlaylists error:', e);
    sel.innerHTML = '';
    sel.appendChild(new Option('歌單載入失敗', ''));
    _neShowError(e.message);
  }
}

/** 抓歌單所有歌曲（支援分頁；endpoint 用 /items，2026/2 後 /tracks 已移除） */
async function _neFetchAllTracks(playlistId, token) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100&offset=0`;

  while (url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error('歌單讀取失敗 ' + r.status + '：' + errText.slice(0, 60));
    }
    const d = await r.json();
    (d.items || [])
      .map(item => item?.track || item?.item)
      .filter(tr => tr && tr.uri && tr.uri.startsWith('spotify:track:'))
      .forEach(tr => tracks.push({
        id: tr.id || tr.uri.split(':')[2],
        name: tr.name || '（未知歌曲）',
        artist: (tr.artists || []).map(a => a.name).join(', '),
      }));
    url = d.next || null;
  }

  return tracks;
}

/* ──────────────────────────────────────
   下拉 1：選歌單 → 載入歌曲
────────────────────────────────────── */

function _neTrackLabel(tr) {
  const mark = _neNotes[tr.id] ? '📝 ' : '';
  return mark + tr.name + (tr.artist ? ' — ' + tr.artist : '');
}

function _neResetTrackSelect(text) {
  const sel = _neEl('ne-track');
  sel.innerHTML = '';
  sel.appendChild(new Option(text, ''));
  sel.disabled = true;
}

async function _neOnPlaylistChange() {
  const playlistId = _neEl('ne-playlist').value;

  _neClearError();
  _neHideNoteSection();
  _neTracks = [];

  if (!playlistId) {
    _neResetTrackSelect('請先選擇歌單');
    return;
  }

  _neResetTrackSelect('載入歌曲中...');

  try {
    const t = await getToken();
    if (!t) { _neGoLogin(); return; }

    const tracks = await _neFetchAllTracks(playlistId, t);
    if (_neEl('ne-playlist').value !== playlistId) return;   // 載入期間已換歌單

    _neTracks = tracks;

    if (tracks.length === 0) {
      _neResetTrackSelect('這個歌單沒有可用的歌曲');
      return;
    }

    const sel = _neEl('ne-track');
    sel.innerHTML = '';
    sel.appendChild(new Option(`請選擇歌曲（共 ${tracks.length} 首）`, ''));
    tracks.forEach(tr => sel.appendChild(new Option(_neTrackLabel(tr), tr.id)));
    sel.disabled = false;

  } catch (e) {
    console.error('_neOnPlaylistChange error:', e);
    _neResetTrackSelect('歌曲載入失敗');
    _neShowError(e.message);
  }
}

/* ──────────────────────────────────────
   下拉 2：選歌曲 → 載入備註
────────────────────────────────────── */

function _neHideNoteSection() {
  _neCurrentId = null;
  _neLoadedNote = '';
  _neEl('ne-note-section').style.display = 'none';
  _neEl('ne-note').value = '';
  _neSetStatus('');
}

function _neUpdateSaveBtn() {
  const ta = _neEl('ne-note');
  const changed = _neNormalize(ta.value) !== _neLoadedNote;
  _neEl('ne-save').disabled = ta.disabled || !changed;
}

async function _neOnTrackChange() {
  const id = _neEl('ne-track').value;

  _neClearError();

  if (!id) { _neHideNoteSection(); return; }

  const tr = _neTracks.find(x => x.id === id);
  const ta = _neEl('ne-note');

  _neCurrentId = id;
  _neLoadedNote = '';
  _neEl('ne-track-name').textContent = tr ? tr.name : '';
  _neEl('ne-track-artist').textContent = tr ? tr.artist : '';
  ta.value = '';
  ta.disabled = true;               // 載入完成前不能輸入，避免誤蓋掉原本的備註
  _neSetStatus('載入備註中...');
  _neEl('ne-note-section').style.display = 'block';
  _neUpdateSaveBtn();

  try {
    const note = await fetchTrackNote(id);
    if (_neCurrentId !== id) return;          // 載入期間已換歌

    if (note) _neNotes[id] = note; else delete _neNotes[id];
    _neLoadedNote = note;
    ta.value = note;                          // 未設定就是空白
    ta.disabled = false;
    _neSetStatus('');
  } catch (e) {
    if (_neCurrentId !== id) return;
    console.warn('fetchTrackNote 失敗:', e);
    _neSetStatus('備註讀取失敗：' + e.message, 'error');   // 維持 disabled，避免覆蓋
  }
  _neUpdateSaveBtn();
}

/* ──────────────────────────────────────
   儲存
────────────────────────────────────── */

function _neRefreshOptionLabel(id) {
  const tr = _neTracks.find(x => x.id === id);
  if (!tr) return;
  Array.from(_neEl('ne-track').options).forEach(opt => {
    if (opt.value === id) opt.textContent = _neTrackLabel(tr);
  });
}

async function neSave() {
  const id = _neCurrentId;
  if (!id) return;

  const ta = _neEl('ne-note');
  const text = _neNormalize(ta.value);

  _neEl('ne-save').disabled = true;
  _neSetStatus('儲存中...');

  try {
    await saveTrackNote(id, text);

    if (text) _neNotes[id] = text; else delete _neNotes[id];
    _neRefreshOptionLabel(id);

    if (_neCurrentId === id) {
      _neLoadedNote = text;
      ta.value = text;
      _neSetStatus(text ? '已儲存 ✓' : '已清除備註 ✓', 'ok');
    }
  } catch (e) {
    console.error('saveTrackNote 失敗:', e);
    if (_neCurrentId === id) _neSetStatus('儲存失敗：' + e.message, 'error');
  }

  _neUpdateSaveBtn();
}

init();
