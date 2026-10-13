/**
 * 課題発表・動作確認用の初期データを作成するファイル。
 * Apps Scriptの関数一覧から createSampleSpreadsheetData を1回実行する。
 * 生徒情報と手入力した固定シフトは残す。
 * サンプル生徒（S001～S032）の固定授業だけは、再実行時に週1コマへ整え直す。
 */

/** サンプルとして登録する生徒。名前は必要に応じてシート上で変更できる。 */
const SAMPLE_STUDENTS = [
  { id: 'S001', name: '佐藤' },
  { id: 'S002', name: '渡辺' },
  { id: 'S003', name: '鈴木' },
  { id: 'S004', name: '高橋' },
  { id: 'S005', name: '田中' },
  { id: 'S006', name: '伊藤' },
  { id: 'S007', name: '山田' },
  { id: 'S008', name: '中村' },
  { id: 'S009', name: '小林' },
  { id: 'S010', name: '加藤' },
  { id: 'S011', name: '吉田' },
  { id: 'S012', name: '山本' },
  { id: 'S013', name: '松本' },
  { id: 'S014', name: '井上' },
  { id: 'S015', name: '木村' },
  { id: 'S016', name: '林' },
  { id: 'S017', name: '斎藤' },
  { id: 'S018', name: '清水' },
  { id: 'S019', name: '山崎' },
  { id: 'S020', name: '森' },
  { id: 'S021', name: '池田' },
  { id: 'S022', name: '橋本' },
  { id: 'S023', name: '石川' },
  { id: 'S024', name: '前田' },
  { id: 'S025', name: '藤田' },
  { id: 'S026', name: '岡田' },
  { id: 'S027', name: '後藤' },
  { id: 'S028', name: '長谷川' },
  { id: 'S029', name: '村上' },
  { id: 'S030', name: '近藤' },
  { id: 'S031', name: '石井' },
  { id: 'S032', name: '坂本' }
];

/**
 * 「講師」「生徒」「固定シフト」「残コマ」に初期データを作成する。
 *
 * 固定シフトは、freeeの全講師について
 * 7曜日 × 5授業時間の行を必ず作成する。
 * 授業が登録されていない枠は、生徒欄を空欄のまま残す。
 */
function createSampleSpreadsheetData() {
  createRequiredSheets_();

  const teachers = getCachedEmployeesFromFreee_();
  if (!teachers.length) {
    throw new Error('freeeから講師を取得できませんでした。API設定を確認してください。');
  }

  saveTeachersForSample_(teachers);
  saveSampleStudents_();
  const result = createFixedShiftTemplate_(teachers);
  createSampleBalances_();

  return [
    'サンプルデータを作成しました。',
    '講師：' + teachers.length + '名',
    '固定シフト新規行：' + result.created + '件',
    '既存行：' + result.preserved + '件',
    '週1コマで配置したサンプル生徒：' + result.assignedStudents + '名'
  ].join('\n');
}

/** freeeの講師を「講師」シートへ保存し、塾独自項目の既存値は残す。 */
function saveTeachersForSample_(teachers) {
  const current = readObjects_(APP.SHEETS.EMPLOYEES);
  const byId = {};
  current.forEach(row => { byId[String(row['講師ID'])] = row; });
  const rows = teachers.map(teacher => {
    const saved = byId[String(teacher.id)] || {};
    return {
      '講師ID': teacher.id,
      '講師名': teacher.name,
      '担当可能曜日': saved['担当可能曜日'] || '',
      '勤務可能時間': saved['勤務可能時間'] || '',
      '有効': saved['有効'] || 'TRUE'
    };
  });
  replaceObjects_(APP.SHEETS.EMPLOYEES, () => true, rows);
}

