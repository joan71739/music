/**
 * host.js
 * 主持人控制台邏輯。
 * 依賴：firebase.js（initFirebase, roomRef, playersRef, buzzerRef, currentTrackRef, hashPassword）
 *
 * 功能：
 *   - 密碼驗證（SHA-256 比對 Firebase）
 *   - 監聽 currentTrack → 顯示歌名
 *   - 監聽 buzzer → 顯示搶答狀態 + 啟/停判定按鈕
 *   - 監聽 players → 即時分數板
 *   - 答對：更新分數 + buzzer → judged
 *   - 答錯：answeredWrong + buzzer → locked
 *   - 跳過：buzzer → waiting-next
 */

const _params = new URLSearchParams(window.location.search);
const _roomCode = _params.get('room');

// 目前搶答者資訊（由 buzzer 監聽更新）
let _buzzerPlayerId = null;
let _buzzerPlayerName = null;
let _buzzerPlayerEmoji = null;
let _currentBuzzerStatus = 'idle';

/* ──────────────────────────────────────
   初始化
────────────────────────────────────── */

function init() {
    if (!_roomCode) {
        alert('找不到房間碼，請重新掃 QR Code');
        window.location.href = 'index.html';
        return;
    }

    initFirebase();

    document.getElementById('auth-room-label').textContent = `房間 ${_roomCode}`;
    document.getElementById('host-footer-room-code').textContent = _roomCode;

    // 按 Enter 直接驗證
    document.getElementById('auth-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuth();
    });
}

/* ──────────────────────────────────────
   密碼驗證
────────────────────────────────────── */

function togglePwdVisibility() {
    const input = document.getElementById('auth-password');
    const icon = document.getElementById('auth-eye-icon');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    icon.className = show ? 'ti ti-eye-off' : 'ti ti-eye';
}

async function handleAuth() {
    const password = document.getElementById('auth-password').value.trim();
    if (!password) return;

    const btn = document.getElementById('auth-btn');
    btn.disabled = true;
    btn.textContent = '驗證中...';

    try {
        const inputHash = await hashPassword(password);
        const snap = await roomRef(_roomCode).child('hostPasswordHash').get();

        if (!snap.exists()) {
            _showAuthError('房間不存在或已過期');
            btn.disabled = false;
            btn.textContent = '進入控制台';
            return;
        }

        if (snap.val() !== inputHash) {
            _showAuthError('密碼錯誤，請再試一次');
            btn.disabled = false;
            btn.textContent = '進入控制台';
            document.getElementById('auth-password').value = '';
            document.getElementById('auth-password').focus();
            return;
        }

        // 驗證成功
        _enterConsole();

    } catch (e) {
        console.error('驗證失敗:', e);
        _showAuthError('驗證失敗：' + (e.message || '請確認網路'));
        btn.disabled = false;
        btn.textContent = '進入控制台';
    }
}

function _showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.style.display = 'block';
}

/* ──────────────────────────────────────
   進入主控台
────────────────────────────────────── */

function _enterConsole() {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('host-view').style.display = 'flex';

    _listenCurrentTrack();
    _listenBuzzer();
    _listenPlayers();
}

/* ──────────────────────────────────────
   監聽 currentTrack
────────────────────────────────────── */

function _listenCurrentTrack() {
    currentTrackRef(_roomCode).on('value', snap => {
        const track = snap.val();
        if (track && track.name) {
            document.getElementById('host-track-name').textContent = track.name;
            document.getElementById('host-track-artist').textContent = track.artist || '';
            document.getElementById('host-track-bar').classList.add('has-track');
        } else {
            document.getElementById('host-track-name').textContent = '等待播放中...';
            document.getElementById('host-track-artist').textContent = '';
            document.getElementById('host-track-bar').classList.remove('has-track');
        }
    });
}

/* ──────────────────────────────────────
   監聽 buzzer 狀態
────────────────────────────────────── */

function _listenBuzzer() {
    buzzerRef(_roomCode).on('value', snap => {
        const buzzer = snap.val() || {};
        _currentBuzzerStatus = buzzer.status || 'idle';
        _buzzerPlayerId = buzzer.playerId || null;
        _buzzerPlayerName = buzzer.playerName || null;
        _buzzerPlayerEmoji = buzzer.playerEmoji || '';

        _renderBuzzerUI(_currentBuzzerStatus, _buzzerPlayerName, _buzzerPlayerEmoji);
        _updateJudgeBtns(_currentBuzzerStatus);
    });
}

