/**
 * freee人事労務APIとの通信を担当するファイル。
 *
 * 重要：アクセストークンや事業所IDは、このファイルへ直接書かない。
 * Apps Scriptの「プロジェクトの設定 → スクリプト プロパティ」に、
 * FREEE_ACCESS_TOKEN と FREEE_COMPANY_ID を登録して使用する。
 */

/**
 * freee APIへ送る共通オプションを作る。
 * AuthorizationヘッダーへBearerトークンを設定する。
 */
function getFreeeRequestOptions_(method, payload) {
  const token = PropertiesService.getScriptProperties().getProperty(PROP.FREEE_ACCESS_TOKEN);
  if (!token) {
    throw new Error('FREEE_ACCESS_TOKENが設定されていません。');
  }

  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: {
      accept: 'application/json',
      Authorization: 'Bearer ' + token
    }
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  return options;
}

/**
 * freeeから従業員一覧を取得する。
 * 戻り値は画面側で使いやすい {id, name} の配列に統一する。
 */
function getEmployeesFromFreee_() {
  const companyId = PropertiesService.getScriptProperties().getProperty(PROP.FREEE_COMPANY_ID);
  if (!companyId) {
    throw new Error('FREEE_COMPANY_IDが設定されていません。');
  }

  const url = 'https://api.freee.co.jp/hr/api/v1/companies/'
    + encodeURIComponent(companyId)
    + '/employees?limit=100&with_no_payroll_calculation=true';
  const response = UrlFetchApp.fetch(url, getFreeeRequestOptions_('get'));
  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText() || '{}');

  if (status !== 200) {
    const message = body.message || ('freee APIでエラーが発生しました。HTTP ' + status);
    throw new Error(message);
  }

  // APIの返却が配列の場合と employees 配下の場合の両方を扱う。
  const employees = Array.isArray(body) ? body : (body.employees || []);
  return employees.map(employee => ({
    id: String(employee.id),
    name: employee.display_name || employee.name || ''
  })).filter(employee => employee.id && employee.name);
}

/**
 * ホーム画面・シフト編集画面で使用するfreee従業員一覧。
 * 画面を開くたびにAPIを呼ばないよう、取得結果を10分間保存する。
 */
function getCachedEmployeesFromFreee_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'freee-employees';
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const employees = getEmployeesFromFreee_();
  cache.put(cacheKey, JSON.stringify(employees), 60 * 10);
  return employees;
}

/**
 * freeeから取得した従業員を、このアプリの「講師」シートへ同期する。
 * 担当可能曜日・勤務可能時間は塾独自情報なので、既存値を残す。
 */
function syncEmployeesFromFreee(token) {
  // 管理者画面からの操作に限定する。
  assertAdmin_(token);
  const freeeEmployees = getEmployeesFromFreee_();
  const current = readObjects_(APP.SHEETS.EMPLOYEES);
  const currentById = {};
  current.forEach(row => { currentById[String(row['講師ID'])] = row; });

  const synchronized = freeeEmployees.map(employee => {
    const saved = currentById[employee.id] || {};
    return {
      '講師ID': employee.id,
      '講師名': employee.name,
      '担当可能曜日': saved['担当可能曜日'] || '',
      '勤務可能時間': saved['勤務可能時間'] || '',
      '有効': saved['有効'] || 'TRUE'
    };
  });

  // freeeに存在する従業員を講師シートへ反映する。
  replaceObjects_(APP.SHEETS.EMPLOYEES, () => true, synchronized);

  // 次のホーム表示から最新データを取得できるようキャッシュを削除する。
  CacheService.getScriptCache().remove('freee-employees');
  return freeeEmployees.length + '名の従業員情報をfreeeから同期しました。';
}

/**
 * freee API設定があるかを確認する。
 * トークンそのものは画面へ返さない。
 */
function hasFreeeApiSettings_() {
  const properties = PropertiesService.getScriptProperties();
  return Boolean(
    properties.getProperty(PROP.FREEE_ACCESS_TOKEN)
    && properties.getProperty(PROP.FREEE_COMPANY_ID)
  );
}
