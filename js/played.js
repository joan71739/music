/**
 * played.js
 * 今日歌單頁（played.html）：
 *   - 列表：讀 Firebase played/（即時更新）
 *   - 同步：以 Spotify 今日歌單為準，重建 Firebase 紀錄
 *   - 清除：清空 Firebase，並嘗試清空 Spotify 今日歌單
 * 依賴：auth.js、track-notes.js、history.js、base.js（showToast）
 */

let _pdBusy = false;

function _pdEl(id) {
  return document.getElementById(id);
}

function _pdEsc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** kind：'ok' | 'warn' | 'err' | ''（一般） */
function pdSetStatus(text, kind) {
  const el = _pdEl('pd-status');
  el.textContent = text || '';
  el.className = 'pd-status' + (kind ? ' ' + kind : '');
  el.style.display = text ? 'block' : 'none';
}

function pdSetBusy(busy) {
  _pdBusy = busy;
  _pdEl('pd-sync').disabled = busy;
  _pdEl('pd-clear').disabled = busy;
}

function _pdToast(msg, ok) {
  if (typeof showToast === 'function') showToast('played-toast', msg, ok);
}

/* ── 列表 ── */

function pdRender() {
  const list = getPlayedList();   // 舊 → 新
  _pdEl('pd-count').textContent = list.length ? `共 ${list.length} 首` : '';

  const box = _pdEl('pd-list');
  if (list.length === 0) {
    box.innerHTML =
      '<div class="pd-empty">今天還沒有播放紀錄' +
      '<small>第一次使用？請先按上方「同步」</small></div>';
    return;
  }

  // 最新的在最上面；編號 = 第幾首播的
  box.innerHTML = list.slice().reverse().map((it, i) => `
    <div class="pd-item">
      <div class="pd-no">${list.length - i}</div>
      <div class="pd-info">
        <div class="pd-song">${_pdEsc(it.name || '（未知歌名）')}</div>
        <div class="pd-artist">${_pdEsc(it.artist)}</div>
      </div>
    </div>
  `).join('');
}

/* ── 同步：Spotify → Firebase ── */

async function pdSync() {
  if (_pdBusy) return;

  const left = spCooldownLeft();
  if (left > 0) {
    pdSetStatus(`Spotify 請求過多，請等 ${left} 秒再同步`, 'err');
    return;
  }

  const ok = confirm(
    '同步會以 Spotify 今日歌單為準，覆蓋 Firebase 目前的紀錄。\n' +
    '（只存在 Firebase、沒有加進 Spotify 歌單的歌會消失）\n\n要繼續嗎？'
  );
  if (!ok) return;

  pdSetBusy(true);
  pdSetStatus('同步中：讀取 Spotify 今日歌單…', '');
  try {
    const n = await syncPlayedFromSpotify();
    pdSetStatus(`同步完成：共 ${n} 首`, 'ok');
    _pdToast(`同步完成：${n} 首`, true);
  } catch (e) {
    pdSetStatus('同步失敗：' + ((e && e.message) || e) + '（原本的 Firebase 紀錄沒有被覆蓋）', 'err');
  } finally {
    pdSetBusy(false);
  }
}

/* ── 清除：Firebase + Spotify 今日歌單 ── */

async function pdClear() {
  if (_pdBusy) return;

  const ok = confirm(
    '確定要清除今日歌單嗎？\n\n' +
    '• 清空 Firebase 的播放紀錄\n' +
    '• 並清空 Spotify 的「今日歌單」\n\n此動作無法復原。'
  );
  if (!ok) return;

  pdSetBusy(true);
  pdSetStatus('清除中…', '');
  try {
    const r = await clearPlayedAll();

    if (r.firebase && r.spotify) {
      pdSetStatus('已清除：Firebase 紀錄與 Spotify 今日歌單', 'ok');
      _pdToast('已清除今日歌單', true);
    } else if (r.firebase && !r.spotify) {
      pdSetStatus('Firebase 紀錄已清除；但 Spotify 今日歌單沒有清掉（' + r.spotifyMsg + '）', 'warn');
    } else if (!r.firebase && r.spotify) {
      pdSetStatus('Spotify 今日歌單已清空；但 Firebase 清除失敗（' + r.firebaseMsg + '）', 'err');
    } else {
      pdSetStatus('清除失敗：Firebase（' + r.firebaseMsg + '）；Spotify（' + (r.spotifyMsg || '未執行') + '）', 'err');
    }
  } catch (e) {
    pdSetStatus('清除失敗：' + ((e && e.message) || e), 'err');
  } finally {
    pdSetBusy(false);
  }
}

/* ── 進入頁面 ── */

async function pdInit() {
  onPlayedChange(pdRender);
  pdSetStatus('讀取 Firebase 今日紀錄中…', '');
  try {
    await loadPlayedRecords();
    pdSetStatus('');
    pdRender();
  } catch (e) {
    _pdEl('pd-list').innerHTML = '<div class="pd-empty">讀取失敗</div>';
    pdSetStatus(
      '讀取 Firebase 失敗：' + ((e && e.message) || e) +
      '。請確認 Firebase 規則有開放 played 路徑的讀寫。', 'err'
    );
  }
}

pdInit();
