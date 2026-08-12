/*************************************************************
 * 工場点検アプリ  スプレッドシート連携（Google Apps Script）
 *
 * 【使い方】
 *  1. Googleスプレッドシートを新規作成
 *  2. 拡張機能 → Apps Script を開き、このコードを貼り付けて保存
 *  3. 上部の関数選択で「初期設定」を選び ▶ 実行（初回は権限を承認）
 *  4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *       次のユーザーとして実行：自分
 *       アクセスできるユーザー：全員
 *     → 発行された /exec のURLをアプリの「設定」タブに貼り付け
 *************************************************************/

var SH_REC = '点検記録';
var SH_DET = '点検明細';
var SH_DASH = '進捗ダッシュボード';
var SH_TARGET = '点検対象マスタ';
var PHOTO_FOLDER = '工場点検_写真';

var REC_HEAD = ['ID', '点検日', '年月', '点検場所', '点検機械', '号機', '点検者',
  '総合判定', '不良件数', '要注意件数', '未判定件数', '備考', '登録日時', '更新日時'];
var DET_HEAD = ['ID', '点検日', '年月', '点検場所', '点検機械', '号機', '点検者',
  '項目No', '点検項目', '判定', '測定値', '単位', '所見', '写真URL', '更新日時',
  '対応状況', '対応日', '対応者', '対応内容', '対応写真', '当初判定'];
var TARGET_HEAD = ['場所ID', '点検場所', '機械ID', '点検機械', '対象', '更新日時'];

var JUDGE_LABEL = { OK: '良', CAUTION: '要注意', NG: '不良', NA: '対象外', '': '未判定' };

/* ============ 初期設定（手動で1回実行） ============ */
function 初期設定() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rec = getSheet_(ss, SH_REC, REC_HEAD);
  var det = getSheet_(ss, SH_DET, DET_HEAD);
  var target = getSheet_(ss, SH_TARGET, TARGET_HEAD);
  safe_(function () { rec.setFrozenRows(1); });
  safe_(function () { det.setFrozenRows(1); });
  safe_(function () { target.setFrozenRows(1); });

  // ※ データシートへの表示形式（setNumberFormat）の設定は行いません。
  //    シートが「テーブル」になっていると列の型が固定されており、
  //    「型付きの列でセルの数値形式を設定することはできません」というエラーになるためです。
  //    集計は点検日（B列）の期間で行うので、表示形式は結果に影響しません。

  // 判定の色分け
  safe_(function () { setRecColors_(rec); });
  safe_(function () { setDetColors_(det); });

  // ダッシュボード（数式で自動集計）
  buildDashboard_(ss);

  // 既存データを最新の形式に揃え直す
  修復_日付と年月();
  safe_(修復_対応状況);
  refreshDashboard_(ss);

  return 'セットアップ完了';
}

/* ============ 判定の色分け ============
   良＝緑 / 要注意＝黄 / 不良＝赤。判定セルは濃い色、行全体は薄い色で塗り分けます。 */
var C_NG = { bg: '#d93025', fg: '#ffffff', row: '#fce8e6' };   // 不良
var C_CA = { bg: '#f9ab00', fg: '#3c2a00', row: '#fff3d6' };   // 要注意
var C_OK = { bg: '#0f9d58', fg: '#ffffff', row: '#e8f5ea' };   // 良
var C_NA = { bg: '#e0e4e8', fg: '#5f6b76', row: '#ffffff' };   // 対象外・未判定

