/**
 * アプリ全体で使う設定値。
 * シート名や授業区分をここへ集約し、表記ゆれを防ぐ。
 */
const APP = Object.freeze({
  NAME: 'まなびシフト',
  TZ: 'Asia/Tokyo',
  ADMIN_SESSION_SECONDS: 60 * 60 * 4,
  SHEETS: {
    EMPLOYEES: '講師',
    STUDENTS: '生徒',
    FIXED_SHIFTS: '固定シフト',
    SHIFT_CHANGES: '日別変更',
    ATTENDANCE: '打刻',
    LESSON_BALANCES: '残コマ',
    LESSON_LEDGER: 'コマ履歴',
    GUARDIAN_MEETINGS: '保護者面談',
    SETTINGS: '設定'
  },
  LESSON_TYPES: ['通常', '振替', '講習'],
  CLOCK_TYPES: {
    clock_in: '出勤',
    break_begin: '休憩開始',
    break_end: '休憩終了',
    clock_out: '退勤'
  },

  /** 個別指導塾で使用する授業時間。シフト編集表の横軸になる。 */
  PERIODS: [
    { id: '3', label: '3コマ', startTime: '13:10', endTime: '14:40' },
    { id: '4', label: '4コマ', startTime: '14:50', endTime: '16:20' },
    { id: 'A', label: 'Aコマ', startTime: '16:50', endTime: '18:20' },
    { id: 'B', label: 'Bコマ', startTime: '18:30', endTime: '20:00' },
    { id: 'C', label: 'Cコマ', startTime: '20:10', endTime: '21:40' }
  ]
});

/** Script Propertiesに保存するキー。 */
const PROP = Object.freeze({
  DATA_SPREADSHEET_ID: 'DATA_SPREADSHEET_ID',
  ADMIN_PASSWORD_HASH: 'ADMIN_PASSWORD_HASH',
  // freee APIの値はソースコードに直接書かず、スクリプトプロパティに保存する。
  FREEE_ACCESS_TOKEN: 'FREEE_ACCESS_TOKEN',
  FREEE_COMPANY_ID: 'FREEE_COMPANY_ID'
});

/** HTMLから共通部品を読み込むための関数。 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Webアプリ自身のURLを返す。 */
function getAppUrl() {
  return ScriptApp.getService().getUrl();
}
