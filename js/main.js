/**
 * main.js
 * 程式進入點。
 * 依賴順序（index.html 載入順序）：
 *   auth.js → player.js → history.js → nfc.js → playlist-mode.js → main.js
 */

async function init() {
  // 套用 NFC 設定到 UI
  applySettingsToUI(loadSettings());

  // 處理 OAuth 回呼
  const callbackOk = await handleCallback();
  if (callbackOk) {
    showView('player');
    checkNFC();
    return;
  }

  // 嘗試用既有 token 直接進入
  const t = await getToken();
  if (t) {
    showView('player');
    checkNFC();
    return;
  }

  // 沒有 token，回到登入頁
  showView('login');
}

init();