/* 点検記録シート：総合判定(H)を濃く塗り、行全体を薄く色づけする */
function setRecColors_(sh) {
  var judge = sh.getRange('H2:H10000');       // 総合判定
  var row = sh.getRange('A2:N10000');         // 行全体
  var ngCount = sh.getRange('I2:I10000');     // 不良件数
  var caCount = sh.getRange('J2:J10000');     // 要注意件数
  sh.setConditionalFormatRules([
    // 判定セル（濃い色＋白抜き文字）
    rule_(judge, '不良', C_NG, true),
    rule_(judge, '要注意', C_CA, true),
    rule_(judge, '良', C_OK, true),
    rule_(judge, '対象外', C_NA, false),
    // 行全体（薄い色）… H列の値で判定する
    rowRule_(row, '=$H2="不良"', C_NG.row),
    rowRule_(row, '=$H2="要注意"', C_CA.row),
    rowRule_(row, '=$H2="良"', C_OK.row),
    // 不良・要注意の件数が1件以上あるセルを強調
    numRule_(ngCount, C_NG),
    numRule_(caCount, C_CA)
  ]);
}

/* 点検明細シート：判定(J)と対応状況(P)を色分けし、行全体も薄く色づけする */
function setDetColors_(sh) {
  var judge = sh.getRange('J2:J10000');       // 判定
  var row = sh.getRange('A2:U10000');         // 行全体
  var state = sh.getRange('P2:P10000');       // 対応状況
  sh.setConditionalFormatRules([
    rule_(judge, '不良', C_NG, true),
    rule_(judge, '要注意', C_CA, true),
    rule_(judge, '良', C_OK, true),
    rule_(judge, '対象外', C_NA, false),
    rule_(state, '未対応', C_NG, true),
    rule_(state, '完了', C_OK, true),
    // 未対応の行だけ薄く色づけ（対応が終わった行は白に戻る）
    rowRule_(row, '=AND($P2="未対応",$J2="不良")', C_NG.row),
    rowRule_(row, '=AND($P2="未対応",$J2="要注意")', C_CA.row)
  ]);
}

function rule_(range, text, c, bold) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text)
    .setBackground(c.bg).setFontColor(c.fg).setBold(!!bold)
    .setRanges([range]).build();
}
function rowRule_(range, formula, bg) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula).setBackground(bg).setRanges([range]).build();
}
function numRule_(range, c) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground(c.bg).setFontColor(c.fg).setBold(true)
    .setRanges([range]).build();
}

/* 見た目の設定など、失敗しても処理を続けてよいものを包む。
   Apps Script はシートへの変更を溜めてから適用するため、
   ここで flush() して「その場で」適用し、エラーを確実に捕まえる。 */
function safe_(fn) {
  try {
    fn();
    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('スキップしました: ' + e);
  }
}

/* ============ ダッシュボードの作成 ============ */
function buildDashboard_(ss) {
  var dash = ss.getSheetByName(SH_DASH) || ss.insertSheet(SH_DASH);
  dash.clear();
  dash.getRange('A1').setValue('工場点検 進捗ダッシュボード').setFontSize(16).setFontWeight('bold');
  dash.getRange('A2').setValue('対象年月');

  // B2 を書式なしテキストにしてから入力する（"2026-08" が日付に変換されるのを防ぐ）。
  // 万一この書式設定ができない場合でも、集計式側で日付・文字列どちらでも読めるようにしてある。
  safe_(function () { dash.getRange('B2').setNumberFormat('@'); });
  dash.getRange('B2')
    .setValue(Utilities.formatDate(new Date(), 'JST', 'yyyy-MM'))
    .setBackground('#fff9d6').setFontWeight('bold')
    .setNote('集計したい年月を yyyy-MM 形式（例 2026-08）で入力してください。\n空欄にすると全期間を集計します。');
  dash.getRange('C2').setFormula('=IF($B$2="","（空欄のため全期間を集計中）","集計対象："&' + YM_ + '&"　※空欄にすると全期間")')
    .setFontColor('#6b7b8c');
  safe_(function () { dash.setHiddenGridlines(true); });
  refreshDashboard_(ss);
}

/* B2の年月が変更されたら、その場で進捗を再集計する */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() === SH_DASH && e.range.getA1Notation() === 'B2') {
      refreshDashboard_(e.source || SpreadsheetApp.getActiveSpreadsheet());
    }
  } catch (err) {
    Logger.log('ダッシュボード再集計エラー: ' + err);
  }
}

