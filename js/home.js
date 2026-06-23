/**
 * home.js
 * 首頁（index.html）專屬邏輯。
 * 負責：登入狀態檢查、登出
 * 依賴：auth.js（getToken）、base.js（showToast）
 */

function homeLogout() {
  localStorage.clear();
  window.location.href = 'login.html';
}
