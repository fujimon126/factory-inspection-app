/* =========================================================
   工場点検アプリ  画面制御
   ========================================================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let currentView = 'inspect';
let editing = null;      // 編集中の点検記録
let toastTimer = null;
let masterSyncTimer = null;

/* ---------------- 共通UI ---------------- */
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}
function busy(on, text) {
  $('#overlayText').textContent = text || '';
  $('#overlay').classList.toggle('hidden', !on);
}
function show(view) {
  ['inspect', 'form', 'todo', 'history', 'dash', 'settings', 'master'].forEach(v => {
    $('#view-' + v).classList.toggle('hidden', v !== view);
  });
  currentView = view;
  const tabOf = view === 'form' ? 'inspect' : (view === 'master' ? 'settings' : view);
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === tabOf));
  $('#btnBack').classList.toggle('hidden', view !== 'form' && view !== 'master');
  $('#appTitle').textContent = {
    inspect: '工場点検', form: '点検項目', todo: '要対応リスト', history: '点検履歴',
    dash: '進捗状況', settings: '設定', master: '点検機械・項目の編集'
  }[view];
  window.scrollTo(0, 0);
  if (view === 'inspect') renderMachineGrid();
  if (view === 'todo') renderTodo();
  if (view === 'history') renderHistory();
  if (view === 'dash') renderDash();
  if (view === 'settings') renderSettings();
  if (view === 'master') renderMaster();
}

/* 点検場所のプルダウンを設定内容から作り直す（値は場所ID） */
function renderSiteOptions() {
  const sites = Store.sites();
  const cur = $('#inpSite').value, hisCur = $('#hisSite').value;
  const todoCur = $('#todoSite').value;
  const opts = sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('#inpSite').innerHTML = opts;
  $('#hisSite').innerHTML = '<option value="">すべての場所</option>' + opts;
  $('#todoSite').innerHTML = '<option value="">すべての場所</option>' + opts;
  if (sites.some(s => s.id === cur)) $('#inpSite').value = cur;
  if (hisCur === '' || sites.some(s => s.id === hisCur)) $('#hisSite').value = hisCur;
  if (todoCur === '' || sites.some(s => s.id === todoCur)) $('#todoSite').value = todoCur;
}
function siteName(id) { return Store.siteName(id); }
/* 記録の表示用工場名。名称変更後は現在の名称を表示する */
function siteLabel(rec) {
  return (rec.siteId && Store.siteName(rec.siteId)) || rec.site || '';
}

/* ---------------- 初期化 ---------------- */
function init() {
  // セレクト初期化
  renderSiteOptions();
  $('#inpDate').value = Util.today();
  $('#hisMonth').value = Util.ym(Util.today());
  $('#dashMonth').value = Util.ym(Util.today());
  const st = Store.settings();
  $('#inpInspector').value = st.inspector || '';
  const last = localStorage.getItem('fi_lastSite');
  if (last && Store.sites().some(s => s.id === last)) $('#inpSite').value = last;

  // イベント
  $$('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#btnBack').addEventListener('click', () => show(currentView === 'master' ? 'settings' : 'inspect'));
  $('#btnOpenMaster').addEventListener('click', () => show('master'));
  $('#btnAddMachine').addEventListener('click', addMachine);
  $('#btnResetMachines').addEventListener('click', resetMachines);
  $('#inpDate').addEventListener('change', renderMachineGrid);
  $('#inpSite').addEventListener('change', () => {
    localStorage.setItem('fi_lastSite', $('#inpSite').value);
    renderMachineGrid();
  });
  $('#inpInspector').addEventListener('change', () => Store.saveSettings({ inspector: $('#inpInspector').value.trim() }));
  $('#btnSave').addEventListener('click', saveRecord);
  $('#btnDelete').addEventListener('click', deleteRecord);
  $$('[data-bulk]').forEach(b => b.addEventListener('click', () => bulkSet(b.dataset.bulk)));
  $$('#noteJudges .jbtn').forEach(b => b.addEventListener('click', () => setNoteJudge(b.dataset.nj)));
  $('#notePhotoBtn').addEventListener('click', pickNotePhoto);
  ['#hisMonth', '#hisSite', '#hisStatus'].forEach(s => $(s).addEventListener('change', renderHistory));
  ['#todoSite', '#todoKind', '#todoDone'].forEach(s => $(s).addEventListener('change', renderTodo));
  $('#btnCsv').addEventListener('click', exportCsv);
  $('#dashMonth').addEventListener('change', renderDash);
  $('#btnPull').addEventListener('click', pullFromSheet);
  $('#btnSync').addEventListener('click', () => syncNow(true));
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#btnTest').addEventListener('click', testConnection);
  $('#btnExportJson').addEventListener('click', exportJson);
  $('#btnClearSynced').addEventListener('click', clearSynced);

  $('#doneCancel').addEventListener('click', closeDoneDialog);
  $('#doneSubmit').addEventListener('click', submitDone);
  $('#donePhotoBtn').addEventListener('click', pickDonePhoto);
  $('#doneDialog').addEventListener('click', ev => { if (ev.target.id === 'doneDialog') closeDoneDialog(); });
  $('#lbClose').addEventListener('click', closePhoto);
  $('#lbShare').addEventListener('click', sharePhoto);
  $('#lightbox').addEventListener('click', ev => { if (ev.target.id === 'lightbox') closePhoto(); });

  window.addEventListener('online', () => { updateNet(); if (Store.settings().autoSync) syncNow(false); });
  window.addEventListener('offline', updateNet);
  window.addEventListener('masterchange', scheduleMasterSync);
  updateNet();
  renderMachineGrid();
  updatePendingBadge();
  updateTodoBadge();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 未対応環境は無視 */ });
  }
}

/* 工場・機械・点検対象の編集が続いても、最後の変更から少し待って1回だけ同期する */
function scheduleMasterSync() {
  clearTimeout(masterSyncTimer);
  masterSyncTimer = setTimeout(() => {
    const st = Store.settings();
    if (st.autoSync && st.gasUrl && navigator.onLine) syncNow(false);
  }, 800);
}

function updateNet() {
  const b = $('#netBadge');
  b.classList.toggle('off', !navigator.onLine);
  b.title = navigator.onLine ? 'オンライン' : 'オフライン（端末に保存されます）';
}
function updatePendingBadge() {
  const n = Store.unsynced().length;
  $('#pendingDot').classList.toggle('hidden', n === 0);
}

/* ---------------- ③ 機械選択 ---------------- */
function renderMachineGrid() {
  const date = $('#inpDate').value, siteId = $('#inpSite').value;
  const todays = Store.records().filter(r => r.date === date && sameSite(r, siteId));
  const targets = Store.targets()[siteId] || [];

  $('#dayHint').textContent =
    `${Util.fmtDate(date)}　${siteName(siteId)}　本日 ${todays.length} 件登録済 / 対象 ${targets.length} 項目`;

  $('#machineGrid').innerHTML = Store.machines().map((m, i) => {
    const recs = todays.filter(r => r.machineId === m.id);
    const st = recs.length ? worstStatus(recs) : null;
    const flag = st ? `<span class="flag ${JUDGE[st].cls}">${recs.length > 1 ? recs.length + '件 ' : ''}${JUDGE[st].label}</span>` : '';
    return `<button class="mcard ${recs.length ? 'done' : ''}" data-mid="${m.id}">
      <span class="num">${i + 1}</span>${flag}
      <span class="ico">${m.icon}</span>${m.name}
    </button>`;
  }).join('');

  $$('#machineGrid .mcard').forEach(b => b.addEventListener('click', () => onPickMachine(b.dataset.mid)));
}
/* 記録が指定の場所のものか判定（シート取込データは名称のみのため名称でも照合） */
function sameSite(rec, siteId) {
  if (rec.siteId) return rec.siteId === siteId;
  return rec.site === siteName(siteId);
}
function worstStatus(recs) {
  const all = recs.map(r => r.status);
  if (all.includes('NG')) return 'NG';
  if (all.includes('CAUTION')) return 'CAUTION';
  if (all.includes('OK')) return 'OK';
  return 'NA';
}

