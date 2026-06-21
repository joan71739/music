/**
 * main.js
 * 程式進入點。
 * 依賴順序（play.html 載入順序）：
 *   auth.js → player.js → history.js → nfc.js → playlist-mode.js → main.js
 */

async function init() {
  applySettingsToUI(loadSettings());

  const t = await getToken();
  if (!t) {
    window.location.href = 'login.html';
    return;
  }

  showView('player');
  _loadPlaylists();
  checkNFC();
}

init();