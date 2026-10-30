/**
 * track-notes.js
 * 歌曲備註的 Firebase 存取（路徑：trackNotes/{Spotify 歌曲 ID}，值為純文字）。
 *
 * 用在兩個地方：
 *   - notes-edit.html：編輯備註（fetchAllTrackNotes / fetchTrackNote / saveTrackNote）
 *   - play.html（單人模式）：每首歌播放時讀取自己的備註（fetchTrackNote）
 *
 * 單人模式原本不載入 Firebase，這裡第一次需要時才動態載入，
 * 所以不影響原本「單人模式不碰 Firebase」的 lazy 載入設計。
 *
 * 依賴：firebase.js（initFirebase, getDb）——若頁面沒載入會自動補載。
 * 所有函式失敗時都會 throw，由呼叫端決定怎麼處理。
 */

const NOTES_PATH = 'trackNotes';
const NOTES_SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';

let _notesDbPromise = null;

function _loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('載入失敗：' + src));
    document.head.appendChild(s);
  });
}

/** 取得可用的 Firebase database（必要時載入 SDK 與 firebase.js 並初始化） */
function ensureNotesDb() {
  if (_notesDbPromise) return _notesDbPromise;

  _notesDbPromise = (async () => {
    // 已經初始化好（例如多人頁面、或編輯頁自己先 init）
    if (typeof getDb === 'function' && getDb()) return getDb();

    // 多人模式：play.html 自己會載入 Firebase，這裡只等它就緒
    const hasRoom = new URLSearchParams(window.location.search).get('room');
    if (hasRoom) {
      for (let i = 0; i < 50; i++) {
        if (typeof getDb === 'function' && getDb()) return getDb();
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('Firebase 尚未就緒');
    }

    // 單人模式：自己補載
    if (typeof firebase === 'undefined') {
      await _loadScriptOnce(NOTES_SDK_BASE + 'firebase-app-compat.js');
      await _loadScriptOnce(NOTES_SDK_BASE + 'firebase-database-compat.js');
    }
    if (typeof initFirebase !== 'function') {
      await _loadScriptOnce('js/firebase.js');
    }
    initFirebase();
    return getDb();
  })();

  // 失敗時清掉，下次呼叫可以重試
  _notesDbPromise.catch(() => { _notesDbPromise = null; });
  return _notesDbPromise;
}

/** 讀單首歌的備註；沒有就回傳空字串 */
async function fetchTrackNote(trackId) {
  if (!trackId) return '';
  const db = await ensureNotesDb();
  const snap = await db.ref(`${NOTES_PATH}/${trackId}`).once('value');
  const v = snap.val();
  return typeof v === 'string' ? v : '';
}

/** 讀全部備註，回傳 { trackId: text } */
async function fetchAllTrackNotes() {
  const db = await ensureNotesDb();
  const snap = await db.ref(NOTES_PATH).once('value');
  const raw = snap.val() || {};
  const notes = {};
  Object.keys(raw).forEach(id => {
    if (typeof raw[id] === 'string' && raw[id]) notes[id] = raw[id];
  });
  return notes;
}

/** 儲存備註；text 為空字串＝刪除這首的備註 */
async function saveTrackNote(trackId, text) {
  if (!trackId) throw new Error('缺少歌曲 ID');
  const db = await ensureNotesDb();
  const ref = db.ref(`${NOTES_PATH}/${trackId}`);
  if (text) await ref.set(text);
  else await ref.remove();
}
