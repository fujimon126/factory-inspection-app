/* =========================================================
   工場点検アプリ  修理タブ
   点検と同じ流れ（実施日・場所・担当者 → 機械を選ぶ → 内容を入力）で修理を記録する。
   1件＝1回の修理。スプレッドシートでは「修理記録」シートの1行になる。
   ========================================================= */
const REPAIR_STATUS = {
  DONE: { label: '完了', cls: 'ok' },
  WATCH: { label: '経過観察', cls: 'caution' },
  OPEN: { label: '未完了', cls: 'ng' }
};
let repEditing = null;   // 編集中の修理記録

function initRepair() {
  $('#repDate').value = Util.today();
  const st = Store.settings();
  $('#repPerson').value = st.repairer || st.inspector || '';
  const last = localStorage.getItem('fi_lastRepSite') || localStorage.getItem('fi_lastSite');
  if (last && Store.sites().some(s => s.id === last)) $('#repSite').value = last;

  on('#repDate', 'change', renderRepair);
  on('#repSite', 'change', () => {
    localStorage.setItem('fi_lastRepSite', $('#repSite').value);
    renderRepair();
  });
  on('#repPerson', 'change', () => Store.saveSettings({ repairer: $('#repPerson').value.trim() }));
  onAll('#rfStatus .jbtn', 'click', function () { setRepairStatus(this.dataset.rs); });
  on('#rfPhotoBtn', 'click', pickRepairPhoto);
  on('#rfSave', 'click', saveRepair);
  on('#rfDelete', 'click', deleteRepair);
}

/* 選択中の修理実施日が属する月・場所の修理記録（新しい順） */
function monthRepairs(siteId, mid) {
  const ym = Util.ym($('#repDate').value);
  return Store.repairs()
    .filter(r => Util.ym(r.date) === ym && sameSite(r, siteId) && (!mid || r.machineId === mid))
    .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
}
/* 複数件あるときは「未完了＞経過観察＞完了」の順に目立つ状態を表示する */
function worstRepairStatus(reps) {
  const all = reps.map(r => r.status);
  return ['OPEN', 'WATCH', 'DONE'].find(s => all.includes(s)) || '';
}
function repairLabel(r) {
  return REPAIR_STATUS[r.status] ? REPAIR_STATUS[r.status].label : '状態未設定';
}

function renderRepair() {
  const siteId = $('#repSite').value;
  const reps = monthRepairs(siteId);
  const [y, mo] = Util.ym($('#repDate').value).split('-');
  $('#repHint').textContent = `${y}年${+mo}月　${siteName(siteId)}　今月の修理 ${reps.length} 件`;

  $('#repMachineGrid').innerHTML = Store.machines().map((m, i) => {
    const mine = reps.filter(r => r.machineId === m.id);
    const st = worstRepairStatus(mine);
    const flag = mine.length
      ? `<span class="flag ${st ? REPAIR_STATUS[st].cls : 'na'}">${mine.length > 1 ? mine.length + '件 ' : ''}${st ? REPAIR_STATUS[st].label : '修理'}</span>` : '';
    const last = mine.length ? `<span class="mdate">${shortDate(mine[0].date)} 修理</span>` : '';
    return `<button class="mcard ${mine.length ? 'done' : ''}" data-rmid="${m.id}">
      <span class="num">${i + 1}</span>${flag}
      <span class="ico">${m.icon}</span>${m.name}${last}
    </button>`;
  }).join('');
  $$('#repMachineGrid .mcard').forEach(b => b.addEventListener('click', () => onPickRepairMachine(b.dataset.rmid)));

  renderRepairList(reps);
}

function renderRepairList(reps) {
  if (!reps.length) {
    $('#repList').innerHTML = '<p class="empty">この月の修理記録はありません</p>';
    return;
  }
  $('#repList').innerHTML = reps.map(r => {
    const st = REPAIR_STATUS[r.status];
    const photos = Util.photosOf(r);
    const thumbs = photos.length ? '<div class="photos">' + photos.map((p, k) =>
      `<button class="pthumb" data-rep-photo="${r.id}" data-k="${k}" title="修理写真${k + 1}">
        <img src="${Util.photoSrc(p)}" alt="修理写真${k + 1}" loading="lazy"></button>`).join('') + '</div>' : '';
    return `<div class="rec" data-repid="${r.id}">
      <div class="stat ${st ? st.cls : 'na'}">${st ? st.label[0] : '－'}</div>
      <div class="body">
        <div class="t1">${esc(r.machineName)}${r.unit ? ' ' + esc(r.unit) : ''}${r.part ? '／' + esc(r.part) : ''}</div>
        <div class="t2">${Util.fmtDate(r.date)}　${esc(siteLabel(r))}　${esc(r.repairer || '')}　${repairLabel(r)}</div>
        ${r.symptom ? `<div class="t2">症状：${esc(r.symptom)}</div>` : ''}
        <div class="t2">修理：${esc(r.work || '')}</div>
        ${thumbs}
      </div>
      <div class="side">
        ${isViewer() ? '' : `<div class="sync ${r.synced ? '' : 'pend'}">${r.synced ? '送信済' : '未送信'}</div>`}
        <button class="sharebtn" data-rep-share="${r.id}" aria-label="共有">共有</button>
      </div>
    </div>`;
  }).join('');

  $$('#repList [data-rep-photo]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    openRepairPhoto(b.dataset.repPhoto, +b.dataset.k);
  }));
  $$('#repList [data-rep-share]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    shareRepair(b.dataset.repShare);
  }));
  $$('#repList .rec').forEach(el => el.addEventListener('click', () => {
    const r = Store.getRepair(el.dataset.repid);
    if (r) openRepairForm(r.machineId, r.id);
  }));
}