/** 生徒シートへ、まだ存在しないサンプル生徒だけを追加する。 */
function saveSampleStudents_() {
  const current = readObjects_(APP.SHEETS.STUDENTS);
  const existingIds = new Set(current.map(row => String(row['生徒ID'])));
  SAMPLE_STUDENTS.forEach(student => {
    if (existingIds.has(student.id)) return;
    appendObject_(APP.SHEETS.STUDENTS, {
      '生徒ID': student.id,
      '生徒名': student.name,
      'メモ': 'サンプル生徒',
      '有効': 'TRUE'
    });
  });
}

/**
 * 全講師・全曜日・全時間の固定シフト入力欄を作る。
 *
 * 実在生徒など、サンプルID以外の固定授業は保持する。
 * S001～S032のサンプル生徒はいったん既存枠から外し、
 * 1人につき週1コマだけ「通常授業」として空いている枠へ再配置する。
 */
function createFixedShiftTemplate_(teachers) {
  const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
  const current = readObjects_(APP.SHEETS.FIXED_SHIFTS);
  const currentByKey = {};
  current.forEach(row => {
    currentByKey[fixedTemplateKey_(row['曜日'], row['開始時刻'], row['講師ID'])] = row;
  });

  const rows = [];
  let created = 0;
  let preserved = 0;
  let assignedStudents = 0;

  weekdays.forEach((weekday, weekdayIndex) => {
    APP.PERIODS.forEach((period, periodIndex) => {
      teachers.forEach((teacher, teacherIndex) => {
        const key = fixedTemplateKey_(weekday, period.startTime, teacher.id);
        if (currentByKey[key]) {
          // 以前の生成処理で重複配置されたサンプル生徒だけを取り除く。
          // サンプル以外の生徒はそのまま残す。
          const existingRow = removeSampleStudentsFromRow_(currentByKey[key]);
          rows.push(existingRow);
          preserved++;
          return;
        }

        const row = {
          '曜日': weekday,
          '開始時刻': period.startTime,
          '終了時刻': period.endTime,
          '講師ID': teacher.id,
          '講師名': teacher.name,
          '生徒1ID': '', '生徒1名': '', '生徒1区分': '',
          '生徒2ID': '', '生徒2名': '', '生徒2区分': ''
        };

        rows.push(row);
        created++;
      });
    });
  });

  // 各生徒を1度だけ配置するため、同じ生徒が週に複数回登場しない。
  assignedStudents = assignStudentsOncePerWeek_(rows, teachers);

  replaceObjects_(APP.SHEETS.FIXED_SHIFTS, () => true, rows);
  return { created: created, preserved: preserved, assignedStudents: assignedStudents };
}

/** 既存の固定シフト行で、生徒が1人も入力されていないか確認する。 */
function isEmptyFixedShift_(row) {
  return !row['生徒1ID'] && !row['生徒1名']
    && !row['生徒2ID'] && !row['生徒2名'];
}

/** 1行からサンプル生徒だけを外し、残った実在生徒を生徒1側へ詰める。 */
function removeSampleStudentsFromRow_(row) {
  const sampleIds = new Set(SAMPLE_STUDENTS.map(student => student.id));
  const remaining = [1, 2].map(number => ({
    id: row['生徒' + number + 'ID'],
    name: row['生徒' + number + '名'],
    type: row['生徒' + number + '区分']
  })).filter(student => (student.id || student.name) && !sampleIds.has(String(student.id)));

  [1, 2].forEach((number, index) => {
    const student = remaining[index] || {};
    row['生徒' + number + 'ID'] = student.id || '';
    row['生徒' + number + '名'] = student.name || '';
    row['生徒' + number + '区分'] = student.type || '';
  });
  return row;
}

/**
 * サンプル生徒を月～土の空き枠へ1人1回だけ配置する。
 * 個別指導塾の通常運用に合わせ、原則として1つの講師枠へ生徒2人を組にして配置する。
 * 固定授業の区分はすべて「通常」にする。
 */
