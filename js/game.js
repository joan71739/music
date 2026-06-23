/**
 * game.js
 * 玩家搶答畫面邏輯。
 * 依賴：firebase.js（initFirebase, roomRef, playersRef, buzzerRef）
 *
 * 功能：
 *   - 讀取玩家自己的 uid / name / emoji
 *   - 監聽 buzzer 狀態 → 切換 UI
 *   - 按搶答按鈕 → runTransaction（防競爭）
 *   - 監聽 players → 即時排行榜 + 自己的分數
 *   - 監聽 room status → ended 時提示
 */

const _params = new URLSearchParams(window.location.search);
const _roomCode = _params.get('room');

const _myUid = localStorage.getItem('player_uid');
const _myName = localStorage.getItem('player_name') || '玩家';
const _myEmoji = localStorage.getItem('player_avatar') || '🎵';

let _currentBuzzerStatus = 'idle';
let _answeredWrong = [];   // 本題已答錯的 uid 清單
let _buzzerPlayerId = null;
let _buzzerPlayerName = null;
let _buzzerPlayerEmoji = '';

let _countdownHandle = null;

/* ──────────────────────────────────────
   初始化
────────────────────────────────────── */

function init() {
    if (!_roomCode || !_myUid) {
        window.location.href = 'index.html';
        return;
    }

    initFirebase();

    // 頂部個人資訊
    document.getElementById('game-room-code').textContent = `房間 ${_roomCode}`;
    document.getElementById('game-self-avatar').textContent = _myEmoji;
    document.getElementById('game-self-name').textContent = _myName;

    _listenBuzzer();
    _listenPlayers();
    _listenRoomStatus();
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
        _answeredWrong = Array.isArray(buzzer.answeredWrong) ? buzzer.answeredWrong : [];

        _renderState();
    });
}

function _iAmWrong() {
    return _answeredWrong.includes(_myUid);
}

/* ──────────────────────────────────────
   UI 渲染
────────────────────────────────────── */

// 所有狀態 id
const ALL_STATES = [
    'state-idle', 'state-self-buzzing', 'state-other-buzzing',
    'state-judged-self', 'state-judged-other',
    'state-locked', 'state-waiting', 'state-locked-self',
];

function _showState(id) {
    ALL_STATES.forEach(s => {
        document.getElementById(s).style.display = (s === id) ? 'flex' : 'none';
    });
}

function _renderState() {
    // 清除倒數
    _clearCountdown();

    const status = _currentBuzzerStatus;
    const isMine = (_buzzerPlayerId === _myUid);
    const btn = document.getElementById('buzzer-btn');
    const hint = document.getElementById('buzzer-hint');

    btn.disabled = false;
    btn.className = 'game-buzzer-btn';
    hint.textContent = '';

    switch (status) {

        case 'idle':
            if (_iAmWrong()) {
                // 本題已答錯，鎖住
                _showState('state-locked-self');
                btn.disabled = true;
                btn.classList.add('btn-locked');
                hint.textContent = '此題已答錯，下一首才能搶答';
            } else {
                _showState('state-idle');
                btn.classList.add('btn-ready');
            }
            document.getElementById('buzzer-text').textContent = '搶答';
            break;

        case 'buzzing':
            if (isMine) {
                _showState('state-self-buzzing');
                btn.disabled = true;
                btn.classList.add('btn-self-buzzing');
                document.getElementById('buzzer-text').textContent = '你搶到了';
            } else {
                _showState('state-other-buzzing');
                document.getElementById('other-buzzing-title').textContent =
                    `${_buzzerPlayerEmoji} ${_buzzerPlayerName} 搶到了！`;
                btn.disabled = true;
                btn.classList.add('btn-locked');
                document.getElementById('buzzer-text').textContent = '搶答';
            }
            break;

        case 'judged':
            if (isMine) {
                _showState('state-judged-self');
            } else {
                _showState('state-judged-other');
                document.getElementById('judged-other-title').textContent =
                    `${_buzzerPlayerEmoji} ${_buzzerPlayerName} 答對！`;
            }
            btn.disabled = true;
            btn.classList.add('btn-locked');
            document.getElementById('buzzer-text').textContent = '等待下一首';
            break;

        case 'locked':
            _showState('state-locked');
            document.getElementById('locked-title').textContent =
                `${_buzzerPlayerEmoji} ${_buzzerPlayerName} 答錯了`;
            btn.disabled = true;
            btn.classList.add('btn-locked');
            document.getElementById('buzzer-text').textContent = '倒數中...';
            // 倒數 UI（play.html 負責寫 Firebase，這裡只做顯示）
            _startCountdown(3);
            break;

        case 'waiting-next':
            _showState('state-waiting');
            btn.disabled = true;
            btn.classList.add('btn-locked');
            document.getElementById('buzzer-text').textContent = '等待下一首';
            break;

        default:
            _showState('state-idle');
    }
}