function onPickMachine(mid) {
  const date = $('#inpDate').value, siteId = $('#inpSite').value;
  const exist = Store.records().filter(r => r.date === date && sameSite(r, siteId) && r.machineId === mid);
  if (exist.length === 0) return openForm(mid, null);

  // 既存記録あり → 編集 or 新規（別号機）を選択
  const names = exist.map((r, i) => `${i + 1}. ${r.unit || '（号機未入力）'}／${JUDGE[r.status].label}`).join('\n');
  const ans = prompt(
    `${Store.machineById(mid).name} はこの日すでに登録があります。\n${names}\n\n編集する番号を入力（新規追加は「n」）`,
    '1'
  );
  if (ans === null) return;
  if (ans.toLowerCase() === 'n') return openForm(mid, null);
  const idx = parseInt(ans, 10) - 1;
  if (exist[idx]) openForm(mid, exist[idx].id);
}

/* ---------------- ④ 点検項目フォーム ---------------- */
function inspectionItemsForMachine(machine, site) {
  if (machine.id !== 'm20') return machine.items;
  if (!DOSING_FLOW_BY_SITE[site]) {
    return machine.items.map(it => it.name === '流量測定' ? Object.assign({}, it, { unit: '' }) : it);
  }

  const flowTemplate = machine.items.find(it => it.name === '流量測定') ||
    { name: '流量測定', type: 'num', unit: '', step: '0.1' };
  const flows = [];
  DOSING_FLOW_BY_SITE[site].forEach(group => {
    group.ports.forEach(portLabel => {
      const parts = String(portLabel).trim().split(/\s+/);
      const port = parts.shift();
      const chemical = parts.join(' ');
      flows.push({
        name: `${group.machine} ${port}${chemical ? ' ' + chemical : ''} 流量測定`,
        type: 'num', unit: '', step: flowTemplate.step || '0.1',
        dosingMachine: group.machine, dosingPort: port, chemical
      });
    });
  });
  // 漏れ確認・溶剤残量確認など、流量測定以外の既存項目はそのまま残す。
  return flows.concat(machine.items.filter(it => it.name !== '流量測定'));
}

/* 投入機の測定値を自動判定する（350以上=良、300以上350未満=要注意、300未満=不良）。 */
function isDosingMeasurement(it) {
  return editing && editing.machineId === 'm20' &&
    !!(it.dosingMachine || it.dosingPort || /流量測定/.test(String(it.name || '')));
}
function dosingJudge(value) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  return n < 300 ? 'NG' : (n < 350 ? 'CAUTION' : 'OK');
}
function applyDosingJudge(it) {
  if (isDosingMeasurement(it)) it.judge = dosingJudge(it.value);
}

function openForm(mid, recId) {
  const m = Store.machineById(mid);
  if (!m) return toast('この点検機械は削除されています', true);
  if (recId) {
    editing = JSON.parse(JSON.stringify(Store.get(recId)));
  } else {
    const site = siteName($('#inpSite').value);
    const inspectionItems = inspectionItemsForMachine(m, site);
    editing = {
      id: Util.uuid(),
      date: $('#inpDate').value,
      siteId: $('#inpSite').value,
      site,
      inspector: $('#inpInspector').value.trim(),
      machineId: mid,
      machineName: m.name,
      unit: '',
      items: inspectionItems.map(it => ({
        name: it.name, type: it.type || 'judge', unit: it.unit || '',
        step: it.step || '', dosingMachine: it.dosingMachine || '',
        dosingPort: it.dosingPort || '', chemical: it.chemical || '',
        judge: '', value: '', note: '', photo: '', photoUrl: ''
      })),
      note: '',
      status: 'NA',
      createdAt: new Date().toISOString(),
      synced: false
    };
  }
  $('#formHead').innerHTML =
    `${m.icon} ${m.name}<small>${Util.fmtDate(editing.date)}　${esc(editing.site)}　点検者：${esc(editing.inspector || '－')}</small>`;
  $('#inpUnit').value = editing.unit || '';
  $('#inpNote').value = editing.note || '';
  $('#btnDelete').classList.toggle('hidden', !recId);
  renderItems();
  renderNoteExtras();
  show('form');
}

/* 備考欄そのものを「備考」という点検項目として保持する。
   こうすることで判定・写真・要対応リスト・スプレッドシートの仕組みをそのまま使える。 */
function noteItem() {
  let i = editing.items.findIndex(x => x.isNote);
  if (i < 0) {
    editing.items.push({
      name: '備考', isNote: true, type: 'judge', unit: '',
      judge: '', value: '', note: '', photo: '', photoUrl: ''
    });
    i = editing.items.length - 1;
  }
  return editing.items[i];
}
/* 点検項目として数える対象（備考は除く） */
function realItems() {
  return editing.items.filter(x => !x.isNote);
}

function renderNoteExtras() {
  const n = noteItem();
  $$('#noteJudges .jbtn').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.nj === n.judge));
  $('#notePhotoThumb').innerHTML = Util.hasPhoto(n)
    ? `<div class="thumb"><img src="${Util.photoSrc(n)}" alt="備考の写真"><button id="noteDelPhoto">×</button></div>` : '';
  if (Util.hasPhoto(n)) $('#noteDelPhoto').addEventListener('click', () => {
    n.photo = ''; n.photoUrl = ''; n.photoId = '';
    renderNoteExtras();
  });
}
function setNoteJudge(j) {
  const n = noteItem();
  n.judge = n.judge === j ? '' : j;
  renderNoteExtras();
}
async function pickNotePhoto() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.onchange = async () => {
    if (!inp.files || !inp.files[0]) return;
    busy(true, '画像を処理中…');
    try {
      const n = noteItem();
      n.photo = await Util.compressImage(inp.files[0]);
      n.photoUrl = '';
      n.photoId = '';
      renderNoteExtras();
    } catch (e) {
      toast('画像を読み込めませんでした', true);
    } finally {
      busy(false);
    }
  };
  inp.click();
}

