/**
 * nfc.js
 * NFC 模式專屬邏輯。
 * 負責：播放設定（start/duration/limitMode）、URL 參數解析、NFC 觸發播放。
 * 依賴：auth.js（getToken）、player.js（playTrack）
 */

/* ── 設定讀寫 ── */

function loadSettings() {
  const defaults = { limitMode: false, durationSec: 30, startSec: 0 };
  const raw = localStorage.getItem('player_settings');
  if (!raw) return defaults;
  try { return { ...defaults, ...JSON.parse(raw) }; }
  catch(e) { return defaults; }
}

function _saveSettings(s) {
  localStorage.setItem('player_settings', JSON.stringify(s));
}

function applySettingsToUI(s) {
  const elLimit = document.getElementById('setting-limit');
  const elStart = document.getElementById('display-start');
  const elDur   = document.getElementById('display-dur');
  const elRow   = document.getElementById('row-duration');
  const elSumm  = document.getElementById('settings-summary');

  if (elLimit) elLimit.checked     = s.limitMode;
  if (elStart) elStart.textContent = s.startSec + ' 秒';
  if (elDur)   elDur.textContent   = s.durationSec + ' 秒';
  if (elRow)   elRow.classList.toggle('disabled', !s.limitMode);

  const parts = [];
  if (s.startSec > 0) parts.push('從' + s.startSec + '秒');
  if (s.limitMode)    parts.push('限時' + s.durationSec + '秒');
  if (elSumm) elSumm.textContent = parts.join(' · ');
}

function stepSetting(key, delta) {
  const s = loadSettings();
  if (key === 'start') s.startSec    = Math.max(0,   Math.min(600, s.startSec + delta));
  else                 s.durationSec = Math.max(5,   Math.min(300, s.durationSec + delta));
  _saveSettings(s);
  applySettingsToUI(s);
}

function onLimitToggle() {
  const el = document.getElementById('setting-limit');
  if (!el) return;
  const s = loadSettings();
  s.limitMode = el.checked;
  _saveSettings(s);
  applySettingsToUI(s);
}

/* ── 設定面板展開 / 收合 ── */

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const btn   = document.getElementById('settings-toggle-btn');
  const open  = panel.classList.toggle('open');
  btn.classList.toggle('open', open);
}

/* ── URL 參數解析（NFC/QR 帶入的參數） ── */

function parsePlayParams() {
  const params = new URLSearchParams(window.location.search);
  const uri    = params.get('uri');
  if (!uri) return null;

  const s          = loadSettings();
  // [修正A] parseInt 加 radix 10，防止前導零被誤判為八進位
  const startMs    = params.has('start_ms')
    ? parseInt(params.get('start_ms'), 10)
    : s.startSec * 1000;
  const durationMs = params.has('duration_ms')
    ? parseInt(params.get('duration_ms'), 10)
    : (s.limitMode ? s.durationSec * 1000 : null);

  return { uri, startMs, durationMs };
}

/* ── NFC 感應觸發 ── */

function checkNFC() {
  const params = parsePlayParams();
  if (!params) return;

  // 清除 URL 參數，避免重新整理時重複播放
  window.history.replaceState({}, '', window.location.pathname);

  setTimeout(() => playTrack(params.uri, params.startMs, params.durationMs), 300);
}