/* ──────────────────────────────────────
   倒數計時（UI 層，不寫 Firebase）
────────────────────────────────────── */

function _startCountdown(sec) {
    const el = document.getElementById('locked-countdown');
    el.textContent = sec;
    let remaining = sec;

    _countdownHandle = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            _clearCountdown();
            el.textContent = '';
        } else {
            el.textContent = remaining;
        }
    }, 1000);
}

function _clearCountdown() {
    if (_countdownHandle) {
        clearInterval(_countdownHandle);
        _countdownHandle = null;
    }
}

/* ──────────────────────────────────────
   搶答按鈕
────────────────────────────────────── */

async function handleBuzzer() {
    if (_iAmWrong()) return;
    if (_currentBuzzerStatus !== 'idle') return;

    const btn = document.getElementById('buzzer-btn');
    btn.disabled = true;

    try {
        const result = await buzzerRef(_roomCode).transaction(current => {
            if (!current || current.status !== 'idle') {
                return; // abort：已有人搶到
            }
            return {
                ...current,
                status: 'buzzing',
                playerId: _myUid,
                playerName: _myName,
                playerEmoji: _myEmoji,
                buzzerTime: firebase.database.ServerValue.TIMESTAMP,
            };
        });

        if (!result.committed) {
            // 搶答失敗（別人先搶到）
            btn.disabled = false;
        }
        // 成功的話 buzzer 監聽會自動更新 UI

    } catch (e) {
        console.error('搶答 transaction 失敗:', e);
        btn.disabled = false;
    }
}

/* ──────────────────────────────────────
   監聽玩家分數（排行榜 + 自己分數）
────────────────────────────────────── */

function _listenPlayers() {
    playersRef(_roomCode).on('value', snap => {
        const players = snap.val() || {};

        // 更新自己的分數
        const me = players[_myUid];
        if (me) {
            document.getElementById('game-self-score').textContent = me.score || 0;
        }

        _renderLeaderboard(players);
    });
}

function _renderLeaderboard(players) {
    const list = document.getElementById('game-lb-list');
    const items = Object.entries(players)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    if (items.length === 0) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = items.map(([uid, p], i) => `
    <div class="game-lb-row ${uid === _myUid ? 'lb-row-me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-avatar">${p.emoji || '🎵'}</span>
      <span class="lb-name">${_escape(p.name || '玩家')}</span>
      <span class="lb-score">${p.score || 0}</span>
    </div>
  `).join('');
}

/* ──────────────────────────────────────
   監聽房間狀態
────────────────────────────────────── */

function _listenRoomStatus() {
    roomRef(_roomCode).child('status').on('value', snap => {
        const status = snap.val();
        if (status === null) {
            // 房間不見了
            alert('房間已結束');
            window.location.href = 'index.html';
        }
    });
}

/* ──────────────────────────────────────
   工具
────────────────────────────────────── */

function _escape(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ──────────────────────────────────────
   啟動
────────────────────────────────────── */

init();