function renderItems() {
  const m = Store.machineById(editing.machineId) || { items: [] };
  if (Store.isFree(m)) {
    $('#itemList').innerHTML =
      `<div class="card"><p class="hint" style="margin:0">「その他」は備考欄に点検内容を記入してください。</p></div>`;
    updateFormProgress();
    return;
  }
  let lastDosingMachine = '';
  $('#itemList').innerHTML = editing.items.map((it, i) => {
    if (it.isNote) return '';   // 備考は下部の備考欄に表示するため、ここでは出さない
    const groupHead = it.dosingMachine && it.dosingMachine !== lastDosingMachine
      ? `<div class="dosing-head">⚗️ 投入機 ${esc(it.dosingMachine)}</div>` : '';
    if (it.dosingMachine) lastDosingMachine = it.dosingMachine;
    const autoJudge = isDosingMeasurement(it);
    const jbtns = ['OK', 'CAUTION', 'NG', 'NA'].map(k =>
      `<button class="jbtn ${JUDGE[k].cls}" aria-pressed="${it.judge === k}" data-j="${k}" data-i="${i}"${autoJudge ? ' disabled' : ''}>${JUDGE[k].label}</button>`
    ).join('');
    const num = it.type === 'num'
      ? `<div class="numrow">
           <input type="number" inputmode="decimal" step="any" placeholder="測定値" value="${esc(it.value)}" data-num="${i}">
           <span class="unit">${it.unit}</span>
         </div>` : '';
    const photo = Util.hasPhoto(it)
      ? `<div class="thumb"><img src="${Util.photoSrc(it)}" alt="添付写真"><button data-delphoto="${i}">×</button></div>` : '';
    return `${groupHead}<div class="item ${it.judge ? JUDGE[it.judge].cls : ''}" data-item="${i}">
      <div class="iname"><span class="idx">${i + 1}</span>${esc(it.name)}</div>
      <div class="judges">${jbtns}</div>
      ${autoJudge ? '<div class="hint">測定値から自動判定（350以上：良／300以上350未満：要注意／300未満：不良）</div>' : ''}
      ${num}
      <div class="subrow">
        <input type="text" placeholder="所見・処置（任意）" value="${esc(it.note)}" data-note="${i}">
        <button class="photobtn" data-photo="${i}" aria-label="写真を撮影">📷</button>
      </div>
      ${photo}
    </div>`;
  }).join('');

  $$('#itemList .jbtn').forEach(b => b.addEventListener('click', () => setJudge(+b.dataset.i, b.dataset.j)));
  $$('#itemList [data-note]').forEach(inp =>
    inp.addEventListener('input', () => { editing.items[+inp.dataset.note].note = inp.value; }));
  $$('#itemList [data-num]').forEach(inp =>
    inp.addEventListener('input', () => {
      const i = +inp.dataset.num;
      const it = editing.items[i];
      it.value = inp.value;
      applyDosingJudge(it);
      const row = $(`#itemList [data-item="${i}"]`);
      row.className = 'item ' + (it.judge ? JUDGE[it.judge].cls : '');
      row.querySelectorAll('.jbtn').forEach(b => b.setAttribute('aria-pressed', b.dataset.j === it.judge));
      updateFormProgress();
    }));
  $$('#itemList [data-photo]').forEach(b =>
    b.addEventListener('click', () => pickPhoto(+b.dataset.photo)));
  $$('#itemList [data-delphoto]').forEach(b =>
    b.addEventListener('click', () => { const i = +b.dataset.delphoto; editing.items[i].photo = ''; editing.items[i].photoUrl = ''; renderItems(); }));
  updateFormProgress();
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function setJudge(i, j) {
  if (isDosingMeasurement(editing.items[i])) return;
  editing.items[i].judge = editing.items[i].judge === j ? '' : j;
  const row = $(`#itemList [data-item="${i}"]`);
  row.className = 'item ' + (editing.items[i].judge ? JUDGE[editing.items[i].judge].cls : '');
  row.querySelectorAll('.jbtn').forEach(b => b.setAttribute('aria-pressed', b.dataset.j === editing.items[i].judge));
  updateFormProgress();
  // 次の未入力項目へ自動スクロール
  if (editing.items[i].judge && i + 1 < editing.items.length) {
    const next = $(`#itemList [data-item="${i + 1}"]`);
    if (next && !editing.items[i + 1].judge) {
      const y = next.getBoundingClientRect().top + window.scrollY - 210;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }
}
function bulkSet(kind) {
  realItems().forEach(it => { it.judge = (kind === 'CLEAR' ? '' : kind); });
  editing.items.forEach(applyDosingJudge);
  renderItems();
}
function updateFormProgress() {
  const items = realItems();
  const total = items.length;
  const done = items.filter(it => it.judge).length;
  const pct = total ? Math.round(done / total * 100) : 100;
  $('#formProgress').style.width = pct + '%';
  $('#formProgressText').textContent = total ? `${done} / ${total} 項目　(${pct}%)` : '備考欄に記入';
}

async function pickPhoto(i) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.onchange = async () => {
    if (!inp.files || !inp.files[0]) return;
    busy(true, '画像を処理中…');
    try {
      editing.items[i].photo = await Util.compressImage(inp.files[0]);
      editing.items[i].photoUrl = '';
      renderItems();
    } catch (e) {
      toast('画像を読み込めませんでした', true);
    } finally {
      busy(false);
    }
  };
  inp.click();
}

async function saveRecord() {
  editing.unit = $('#inpUnit').value.trim();
  editing.note = $('#inpNote').value.trim();
  editing.inspector = $('#inpInspector').value.trim();
  if (editing.siteId) editing.site = siteName(editing.siteId) || editing.site; // 最新の工場名を反映
  const m = Store.machineById(editing.machineId) || { items: [] };

  // 手動変更や古い編集中データがあっても、投入機の測定値を必ず基準どおり再判定する。
  editing.items.forEach(applyDosingJudge);

  // 備考欄の内容を「備考」項目にも反映する（判定・写真つきで記録に残すため）
  const note = noteItem();
  note.note = editing.note;
  // 備考が未入力・判定なし・写真なしなら項目として持たない
  if (!editing.note && !note.judge && !Util.hasPhoto(note)) {
    editing.items = editing.items.filter(x => !x.isNote);
  }

  const items = realItems();
  if (Store.isFree(m)) {
    if (!editing.note) return toast('備考欄を入力してください', true);
  } else {
    const done = items.filter(it => it.judge).length;
    if (done === 0) return toast('点検項目を判定してください', true);
    if (done < items.length &&
      !confirm(`未判定の項目が ${items.length - done} 件あります。このまま保存しますか？`)) return;
    const ngNoNote = items.some(it => it.judge === 'NG' && !it.note);
    if (ngNoNote && !confirm('「不良」の項目に所見が未記入です。このまま保存しますか？')) return;
  }

  // 備考の判定も総合判定に反映する（その他の機械も備考の判定で決まる）
  editing.status = Util.statusOf(editing);
  editing.synced = false;
  Store.upsert(editing);
  updatePendingBadge();
  updateTodoBadge();
  toast('保存しました');
  show('inspect');

  if (Store.settings().autoSync && Store.settings().gasUrl && navigator.onLine) syncNow(false);
}

function deleteRecord() {
  if (!confirm('この点検記録を端末から削除します。よろしいですか？\n（スプレッドシート送信済みのデータはシート側に残ります）')) return;
  Store.remove(editing.id);
  updatePendingBadge();
  toast('削除しました');
  show('inspect');
}

/* ---------------- 同期 ---------------- */
async function syncNow(manual) {
  const st = Store.settings();
  if (!st.gasUrl) {
    if (manual) { toast('設定タブでスプレッドシート連携URLを登録してください', true); show('settings'); }
    return;
  }
  if (!navigator.onLine) { if (manual) toast('オフラインです。通信可能になったら送信されます', true); return; }
  const n = Store.unsynced().length;
  if (manual) busy(true, n ? `送信中… (${n}件)` : '点検対象設定を同期中…');
  try {
    const r = await Store.push();
    toast(r.sent
      ? `点検対象設定と点検記録 ${r.sent} 件を送信しました`
      : `点検対象設定 ${r.targets} 項目を同期しました`);
  } catch (e) {
    toast('送信に失敗：' + e.message, true);
  } finally {
    busy(false);
    updatePendingBadge();
    if (currentView === 'history') renderHistory();
  }
}

async function pullFromSheet() {
  busy(true, '取得中…');
  try {
    const r = await Store.pull($('#dashMonth').value);
    toast(`シートから ${r.total} 件取得（新規 ${r.added} 件）`);
    renderDash();
    updateTodoBadge();
  } catch (e) {
    toast('取得に失敗：' + e.message, true);
  } finally {
    busy(false);
  }
}

/* ---------------- 写真の表示・共有 ---------------- */
/* 記録内の写真つき項目を一覧のサムネイルにする */
function photoStrip(rec) {
  const withPhoto = (rec.items || []).map((it, i) => ({ it, i })).filter(x => Util.hasPhoto(x.it));
  if (!withPhoto.length) return '';
  return '<div class="photos">' + withPhoto.map(x =>
    `<button class="pthumb" data-photo-rid="${rec.id}" data-photo-i="${x.i}" title="${esc(x.it.name)}">
       <img src="${Util.photoSrc(x.it)}" alt="${esc(x.it.name)}" loading="lazy">
       ${x.it.judge === 'NG' ? '<span class="pbadge ng">不良</span>' : x.it.judge === 'CAUTION' ? '<span class="pbadge caution">注意</span>' : ''}
     </button>`).join('') + '</div>';
}
/* サムネイルのタップで拡大表示を開く */
function bindPhotoStrips(root) {
  $$(root + ' [data-photo-rid]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    openPhoto(b.dataset.photoRid, +b.dataset.photoI, b.dataset.kind);
  }));
}