/* ============ 工場別・機械別の進捗集計 ============ */
function refreshDashboard_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName(SH_DASH);
  if (!dash) return;

  // B2より下の表示部分だけを作り直す。入力セルB2は保持する。
  safe_(function () { dash.getRange('A4:AE500').clearContent().clearFormat(); });

  var targetSh = getSheet_(ss, SH_TARGET, TARGET_HEAD);
  var recSh = getSheet_(ss, SH_REC, REC_HEAD);
  var targetRows = targetSh.getLastRow() > 1
    ? targetSh.getRange(2, 1, targetSh.getLastRow() - 1, TARGET_HEAD.length).getValues() : [];
  targetRows = targetRows.filter(function (r) {
    return r[1] && r[3] && (r[4] === true || String(r[4]).toUpperCase() === 'TRUE' || r[4] === 1);
  });

  var recRows = recSh.getLastRow() > 1
    ? recSh.getRange(2, 1, recSh.getLastRow() - 1, REC_HEAD.length).getValues() : [];
  var b2 = dash.getRange('B2').getValue();
  var ym = b2 === '' ? '' : ymOf_(b2);
  recRows = recRows.filter(function (r) { return !ym || ymOf_(r[1]) === ym; });

  // マスタ未同期の場合でも記録済みデータから最低限の表を作る。
  var inferred = false;
  if (!targetRows.length && recRows.length) {
    inferred = true;
    var seenFallback = {};
    recRows.forEach(function (r) {
      var k = String(r[3]) + '\u0001' + String(r[4]);
      if (!seenFallback[k]) {
        seenFallback[k] = true;
        targetRows.push(['', r[3], '', r[4], true, '']);
      }
    });
  }

  var target = {}, done = {}, sites = [], machines = [], seenSite = {}, seenMachine = {};
  targetRows.forEach(function (r) {
    var site = String(r[1]), machine = String(r[3]);
    var key = site + '\u0001' + machine;
    target[key] = true;
    if (!seenSite[site]) { seenSite[site] = true; sites.push(site); }
    if (!seenMachine[machine]) { seenMachine[machine] = true; machines.push(machine); }
  });
  recRows.forEach(function (r) {
    var site = String(r[3] || ''), machine = String(r[4] || '');
    if (site && machine) done[site + '\u0001' + machine] = true;
  });

  var targetTotal = Object.keys(target).length;
  var doneTotal = Object.keys(target).filter(function (k) { return done[k]; }).length;
  var pendingTotal = Math.max(0, targetTotal - doneTotal);
  var totalRate = targetTotal ? doneTotal / targetTotal : 0;

  // KPIカード
  var kpis = [
    ['対象項目', targetTotal], ['実施項目', doneTotal],
    ['未実施項目', pendingTotal], ['全体進捗率', totalRate]
  ];
  var kpiCols = [1, 3, 5, 7];
  kpis.forEach(function (k, i) {
    dash.getRange(4, kpiCols[i]).setValue(k[0]).setFontWeight('bold').setFontColor('#5f6b76');
    dash.getRange(5, kpiCols[i]).setValue(k[1]).setFontSize(18).setFontWeight('bold')
      .setBackground(i === 2 && pendingTotal ? '#fce8e6' : '#e8f5ea');
  });
  dash.getRange('G5').setNumberFormat('0%');
  dash.getRange('A6').setValue(inferred
    ? '※ 点検対象マスタが未同期です。現在は記録済みデータだけを対象として仮集計しています。アプリの「今すぐ同期」を実行してください。'
    : '※ 月内に同じ工場・機械を複数回点検しても、進捗では1項目として集計します。')
    .setFontColor(inferred ? '#b3261e' : '#6b7b8c');

  // 工場別進捗
  var siteStats = sites.map(function (site) {
    var keys = Object.keys(target).filter(function (k) { return k.indexOf(site + '\u0001') === 0; });
    var d = keys.filter(function (k) { return done[k]; }).length;
    return [site, keys.length, d, keys.length - d, keys.length ? d / keys.length : 0];
  });
  writeProgressTable_(dash, 8, 1, '■ 工場別 点検進捗',
    ['点検場所', '対象項目', '実施項目', '未実施', '進捗率'], siteStats);

  // 機械別進捗（各工場で対象になっている機械を1項目として数える）
  var machineStats = machines.map(function (machine) {
    var keys = Object.keys(target).filter(function (k) { return k.slice(k.indexOf('\u0001') + 1) === machine; });
    var d = keys.filter(function (k) { return done[k]; }).length;
    return [machine, keys.length, d, keys.length - d, keys.length ? d / keys.length : 0];
  }).sort(function (a, b) { return a[4] - b[4] || String(a[0]).localeCompare(String(b[0]), 'ja'); });
  writeProgressTable_(dash, 8, 7, '■ 機械別 点検進捗',
    ['点検機械', '対象工場', '実施工場', '未実施', '進捗率'], machineStats);

  // 工場×機械マトリクス
  var matrixRow = Math.max(16, 11 + machineStats.length);
  dash.getRange(matrixRow, 1).setValue('■ 工場 × 機械 点検進捗（済＝実施、未＝未実施、－＝対象外）')
    .setFontWeight('bold').setFontColor('#0f4c81');
  var matrix = [['点検機械'].concat(sites)];
  machines.forEach(function (machine) {
    var row = [machine];
    sites.forEach(function (site) {
      var key = site + '\u0001' + machine;
      row.push(!target[key] ? '－' : (done[key] ? '済' : '未'));
    });
    matrix.push(row);
  });
  if (matrix.length > 1) {
    var mr = dash.getRange(matrixRow + 1, 1, matrix.length, matrix[0].length);
    mr.setValues(matrix);
    dash.getRange(matrixRow + 1, 1, 1, matrix[0].length)
      .setBackground('#0f4c81').setFontColor('#ffffff').setFontWeight('bold');
    dash.getRange(matrixRow + 2, 2, matrix.length - 1, sites.length).setHorizontalAlignment('center');
    for (var rr = 0; rr < machines.length; rr++) {
      for (var cc = 0; cc < sites.length; cc++) {
        var cell = dash.getRange(matrixRow + 2 + rr, 2 + cc);
        var value = matrix[rr + 1][cc + 1];
        if (value === '済') cell.setBackground('#0f9d58').setFontColor('#ffffff').setFontWeight('bold');
        else if (value === '未') cell.setBackground('#fce8e6').setFontColor('#d93025').setFontWeight('bold');
        else cell.setBackground('#f1f3f4').setFontColor('#9aa0a6');
      }
    }
  }

  // 要対応・対応完了は従来どおり右側に表示する。
  dash.getRange('M7').setValue('■ 要対応（未対応の不良・要注意）').setFontWeight('bold');
  dash.getRange('M8').setFormula(
    '=IFERROR(QUERY(' + SH_DET + '!A:U,"select B, D, E, F, I, J, M, N ' +
    'where (J = \'不良\' or J = \'要注意\') and (P is null or P = \'未対応\') "' +
    andYm_() +
    '"order by B desc label B \'点検日\', D \'場所\', E \'機械\', F \'号機\', I \'項目\', J \'判定\', M \'所見\', N \'写真\' format B \'yyyy-mm-dd\'",1),"要対応なし")');
  dash.getRange('V7').setValue('■ 対応完了した項目').setFontWeight('bold');
  dash.getRange('V8').setFormula(
    '=IFERROR(QUERY(' + SH_DET + '!A:U,"select B, D, E, I, U, Q, R, S, T where P = \'完了\' "' +
    andYm_() +
    '"order by Q desc label B \'点検日\', D \'場所\', E \'機械\', I \'項目\', U \'当初判定\', ' +
    'Q \'対応日\', R \'対応者\', S \'対応内容\', T \'対応写真\' format B \'yyyy-mm-dd\', Q \'yyyy-mm-dd\'",1),"完了分なし")');

  safe_(function () {
    dash.getRange('M8:M').setNumberFormat('yyyy-mm-dd');
    dash.getRange('V8:V').setNumberFormat('yyyy-mm-dd');
    dash.getRange('AA8:AA').setNumberFormat('yyyy-mm-dd');
    dash.setFrozenRows(2);
    dash.setColumnWidth(1, 190);
    dash.setColumnWidth(7, 190);
    for (var c = 2; c <= Math.max(6, sites.length + 1); c++) dash.setColumnWidth(c, 90);
    dash.autoResizeColumns(13, 19);
  });
}