function assignStudentsOncePerWeek_(rows, teachers) {
  const teacherOrder = {};
  teachers.forEach((teacher, index) => { teacherOrder[String(teacher.id)] = index; });
  const weekdayOrder = { '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5 };
  const periodOrder = {};
  APP.PERIODS.forEach((period, index) => { periodOrder[period.startTime] = index; });

  // 2人とも空いている枠を優先することで、講師1人対生徒2人の授業を作る。
  const emptyRows = rows.filter(row =>
    Object.prototype.hasOwnProperty.call(weekdayOrder, row['曜日'])
    && isEmptyFixedShift_(row)
  );
  const usedRows = new Set();
  let assigned = 0;

  for (let studentIndex = 0; studentIndex < SAMPLE_STUDENTS.length; studentIndex += 2) {
    const lessonNumber = studentIndex / 2;
    const preferredDay = lessonNumber % 6;
    const preferredTeacher = lessonNumber % teachers.length;
    const preferredPeriod = Math.floor(lessonNumber / 6) % APP.PERIODS.length;

    // 希望する曜日・講師・時間に最も近い未使用枠を選び、曜日などの偏りを防ぐ。
    const candidates = emptyRows
      .filter(row => !usedRows.has(row))
      .sort((a, b) => sampleSlotDistance_(a, preferredDay, preferredTeacher, preferredPeriod,
        weekdayOrder, teacherOrder, periodOrder, teachers.length)
        - sampleSlotDistance_(b, preferredDay, preferredTeacher, preferredPeriod,
          weekdayOrder, teacherOrder, periodOrder, teachers.length));
    const row = candidates[0];
    if (!row) break;

    const pair = SAMPLE_STUDENTS.slice(studentIndex, studentIndex + 2);
    pair.forEach((student, pairIndex) => {
      const number = pairIndex + 1;
      row['生徒' + number + 'ID'] = student.id;
      row['生徒' + number + '名'] = student.name;
      row['生徒' + number + '区分'] = '通常';
      assigned++;
    });
    usedRows.add(row);
  }

  if (assigned < SAMPLE_STUDENTS.length) {
    throw new Error('固定シフトの空き枠が不足し、全サンプル生徒を週1コマで配置できませんでした。');
  }
  return assigned;
}

/** 希望位置に近い固定シフト枠ほど小さくなる並び替え用の値。 */
function sampleSlotDistance_(row, day, teacher, period,
    weekdayOrder, teacherOrder, periodOrder, teacherCount) {
  const rowDay = weekdayOrder[row['曜日']];
  const rowTeacher = teacherOrder[String(row['講師ID'])] || 0;
  const rowPeriod = periodOrder[row['開始時刻']] || 0;
  return Math.abs(rowDay - day) * 100
    + Math.abs(rowPeriod - period) * 10
    + Math.min(Math.abs(rowTeacher - teacher), teacherCount);
}

function fixedTemplateKey_(weekday, startTime, teacherId) {
  return [weekday, startTime, String(teacherId)].join('|');
}

/** 振替・講習の残数表示を確認できるサンプル値を追加する。 */
function createSampleBalances_() {
  const current = readObjects_(APP.SHEETS.LESSON_BALANCES);
  const existing = new Set(current.map(row => [row['生徒ID'], row['区分']].join('|')));
  SAMPLE_STUDENTS.slice(0, 12).forEach((student, index) => {
    ['振替', '講習'].forEach((type, typeIndex) => {
      const key = [student.id, type].join('|');
      if (existing.has(key)) return;
      const granted = type === '振替' ? 2 : 8;
      const used = Math.min(granted, index + typeIndex);
      appendObject_(APP.SHEETS.LESSON_BALANCES, {
        '生徒ID': student.id,
        '生徒名': student.name,
        '区分': type,
        '付与数': granted,
        '実施数': used,
        '残数': granted - used,
        '更新日時': formatDateTime_(new Date())
      });
    });
  });
}