let lightboxTarget = null;
function openPhoto(rid, idx, kind) {
  const rec = Store.get(rid);
  if (!rec) return;
  const item = rec.items[idx];
  // 「対応後」の写真は別項目として扱う
  const it = kind === 'resolved' ? Util.resolvedPhotoOf(item) : item;
  it.name = item.name + (kind === 'resolved' ? '（対応後）' : '');
  it.judge = item.judge;
  it.note = kind === 'resolved' ? (item.resolvedNote || '') : (item.note || '');
  lightboxTarget = { rec, it };
  $('#lightboxImg').src = Util.photoSrc(it);
  const link = Util.photoLink(it);
  $('#lbOpen').classList.toggle('hidden', !link);
  if (link) $('#lbOpen').href = link;
  $('#lightbox').classList.remove('hidden');
}
function closePhoto() {
  $('#lightbox').classList.add('hidden');
  $('#lightboxImg').src = '';
  lightboxTarget = null;
}

/* 写真1枚を共有する。未送信なら画像そのもの、送信済みならリンクを共有 */
async function sharePhoto() {
  if (!lightboxTarget) return;
  const { rec, it } = lightboxTarget;
  const text = `${Util.fmtDate(rec.date)} ${siteLabel(rec)} ${rec.machineName}${rec.unit ? ' ' + rec.unit : ''}\n`
    + `${it.name}（${it.judge ? JUDGE[it.judge].label : '未判定'}）${it.note ? '：' + it.note : ''}`;
  const link = Util.photoLink(it);
  if (it.photo && navigator.canShare) {
    const f = Util.dataUrlToFile(it.photo, `${rec.machineName}_${it.name}.jpg`);
    if (f && navigator.canShare({ files: [f] })) {
      return doShare({ text, files: [f] });
    }
  }
  if (link) return doShare({ title: '点検写真', text: text + '\n' + link });
  toast('この写真はまだ送信されていないため、リンクを作成できません', true);
}

/* 点検記録1件を共有する（要対応の内容と写真リンク） */
async function shareRecord(rid) {
  const r = Store.get(rid);
  if (!r) return;
  const lines = [
    `【点検報告】${Util.fmtDate(r.date)}`,
    `${siteLabel(r)}　${r.machineName}${r.unit ? ' ' + r.unit : ''}`,
    `点検者：${r.inspector || '－'}　総合判定：${JUDGE[r.status].label}`
  ];
  const bad = (r.items || []).filter(i => i.judge === 'NG' || i.judge === 'CAUTION');
  if (bad.length) {
    lines.push('', '■ 要対応');
    bad.forEach(i => lines.push(
      `・${i.name}（${JUDGE[i.judge].label}）${i.value ? ` ${i.value}${i.unit}` : ''}${i.note ? ' ' + i.note : ''}`));
  }
  const completed = (r.items || []).filter(i => i.resolved);
  if (completed.length) {
    lines.push('', '■ 対応完了');
    completed.forEach(i => {
      lines.push(`・${i.name}（当初：${i.originalJudge ? JUDGE[i.originalJudge].label : '－'}）`);
      if (i.resolvedCause) lines.push(`　原因：${i.resolvedCause}`);
      if (i.resolvedNote) lines.push(`　対応内容：${i.resolvedNote}`);
    });
  }
  const nums = (r.items || []).filter(i => i.type === 'num' && i.value);
  if (nums.length) {
    lines.push('', '■ 測定値');
    nums.forEach(i => lines.push(`・${i.name}：${i.value}${i.unit}`));
  }
  if (r.note) lines.push('', `備考：${r.note}`);

  const links = (r.items || []).filter(i => Util.photoLink(i));
  if (links.length) {
    lines.push('', '■ 写真');
    links.forEach(i => lines.push(`・${i.name}：${Util.photoLink(i)}`));
  }
  const text = lines.join('\n');

  // 未送信の写真は画像ファイルとして直接共有する
  const files = [];
  if (navigator.canShare) {
    (r.items || []).forEach(it => {
      if (it.photo) {
        const f = Util.dataUrlToFile(it.photo, `${r.machineName}_${it.name}.jpg`);
        if (f) files.push(f);
      }
    });
  }
  if (files.length && navigator.canShare({ files })) return doShare({ text, files });
  return doShare({ title: '点検報告', text });
}

async function doShare(data) {
  try {
    if (navigator.share) { await navigator.share(data); return; }
    throw new Error('unsupported');
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // ユーザーが共有をキャンセルした
    try {
      await navigator.clipboard.writeText(data.text || '');
      toast('内容をコピーしました。LINEやメールに貼り付けてください');
    } catch (e2) {
      toast('共有に対応していない環境です', true);
    }
  }
}

/* ---------------- 要対応リスト ---------------- */
/* 全記録から不良・要注意の項目を取り出す */
function todoItems(includeDone) {
  const out = [];
  Store.records().forEach(r => {
    (r.items || []).forEach((it, idx) => {
      // 対応完了して判定を「良」に変えた項目も、完了分の表示対象に含める
      const target = it.judge === 'NG' || it.judge === 'CAUTION' || it.resolved;
      if (!target) return;
      if (!includeDone && it.resolved) return;
      out.push({ r, it, idx });
    });
  });
  // 不良を先に、その中で日付の新しい順
  return out.sort((a, b) =>
    (a.it.judge === b.it.judge ? 0 : a.it.judge === 'NG' ? -1 : 1) ||
    b.r.date.localeCompare(a.r.date));
}
/* 一覧に表示する判定（完了後に良へ変えた場合は当初の判定を見せる） */
function shownJudge(it) {
  return (it.resolved && it.originalJudge) ? it.originalJudge : it.judge;
}
function openTodoCount() {
  return todoItems(false).length;
}
function updateTodoBadge() {
  const n = openTodoCount();
  const b = $('#todoBadge');
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', n === 0);
}

