/**
 * 固定シフトと日別変更を合成し、実際に表示するシフトを作る。
 * 「通常日は自動入力、イレギュラー時だけ修正」という運用の中心。
 */

/** 指定日のシフトを返す。日別変更がある同一枠は固定シフトより優先。 */
function getScheduleForDate(dateText) {
  return composeScheduleForDate_(
    dateText,
    readObjects_(APP.SHEETS.FIXED_SHIFTS),
    readObjects_(APP.SHEETS.SHIFT_CHANGES)
  );
}

/** 読込済みデータから指定日の固定シフトと日別変更を合成する。 */
function composeScheduleForDate_(dateText, fixedRows, changeRows) {
  const date = new Date(dateText + 'T00:00:00+09:00');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];

  const fixed = fixedRows
    .filter(row => row['曜日'] === weekday)
    .map(row => normalizeShift_(row, dateText, false))
    // 固定シフトシートには全講師・全時間の空行も用意するが、
    // 生徒が入っていない枠は実際の授業として数えない。
    .filter(shift => shift.students.length > 0);
  const changes = changeRows
    .filter(row => row['日付'] === dateText)
    .map(row => normalizeShift_(row, dateText, true));

  const byKey = {};
  fixed.forEach(shift => { byKey[shiftKey_(shift)] = shift; });
  changes.forEach(shift => {
    if (shift.changeType === '休講') delete byKey[shiftKey_(shift)];
    else byKey[shiftKey_(shift)] = shift;
  });

  return Object.values(byKey).sort((a, b) =>
    a.startTime.localeCompare(b.startTime) || a.teacherName.localeCompare(b.teacherName)
  );
}

function normalizeShift_(row, dateText, changed) {
  return {
    date: dateText,
    startTime: row['開始時刻'],
    endTime: row['終了時刻'],
    teacherId: row['講師ID'],
    teacherName: row['講師名'],
    students: [
      { id: row['生徒1ID'], name: row['生徒1名'], type: row['生徒1区分'] || '通常', status: row['生徒1実施状況'] || '予定' },
      { id: row['生徒2ID'], name: row['生徒2名'], type: row['生徒2区分'] || '通常', status: row['生徒2実施状況'] || '予定' }
    ].filter(student => student.id || student.name),
    changed: changed,
    changeType: row['変更種別'] || '',
    memo: row['変更メモ'] || ''
  };
}

function shiftKey_(shift) {
  return [shift.startTime, shift.teacherId || shift.teacherName].join('|');
}

/** ホーム画面に必要な情報を1回の通信で返す。 */
function getHomeData() {
  const date = today_();
  return {
    appName: APP.NAME,
    date: date,
    schedule: getScheduleForDate(date),
    employees: getActiveEmployees_(),
    attendance: getTodayAttendanceStatus_()
  };
}

function getActiveEmployees_() {
  const sheetEmployees = readObjects_(APP.SHEETS.EMPLOYEES)
    .filter(row => row['有効'] !== 'FALSE' && row['有効'] !== '無効')
    .map(row => ({ id: row['講師ID'], name: row['講師名'] }));

  // freee APIが設定済みなら、ホーム画面を開いた時点で従業員を自動取得する。
  // これにより、事前に同期ボタンを押していなくても講師名が表示される。
  if (hasFreeeApiSettings_()) {
    try {
      return getCachedEmployeesFromFreee_();
    } catch (error) {
      // freeeのトークン期限切れなどが起きた場合も、保存済みの講師を表示する。
      console.error('freee従業員取得エラー: ' + error.message);
    }
  }

  return sheetEmployees;
}

