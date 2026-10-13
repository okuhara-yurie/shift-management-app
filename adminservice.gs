/** 管理者認証と管理者ダッシュボードの処理。 */

function hash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function setAdminPassword_(password) {
  PropertiesService.getScriptProperties().setProperty(PROP.ADMIN_PASSWORD_HASH, hash_(password));
}

/** ログイン成功時だけ、一時的なセッショントークンを返す。 */
function adminLogin(password) {
  const saved = PropertiesService.getScriptProperties().getProperty(PROP.ADMIN_PASSWORD_HASH);
  if (!saved || hash_(password) !== saved) throw new Error('パスワードが違います。');
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('admin:' + token, '1', APP.ADMIN_SESSION_SECONDS);
  return { token: token, redirectUrl: getAppUrl() + '?page=admin' };
}

function verifyAdminSession(token) {
  return Boolean(token && CacheService.getScriptCache().get('admin:' + token));
}

function assertAdmin_(token) {
  if (!verifyAdminSession(token)) throw new Error('管理者セッションの有効期限が切れました。再ログインしてください。');
}

function adminLogout(token) {
  if (token) CacheService.getScriptCache().remove('admin:' + token);
  return getAppUrl() + '?page=admin-login';
}

function changeAdminPassword(currentPassword, newPassword, token) {
  assertAdmin_(token);
  const saved = PropertiesService.getScriptProperties().getProperty(PROP.ADMIN_PASSWORD_HASH);
  if (hash_(currentPassword) !== saved) throw new Error('現在のパスワードが違います。');
  if (!newPassword || newPassword.length < 8) throw new Error('新しいパスワードは8文字以上にしてください。');
  setAdminPassword_(newPassword);
  return '管理者パスワードを変更しました。';
}

/** 室長が最初に見る情報をまとめて返し、画面間の往復を減らす。 */
function getAdminDashboard(token) {
  assertAdmin_(token);
  const date = today_();
  const schedule = getScheduleForDate(date);
  const attendance = getTodayAttendanceStatus_();
  const teacherIds = [...new Set(schedule.map(s => s.teacherId))];
  const presentIds = teacherIds.filter(id => attendance[id] && attendance[id].type !== 'clock_out');
  const alerts = buildTodayAlerts_(schedule, attendance);

  return {
    date: date,
    freeeConfigured: hasFreeeApiSettings_(),
    summary: {
      lessonCount: schedule.reduce((sum, shift) => sum + shift.students.length, 0),
      scheduledTeachers: teacherIds.length,
      presentTeachers: presentIds.length,
      alertCount: alerts.length
    },
    attendance: teacherIds.map(id => {
      const shift = schedule.find(s => s.teacherId === id);
      return attendance[id] || { employeeId: id, employeeName: shift.teacherName, type: 'not_clocked_in', label: '未出勤', datetime: '' };
    }),
    alerts: alerts,
    yesterdayIssues: getYesterdayIssues_(),
    balances: getLessonBalances_()
  };
}

function buildTodayAlerts_(schedule, attendance) {
  const alerts = [];
  const nowTime = Utilities.formatDate(new Date(), APP.TZ, 'HH:mm');
  schedule.forEach(shift => {
    if (shift.startTime < nowTime && (!attendance[shift.teacherId] || attendance[shift.teacherId].type === 'clock_out')) {
      alerts.push({ level: 'danger', title: '未出勤', message: shift.startTime + '開始の' + shift.teacherName + '先生が未出勤です。' });
    }
    if (shift.students.length === 0) alerts.push({ level: 'warning', title: '生徒未配置', message: shift.startTime + 'の' + shift.teacherName + '先生に生徒が登録されていません。' });
  });
  return alerts;
}

function getYesterdayIssues_() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateText = formatDate_(yesterday);
  const records = readObjects_(APP.SHEETS.ATTENDANCE).filter(row => row['打刻日時'].startsWith(dateText));
  const latest = {};
  records.forEach(row => { latest[row['講師ID']] = row; });
  return Object.values(latest)
    .filter(row => row['打刻種別'] !== 'clock_out')
    .map(row => ({ title: '退勤打刻の未完了', message: row['講師名'] + '先生の最終打刻は「' + (APP.CLOCK_TYPES[row['打刻種別']] || row['打刻種別']) + '」です。' }));
}