function renderTodo() {
  const showDone = $('#todoDone').checked;
  const siteId = $('#todoSite').value;
  const kind = $('#todoKind').value;
  const all = todoItems(showDone).filter(x =>
    (!siteId || sameSite(x.r, siteId)) && (!kind || x.it.judge === kind));

  const open = openTodoCount();
  const opens = todoItems(false);
  $('#todoSummary').textContent = open
    ? `未対応 ${open} 件（不良 ${opens.filter(x => x.it.judge === 'NG').length} 件 / 要注意 ${opens.filter(x => x.it.judge === 'CAUTION').length} 件）`
    : '未対応の項目はありません';

  if (!all.length) {
    $('#todoList').innerHTML = '<p class="empty">該当する項目はありません</p>';
    updateTodoBadge();
    return;
  }

  $('#todoList').innerHTML = all.map(({ r, it, idx }) => {
    const done = !!it.resolved;
    const j = shownJudge(it);
    const thumbs = [];
    if (Util.hasPhoto(it)) {
      thumbs.push(`<button class="pthumb" data-photo-rid="${r.id}" data-photo-i="${idx}" data-kind="item">
        <img src="${Util.photoSrc(it)}" alt="点検時の写真" loading="lazy"><span class="pbadge">点検時</span></button>`);
    }
    const rp = Util.resolvedPhotoOf(it);
    if (Util.hasPhoto(rp)) {
      thumbs.push(`<button class="pthumb" data-photo-rid="${r.id}" data-photo-i="${idx}" data-kind="resolved">
        <img src="${Util.photoSrc(rp)}" alt="対応後の写真" loading="lazy"><span class="pbadge ok">対応後</span></button>`);
    }
    const doneInfo = done ? `
      <div class="doneblock">
        <div class="doneinfo">✔ 対応完了　${esc(it.resolvedAt ? Util.fmtDate(it.resolvedAt) : '')}${it.resolvedBy ? '　' + esc(it.resolvedBy) : ''}</div>
        ${it.resolvedCause ? `<div class="t2">原因：${esc(it.resolvedCause)}</div>` : ''}
        ${it.resolvedNote ? `<div class="t2">対応内容：${esc(it.resolvedNote)}</div>` : ''}
        ${it.originalJudge ? `<div class="t2">判定を「良」に変更（当初：${JUDGE[it.originalJudge].label}）</div>` : ''}
      </div>` : '';

    return `<div class="rec todo ${done ? 'donerec' : ''}">
      <div class="stat ${JUDGE[j].cls}">${JUDGE[j].label[0]}</div>
      <div class="body">
        <div class="t1">${esc(it.name)}${it.value ? `　<span class="t2">${esc(it.value)}${esc(it.unit || '')}</span>` : ''}</div>
        <div class="t2">${Util.fmtDate(r.date)}　${esc(siteLabel(r))}　${esc(r.machineName)}${r.unit ? ' ' + esc(r.unit) : ''}</div>
        ${it.note ? `<div class="t2">所見：${esc(it.note)}</div>` : ''}
        ${doneInfo}
        ${thumbs.length ? `<div class="photos">${thumbs.join('')}</div>` : ''}
        <div class="todobtns">
          ${done
        ? `<button class="btn ghost sm" data-undo="${r.id}" data-i="${idx}">未対応に戻す</button>`
        : `<button class="btn primary sm" data-done="${r.id}" data-i="${idx}">対応完了</button>`}
          <button class="btn ghost sm" data-share="${r.id}">共有</button>
          <button class="btn ghost sm" data-open="${r.id}">記録を開く</button>
        </div>
      </div>
    </div>`;
  }).join('');

  bindPhotoStrips('#todoList');
  $$('#todoList [data-done]').forEach(b =>
    b.addEventListener('click', () => openDoneDialog(b.dataset.done, +b.dataset.i)));
  $$('#todoList [data-undo]').forEach(b =>
    b.addEventListener('click', () => unresolveItem(b.dataset.undo, +b.dataset.i)));
  $$('#todoList [data-share]').forEach(b =>
    b.addEventListener('click', () => shareRecord(b.dataset.share)));
  $$('#todoList [data-open]').forEach(b => b.addEventListener('click', () => {
    const r = Store.get(b.dataset.open);
    $('#inpDate').value = r.date;
    const sid = r.siteId || Store.siteIdByName(r.site);
    if (sid) $('#inpSite').value = sid;
    openForm(r.machineId, r.id);
  }));
  updateTodoBadge();
}

/* ---- 対応完了の記録 ---- */
let doneTarget = null;      // { rid, idx }
let donePhoto = '';         // 対応後の写真（DataURL）

function openDoneDialog(rid, idx) {
  const rec = Store.get(rid);
  if (!rec || !rec.items[idx]) return;
  const it = rec.items[idx];
  doneTarget = { rid, idx };
  donePhoto = '';
  $('#doneTarget').textContent =
    `${rec.machineName}${rec.unit ? ' ' + rec.unit : ''}　${it.name}（${JUDGE[it.judge].label}）`;
  $('#doneDate').value = Util.today();
  $('#donePerson').value = $('#inpInspector').value.trim() || Store.settings().inspector || '';
  $('#doneCause').value = it.resolvedCause || '';
  $('#doneNote').value = it.resolvedNote || '';
  renderDonePhoto();
  $('#doneDialog').classList.remove('hidden');
}
function closeDoneDialog() {
  $('#doneDialog').classList.add('hidden');
  doneTarget = null;
  donePhoto = '';
}
function renderDonePhoto() {
  $('#donePhotoThumb').innerHTML = donePhoto
    ? `<div class="thumb"><img src="${donePhoto}" alt="対応後の写真"><button id="doneDelPhoto">×</button></div>` : '';
  if (donePhoto) $('#doneDelPhoto').addEventListener('click', () => { donePhoto = ''; renderDonePhoto(); });
}
async function pickDonePhoto() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.onchange = async () => {
    if (!inp.files || !inp.files[0]) return;
    busy(true, '画像を処理中…');
    try {
      donePhoto = await Util.compressImage(inp.files[0]);
      renderDonePhoto();
    } catch (e) {
      toast('画像を読み込めませんでした', true);
    } finally {
      busy(false);
    }
  };
  inp.click();
}

/* 入力内容を記録に反映する。スプレッドシートへ送るため未送信に戻す */
function submitDone() {
  if (!doneTarget) return;
  const rec = Store.get(doneTarget.rid);
  const it = rec.items[doneTarget.idx];
  const cause = $('#doneCause').value.trim();
  const note = $('#doneNote').value.trim();
  if (!note && !confirm('対応内容が未記入です。このまま記録しますか？')) return;

  it.resolved = true;
  it.resolvedAt = $('#doneDate').value || Util.today();
  it.resolvedBy = $('#donePerson').value.trim();
  it.resolvedCause = cause;
  it.resolvedNote = note;
  if (donePhoto) { it.resolvedPhoto = donePhoto; it.resolvedPhotoUrl = ''; it.resolvedPhotoId = ''; }

  // 対応完了時は自動的に「良」へ変更する。
  // 未対応へ戻した際に復元できるよう、変更前の判定を必ず保存する。
  if (!it.originalJudge) it.originalJudge = it.judge;
  it.judge = 'OK';
  rec.status = Util.statusOf(rec);                        // 総合判定を再計算

  rec.synced = false;
  Store.upsert(rec);
  closeDoneDialog();
  updatePendingBadge();
  updateTodoBadge();
  renderTodo();
  toast('対応完了として記録しました');
  if (Store.settings().autoSync && Store.settings().gasUrl && navigator.onLine) syncNow(false);
}

/* 未対応に戻す（判定を良に変えていた場合は元の判定に戻す） */
function unresolveItem(rid, idx) {
  const rec = Store.get(rid);
  if (!rec || !rec.items[idx]) return;
  const it = rec.items[idx];
  if (!confirm(`「${it.name}」を未対応に戻します。\n（対応内容の記録も削除されます）\n\nよろしいですか？`)) return;
  if (it.originalJudge) { it.judge = it.originalJudge; it.originalJudge = ''; }
  it.resolved = false;
  it.resolvedAt = '';
  it.resolvedBy = '';
  it.resolvedCause = '';
  it.resolvedNote = '';
  it.resolvedPhoto = '';
  it.resolvedPhotoUrl = '';
  it.resolvedPhotoId = '';
  rec.status = Util.statusOf(rec);
  rec.synced = false;
  Store.upsert(rec);
  updatePendingBadge();
  updateTodoBadge();
  renderTodo();
  toast('未対応に戻しました');
  if (Store.settings().autoSync && Store.settings().gasUrl && navigator.onLine) syncNow(false);
}

