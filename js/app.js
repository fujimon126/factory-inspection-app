/* =========================================================
   工場点検アプリ  画面制御
   ========================================================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let currentView = 'inspect';
let editing = null;      // 編集中の点検記録
let toastTimer = null;

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
  ['inspect', 'form', 'history', 'dash', 'settings'].forEach(v => {
    $('#view-' + v).classList.toggle('hidden', v !== view);
  });
  currentView = view;
  const tabOf = view === 'form' ? 'inspect' : view;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === tabOf));
  $('#btnBack').classList.toggle('hidden', view !== 'form');
  $('#appTitle').textContent =
    { inspect: '工場点検', form: '点検項目', history: '点検履歴', dash: '進捗状況', settings: '設定' }[view];
  window.scrollTo(0, 0);
  if (view === 'inspect') renderMachineGrid();
  if (view === 'history') renderHistory();
  if (view === 'dash') renderDash();
  if (view === 'settings') renderSettings();
}

/* 点検場所のプルダウンを設定内容から作り直す（値は場所ID） */
function renderSiteOptions() {
  const sites = Store.sites();
  const cur = $('#inpSite').value, hisCur = $('#hisSite').value;
  const opts = sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('#inpSite').innerHTML = opts;
  $('#hisSite').innerHTML = '<option value="">すべての場所</option>' + opts;
  if (sites.some(s => s.id === cur)) $('#inpSite').value = cur;
  if (hisCur === '' || sites.some(s => s.id === hisCur)) $('#hisSite').value = hisCur;
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
  $('#btnBack').addEventListener('click', () => show('inspect'));
  $('#inpDate').addEventListener('change', renderMachineGrid);
  $('#inpSite').addEventListener('change', () => {
    localStorage.setItem('fi_lastSite', $('#inpSite').value);
    renderMachineGrid();
  });
  $('#inpInspector').addEventListener('change', () => Store.saveSettings({ inspector: $('#inpInspector').value.trim() }));
  $('#btnSave').addEventListener('click', saveRecord);
  $('#btnDelete').addEventListener('click', deleteRecord);
  $$('[data-bulk]').forEach(b => b.addEventListener('click', () => bulkSet(b.dataset.bulk)));
  ['#hisMonth', '#hisSite', '#hisStatus'].forEach(s => $(s).addEventListener('change', renderHistory));
  $('#btnCsv').addEventListener('click', exportCsv);
  $('#dashMonth').addEventListener('change', renderDash);
  $('#btnPull').addEventListener('click', pullFromSheet);
  $('#btnSync').addEventListener('click', () => syncNow(true));
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#btnTest').addEventListener('click', testConnection);
  $('#btnExportJson').addEventListener('click', exportJson);
  $('#btnClearSynced').addEventListener('click', clearSynced);

  $('#lbClose').addEventListener('click', closePhoto);
  $('#lbShare').addEventListener('click', sharePhoto);
  $('#lightbox').addEventListener('click', ev => { if (ev.target.id === 'lightbox') closePhoto(); });

  window.addEventListener('online', () => { updateNet(); if (Store.settings().autoSync) syncNow(false); });
  window.addEventListener('offline', updateNet);
  updateNet();
  renderMachineGrid();
  updatePendingBadge();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 未対応環境は無視 */ });
  }
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
    `${Util.fmtDate(date)}　${siteName(siteId)}　本日 ${todays.length} 件登録済 / 対象 ${targets.length} 台`;

  $('#machineGrid').innerHTML = MACHINES.map((m, i) => {
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
    `${MACHINE_BY_ID[mid].name} はこの日すでに登録があります。\n${names}\n\n編集する番号を入力（新規追加は「n」）`,
    '1'
  );
  if (ans === null) return;
  if (ans.toLowerCase() === 'n') return openForm(mid, null);
  const idx = parseInt(ans, 10) - 1;
  if (exist[idx]) openForm(mid, exist[idx].id);
}

