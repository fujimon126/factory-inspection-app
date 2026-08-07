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
var PHOTO_FOLDER = '工場点検_写真';

var REC_HEAD = ['ID', '点検日', '年月', '点検場所', '点検機械', '号機', '点検者',
  '総合判定', '不良件数', '要注意件数', '未判定件数', '備考', '登録日時', '更新日時'];
var DET_HEAD = ['ID', '点検日', '年月', '点検場所', '点検機械', '号機', '点検者',
  '項目No', '点検項目', '判定', '測定値', '単位', '所見', '写真URL', '更新日時'];

var JUDGE_LABEL = { OK: '良', CAUTION: '要注意', NG: '不良', NA: '対象外', '': '未判定' };

/* ============ 初期設定（手動で1回実行） ============ */
function 初期設定() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rec = getSheet_(ss, SH_REC, REC_HEAD);
  var det = getSheet_(ss, SH_DET, DET_HEAD);
  rec.setFrozenRows(1);
  det.setFrozenRows(1);

  // 「2026-08」がスプレッドシート側で日付に自動変換されないよう、年月列を書式なしテキストに固定
  rec.getRange('C2:C').setNumberFormat('@');
  det.getRange('C2:C').setNumberFormat('@');
  rec.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  det.getRange('B2:B').setNumberFormat('yyyy-mm-dd');

  // 判定の色分け（総合判定列）
  var rng = rec.getRange('H2:H10000');
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('不良')
      .setBackground('#fdeceb').setFontColor('#d93025').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('要注意')
      .setBackground('#fff5e0').setFontColor('#b87700').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('良')
      .setBackground('#e7f6ec').setFontColor('#0f9d58').setRanges([rng]).build()
  ];
  rec.setConditionalFormatRules(rules);

  // ダッシュボード（数式で自動集計）
  var dash = ss.getSheetByName(SH_DASH) || ss.insertSheet(SH_DASH);
  dash.clear();
  dash.getRange('A1').setValue('工場点検 進捗ダッシュボード').setFontSize(16).setFontWeight('bold');
  dash.getRange('A2').setValue('対象年月');
  dash.getRange('B2').setValue(Utilities.formatDate(new Date(), 'JST', 'yyyy-MM'));
  dash.getRange('B2').setNote('集計したい年月を yyyy-MM 形式で入力してください');

  dash.getRange('A4').setValue('■ 工場別 点検台数').setFontWeight('bold');
  dash.getRange('A5').setFormula(
    '=IFERROR(QUERY(' + SH_REC + '!A:N,"select D, count(A) where C = \'"&B2&"\' group by D label D \'点検場所\', count(A) \'点検台数\'",1),"データなし")');

  dash.getRange('D4').setValue('■ 判定内訳').setFontWeight('bold');
  dash.getRange('D5').setFormula(
    '=IFERROR(QUERY(' + SH_REC + '!A:N,"select H, count(A) where C = \'"&B2&"\' group by H label H \'総合判定\', count(A) \'件数\'",1),"データなし")');

  dash.getRange('G4').setValue('■ 要対応（不良・要注意）項目一覧').setFontWeight('bold');
  dash.getRange('G5').setFormula(
    '=IFERROR(QUERY(' + SH_DET + '!A:O,"select B, D, E, F, I, J, M where C = \'"&B2&"\' and (J = \'不良\' or J = \'要注意\') order by B desc label B \'点検日\', D \'場所\', E \'機械\', F \'号機\', I \'項目\', J \'判定\', M \'所見\'",1),"要対応なし")');

  dash.getRange('A20').setValue('■ 機械別 点検回数').setFontWeight('bold');
  dash.getRange('A21').setFormula(
    '=IFERROR(QUERY(' + SH_REC + '!A:N,"select E, count(A) where C = \'"&B2&"\' group by E order by count(A) desc label E \'点検機械\', count(A) \'点検回数\'",1),"データなし")');

  dash.setColumnWidth(1, 160);
  dash.autoResizeColumns(4, 12);
  SpreadsheetApp.getUi && SpreadsheetApp.flush();
  return 'セットアップ完了';
}

function getSheet_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 || String(sh.getRange(1, 1).getValue()) !== head[0]) {
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
    if (body.action !== 'save') return json_({ ok: false, error: '不明なアクションです' });
    return json_(saveRecord_(body.record));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

function saveRecord_(rec) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var recSh = getSheet_(ss, SH_REC, REC_HEAD);
  var detSh = getSheet_(ss, SH_DET, DET_HEAD);
  var items = rec.items || [];
  var now = new Date();
  var ym = String(rec.date || '').slice(0, 7);

  // 写真をドライブへ保存し、URLに置換
  var photoUrls = [];
  items.forEach(function (it, idx) {
    if (it.photo && String(it.photo).indexOf('data:image') === 0) {
      var url = savePhoto_(it.photo, [rec.date, rec.site, rec.machineName, it.name, idx].join('_'));
      it.photoUrl = url;
      it.photo = '';
      photoUrls.push({ index: idx, url: url });
    }
  });

  var counts = { NG: 0, CAUTION: 0, NONE: 0 };
  items.forEach(function (it) {
    if (it.judge === 'NG') counts.NG++;
    else if (it.judge === 'CAUTION') counts.CAUTION++;
    else if (!it.judge) counts.NONE++;
  });

  var row = [rec.id, rec.date, ym, rec.site, rec.machineName, rec.unit || '', rec.inspector || '',
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
      return [rec.id, rec.date, ym, rec.site, rec.machineName, rec.unit || '', rec.inspector || '',
        i + 1, it.name, JUDGE_LABEL[it.judge] || '未判定', it.value === '' ? '' : it.value,
        it.unit || '', it.note || '', it.photoUrl || '', now];
    });
    detSh.getRange(detSh.getLastRow() + 1, 1, detRows.length, DET_HEAD.length).setValues(detRows);
  }
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
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
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
    if (ym && ymOf_(d[2]) !== ym) return;
    (byId[d[0]] = byId[d[0]] || []).push({
      name: d[8], type: d[11] ? 'num' : 'judge', unit: d[11] || '',
      judge: labelToKey_(d[9]), value: d[10] === '' ? '' : String(d[10]),
      note: d[12] || '', photo: '', photoUrl: d[13] || ''
    });
  });

  return recs.filter(function (r) { return !ym || ymOf_(r[2]) === ym; }).map(function (r) {
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