/* ---------------- 履歴 ---------------- */
function filteredRecords() {
  const ym = $('#hisMonth').value, siteId = $('#hisSite').value, st = $('#hisStatus').value;
  return Store.records()
    .filter(r => (!ym || Util.ym(r.date) === ym) && (!siteId || sameSite(r, siteId)) && (!st || r.status === st))
    .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
}
function renderHistory() {
  const list = filteredRecords();
  if (!list.length) {
    $('#historyList').innerHTML = '<p class="empty">該当する点検記録がありません</p>';
    return;
  }
  $('#historyList').innerHTML = list.map(r => {
    const ng = (r.items || []).filter(i => i.judge === 'NG' || i.judge === 'CAUTION');
    const issue = ng.length
      ? `<div class="t3">要対応：${ng.map(i => esc(i.name) + (i.judge === 'NG' ? '(不良)' : '(注意)')).join('、')}</div>` : '';
    return `<div class="rec" data-rid="${r.id}">
      <div class="stat ${JUDGE[r.status].cls}">${JUDGE[r.status].label[0]}</div>
      <div class="body">
        <div class="t1">${esc(r.machineName)}${r.unit ? ' ' + esc(r.unit) : ''}</div>
        <div class="t2">${Util.fmtDate(r.date)}　${esc(siteLabel(r))}　${esc(r.inspector || '')}</div>
        ${issue}
        ${r.note ? `<div class="t2">備考：${esc(r.note)}</div>` : ''}
        ${photoStrip(r)}
      </div>
      <div class="side">
        <div class="sync ${r.synced ? '' : 'pend'}">${r.synced ? '送信済' : '未送信'}</div>
        <button class="sharebtn" data-share="${r.id}" aria-label="共有">共有</button>
      </div>
    </div>`;
  }).join('');
  bindPhotoStrips('#historyList');
  $$('#historyList [data-share]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    shareRecord(b.dataset.share);
  }));
  $$('#historyList .rec').forEach(el => el.addEventListener('click', () => {
    const r = Store.get(el.dataset.rid);
    $('#inpDate').value = r.date;
    const sid = r.siteId || Store.siteIdByName(r.site);
    if (sid) $('#inpSite').value = sid;
    openForm(r.machineId, r.id);
  }));
}

