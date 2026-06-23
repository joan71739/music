/**
 * mode-select.js
 * 選玩法頁面邏輯。
 * 負責：點選玩法時 check token，無則存 loginRedirect 跳登入。
 * 支援單人（無 room 參數）與多人（有 room 參數）兩種路徑。
 */

async function goPlay(mode) {
  // 讀 URL 的 room 參數（多人模式才有）
  const room = new URLSearchParams(window.location.search).get('room');

  // 目標 URL
  const target = room
    ? `play.html?mode=${mode}&room=${room}`
    : `play.html?mode=${mode}`;

  // 檢查是否已登入
  const t = await getToken();
  if (t) {
    window.location.href = target;
    return;
  }

  // 沒有 token，存 redirect target 後跳登入
  sessionStorage.setItem('loginRedirect', target);
  window.location.href = 'login.html';
}

// 如果有 room 參數，改一下副標題提示多人模式
function init() {
  const room = new URLSearchParams(window.location.search).get('room');
  if (room) {
    const sub = document.getElementById('mode-sub');
    if (sub) sub.textContent = `多人房間 ${room} · 選擇玩法`;
  }
}

init();
