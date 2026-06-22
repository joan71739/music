/**
 * main.js
 * 程式進入點。
 * 依賴順序（play.html 載入順序）：
 *   constants.js → auth.js → player.js → history.js → nfc.js → playlist-mode.js → main.js
 */

async function init() {
  const s = loadSettings();

  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'intro') {
    s.startSec    = DEFAULTS.INTRO_START_SEC;
    s.limitMode   = true;
    s.durationSec = DEFAULTS.DURATION_SEC;
  } else if (mode === 'name') {
    s.startSec  = DEFAULTS.NAME_START_SEC;
    s.limitMode = false;
  }

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