function writeProgressTable_(sheet, row, col, title, headers, rows) {
  sheet.getRange(row - 1, col).setValue(title).setFontWeight('bold').setFontColor('#0f4c81');
  sheet.getRange(row, col, 1, headers.length).setValues([headers])
    .setBackground('#0f4c81').setFontColor('#ffffff').setFontWeight('bold');
  if (!rows.length) {
    sheet.getRange(row + 1, col).setValue('データなし');
    return;
  }
  sheet.getRange(row + 1, col, rows.length, headers.length).setValues(rows);
  sheet.getRange(row + 1, col + 4, rows.length, 1).setNumberFormat('0%');
  rows.forEach(function (r, i) {
    var rate = r[4];
    var bg = rate >= 1 ? '#e8f5ea' : (rate > 0 ? '#fff3d6' : '#fce8e6');
    var fg = rate >= 1 ? '#0f9d58' : (rate > 0 ? '#8a5a00' : '#d93025');
    sheet.getRange(row + 1 + i, col + 4).setBackground(bg).setFontColor(fg).setFontWeight('bold');
  });
}

/* B2 の年月を安全に読み取る式。日付に変換されていても yyyy-MM に直す */
var YM_ = 'IF(ISNUMBER($B$2),TEXT($B$2,"yyyy-mm"),TRIM(TO_TEXT($B$2)))';
/* 絞り込みは文字列の年月列ではなく、確実に日付である「点検日」列(B)の期間で行う。
   これによりシートが「テーブル」でも列の型に左右されず集計できる */
