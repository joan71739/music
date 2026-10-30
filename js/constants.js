/**
 * constants.js
 * 全站共用常數
 * 所有頁面最先載入此檔（在 base.js 之前）
 */

const DEFAULTS = {
  LIMIT_MODE:      false,  // 預設不限時
  DURATION_SEC:    30,     // 限時播放秒數
  START_SEC:       0,      // 預設從頭播
  NAME_START_SEC:  30,     // 猜歌名模式：從第 30 秒開始
  INTRO_START_SEC: 0,      // 猜前奏模式：從頭開始
  ADD_TO_PLAYED:   true,   // 播放時是否加入今日歌單
  ALLOW_REPEAT:    true,   // 是否允許重複播放（關閉則跳過今日歌單已有的歌）
};