function exportCsv() {
  const list = filteredRecords();
  if (!list.length) return toast('出力するデータがありません', true);
  const head = ['点検日', '点検場所', '点検機械', '号機', '点検者', '点検項目', '判定', '測定値', '単位',
    '項目所見', '備考', '総合判定', '登録日時', '対応状況', '対応日', '対応者', '原因', '対応内容', '当初判定',
    '投入機番号', 'P番号', '洗剤・助剤名'];
  const rows = [head];
  list.forEach(r => {
    const base = [r.date, siteLabel(r), r.machineName, r.unit || '', r.inspector || ''];
    if (!r.items || !r.items.length) {
      rows.push(base.concat(['（その他）', '', '', '', '', r.note || '', JUDGE[r.status].label, r.createdAt || '', '', '', '', '', '', '', '', '']));
    } else {
      r.items.forEach(it => {
        const needs = it.judge === 'NG' || it.judge === 'CAUTION' || it.resolved;
        rows.push(base.concat([
          it.name, it.judge ? JUDGE[it.judge].label : '未判定', it.value || '', it.unit || '',
          it.note || '', r.note || '', JUDGE[r.status].label, r.createdAt || '',
          it.resolved ? '完了' : (needs ? '未対応' : ''),
          it.resolvedAt || '', it.resolvedBy || '', it.resolvedCause || '', it.resolvedNote || '',
          it.originalJudge ? JUDGE[it.originalJudge].label : '',
          it.dosingMachine || '', it.dosingPort || '', it.chemical || ''
        ]));
      });
    }
  });
  const csv = '﻿' + rows.map(r => r.map(Util.csvEscape).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv' }), `点検記録_${$('#hisMonth').value || 'all'}.csv`);
  toast('CSVを書き出しました');
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------------- 進捗ダッシュボード ---------------- */
function renderDash() {
  const ym = $('#dashMonth').value;
  const recs = Store.records().filter(r => !ym || Util.ym(r.date) === ym);
  const targets = Store.targets();
  const sites = Store.sites();

  // 進捗は、その工場・機械に属する全記録の全点検項目が「良」の場合だけ完了とする。
  // 不良・要注意・対象外・未判定が1つでもあれば「未」のまま。
  const totalTargets = sites.reduce((n, s) => n + (targets[s.id] || []).length, 0);
  const recsByKey = {};
  recs.forEach(r => {
    const key = (r.siteId || Store.siteIdByName(r.site)) + '|' + r.machineId;
    (recsByKey[key] = recsByKey[key] || []).push(r);
  });
  const doneKeys = new Set(Object.keys(recsByKey).filter(key => {
    const group = recsByKey[key];
    return group.length > 0 && group.every(r =>
      Array.isArray(r.items) && r.items.length > 0 && r.items.every(i => i.judge === 'OK'));
  }));
  const doneTargets = sites.reduce((n, s) =>
    n + (targets[s.id] || []).filter(mid => doneKeys.has(s.id + '|' + mid)).length, 0);
  const pct = totalTargets ? Math.round(doneTargets / totalTargets * 100) : 0;
  // 要対応リストは未対応のみ表示（対応完了したものは除く）
  const ngItems = recs.flatMap(r => (r.items || []).filter(i => i.judge === 'NG' && !i.resolved).map(i => ({ r, i })));
  const caItems = recs.flatMap(r => (r.items || []).filter(i => i.judge === 'CAUTION' && !i.resolved).map(i => ({ r, i })));

  $('#dashStats').innerHTML = `
    <div class="stat-card"><div class="n">${pct}<small style="font-size:14px">%</small></div><div class="l">点検実施率</div></div>
    <div class="stat-card okc"><div class="n">${doneTargets}/${totalTargets}</div><div class="l">完了項目 / 対象項目</div></div>
    <div class="stat-card ngc"><div class="n">${ngItems.length}</div><div class="l">未対応の不良</div></div>
    <div class="stat-card cac"><div class="n">${caItems.length}</div><div class="l">未対応の要注意</div></div>`;

  // 工場別
  $('#dashSites').innerHTML = sites.map(s => {
    const tg = targets[s.id] || [];
    const d = tg.filter(mid => doneKeys.has(s.id + '|' + mid)).length;
    const p = tg.length ? Math.round(d / tg.length * 100) : 0;
    return `<div class="siterow">
      <div class="top">${esc(s.name)}<span>${d} / ${tg.length} 項目　${p}%</span></div>
      <div class="bar"><i style="width:${p}%"></i></div>
    </div>`;
  }).join('');

  // マトリクス
  const head = '<thead><tr><th>機械 \\ 場所</th>' +
    sites.map(s => `<th>${esc(s.name.replace(/工場$/, ''))}</th>`).join('') + '</tr></thead>';
  const body = Store.countedMachines().map(m => {
    const tds = sites.map(s => {
      const isTarget = (targets[s.id] || []).includes(m.id);
      if (!isTarget) return '<td class="off">－</td>';
      const key = s.id + '|' + m.id;
      const rs = recsByKey[key] || [];
      if (!rs.length) return '<td class="none">・</td>';
      if (doneKeys.has(key)) return '<td class="ok">〇</td>';
      const st = worstStatus(rs);
      const mark = st === 'NG' ? '×' : (st === 'CAUTION' ? '△' : '未');
      return `<td class="${JUDGE[st].cls}">${mark}</td>`;
    }).join('');
    return `<tr><th>${m.name}</th>${tds}</tr>`;
  }).join('');
  $('#dashMatrix').innerHTML = head + '<tbody>' + body + '</tbody>';

  // 要対応リスト
  const issues = ngItems.concat(caItems);
  $('#dashIssues').innerHTML = issues.length ? issues.map(({ r, i }) => {
    const idx = r.items.indexOf(i);
    const photo = Util.hasPhoto(i)
      ? `<div class="photos"><button class="pthumb" data-photo-rid="${r.id}" data-photo-i="${idx}">
           <img src="${Util.photoSrc(i)}" alt="${esc(i.name)}" loading="lazy"></button></div>` : '';
    return `<div class="rec">
      <div class="stat ${JUDGE[i.judge].cls}">${JUDGE[i.judge].label[0]}</div>
      <div class="body">
        <div class="t1">${esc(i.name)}</div>
        <div class="t2">${Util.fmtDate(r.date)}　${esc(siteLabel(r))}　${esc(r.machineName)}${r.unit ? ' ' + esc(r.unit) : ''}</div>
        ${i.note ? `<div class="t2">所見：${esc(i.note)}</div>` : ''}
        ${photo}
      </div>
      <div class="side">
        <button class="sharebtn" data-share="${r.id}" aria-label="共有">共有</button>
      </div>
    </div>`;
  }).join('') : '<p class="empty">不良・要注意はありません</p>';
  bindPhotoStrips('#dashIssues');
  $$('#dashIssues [data-share]').forEach(b => b.addEventListener('click', () => shareRecord(b.dataset.share)));
}

/* 点検場所（工場名）の編集。名称は端末内にのみ保存されます */
function renderSiteEditor() {
  const sites = Store.sites();
  $('#siteEditor').innerHTML = sites.map((s, i) => `
    <div class="siteedit">
      <span class="no">${i + 1}</span>
      <input type="text" value="${esc(s.name)}" data-sid="${s.id}" placeholder="工場名を入力" maxlength="20">
      <button class="delsite" data-del="${s.id}" aria-label="削除" ${sites.length <= 1 ? 'disabled' : ''}>×</button>
    </div>`).join('') +
    `<button id="btnAddSite" class="btn ghost sm" style="width:100%;margin-top:6px">＋ 点検場所を追加</button>`;

  $$('#siteEditor input').forEach(inp => inp.addEventListener('change', () => {
    const list = Store.sites();
    const t = list.find(x => x.id === inp.dataset.sid);
    const name = inp.value.trim();
    if (!name) { inp.value = t.name; return toast('工場名を入力してください', true); }
    t.name = name;
    Store.saveSites(list);
    renderSiteOptions();
    renderTargetEditor();
    renderMachineGrid();
    toast('点検場所を更新しました');
  }));

  $$('#siteEditor .delsite').forEach(b => b.addEventListener('click', () => {
    const list = Store.sites();
    const t = list.find(x => x.id === b.dataset.del);
    const used = Store.records().filter(r => r.siteId === t.id).length;
    if (!confirm(`「${t.name}」を点検場所から削除します。${used ? `\nこの場所の点検記録 ${used} 件は残りますが、進捗集計の対象外になります。` : ''}\nよろしいですか？`)) return;
    Store.saveSites(list.filter(x => x.id !== t.id));
    renderSiteOptions(); renderSiteEditor(); renderTargetEditor(); renderMachineGrid();
    toast('削除しました');
  }));

  $('#btnAddSite').addEventListener('click', () => {
    const list = Store.sites();
    const nextId = 's' + (Math.max(0, ...list.map(x => +String(x.id).replace('s', '') || 0)) + 1);
    list.push({ id: nextId, name: '新しい工場' });
    Store.saveSites(list);
    renderSiteOptions(); renderSiteEditor(); renderTargetEditor();
    toast('点検場所を追加しました。名称を入力してください');
  });
}

/* 点検対象設定（場所ごとに設置されている機械） */
function renderTargetEditor() {
  const tg = Store.targets();
  $('#targetEditor').innerHTML = Store.sites().map(site => {
    const on = tg[site.id] || [];
    const list = Store.countedMachines().map(m =>
      `<label><input type="checkbox" data-site="${site.id}" value="${m.id}" ${on.includes(m.id) ? 'checked' : ''}>${esc(m.name)}</label>`
    ).join('');
    return `<details class="tgt"><summary>${esc(site.name)}（${on.length}項目）</summary><div class="list">${list}</div></details>`;
  }).join('');

  $$('#targetEditor input').forEach(cb => cb.addEventListener('change', () => {
    const t = Store.targets();
    const sid = cb.dataset.site;
    const set = new Set(t[sid] || []);
    cb.checked ? set.add(cb.value) : set.delete(cb.value);
    t[sid] = Store.countedMachines().filter(m => set.has(m.id)).map(m => m.id);
    Store.saveTargets(t);
    cb.closest('details').querySelector('summary').textContent = `${Store.siteName(sid)}（${t[sid].length}項目）`;
  }));
}

/* ---------------- 点検機械・点検項目の編集 ---------------- */
let openMachineId = null;   // 開いている機械（再描画時に開いたままにする）

function renderMaster() {
  const list = Store.machines();
  $('#masterEditor').innerHTML = list.map((m, mi) => {
    const items = (m.items || []).map((it, ii) => `
      <div class="mrow">
        <span class="mno">${ii + 1}</span>
        <input type="text" class="mname" value="${esc(it.name)}" placeholder="点検項目名"
               data-mid="${m.id}" data-ii="${ii}" data-f="name">
        <select class="mtype" data-mid="${m.id}" data-ii="${ii}" data-f="type">
          <option value="judge" ${it.type !== 'num' ? 'selected' : ''}>判定のみ</option>
          <option value="num" ${it.type === 'num' ? 'selected' : ''}>数値+判定</option>
        </select>
        <input type="text" class="munit ${it.type === 'num' ? '' : 'hidden'}" value="${esc(it.unit || '')}"
               placeholder="単位" data-mid="${m.id}" data-ii="${ii}" data-f="unit">
        <button class="miconbtn" data-move-item="${m.id}" data-ii="${ii}" data-dir="-1" ${ii === 0 ? 'disabled' : ''}>↑</button>
        <button class="miconbtn" data-move-item="${m.id}" data-ii="${ii}" data-dir="1" ${ii === (m.items.length - 1) ? 'disabled' : ''}>↓</button>
        <button class="miconbtn del" data-del-item="${m.id}" data-ii="${ii}">×</button>
      </div>`).join('');

    return `<details class="mcardedit" ${openMachineId === m.id ? 'open' : ''} data-machine="${m.id}">
      <summary><span class="mico">${m.icon || '🔧'}</span>${esc(m.name)}
        <span class="mcount">${(m.items || []).length ? (m.items.length + '項目') : '備考のみ'}</span></summary>
      <div class="mbody">
        <div class="mhead">
          <input type="text" class="micon" value="${esc(m.icon || '')}" maxlength="2" placeholder="🔧"
                 data-mid="${m.id}" data-f="icon" aria-label="アイコン">
          <input type="text" value="${esc(m.name)}" placeholder="点検機械名"
                 data-mid="${m.id}" data-f="mname" aria-label="機械名">
          <button class="miconbtn" data-move-machine="${m.id}" data-dir="-1" ${mi === 0 ? 'disabled' : ''}>↑</button>
          <button class="miconbtn" data-move-machine="${m.id}" data-dir="1" ${mi === list.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
        <div class="mitems">${items || '<p class="hint" style="margin:6px 2px">点検項目がありません（備考欄のみの機械として扱われます）</p>'}</div>
        <div class="mfoot">
          <button class="btn ghost sm" data-add-item="${m.id}">＋ 点検項目を追加</button>
          <button class="btn ghost sm danger" data-del-machine="${m.id}">この機械を削除</button>
        </div>
      </div>
    </details>`;
  }).join('');

  // 開閉状態を覚えておく
  $$('#masterEditor details').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) openMachineId = d.dataset.machine;
    else if (openMachineId === d.dataset.machine) openMachineId = null;
  }));

  // 機械名・アイコンの変更
  $$('#masterEditor [data-f="mname"], #masterEditor [data-f="icon"]').forEach(inp =>
    inp.addEventListener('change', () => {
      const list = Store.machines();
      const m = list.find(x => x.id === inp.dataset.mid);
      const v = inp.value.trim();
      if (inp.dataset.f === 'mname') {
        if (!v) { inp.value = m.name; return toast('機械名を入力してください', true); }
        m.name = v;
      } else {
        m.icon = v || '🔧';
      }
      Store.saveMachines(list);
      renderMaster();
      toast('保存しました');
    }));

  // 点検項目の変更
  $$('#masterEditor .mrow input, #masterEditor .mrow select').forEach(el =>
    el.addEventListener('change', () => {
      const list = Store.machines();
      const m = list.find(x => x.id === el.dataset.mid);
      const it = m.items[+el.dataset.ii];
      const f = el.dataset.f;
      if (f === 'name') {
        const v = el.value.trim();
        if (!v) { el.value = it.name; return toast('点検項目名を入力してください', true); }
        it.name = v;
      } else if (f === 'type') {
        it.type = el.value;
        if (it.type !== 'num') { it.unit = ''; }
      } else {
        it.unit = el.value.trim();
      }
      Store.saveMachines(list);
      renderMaster();
    }));

  $$('#masterEditor [data-add-item]').forEach(b => b.addEventListener('click', () => {
    const list = Store.machines();
    const m = list.find(x => x.id === b.dataset.addItem);
    const wasFree = Store.isFree(m);
    m.items = m.items || [];
    m.items.push({ name: '新しい点検項目', type: 'judge', unit: '' });
    Store.saveMachines(list);
    if (wasFree) Store.addTargetToAllSites(m.id);   // 備考のみ→通常の機械になったら集計対象に加える
    openMachineId = m.id;
    renderMaster();
  }));

  $$('#masterEditor [data-del-item]').forEach(b => b.addEventListener('click', () => {
    const list = Store.machines();
    const m = list.find(x => x.id === b.dataset.delItem);
    const it = m.items[+b.dataset.ii];
    if (!confirm(`点検項目「${it.name}」を削除します。よろしいですか？\n（過去の点検記録は残ります）`)) return;
    m.items.splice(+b.dataset.ii, 1);
    Store.saveMachines(list);
    openMachineId = m.id;
    renderMaster();
    toast('削除しました');
  }));

  $$('#masterEditor [data-move-item]').forEach(b => b.addEventListener('click', () => {
    const list = Store.machines();
    const m = list.find(x => x.id === b.dataset.moveItem);
    move(m.items, +b.dataset.ii, +b.dataset.dir);
    Store.saveMachines(list);
    openMachineId = m.id;
    renderMaster();
  }));

  $$('#masterEditor [data-move-machine]').forEach(b => b.addEventListener('click', () => {
    const list = Store.machines();
    const i = list.findIndex(x => x.id === b.dataset.moveMachine);
    move(list, i, +b.dataset.dir);
    Store.saveMachines(list);
    openMachineId = b.dataset.moveMachine;
    renderMaster();
  }));

  $$('#masterEditor [data-del-machine]').forEach(b => b.addEventListener('click', () => {
    const list = Store.machines();
    const m = list.find(x => x.id === b.dataset.delMachine);
    if (list.length <= 1) return toast('点検機械は1つ以上必要です', true);
    const used = Store.records().filter(r => r.machineId === m.id).length;
    if (!confirm(`点検機械「${m.name}」を削除します。${used ? `\nこの機械の点検記録 ${used} 件は残りますが、進捗集計の対象外になります。` : ''}\nよろしいですか？`)) return;
    Store.saveMachines(list.filter(x => x.id !== m.id));
    const t = Store.targets();
    Object.keys(t).forEach(sid => { t[sid] = t[sid].filter(id => id !== m.id); });
    Store.saveTargets(t);
    openMachineId = null;
    renderMaster();
    toast('削除しました');
  }));
}