var D1_ = 'TEXT(DATEVALUE(' + YM_ + '&"-01"),"yyyy-mm-dd")';
var D2_ = 'TEXT(EOMONTH(DATEVALUE(' + YM_ + '&"-01"),0),"yyyy-mm-dd")';
var COND_ = 'B >= date \'"&' + D1_ + '&"\' and B <= date \'"&' + D2_ + '&"\' ';
/* B2 が空欄なら条件なし（全期間）、入力があれば当月で絞り込む */
function whereYm_() { return '&IF($B$2="","","where ' + COND_ + '")&'; }
function andYm_() { return '&IF($B$2="","","and ' + COND_ + '")&'; }
function q_(range, select, tail, empty) {
  return '=IFERROR(QUERY(' + range + ',"' + select + '"' + whereYm_() + '"' + tail + '",1),"' + empty + '")';
}

/* ============ 過去データの修復 ============
   点検日(B列)を日付データに、年月(C列)を yyyy-MM の文字列に揃え直します。
   集計が0件になる場合に手動で実行してください。 */
function 修復_日付と年月() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var msg = [];
  [SH_REC, SH_DET].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var n = sh.getLastRow() - 1;
    var dates = sh.getRange(2, 2, n, 1).getValues();   // B列＝点検日
    // 点検日を日付データに揃える（文字列のままだと期間での絞り込みが効かない）
    safe_(function () {
      sh.getRange(2, 2, n, 1).setValues(dates.map(function (d) { return [toDate_(d[0])]; }));
    });
    // 年月を yyyy-MM の文字列に揃える（表示・ピボット用。集計には使いません）
    safe_(function () {
      sh.getRange(2, 3, n, 1).setValues(dates.map(function (d) { return [ymOf_(d[0])]; }));
    });
    msg.push(name + ' ' + n + '行');
  });
  var out = '修復しました: ' + (msg.join(' / ') || '対象データなし');
  Logger.log(out);
  return out;
}