function getLessonBalances_() {
  return getAllLessonBalances_().map(item => ({
    studentId: item.studentId, studentName: item.studentName, type: item.type,
    granted: item.granted, used: item.used, planned: item.planned,
    remaining: item.remaining
  // 「残っているが少ない」生徒だけを表示する。
  // 0コマ・マイナス・3コマ以上はホームの残コマ注意から除外する。
  })).filter(item => item.remaining > 0 && item.remaining <= 2);
}

/**
 * 付与履歴と日別シフトを合成し、振替・講習の付与数、予定数、実施数、残数を算出する。
 * 残コマシートの既存値も初期値として維持するため、旧版からそのまま更新できる。
 */
function getAllLessonBalances_() {
  createRequiredSheets_();
  const summaries = {};
  const ensure = (studentId, studentName, type) => {
    const key = [String(studentId || studentName), type].join('|');
    if (!summaries[key]) summaries[key] = {
      studentId: studentId, studentName: studentName, type: type,
      granted: 0, used: 0, planned: 0, remaining: 0
    };
    return summaries[key];
  };

  readObjects_(APP.SHEETS.LESSON_BALANCES).forEach(row => {
    const item = ensure(row['生徒ID'], row['生徒名'], row['区分']);
    item.granted += Number(row['付与数'] || 0);
    item.used += Number(row['実施数'] || 0);
  });
  readObjects_(APP.SHEETS.LESSON_LEDGER).forEach(row => {
    const item = ensure(row['生徒ID'], row['生徒名'], row['区分']);
    item.granted += Number(row['増減数'] || 0);
  });

  // 振替・講習として日別シフトへ登録された生徒を予定・実施済みに分ける。
  readObjects_(APP.SHEETS.SHIFT_CHANGES).forEach(row => {
    [1, 2].forEach(number => {
      const type = row['生徒' + number + '区分'];
      const studentId = row['生徒' + number + 'ID'];
      const studentName = row['生徒' + number + '名'];
      if (!studentName || (type !== '振替' && type !== '講習')) return;
      const item = ensure(studentId, studentName, type);
      if (row['生徒' + number + '実施状況'] === '実施済み') item.used++;
      else item.planned++;
    });
  });

  return Object.values(summaries).map(item => {
    item.remaining = item.granted - item.used;
    return item;
  });
}

/** 管理者画面の「講師情報」に表示する一覧。講師名はfreeeから自動取得。 */
function getTeacherInformation(token) {
  assertAdmin_(token);
  const sheetRows = readObjects_(APP.SHEETS.EMPLOYEES);
  const sheetById = {};
  sheetRows.forEach(row => { sheetById[String(row['講師ID'])] = row; });

  return getActiveEmployees_().map(teacher => {
    const local = sheetById[String(teacher.id)] || {};
    return {
      id: teacher.id,
      name: teacher.name,
      availableDays: local['担当可能曜日'] || '未登録',
      availableTime: local['勤務可能時間'] || '未登録',
      enabled: local['有効'] || 'TRUE'
    };
  });
}

/** 管理者画面の「生徒情報」に表示する一覧。残コマシートも合成する。 */
function getStudentInformation(token) {
  assertAdmin_(token);
  const balanceRows = getAllLessonBalances_();
  const balancesByStudent = {};
  balanceRows.forEach(row => {
    const key = String(row.studentId || row.studentName);
    if (!balancesByStudent[key]) balancesByStudent[key] = [];
    balancesByStudent[key].push({
      type: row.type,
      granted: row.granted,
      used: row.used,
      planned: row.planned,
      remaining: row.remaining
    });
  });

  return readObjects_(APP.SHEETS.STUDENTS)
    .filter(row => row['有効'] !== 'FALSE' && row['有効'] !== '無効')
    .map(row => ({
      id: row['生徒ID'],
      name: row['生徒名'],
      memo: row['メモ'] || '',
      balances: balancesByStudent[String(row['生徒ID'] || row['生徒名'])] || []
    }));
}