function _renderBuzzerUI(status, name, emoji) {
    const dot = document.getElementById('host-buzzer-dot');
    const text = document.getElementById('host-buzzer-text');
    const bar = document.getElementById('host-buzzer-bar');

    bar.className = 'host-buzzer-bar';

    switch (status) {
        case 'idle':
            dot.className = 'host-buzzer-dot dot-idle';
            text.textContent = '等待搶答';
            break;
        case 'buzzing':
            bar.classList.add('bar-buzzing');
            dot.className = 'host-buzzer-dot dot-buzzing';
            text.textContent = `${emoji} ${name} 搶答！`;
            break;
        case 'judged':
            dot.className = 'host-buzzer-dot dot-judged';
            text.textContent = `✅ ${emoji} ${name} 答對！等待下一首`;
            break;
        case 'locked':
            dot.className = 'host-buzzer-dot dot-locked';
            text.textContent = `❌ ${emoji} ${name} 答錯，開放其他人倒數中...`;
            break;
        case 'waiting-next':
            dot.className = 'host-buzzer-dot dot-skip';
            text.textContent = '⏭ 跳過，等待下一首';
            break;
        default:
            dot.className = 'host-buzzer-dot dot-idle';
            text.textContent = '等待搶答';
    }
}

function _updateJudgeBtns(status) {
    const canJudge = (status === 'buzzing');
    ['btn-correct-1', 'btn-correct-2', 'btn-correct-3', 'btn-wrong', 'btn-skip'].forEach(id => {
        document.getElementById(id).disabled = !canJudge;
    });
}

/* ──────────────────────────────────────
   監聽玩家分數板
────────────────────────────────────── */

function _listenPlayers() {
    playersRef(_roomCode).on('value', snap => {
        const players = snap.val() || {};
        _renderScores(players);
    });
}

function _renderScores(players) {
    const list = document.getElementById('host-scores-list');
    const items = Object.entries(players)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    if (items.length === 0) {
        list.innerHTML = '<div class="host-no-players">尚無玩家</div>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    list.innerHTML = items.map(([uid, p], i) => `
    <div class="host-score-row ${uid === _buzzerPlayerId ? 'score-row-active' : ''}">
      <div class="host-score-rank">${medals[i] || (i + 1)}</div>
      <div class="host-score-avatar">${p.emoji || '🎵'}</div>
      <div class="host-score-name">${_escape(p.name || '玩家')}</div>
      <div class="host-score-pts">${p.score || 0}<span class="pts-label">分</span></div>
    </div>
  `).join('');
}

function _escape(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ──────────────────────────────────────
   判定：答對（+N 分）
────────────────────────────────────── */

async function handleCorrect(pts) {
    if (!_buzzerPlayerId || _currentBuzzerStatus !== 'buzzing') return;

    _disableAllJudgeBtns();

    try {
        // 更新分數
        const scoreRef = playersRef(_roomCode).child(_buzzerPlayerId).child('score');
        await scoreRef.transaction(current => (current || 0) + pts);

        // buzzer → judged
        await buzzerRef(_roomCode).update({
            status: 'judged',
        });

    } catch (e) {
        console.error('handleCorrect 失敗:', e);
    }
}

/* ──────────────────────────────────────
   判定：答錯
────────────────────────────────────── */

async function handleWrong() {
    if (!_buzzerPlayerId || _currentBuzzerStatus !== 'buzzing') return;

    _disableAllJudgeBtns();

    try {
        // 讀取目前 answeredWrong 名單，push 進去
        const buzzerSnap = await buzzerRef(_roomCode).get();
        const buzzer = buzzerSnap.val() || {};
        const wrongList = Array.isArray(buzzer.answeredWrong) ? buzzer.answeredWrong : [];

        if (!wrongList.includes(_buzzerPlayerId)) {
            wrongList.push(_buzzerPlayerId);
        }

        // 一次更新：answeredWrong + status → locked
        await buzzerRef(_roomCode).update({
            status: 'locked',
            answeredWrong: wrongList,
        });

    } catch (e) {
        console.error('handleWrong 失敗:', e);
    }
}

/* ──────────────────────────────────────
   判定：跳過
────────────────────────────────────── */

async function handleSkip() {
    if (_currentBuzzerStatus !== 'buzzing') return;

    _disableAllJudgeBtns();

    try {
        await buzzerRef(_roomCode).update({ status: 'waiting-next' });
    } catch (e) {
        console.error('handleSkip 失敗:', e);
    }
}

/* ──────────────────────────────────────
   工具
────────────────────────────────────── */

function _disableAllJudgeBtns() {
    ['btn-correct-1', 'btn-correct-2', 'btn-correct-3', 'btn-wrong', 'btn-skip'].forEach(id => {
        document.getElementById(id).disabled = true;
    });
}

/* ──────────────────────────────────────
   啟動
────────────────────────────────────── */

init();