/* 対応状況が空欄の不良・要注意を「未対応」で埋める（列を追加する前のデータ用） */
function 修復_対応状況() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_DET);
  if (!sh || sh.getLastRow() < 2) return '対象データなし';
  var n = sh.getLastRow() - 1;
  var judges = sh.getRange(2, 10, n, 1).getValues();   // J列＝判定
  var states = sh.getRange(2, 16, n, 1).getValues();   // P列＝対応状況
  var filled = 0;
  for (var i = 0; i < n; i++) {
    var j = String(judges[i][0]);
    if ((j === '不良' || j === '要注意') && !String(states[i][0]).trim()) {
      states[i][0] = '未対応';
      filled++;
    }
  }
  sh.getRange(2, 16, n, 1).setValues(states);
  var out = '対応状況を ' + filled + ' 件「未対応」にしました';
  Logger.log(out);
  return out;
}

/* ============ 診断（集計されないときの原因調べ） ============
   実行後、下部の「実行ログ」に結果が表示されます。 */
function 診断_データ形式() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = ['=== 工場点検アプリ 診断 ==='];
  [SH_REC, SH_DET].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push(name + '：シートがありません'); return; }
    var rows = Math.max(0, sh.getLastRow() - 1);
    out.push('■ ' + name + '：データ ' + rows + ' 行');
    if (rows > 0) {
      var v = sh.getRange(2, 1, 1, 3).getValues()[0];
      out.push('　 点検日(B) = ' + v[1] + '　形式: ' + ((v[1] instanceof Date) ? '日付 ← 正常' : '文字列 ← 要修復'));
      out.push('　 年月(C)　 = ' + v[2] + '　形式: ' + ((v[2] instanceof Date) ? '日付' : '文字列'));
    }
  });
  var dash = ss.getSheetByName(SH_DASH);
  if (!dash) out.push('■ ' + SH_DASH + '：シートがありません（初期設定を実行してください）');
  else {
    var b2 = dash.getRange('B2').getValue();
    out.push('■ ' + SH_DASH + '：B2 = ' + b2 + '　形式: ' + ((b2 instanceof Date) ? '日付' : '文字列'));
    out.push('　 A5の集計結果 = ' + dash.getRange('A5').getDisplayValue());
  }
  out.push('点検日が「文字列」と出た場合は 修復_日付と年月 を実行してください。');
  var text = out.join('\n');
  Logger.log(text);
  return text;
}

function getSheet_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // 見出しが未設定、または列が増えた場合は書き直す（バージョンアップ対応）
  var cur = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), head.length)).getValues()[0] : [];
  if (cur.slice(0, head.length).join('\t') !== head.join('\t')) {
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
  }
  return sh;
}