function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
}

function addMachine() {
  const name = prompt('追加する点検機械の名称を入力してください', '');
  if (name === null) return;
  if (!name.trim()) return toast('機械名を入力してください', true);
  const list = Store.machines();
  const id = Store.newMachineId();
  list.push({ id, name: name.trim(), icon: '🔧', items: [{ name: '新しい点検項目', type: 'judge', unit: '' }] });
  Store.saveMachines(list);
  Store.addTargetToAllSites(id);
  openMachineId = id;
  renderMaster();
  toast('追加しました。点検項目を入力してください');
}

function resetMachines() {
  if (!confirm('点検機械と点検項目を初期状態（22機種）に戻します。\n追加・変更した内容は失われます。\n（過去の点検記録は残ります）\n\nよろしいですか？')) return;
  Store.resetMachines();
  openMachineId = null;
  renderMaster();
  toast('初期状態に戻しました');
}

/* ---------------- 設定 ---------------- */
function renderSettings() {
  const s = Store.settings();
  $('#setGas').value = s.gasUrl || '';
  $('#setInspector').value = s.inspector || '';
  $('#setAutoSync').checked = !!s.autoSync;

  renderSiteEditor();
  renderTargetEditor();

  const all = Store.records();
  $('#dataInfo').textContent =
    `端末内 ${all.length} 件（未送信 ${all.filter(r => !r.synced).length} 件）　最終取得：${s.lastPull ? new Date(s.lastPull).toLocaleString('ja-JP') : '未実施'}`;
}

function saveSettings() {
  const url = $('#setGas').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) {
    if (!confirm('GASのウェブアプリURL形式ではないようです。このまま保存しますか？')) return;
  }
  Store.saveSettings({
    gasUrl: url,
    inspector: $('#setInspector').value.trim(),
    autoSync: $('#setAutoSync').checked
  });
  $('#inpInspector').value = $('#setInspector').value.trim();
  toast('設定を保存しました');
}

async function testConnection() {
  const url = $('#setGas').value.trim();
  if (!url) return toast('URLを入力してください', true);
  busy(true, '接続確認中…');
  try {
    const res = await fetch(url + '?action=ping');
    const j = await res.json();
    toast(j.ok ? `接続OK：${j.sheetName || 'スプレッドシート'}` : '接続失敗', !j.ok);
  } catch (e) {
    toast('接続失敗：URLとデプロイ設定（全員がアクセス可）を確認してください', true);
  } finally {
    busy(false);
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings: Store.settings(),
    sites: Store.sites(),
    targets: Store.targets(),
    records: Store.records()
  }, null, 2)], { type: 'application/json' });
  download(blob, `点検データバックアップ_${Util.today()}.json`);
}

function clearSynced() {
  const keep = Store.records().filter(r => !r.synced);
  const del = Store.records().length - keep.length;
  if (!del) return toast('同期済みデータはありません');
  if (!confirm(`送信済み ${del} 件を端末から削除します（シート側には残ります）。よろしいですか？`)) return;
  Store.writeAll(keep);
  renderSettings();
  toast(`${del} 件を削除しました`);
}

document.addEventListener('DOMContentLoaded', init);
