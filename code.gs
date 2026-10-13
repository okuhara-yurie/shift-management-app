/**
 * Webアプリの入口。
 * URLの page パラメータに応じて表示画面を切り替える。
 *   ?page=home        : 講師が使うホーム画面
 *   ?page=admin-login : 管理者ログイン画面
 *   ?page=admin       : 管理者画面（画面表示後にもセッションを検証）
 */
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'home';
  const files = {
    home: 'view_home',
    'admin-login': 'view_admin_login',
    admin: 'view_admin'
  };
  const file = files[page] || files.home;

  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 管理者ログイン成功後、同じApps Script画面内へ管理者ページを読み込む。
 * 非同期処理後の外部URL遷移を行わないため、Googleのiframe制限を受けない。
 */
function getAdminPageHtml(token) {
  assertAdmin_(token);
  return HtmlService
    .createTemplateFromFile('view_admin')
    .evaluate()
    .getContent();
}

/**
 * 初回だけ実行するセットアップ。
 * 1. このApps Scriptに紐づくスプレッドシートをデータ保存先として登録
 * 2. 必要なシートと見出しを作成
 * 3. 初期管理者パスワードを設定
 *
 * スタンドアロン型スクリプトの場合は setupWithSpreadsheetId(id) を使う。
 */
function setupApplication() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('スプレッドシートからApps Scriptを開いて実行してください。');
  return setupWithSpreadsheetId(spreadsheet.getId());
}

function setupWithSpreadsheetId(spreadsheetId) {
  PropertiesService.getScriptProperties().setProperty(PROP.DATA_SPREADSHEET_ID, spreadsheetId);
  createRequiredSheets_();

  // 初期値。公開前に必ず管理者画面から変更すること。
  if (!PropertiesService.getScriptProperties().getProperty(PROP.ADMIN_PASSWORD_HASH)) {
    setAdminPassword_('change-me-1234');
  }
  return '初期設定が完了しました。初期管理者パスワードは change-me-1234 です。必ず変更してください。';
}