/** 講師名を押した後に表示する講師個人ページの情報。 */
function getTeacherDetail(teacherId, token) {
  assertAdmin_(token);
  teacherId = String(teacherId);
  const teacher = getTeacherInformation(token).find(item => String(item.id) === teacherId);
  if (!teacher) throw new Error('指定された講師が見つかりません。');

  const fixedShifts = readObjects_(APP.SHEETS.FIXED_SHIFTS)
    .filter(row => String(row['講師ID']) === teacherId && (row['生徒1名'] || row['生徒2名']))
    .map(row => ({
      weekday: row['曜日'], startTime: row['開始時刻'], endTime: row['終了時刻'],
      student1: row['生徒1名'], student1Type: row['生徒1区分'],
      student2: row['生徒2名'], student2Type: row['生徒2区分']
    }));
  const attendance = readObjects_(APP.SHEETS.ATTENDANCE)
    .filter(row => String(row['講師ID']) === teacherId)
    .slice(-20).reverse()
    .map(row => ({
      type: APP.CLOCK_TYPES[row['打刻種別']] || row['打刻種別'],
      datetime: row['打刻日時'], reason: row['修正理由'] || ''
    }));
  return { teacher: teacher, fixedShifts: fixedShifts, attendance: attendance };
}

/** 生徒名を押した後に表示する生徒個人ページの情報。 */
function getStudentDetail(studentId, token) {
  assertAdmin_(token);
  createRequiredSheets_(); // 旧版から更新した場合も「保護者面談」シートを補完する。
  studentId = String(studentId);
  const student = getStudentInformation(token).find(item => String(item.id) === studentId);
  if (!student) throw new Error('指定された生徒が見つかりません。');

  const fixedShifts = readObjects_(APP.SHEETS.FIXED_SHIFTS)
    .filter(row => String(row['生徒1ID']) === studentId || String(row['生徒2ID']) === studentId)
    .map(row => {
      const first = String(row['生徒1ID']) === studentId;
      return {
        weekday: row['曜日'], startTime: row['開始時刻'], endTime: row['終了時刻'],
        teacherName: row['講師名'], type: first ? row['生徒1区分'] : row['生徒2区分']
      };
    });
  const meetings = readObjects_(APP.SHEETS.GUARDIAN_MEETINGS)
    .filter(row => String(row['生徒ID']) === studentId)
    .sort((a, b) => b['面談日'].localeCompare(a['面談日']))
    .map(row => ({
      id: row['面談ID'], date: row['面談日'], partner: row['面談相手'],
      content: row['面談内容'], nextAction: row['次回対応'], createdAt: row['登録日時']
    }));
  return { student: student, fixedShifts: fixedShifts, meetings: meetings };
}

/** 生徒個人ページから保護者面談の記録を保存する。 */
function saveGuardianMeeting(form, token) {
  assertAdmin_(token);
  createRequiredSheets_();
  if (!form || !form.studentId || !form.date || !form.content) {
    throw new Error('面談日と面談内容を入力してください。');
  }
  const student = getStudentInformation(token)
    .find(item => String(item.id) === String(form.studentId));
  if (!student) throw new Error('対象の生徒が見つかりません。');

  appendObject_(APP.SHEETS.GUARDIAN_MEETINGS, {
    '面談ID': Utilities.getUuid(),
    '生徒ID': student.id,
    '生徒名': student.name,
    '面談日': form.date,
    '面談相手': form.partner || '保護者',
    '面談内容': form.content,
    '次回対応': form.nextAction || '',
    '登録日時': formatDateTime_(new Date())
  });
  return getStudentDetail(student.id, token);
}

/** 生徒個人ページから振替・講習のコマ数を付与する。 */
function addLessonCredits(form, token) {
  assertAdmin_(token);
  createRequiredSheets_();
  if (!form || !form.studentId || !['振替', '講習'].includes(form.type)) {
    throw new Error('生徒とコマ区分を確認してください。');
  }
  const count = Number(form.count);
  if (!Number.isInteger(count) || count <= 0 || count > 100) {
    throw new Error('追加コマ数は1～100の整数で入力してください。');
  }
  const student = getStudentInformation(token)
    .find(item => String(item.id) === String(form.studentId));
  if (!student) throw new Error('対象の生徒が見つかりません。');

  appendObject_(APP.SHEETS.LESSON_LEDGER, {
    '履歴ID': Utilities.getUuid(),
    '生徒ID': student.id,
    '生徒名': student.name,
    '区分': form.type,
    '増減数': count,
    '発生日': form.date || today_(),
    '内容': form.note || (form.type + 'コマの追加'),
    '参照キー': '',
    '登録日時': formatDateTime_(new Date())
  });
  return getStudentDetail(student.id, token);
}
