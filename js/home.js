/**
 * home.js
 * 首頁（index.html）專屬邏輯。
 * 負責：登入狀態檢查、登出、Toast 通知
 * 依賴：auth.js（getToken、localStorage 清除）
 */

let _homeToastTimer = null;

function showHomeToast(msg, isOk = true) {
    const toast = document.getElementById('home-toast');
    toast.innerHTML = `<span class="toast-check" style="background:${isOk ? 'var(--green)' : '#e74c3c'}">${isOk ? '✓' : '!'}</span>${msg}`;
    toast.classList.add('show');
    clearTimeout(_homeToastTimer);
    _homeToastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function homeLogout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

async function init() {
    const t = await getToken();
    if (!t) {
        window.location.href = 'login.html';
    }
}

init();