/* ---------------- ④ 点検項目フォーム ---------------- */
function openForm(mid, recId) {
  const m = MACHINE_BY_ID[mid];
  if (recId) {
    editing = JSON.parse(JSON.stringify(Store.get(recId)));
  } else {
    editing = {
      id: Util.uuid(),
      date: $('#inpDate').value,
      siteId: $('#inpSite').value,
      site: siteName($('#inpSite').value),
      inspector: $('#inpInspector').value.trim(),
      machineId: mid,
      machineName: m.name,
      unit: '',
      items: m.items.map(it => ({
        name: it.name, type: it.type || 'judge', unit: it.unit || '',
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
  show('form');
}

function renderItems() {
  const m = MACHINE_BY_ID[editing.machineId];
  if (m.freeOnly) {
    $('#itemList').innerHTML =
      `<div class="card"><p class="hint" style="margin:0">「その他」は備考欄に点検内容を記入してください。</p></div>`;
    updateFormProgress();
    return;
  }
  $('#itemList').innerHTML = editing.items.map((it, i) => {
    const jbtns = ['OK', 'CAUTION', 'NG', 'NA'].map(k =>
      `<button class="jbtn ${JUDGE[k].cls}" aria-pressed="${it.judge === k}" data-j="${k}" data-i="${i}">${JUDGE[k].label}</button>`
    ).join('');
    const num = it.type === 'num'
      ? `<div class="numrow">
           <input type="number" inputmode="decimal" step="any" placeholder="測定値" value="${esc(it.value)}" data-num="${i}">
           <span class="unit">${it.unit}</span>
         </div>` : '';
    const photo = Util.hasPhoto(it)
      ? `<div class="thumb"><img src="${Util.photoSrc(it)}" alt="添付写真"><button data-delphoto="${i}">×</button></div>` : '';
    return `<div class="item ${it.judge ? JUDGE[it.judge].cls : ''}" data-item="${i}">
      <div class="iname"><span class="idx">${i + 1}</span>${esc(it.name)}</div>
      <div class="judges">${jbtns}</div>
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
    inp.addEventListener('input', () => { editing.items[+inp.dataset.num].value = inp.value; }));
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
  editing.items.forEach(it => { it.judge = (kind === 'CLEAR' ? '' : kind); });
  renderItems();
}
function updateFormProgress() {
  const total = editing.items.length;
  const done = editing.items.filter(it => it.judge).length;
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
  const m = MACHINE_BY_ID[editing.machineId];

  if (m.freeOnly) {
    if (!editing.note) return toast('備考欄を入力してください', true);
  } else {
    const done = editing.items.filter(it => it.judge).length;
    if (done === 0) return toast('点検項目を判定してください', true);
    if (done < editing.items.length &&
      !confirm(`未判定の項目が ${editing.items.length - done} 件あります。このまま保存しますか？`)) return;
    const ngNoNote = editing.items.some(it => it.judge === 'NG' && !it.note);
    if (ngNoNote && !confirm('「不良」の項目に所見が未記入です。このまま保存しますか？')) return;
  }

  editing.status = m.freeOnly ? 'NA' : Util.statusOf(editing);
  editing.synced = false;
  Store.upsert(editing);
  updatePendingBadge();
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
  if (!n) { if (manual) toast('未送信データはありません'); return; }
  if (manual) busy(true, `送信中… (${n}件)`);
  try {
    const r = await Store.push();
    toast(`スプレッドシートへ ${r.sent} 件送信しました`);
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
    openPhoto(b.dataset.photoRid, +b.dataset.photoI);
  }));
}

let lightboxTarget = null;
function openPhoto(rid, idx) {
  const rec = Store.get(rid);
  if (!rec) return;
  const it = rec.items[idx];
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
  const head = ['点検日', '点検場所', '点検機械', '号機', '点検者', '点検項目', '判定', '測定値', '単位', '項目所見', '備考', '総合判定', '登録日時'];
  const rows = [head];
  list.forEach(r => {
    const base = [r.date, siteLabel(r), r.machineName, r.unit || '', r.inspector || ''];
    if (!r.items || !r.items.length) {
      rows.push(base.concat(['（その他）', '', '', '', '', r.note || '', JUDGE[r.status].label, r.createdAt || '']));
    } else {
      r.items.forEach(it => rows.push(base.concat([
        it.name, it.judge ? JUDGE[it.judge].label : '未判定', it.value || '', it.unit || '',
        it.note || '', r.note || '', JUDGE[r.status].label, r.createdAt || ''
      ])));
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

  // 統計（点検済みの判定は場所ID、シート取込データは工場名で照合）
  const totalTargets = sites.reduce((n, s) => n + (targets[s.id] || []).length, 0);
  const doneKeys = new Set(recs.map(r => (r.siteId || Store.siteIdByName(r.site)) + '|' + r.machineId));
  const doneTargets = sites.reduce((n, s) =>
    n + (targets[s.id] || []).filter(mid => doneKeys.has(s.id + '|' + mid)).length, 0);
  const pct = totalTargets ? Math.round(doneTargets / totalTargets * 100) : 0;
  const ngItems = recs.flatMap(r => (r.items || []).filter(i => i.judge === 'NG').map(i => ({ r, i })));
  const caItems = recs.flatMap(r => (r.items || []).filter(i => i.judge === 'CAUTION').map(i => ({ r, i })));

  $('#dashStats').innerHTML = `
    <div class="stat-card"><div class="n">${pct}<small style="font-size:14px">%</small></div><div class="l">点検実施率</div></div>
    <div class="stat-card okc"><div class="n">${doneTargets}/${totalTargets}</div><div class="l">実施台数 / 対象</div></div>
    <div class="stat-card ngc"><div class="n">${ngItems.length}</div><div class="l">不良項目</div></div>
    <div class="stat-card cac"><div class="n">${caItems.length}</div><div class="l">要注意項目</div></div>`;

  // 工場別
  $('#dashSites').innerHTML = sites.map(s => {
    const tg = targets[s.id] || [];
    const d = tg.filter(mid => doneKeys.has(s.id + '|' + mid)).length;
    const p = tg.length ? Math.round(d / tg.length * 100) : 0;
    return `<div class="siterow">
      <div class="top">${esc(s.name)}<span>${d} / ${tg.length} 台　${p}%</span></div>
      <div class="bar"><i style="width:${p}%"></i></div>
    </div>`;
  }).join('');

  // マトリクス
  const head = '<thead><tr><th>機械 \\ 場所</th>' +
    sites.map(s => `<th>${esc(s.name.replace(/工場$/, ''))}</th>`).join('') + '</tr></thead>';
  const body = MACHINES.filter(m => !m.freeOnly).map(m => {
    const tds = sites.map(s => {
      const isTarget = (targets[s.id] || []).includes(m.id);
      if (!isTarget) return '<td class="off">－</td>';
      const rs = recs.filter(r => sameSite(r, s.id) && r.machineId === m.id);
      if (!rs.length) return '<td class="none">・</td>';
      const st = worstStatus(rs);
      const mark = { OK: '〇', CAUTION: '△', NG: '×', NA: '－' }[st];
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
    const list = MACHINES.filter(m => !m.freeOnly).map(m =>
      `<label><input type="checkbox" data-site="${site.id}" value="${m.id}" ${on.includes(m.id) ? 'checked' : ''}>${m.name}</label>`
    ).join('');
    return `<details class="tgt"><summary>${esc(site.name)}（${on.length}台）</summary><div class="list">${list}</div></details>`;
  }).join('');

  $$('#targetEditor input').forEach(cb => cb.addEventListener('change', () => {
    const t = Store.targets();
    const sid = cb.dataset.site;
    const set = new Set(t[sid] || []);
    cb.checked ? set.add(cb.value) : set.delete(cb.value);
    t[sid] = MACHINES.filter(m => set.has(m.id)).map(m => m.id);
    Store.saveTargets(t);
    cb.closest('details').querySelector('summary').textContent = `${Store.siteName(sid)}（${t[sid].length}台）`;
  }));
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