/* ============ 受信（アプリ → シート） ============ */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'syncMaster') return json_(syncTargetMaster_(body.master));
    if (body.action === 'save') return json_(saveRecord_(body.record, body.refresh !== false));
    return json_({ ok: false, error: '不明なアクションです' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

/* アプリ内の点検対象設定をスプレッドシートへ同期する。
   最後に同期した端末の設定を正として、対象マスタを入れ替える。 */
function syncTargetMaster_(master) {
  master = master || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheet_(ss, SH_TARGET, TARGET_HEAD);
  var sites = master.sites || [];
  var machines = master.machines || [];
  var targets = master.targets || {};
  var now = new Date();
  var rows = [];
  var machineById = {};
  machines.forEach(function (m) { machineById[m.id] = m; });
  sites.forEach(function (s) {
    (targets[s.id] || []).forEach(function (mid) {
      var m = machineById[mid];
      if (m && m.name) rows.push([s.id, s.name, mid, m.name, true, now]);
    });
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, TARGET_HEAD.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, TARGET_HEAD.length).setValues(rows);
  safe_(function () {
    sh.getRange('A1:F1').setBackground('#0f4c81').setFontColor('#ffffff').setFontWeight('bold');
    sh.autoResizeColumns(1, TARGET_HEAD.length);
  });
  refreshDashboard_(ss);
  return { ok: true, targets: rows.length };
}

function saveRecord_(rec, refresh) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var recSh = getSheet_(ss, SH_REC, REC_HEAD);
  var detSh = getSheet_(ss, SH_DET, DET_HEAD);
  var items = rec.items || [];
  var now = new Date();
  var ym = String(rec.date || '').slice(0, 7);

  // 写真をドライブへ保存し、URLに置換
  var photoUrls = [];
  items.forEach(function (it, idx) {
    // 点検時の写真
    if (it.photo && String(it.photo).indexOf('data:image') === 0) {
      var p = savePhoto_(it.photo, [rec.date, rec.site, rec.machineName, it.name, idx].join('_'));
      it.photoUrl = p.url;
      it.photoId = p.id;
      it.photo = '';
      photoUrls.push({ index: idx, url: p.url, id: p.id, kind: 'item' });
    }
    // 対応完了時の写真
    if (it.resolvedPhoto && String(it.resolvedPhoto).indexOf('data:image') === 0) {
      var p2 = savePhoto_(it.resolvedPhoto, [rec.date, rec.site, rec.machineName, it.name, idx, '対応後'].join('_'));
      it.resolvedPhotoUrl = p2.url;
      it.resolvedPhotoId = p2.id;
      it.resolvedPhoto = '';
      photoUrls.push({ index: idx, url: p2.url, id: p2.id, kind: 'resolved' });
    }
  });

  var counts = { NG: 0, CAUTION: 0, NONE: 0 };
  items.forEach(function (it) {
    if (it.judge === 'NG') counts.NG++;
    else if (it.judge === 'CAUTION') counts.CAUTION++;
    else if (!it.judge) counts.NONE++;
  });

  var row = [rec.id, toDate_(rec.date), ym, rec.site, rec.machineName, rec.unit || '', rec.inspector || '',
    JUDGE_LABEL[rec.status] || '', counts.NG, counts.CAUTION, counts.NONE, rec.note || '',
    rec.createdAt ? new Date(rec.createdAt) : now, now];

  // 既存行があれば上書き（再送・修正に対応）
  var idx = findRow_(recSh, rec.id);
  if (idx > 0) recSh.getRange(idx, 1, 1, row.length).setValues([row]);
  else recSh.appendRow(row);

  // 明細は一旦削除して入れ直し
  deleteDetail_(detSh, rec.id);
  if (items.length) {
    var detRows = items.map(function (it, i) {
      // 不良・要注意の項目に対応状況を持たせる。
      // 対応完了後に判定を「良」へ変えた項目も、完了の記録として残す
      var needsAction = (it.judge === 'NG' || it.judge === 'CAUTION');
      var state = it.resolved ? '完了' : (needsAction ? '未対応' : '');
      return [rec.id, toDate_(rec.date), ym, rec.site, rec.machineName, rec.unit || '', rec.inspector || '',
        i + 1, it.name, JUDGE_LABEL[it.judge] || '未判定', it.value === '' ? '' : it.value,
        it.unit || '', it.note || '', it.photoUrl || '', now,
        state, it.resolvedAt ? toDate_(it.resolvedAt) : '', it.resolvedBy || '',
        it.resolvedNote || '', it.resolvedPhotoUrl || '',
        it.originalJudge ? (JUDGE_LABEL[it.originalJudge] || '') : ''];
    });
    detSh.getRange(detSh.getLastRow() + 1, 1, detRows.length, DET_HEAD.length).setValues(detRows);
  }
  if (refresh !== false) refreshDashboard_(ss);
  return { ok: true, id: rec.id, photoUrls: photoUrls };
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function deleteDetail_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) sh.deleteRow(i + 2);
  }
}

