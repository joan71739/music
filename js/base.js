/**
 * base.js
 * 全站共用工具函式
 * 所有頁面在載入其他 js 前先載入此檔
 */

/* ── Toast（共用） ── */

const _toastTimers = {};

/**
 * 顯示 Toast 通知
 * @param {string} toastId  Toast 元素的 id
 * @param {string} msg      訊息文字
 * @param {boolean} isOk    true = 綠色成功，false = 紅色失敗
 */
function showToast(toastId, msg, isOk = true) {
  const toast = document.getElementById(toastId);
  if (!toast) return;
  toast.innerHTML = `<span class="toast-check" style="background:${isOk ? 'var(--green)' : '#e74c3c'}">${isOk ? '✓' : '!'}</span>${msg}`;
  toast.classList.add('show');
  clearTimeout(_toastTimers[toastId]);
  _toastTimers[toastId] = setTimeout(() => toast.classList.remove('show'), 3000);
}
