/**
 * main.js
 * 程式進入點。
 * 依賴順序（play.html 載入順序）：
 *   constants.js → auth.js → player.js → history.js → nfc.js → playlist-mode.js → main.js
 */

async function init() {
  const s = loadSettings();

  const mode = new URLSearchParams(window.location.search).get('mode') || 'name';
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
  loadPlayedRecords().catch(() => {});   // 預載今日紀錄（Firebase），之後判斷「播過了沒」不用再等
  startCooldownUI();                      // 上一次的 429 冷卻還沒結束 → 一進來就鎖住「下一首」並顯示倒數
  checkNFC();
}

init();