/** 指定日の編集用データ。固定シフトも入力済みの状態で返す。 */
function getShiftEditorData(dateText, token) {
  assertAdmin_(token);
  const shifts = getScheduleForDate(dateText);
  const studentMap = {};
  const teacherMap = {};

  // freeeから取得した全講師を必ず行として表示する。
  getActiveEmployees_().forEach(teacher => {
    teacherMap[teacher.id || teacher.name] = teacher;
  });
  // 固定シフトに存在する講師がfreee側に見つからない場合も、
  // 固定シフトを消さないため編集表へ補完する。
  shifts.forEach(shift => {
    teacherMap[shift.teacherId || shift.teacherName] = {
      id: shift.teacherId, name: shift.teacherName
    };
  });

  // 生徒シートの登録者に加え、固定シフトにだけ記載されている生徒も
  // 選択肢へ加える。固定シフトの生徒名が必ず編集表に表示されるための処理。
  readObjects_(APP.SHEETS.STUDENTS)
    .filter(row => row['有効'] !== 'FALSE' && row['有効'] !== '無効')
    .forEach(row => {
      studentMap[row['生徒ID'] || row['生徒名']] = {
        id: row['生徒ID'], name: row['生徒名']
      };
    });
  shifts.forEach(shift => shift.students.forEach(student => {
    studentMap[student.id || student.name] = student;
  }));

  return {
    date: dateText,
    shifts: shifts,
    teachers: Object.values(teacherMap),
    students: Object.values(studentMap),
    lessonTypes: APP.LESSON_TYPES,
    lessonStatuses: ['予定', '実施済み'],
    periods: APP.PERIODS
  };
}

/** 月間カレンダーへ授業数と変更の有無を表示するためのデータを返す。 */
function getShiftCalendarData(year, month, token) {
  assertAdmin_(token);
  year = Number(year);
  month = Number(month);
  if (!year || month < 1 || month > 12) throw new Error('年月が正しくありません。');

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  // 月内の日数分だけシートを開き直さないよう、最初に一括取得する。
  const fixedRows = readObjects_(APP.SHEETS.FIXED_SHIFTS);
  const changeRows = readObjects_(APP.SHEETS.SHIFT_CHANGES);
  const changedDates = new Set(
    changeRows
      .map(row => row['日付'])
      .filter(date => date.indexOf(year + '-' + String(month).padStart(2, '0')) === 0)
  );
  const days = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateText = [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
    const schedule = composeScheduleForDate_(dateText, fixedRows, changeRows);
    days.push({
      day: day,
      date: dateText,
      lessonCount: schedule.reduce((sum, shift) => sum + shift.students.length, 0),
      changed: changedDates.has(dateText)
    });
  }

  return {
    year: year,
    month: month,
    firstWeekday: firstWeekday,
    daysInMonth: daysInMonth,
    days: days
  };
}

/**
 * 1日分の編集結果を日別変更として保存。
 * 固定シフト自体は上書きしないため、別の日には影響しない。
 */
function saveDailyShifts(dateText, shifts, token) {
  assertAdmin_(token);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error('日付が正しくありません。');
  validateShifts_(shifts);

  const now = formatDateTime_(new Date());
  const objects = shifts.map(shift => ({
    '日付': dateText,
    '開始時刻': shift.startTime,
    '終了時刻': shift.endTime,
    '講師ID': shift.teacherId,
    '講師名': shift.teacherName,
    '生徒1ID': shift.students?.[0]?.id || '',
    '生徒1名': shift.students?.[0]?.name || '',
    '生徒1区分': shift.students?.[0]?.type || '',
    '生徒1実施状況': shift.students?.[0]?.status || '予定',
    '生徒2ID': shift.students?.[1]?.id || '',
    '生徒2名': shift.students?.[1]?.name || '',
    '生徒2区分': shift.students?.[1]?.type || '',
    '生徒2実施状況': shift.students?.[1]?.status || '予定',
    '変更種別': shift.changeType || '変更',
    '変更メモ': shift.memo || '',
    '更新日時': now
  }));

  // 編集画面から削除された固定枠は「休講」という日別変更で打ち消す。
  // これがないと、日別変更を保存した後も元の固定枠が再表示されてしまう。
  const date = new Date(dateText + 'T00:00:00+09:00');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  const savedKeys = new Set(shifts.map(shiftKey_));
  readObjects_(APP.SHEETS.FIXED_SHIFTS)
    .filter(row => row['曜日'] === weekday)
    .map(row => normalizeShift_(row, dateText, false))
    .filter(fixedShift => !savedKeys.has(shiftKey_(fixedShift)))
    .forEach(fixedShift => objects.push({
      '日付': dateText,
      '開始時刻': fixedShift.startTime,
      '終了時刻': fixedShift.endTime,
      '講師ID': fixedShift.teacherId,
      '講師名': fixedShift.teacherName,
      '変更種別': '休講',
      '変更メモ': '日別編集で削除',
      '更新日時': now
    }));
  replaceObjects_(APP.SHEETS.SHIFT_CHANGES, row => row['日付'] === dateText, objects);
  syncAutomaticMakeupCredits_(dateText, shifts);
  return { message: dateText + ' のシフトを更新しました。', shifts: getScheduleForDate(dateText) };
}