/* 機械を選んだとき：今月の修理があれば「編集」か「新規」を選ぶ（点検と同じ操作） */
function onPickRepairMachine(mid) {
  const exist = monthRepairs($('#repSite').value, mid);
  const names = exist.map((r, i) =>
    `${i + 1}. ${shortDate(r.date)} ${r.part || r.unit || ''}／${repairLabel(r)}`).join('\n');
  if (isViewer()) {
    if (!exist.length) return toast('この機械の今月の修理記録はありません');
    if (exist.length === 1) return openRepairForm(mid, exist[0].id);
    const k = parseInt(prompt(`見る記録の番号を入力してください\n${names}`, '1'), 10) - 1;
    if (exist[k]) openRepairForm(mid, exist[k].id);
    return;
  }
  if (!exist.length) return openRepairForm(mid, null);
  const ans = prompt(
    `${Store.machineById(mid).name} は今月すでに修理の記録があります。\n${names}\n\n編集する番号を入力（新しい修理を追加は「n」）`,
    'n'
  );
  if (ans === null) return;
  if (ans.trim().toLowerCase() === 'n') return openRepairForm(mid, null);
  const idx = parseInt(ans, 10) - 1;
  if (exist[idx]) openRepairForm(mid, exist[idx].id);
}

function openRepairForm(mid, id) {
  if (isViewer() && !id) return;   // 閲覧モードでは新しい修理は作らない
  let m = Store.machineById(mid);
  const src = id ? Store.getRepair(id) : null;
  // 機械が削除・未登録でも、記録があれば内容だけで表示する
  if (!m && src) m = { id: mid, name: src.machineName || '修理記録', icon: '🔧', items: [] };
  if (!m) return toast('この機械は削除されています', true);

  if (src) {
    repEditing = JSON.parse(JSON.stringify(src));
  } else {
    const siteId = $('#repSite').value;
    repEditing = {
      id: Util.uuid(),
      date: $('#repDate').value || Util.today(),
      siteId,
      site: siteName(siteId),
      repairer: $('#repPerson').value.trim(),
      machineId: mid,
      machineName: m.name,
      unit: '', part: '', symptom: '', cause: '', work: '', parts: '',
      status: 'DONE',
      photos: [],
      note: '',
      createdAt: new Date().toISOString(),
      synced: false
    };
  }
  const r = repEditing;
  $('#rfHead').innerHTML = `${m.icon} ${esc(m.name)}<small>${Util.fmtDate(r.date)}　${esc(siteLabel(r))}　修理者：${esc(r.repairer || '－')}</small>`;
  const sid = r.siteId || Store.siteIdByName(r.site);
  if (sid) $('#rfSite').value = sid;
  $('#rfDate').value = r.date || '';
  $('#rfPerson').value = r.repairer || '';
  $('#rfUnit').value = r.unit || '';
  $('#rfPart').value = r.part || '';
  $('#rfSymptom').value = r.symptom || '';
  $('#rfCause').value = r.cause || '';
  $('#rfWork').value = r.work || '';
  $('#rfParts').value = r.parts || '';
  $('#rfNote').value = r.note || '';
  // 修理箇所の候補：その機械の点検項目（「点検済み」は除く）
  $('#rfPartList').innerHTML = (m.items || []).filter(it => !it.isCompletion)
    .map(it => `<option value="${esc(it.name)}"></option>`).join('');
  $('#rfDelete').classList.toggle('hidden', !id);
  renderRepairExtras();
  $$('#view-rform input, #view-rform select, #view-rform textarea').forEach(el => { el.disabled = isViewer(); });
  show('rform');
}

function renderRepairExtras() {
  $$('#rfStatus .jbtn').forEach(b => b.setAttribute('aria-pressed', b.dataset.rs === repEditing.status));
  const photos = Util.photosOf(repEditing);
  $('#rfPhotoThumb').innerHTML = editThumbs(photos, 'data-rpdel');
  $$('#rfPhotoThumb [data-rpdel]').forEach(b => b.addEventListener('click', () => {
    if (viewerBlocked()) return;
    const list = Util.photosOf(repEditing);
    list.splice(+b.dataset.rpdel, 1);
    Util.setPhotos(repEditing, list);
    renderRepairExtras();
  }));
  $('#rfPhotoBtn').textContent = photos.length ? `📷 写真を追加（${photos.length}枚）` : '📷 写真を撮影・選択';
}
function setRepairStatus(s) {
  if (viewerBlocked()) return;
  repEditing.status = s;
  renderRepairExtras();
}
function pickRepairPhoto() {
  if (viewerBlocked()) return;
  pickImages(urls => {
    Util.setPhotos(repEditing, Util.photosOf(repEditing).concat(urls.map(u => ({ photo: u, photoUrl: '', photoId: '' }))));
    renderRepairExtras();
  });
}

