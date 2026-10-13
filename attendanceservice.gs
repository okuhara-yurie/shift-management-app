/**
 * 講師の打刻処理。
 * ログインや暗証番号は求めず、ホーム画面で講師を選択して即時打刻する。
 */

function recordAttendance(employeeId, clockType) {
  const employee = getActiveEmployees_().find(item => item.id === String(employeeId));
  if (!employee) throw new Error('講師を選択してください。');
  if (!APP.CLOCK_TYPES[clockType]) throw new Error('打刻種別が正しくありません。');

  const now = new Date();
  appendObject_(APP.SHEETS.ATTENDANCE, {
    '打刻ID': Utilities.getUuid(),
    '講師ID': employee.id,
    '講師名': employee.name,
    '打刻種別': clockType,
    '打刻日時': formatDateTime_(now),
    '更新日時': formatDateTime_(now)
  });
  return {
    message: employee.name + '先生の「' + APP.CLOCK_TYPES[clockType] + '」を記録しました。',
    status: getTodayAttendanceStatus_()
  };
}

/** 本日の各講師の最新状態を返す。 */
function getTodayAttendanceStatus_() {
  const prefix = today_();
  const latest = {};
  readObjects_(APP.SHEETS.ATTENDANCE)
    .filter(row => row['打刻日時'].startsWith(prefix))
    .sort((a, b) => a['打刻日時'].localeCompare(b['打刻日時']))
    .forEach(row => {
      latest[row['講師ID']] = {
        employeeId: row['講師ID'],
        employeeName: row['講師名'],
        type: row['打刻種別'],
        label: APP.CLOCK_TYPES[row['打刻種別']] || row['打刻種別'],
        datetime: row['打刻日時']
      };
    });
  return latest;
}

/** 管理者による打刻時刻の修正。履歴追跡のため修正前日時も残す。 */
function correctAttendance(clockId, correctedDateTime, reason, token) {
  assertAdmin_(token);
  if (!reason) throw new Error('修正理由を入力してください。');
  const sheet = getDataSpreadsheet_().getSheetByName(APP.SHEETS.ATTENDANCE);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const idCol = headers.indexOf('打刻ID');
  const dateCol = headers.indexOf('打刻日時');
  const beforeCol = headers.indexOf('修正前日時');
  const reasonCol = headers.indexOf('修正理由');
  const updatedCol = headers.indexOf('更新日時');
  for (let row = 1; row < values.length; row++) {
    if (values[row][idCol] === clockId) {
      sheet.getRange(row + 1, beforeCol + 1).setValue(values[row][dateCol]);
      sheet.getRange(row + 1, dateCol + 1).setValue(correctedDateTime);
      sheet.getRange(row + 1, reasonCol + 1).setValue(reason);
      sheet.getRange(row + 1, updatedCol + 1).setValue(formatDateTime_(new Date()));
      return '打刻を修正しました。';
    }
  }
  throw new Error('対象の打刻が見つかりません。');
}