function savePhoto_(dataUrl, name) {
  var parts = dataUrl.split(',');
  var bytes = Utilities.base64Decode(parts[1]);
  var blob = Utilities.newBlob(bytes, 'image/jpeg', name.replace(/[\\/:*?"<>|]/g, '_') + '.jpg');
  var folders = DriveApp.getFoldersByName(PHOTO_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER);
  var file = folder.createFile(blob);
  // リンクを知っている人が閲覧できるようにする（写真を共有するため）。
  // 組織の共有ポリシーで設定できない場合も、写真の保存自体は成功させる
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('共有設定をスキップしました: ' + e);
  }
  var id = file.getId();
  return { id: id, url: 'https://drive.google.com/file/d/' + id + '/view' };
}

/* ============ 送信（シート → アプリ） ============ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'ping') {
      return json_({ ok: true, sheetName: SpreadsheetApp.getActiveSpreadsheet().getName() });
    }
    if (p.action === 'list') return json_({ ok: true, records: listRecords_(p.ym) });
    return json_({ ok: false, error: '不明なアクションです' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function listRecords_(ym) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var recSh = getSheet_(ss, SH_REC, REC_HEAD);
  var detSh = getSheet_(ss, SH_DET, DET_HEAD);
  if (recSh.getLastRow() < 2) return [];

  var recs = recSh.getRange(2, 1, recSh.getLastRow() - 1, REC_HEAD.length).getValues();
  var dets = detSh.getLastRow() > 1
    ? detSh.getRange(2, 1, detSh.getLastRow() - 1, DET_HEAD.length).getValues() : [];

  var byId = {};
  dets.forEach(function (d) {
    if (ym && ymOf_(d[1]) !== ym) return;   // 点検日から年月を判定する
    (byId[d[0]] = byId[d[0]] || []).push({
      name: d[8], type: d[11] ? 'num' : 'judge', unit: d[11] || '',
      judge: labelToKey_(d[9]), value: d[10] === '' ? '' : String(d[10]),
      note: d[12] || '', photo: '', photoUrl: d[13] || '',
      resolved: d[15] === '完了',
      resolvedAt: d[16] ? fmtDate_(d[16]) : '',
      resolvedBy: d[17] || '',
      resolvedNote: d[18] || '',
      resolvedPhoto: '', resolvedPhotoUrl: d[19] || '',
      originalJudge: labelToKey_(d[20])
    });
  });

  return recs.filter(function (r) { return !ym || ymOf_(r[1]) === ym; }).map(function (r) {
    return {
      id: String(r[0]),
      date: fmtDate_(r[1]),
      site: r[3], machineId: machineIdOf_(r[4]), machineName: r[4],
      unit: r[5], inspector: r[6],
      status: labelToKey_(r[7]),
      items: byId[r[0]] || [],
      note: r[11],
      createdAt: r[12] ? new Date(r[12]).toISOString() : '',
      updatedAt: r[13] ? new Date(r[13]).toISOString() : ''
    };
  });
}

function labelToKey_(label) {
  for (var k in JUDGE_LABEL) if (JUDGE_LABEL[k] === label) return k;
  return '';
}
function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}
/* 年月欄の読み取り。スプレッドシートが日付に自動変換した場合にも対応する */
function ymOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy-MM');
  return String(v).slice(0, 7);
}
/* 'YYYY-MM-DD' を日付データに変換する（文字列のまま入れると期間の絞り込みが効かないため） */
function toDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : s;
}
var MACHINE_IDS = ['回収乾燥機', '静止立体乾燥機', 'ドライ機', '水洗機', 'トンネルフィニッシャー',
  '立体自動包装機', '平包装機', '立体手動包装機', 'シーツローラー', 'カッタープレス機',
  '三ツ山プレス機', 'ズボンプレス機', '万能プレス機', '綿プレス機', '人体', 'パフ台', '平台',
  'ボイラー', 'コンプレッサー', '投入機', '軟水器', 'その他'];
function machineIdOf_(name) {
  var i = MACHINE_IDS.indexOf(name);
  return i < 0 ? 'm22' : 'm' + ('0' + (i + 1)).slice(-2);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
