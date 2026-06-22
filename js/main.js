/**
 * main.js
 * 程式進入點。
 * 依賴順序（play.html 載入順序）：
 *   auth.js → player.js → history.js → nfc.js → playlist-mode.js → main.js
 */

async function init() {
  const s = loadSettings();

  // 根據 mode 參數覆蓋播放設定（不寫入 localStorage）
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'intro') {
    s.startSec = 0;
    s.limitMode = true;
    s.durationSec = 30;
  } else if (mode === 'name') {
    s.startSec = 30;
    s.limitMode = false;
  }

  // 寫回 localStorage
  localStorage.setItem('player_settings', JSON.stringify(s));
  
  applySettingsToUI(s);

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
