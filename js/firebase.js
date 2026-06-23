/**
 * firebase.js
 * Firebase Realtime Database 初始化與共用工具函式。
 * ⚠️ 只在有 `room` URL 參數的頁面才呼叫 initFirebase()。
 *
 * 使用前需先把下方 firebaseConfig 填入你的 Firebase 專案設定。
 */

// ── 請把這裡換成你的 Firebase 專案設定 ──
const firebaseConfig = {
  apiKey:            "AIzaSyCjRHrS10zj5ga7wOh8cI1wPFSyUv-aU_s",
  authDomain:        "music-54eeb.firebaseapp.com",
  databaseURL:       "https://music-54eeb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "music-54eeb",
  storageBucket:     "music-54eeb.firebasestorage.app",
  messagingSenderId: "1078805338803",
  appId:             "1:1078805338803:web:711e4dd97bdba09fb9eec6",
};
// ─────────────────────────────────────────

let _db = null;

/**
 * 初始化 Firebase。
 * 只在有 room 參數的頁面呼叫，呼叫一次即可。
 */
function initFirebase() {
  if (_db) return; // 已初始化就跳過

  // 使用 Firebase CDN compat 版本（v9 compat，全域 firebase 物件）
  firebase.initializeApp(firebaseConfig);
  _db = firebase.database();
}

/** 取得 database 實例（initFirebase 之後才能用） */
function getDb() {
  return _db;
}

/* ── 常用 ref 工具 ── */

function roomRef(roomCode) {
  return _db.ref(`rooms/${roomCode}`);
}

function playersRef(roomCode) {
  return _db.ref(`rooms/${roomCode}/players`);
}

function buzzerRef(roomCode) {
  return _db.ref(`rooms/${roomCode}/buzzer`);
}

function currentTrackRef(roomCode) {
  return _db.ref(`rooms/${roomCode}/currentTrack`);
}

/* ── 密碼 Hash（SHA-256） ── */

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ── 房間碼產生（6 碼英數大寫） ── */

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字元 0/O/1/I
  let code = '';
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (const b of arr) code += chars[b % chars.length];
  return code;
}

/* ── 刪除舊房間 ── */

async function deleteOldRoom() {
  const oldRoom = localStorage.getItem('host_room_code');
  if (!oldRoom) return;
  try {
    await _db.ref(`rooms/${oldRoom}`).remove();
  } catch (e) {
    console.warn('刪除舊房間失敗（可能已不存在）:', e);
  }
}

/* ── 建立新房間 ── */

/**
 * @param {string} roomCode
 * @param {string} passwordHash
 * @returns {Promise<void>}
 */
async function createRoom(roomCode, passwordHash) {
  await _db.ref(`rooms/${roomCode}`).set({
    hostPasswordHash: passwordHash,
    status:           'waiting',
    createdAt:        firebase.database.ServerValue.TIMESTAMP,
    currentTrack:     null,
    buzzer: {
      status:        'idle',
      playerId:      null,
      playerName:    null,
      buzzerTime:    null,
      answeredWrong: [],
    },
    players: {},
  });
}