/**
 * 固定授業から完全に外れた生徒について、未実施振替を自動で1コマ付与する。
 * 同じ日に別講師・別時間へ移動して残っている生徒は、代講・時間変更として扱い付与しない。
 * 日付単位で作り直すため、同じシフトを何度保存しても二重加算されない。
 */
function syncAutomaticMakeupCredits_(dateText, savedShifts) {
  createRequiredSheets_();
  const date = new Date(dateText + 'T00:00:00+09:00');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  const fixedStudents = {};
  readObjects_(APP.SHEETS.FIXED_SHIFTS)
    .filter(row => row['曜日'] === weekday)
    .forEach(row => [1, 2].forEach(number => {
      const id = row['生徒' + number + 'ID'];
      const name = row['生徒' + number + '名'];
      if (id || name) fixedStudents[String(id || name)] = { id: id, name: name };
    }));
  const savedStudentKeys = new Set();
  savedShifts.forEach(shift => (shift.students || []).forEach(student => {
    if (student.id || student.name) savedStudentKeys.add(String(student.id || student.name));
  }));

  const referencePrefix = 'AUTO_MAKEUP|' + dateText + '|';
  const ledger = readObjects_(APP.SHEETS.LESSON_LEDGER);
  const retained = ledger.filter(row => !String(row['参照キー'] || '').startsWith(referencePrefix));
  Object.keys(fixedStudents).forEach(key => {
    if (savedStudentKeys.has(key)) return;
    const student = fixedStudents[key];
    retained.push({
      '履歴ID': Utilities.getUuid(),
      '生徒ID': student.id,
      '生徒名': student.name,
      '区分': '振替',
      '増減数': 1,
      '発生日': dateText,
      '内容': '固定授業の日別削除による自動付与',
      '参照キー': referencePrefix + key,
      '登録日時': formatDateTime_(new Date())
    });
  });
  replaceObjects_(APP.SHEETS.LESSON_LEDGER, () => true, retained);
}

/** 保存前に、室長が見落としやすい重複・3人配置を止める。 */
function validateShifts_(shifts) {
  const teacherKeys = new Set();
  const studentKeys = new Set();
  shifts.forEach((shift, index) => {
    if (!shift.startTime || !shift.endTime || !shift.teacherName) {
      throw new Error((index + 1) + '行目の時間または講師が未入力です。');
    }
    if ((shift.students || []).filter(s => s.name).length > 2) {
      throw new Error(shift.teacherName + '先生に生徒が3人以上登録されています。');
    }
    const teacherKey = shift.startTime + '|' + (shift.teacherId || shift.teacherName);
    if (teacherKeys.has(teacherKey)) throw new Error(shift.startTime + ' の ' + shift.teacherName + '先生が重複しています。');
    teacherKeys.add(teacherKey);

    (shift.students || []).filter(s => s.name).forEach(student => {
      const studentKey = shift.startTime + '|' + (student.id || student.name);
      if (studentKeys.has(studentKey)) throw new Error(shift.startTime + ' の ' + student.name + 'さんが重複しています。');
      studentKeys.add(studentKey);
      if (!APP.LESSON_TYPES.includes(student.type)) throw new Error('授業区分が正しくありません。');
      if (student.status && !['予定', '実施済み'].includes(student.status)) {
        throw new Error('実施状況が正しくありません。');
      }
    });
  });
}