function saveRepair() {
  if (viewerBlocked()) return;
  const r = repEditing;
  r.work = $('#rfWork').value.trim();
  if (!r.work) {
    $('#rfWork').focus();
    return toast('修理内容を入力してください', true);
  }
  if (!r.status) return toast('状態（完了・経過観察・未完了）を選んでください', true);
  r.repairer = $('#rfPerson').value.trim();
  r.unit = $('#rfUnit').value.trim();
  r.part = $('#rfPart').value.trim();
  r.symptom = $('#rfSymptom').value.trim();
  r.cause = $('#rfCause').value.trim();
  r.parts = $('#rfParts').value.trim();
  r.note = $('#rfNote').value.trim();
  if ($('#rfDate').value) r.date = $('#rfDate').value;
  if ($('#rfSite').value) r.siteId = $('#rfSite').value;
  r.site = siteName(r.siteId) || r.site;
  r.synced = false;
  try {
    Store.upsertRepair(r);
  } catch (e) {
    return toast('端末の保存容量が足りません。⇅ボタンで未送信の記録を送信してから、もう一度保存してください', true);
  }
  if (r.repairer) Store.saveSettings({ repairer: r.repairer });
  // 保存した修理の月・場所が一覧に表示されるようにする
  $('#repDate').value = r.date;
  if (r.siteId) $('#repSite').value = r.siteId;
  updatePendingBadge();
  toast('修理記録を保存しました');
  show('repair');
  if (Store.settings().autoSync && Store.settings().gasUrl && navigator.onLine) syncNow(false);
}

async function deleteRepair() {
  if (viewerBlocked()) return;
  const r = Store.getRepair(repEditing.id);
  if (!r) return show('repair');
  const remote = r.synced && Store.settings().gasUrl;
  if (!confirm('この修理記録を削除します。' + (remote ? 'スプレッドシートからも削除されます。' : '') + '\nよろしいですか？')) return;
  if (remote) {
    if (!navigator.onLine) return toast('送信済みの記録の削除には通信が必要です', true);
    busy(true, '削除中…');
    try {
      await Store.deleteRepairRemote(r.id);
    } catch (e) {
      return toast('削除に失敗：' + e.message, true);
    } finally {
      busy(false);
    }
  }
  Store.removeRepair(r.id);
  updatePendingBadge();
  toast('削除しました');
  show('repair');
}

/* 修理写真の拡大表示（点検写真と同じ表示・共有の仕組みを使う） */
function openRepairPhoto(id, k) {
  const r = Store.getRepair(id);
  if (!r) return;
  const list = Util.photosOf(r);
  const p = list[k || 0];
  if (!p) return;
  lightboxTarget = {
    rec: r,
    it: Object.assign({}, p, {
      name: '修理' + (r.part ? '：' + r.part : '') + (list.length > 1 ? ` ${(k || 0) + 1}/${list.length}` : ''),
      statusLabel: repairLabel(r),
      note: r.work || ''
    })
  };
  $('#lightboxImg').src = Util.photoSrc(p);
  const link = Util.photoLink(p);
  $('#lbOpen').classList.toggle('hidden', !link);
  if (link) $('#lbOpen').href = link;
  $('#lightbox').classList.remove('hidden');
}

/* 修理記録1件を共有する（LINE・メールなど） */
async function shareRepair(id) {
  const r = Store.getRepair(id);
  if (!r) return;
  const lines = [
    `【修理報告】${Util.fmtDate(r.date)}`,
    `${siteLabel(r)}　${r.machineName}${r.unit ? ' ' + r.unit : ''}`,
    `修理者：${r.repairer || '－'}　状態：${repairLabel(r)}`
  ];
  if (r.part) lines.push(`修理箇所：${r.part}`);
  if (r.symptom) lines.push(`症状：${r.symptom}`);
  if (r.cause) lines.push(`原因：${r.cause}`);
  lines.push(`修理内容：${r.work || ''}`);
  if (r.parts) lines.push(`使用部品：${r.parts}`);
  if (r.note) lines.push(`備考：${r.note}`);
  const linkLines = [];
  const files = [];
  Util.photosOf(r).forEach((p, k) => {
    if (Util.photoLink(p)) linkLines.push(`・写真${k + 1}：${Util.photoLink(p)}`);
    else if (p.photo && navigator.canShare) {
      const f = Util.dataUrlToFile(p.photo, `${r.machineName}_修理_${k + 1}.jpg`);
      if (f) files.push(f);
    }
  });
  if (linkLines.length) lines.push('', '■ 写真', ...linkLines);
  const text = lines.join('\n');
  if (files.length && navigator.canShare({ files })) return doShare({ text, files });
  return doShare({ title: '修理報告', text });
}
