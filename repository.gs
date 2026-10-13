/**
 * スプレッドシートへの読み書きを担当する層。
 * 画面や業務ロジックからセル位置を意識しなくて済むようにする。
 */

const HEADERS = Object.freeze({
  '講師': ['講師ID', '講師名', '担当可能曜日', '勤務可能時間', '有効'],
  '生徒': ['生徒ID', '生徒名', 'メモ', '有効'],
  '固定シフト': ['曜日', '開始時刻', '終了時刻', '講師ID', '講師名', '生徒1ID', '生徒1名', '生徒1区分', '生徒2ID', '生徒2名', '生徒2区分'],
  // 実施状況は既存データの列位置を崩さないよう末尾へ追加する。
  '日別変更': ['日付', '開始時刻', '終了時刻', '講師ID', '講師名', '生徒1ID', '生徒1名', '生徒1区分', '生徒2ID', '生徒2名', '生徒2区分', '変更種別', '変更メモ', '更新日時', '生徒1実施状況', '生徒2実施状況'],
  '打刻': ['打刻ID', '講師ID', '講師名', '打刻種別', '打刻日時', '修正前日時', '修正理由', '更新日時'],
  '残コマ': ['生徒ID', '生徒名', '区分', '付与数', '実施数', '残数', '更新日時'],
  'コマ履歴': ['履歴ID', '生徒ID', '生徒名', '区分', '増減数', '発生日', '内容', '参照キー', '登録日時'],
  '保護者面談': ['面談ID', '生徒ID', '生徒名', '面談日', '面談相手', '面談内容', '次回対応', '登録日時'],
  '設定': ['キー', '値', '説明']
});

function getDataSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP.DATA_SPREADSHEET_ID);
  if (!id) throw new Error('初期設定が未完了です。setupApplication() を実行してください。');
  return SpreadsheetApp.openById(id);
}

function createRequiredSheets_() {
  const ss = getDataSpreadsheet_();
  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = HEADERS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#183B56').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);
  });
}

/** シートを「見出し名: 値」のオブジェクト配列として取得。 */
function readObjects_(sheetName) {
  const sheet = getDataSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift();
  return values
    .filter(row => row.some(value => value !== ''))
    .map(row => headers.reduce((obj, header, index) => {
      obj[header] = row[index];
      return obj;
    }, {}));
}

/** 見出し順に合わせて1行追加。 */
function appendObject_(sheetName, object) {
  const sheet = getDataSpreadsheet_().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  sheet.appendRow(headers.map(header => object[header] ?? ''));
}

/** 条件に合う行を削除してから複数行を追加する。 */
function replaceObjects_(sheetName, predicate, objects) {
  const sheet = getDataSpreadsheet_().getSheetByName(sheetName);
  const current = readObjects_(sheetName).filter(row => !predicate(row));
  const all = current.concat(objects);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS[sheetName].length).clearContent();
  if (all.length) {
    const rows = all.map(obj => HEADERS[sheetName].map(header => obj[header] ?? ''));
    sheet.getRange(2, 1, rows.length, HEADERS[sheetName].length).setValues(rows);
  }
}

function formatDate_(date) {
  return Utilities.formatDate(new Date(date), APP.TZ, 'yyyy-MM-dd');
}

function formatDateTime_(date) {
  return Utilities.formatDate(new Date(date), APP.TZ, 'yyyy-MM-dd HH:mm:ss');
}

function today_() {
  return formatDate_(new Date());
}
