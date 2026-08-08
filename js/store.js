/* =========================================================
   データ保存 / 同期（localStorage ＋ Googleスプレッドシート）
   ========================================================= */

const LS_RECORDS = 'fi_records_v1';
const LS_SETTINGS = 'fi_settings_v1';
const LS_TARGETS = 'fi_targets_v1';
const LS_SITES = 'fi_sites_v1';
const LS_MACHINES = 'fi_machines_v1';

const Store = {
  /* ---------- 設定 ---------- */
  settings() {
    const def = { gasUrl: '', inspector: '', autoSync: true, lastPull: '' };
    try {
      return Object.assign(def, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'));
    } catch (e) {
      return def;
    }
  },
  saveSettings(s) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(Object.assign(this.settings(), s)));
  },

  /* ---------- 点検場所（工場名は端末内にのみ保存） ---------- */
  sites() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SITES) || 'null');
      if (Array.isArray(s) && s.length) return s;
    } catch (e) { /* 破損時は既定値 */ }
    return DEFAULT_SITES.slice();
  },
  saveSites(list) {
    localStorage.setItem(LS_SITES, JSON.stringify(list));
  },
  siteName(id) {
    const s = this.sites().find(x => x.id === id);
    return s ? s.name : '';
  },
  siteIdByName(name) {
    const s = this.sites().find(x => x.name === name);
    return s ? s.id : '';
  },

  /* ---------- 点検機械・点検項目（編集可能なマスター） ---------- */
  machines() {
    try {
      const m = JSON.parse(localStorage.getItem(LS_MACHINES) || 'null');
      if (Array.isArray(m) && m.length) return m;
    } catch (e) { /* 破損時は初期値 */ }
    return JSON.parse(JSON.stringify(DEFAULT_MACHINES));
  },
  saveMachines(list) {
    localStorage.setItem(LS_MACHINES, JSON.stringify(list));
  },
  resetMachines() {
    localStorage.removeItem(LS_MACHINES);
  },
  machineById(id) {
    return this.machines().find(m => m.id === id) || null;
  },
  // 点検項目が無い機械は「備考欄のみ」（例：その他）として扱う
  isFree(m) {
    return !m || !m.items || m.items.length === 0;
  },
  // 進捗集計の対象になる機械（備考欄のみの機械は除く）
  countedMachines() {
    return this.machines().filter(m => !this.isFree(m));
  },
  newMachineId() {
    const used = new Set(this.machines().map(m => m.id));
    let n = 1;
    while (used.has('m' + String(n).padStart(2, '0'))) n++;
    return 'm' + String(n).padStart(2, '0');
  },

  /* ---------- 点検対象マスター（場所×機械／キーは場所ID） ---------- */
  targets() {
    let t = {};
    try {
      t = JSON.parse(localStorage.getItem(LS_TARGETS) || '{}') || {};
    } catch (e) { /* 破損時は既定値 */ }
    // 未設定の場所は「備考欄のみを除く全機械」を既定の対象とする
    const def = this.countedMachines().map(m => m.id);
    this.sites().forEach(s => { if (!t[s.id]) t[s.id] = def.slice(); });
    return t;
  },
  // 新しく追加した機械を、全ての場所の点検対象に加える
  addTargetToAllSites(mid) {
    const t = this.targets();
    Object.keys(t).forEach(sid => { if (t[sid].indexOf(mid) < 0) t[sid].push(mid); });
    this.saveTargets(t);
  },
  saveTargets(t) {
    localStorage.setItem(LS_TARGETS, JSON.stringify(t));
  },

  /* ---------- 点検記録 ---------- */
  records() {
    try {
      return JSON.parse(localStorage.getItem(LS_RECORDS) || '[]');
    } catch (e) {
      return [];
    }
  },
  writeAll(list) {
    localStorage.setItem(LS_RECORDS, JSON.stringify(list));
  },
  get(id) {
    return this.records().find(r => r.id === id) || null;
  },
  upsert(rec) {
    const list = this.records();
    const i = list.findIndex(r => r.id === rec.id);
    rec.updatedAt = new Date().toISOString();
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    this.writeAll(list);
    return rec;
  },
  remove(id) {
    this.writeAll(this.records().filter(r => r.id !== id));
  },
  unsynced() {
    return this.records().filter(r => !r.synced);
  },

  /* ---------- スプレッドシート同期 ---------- */
  async push() {
    const s = this.settings();
    if (!s.gasUrl) throw new Error('スプレッドシートの連携URLが未設定です（設定タブ）');
    const pending = this.unsynced();
    if (!pending.length) return { sent: 0 };

    let sent = 0;
    for (const rec of pending) {
      const res = await fetch(s.gasUrl, {
        method: 'POST',
        // text/plain にすると CORS プリフライトを回避できる（GAS 側で JSON.parse）
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'save', record: rec })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || '保存に失敗しました');
      const list = this.records();
      const i = list.findIndex(r => r.id === rec.id);
      if (i >= 0) {
        list[i].synced = true;
        list[i].syncedAt = new Date().toISOString();
        if (json.photoUrls) {
          json.photoUrls.forEach(p => {
            const it = list[i].items[p.index];
            if (!it) return;
            // ドライブに保存できたら端末側の画像は破棄して容量を節約する
            if (p.kind === 'resolved') {
              it.resolvedPhotoUrl = p.url; it.resolvedPhotoId = p.id || ''; it.resolvedPhoto = '';
            } else {
              it.photoUrl = p.url; it.photoId = p.id || ''; it.photo = '';
            }
          });
        }
        this.writeAll(list);
      }
      sent++;
    }
    return { sent };
  },

  async pull(ym) {
    const s = this.settings();
    if (!s.gasUrl) throw new Error('スプレッドシートの連携URLが未設定です（設定タブ）');
    const url = s.gasUrl + '?action=list&ym=' + encodeURIComponent(ym || '');
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '取得に失敗しました');

    const list = this.records();
    const byId = Object.fromEntries(list.map(r => [r.id, r]));
    let added = 0;
    json.records.forEach(r => {
      // シートには工場名だけが入るため、端末の設定から場所IDを復元する
      if (!r.siteId) r.siteId = this.siteIdByName(r.site);
      const cur = byId[r.id];
      if (!cur) {
        r.synced = true;
        list.push(r);
        added++;
      } else if (cur.synced && new Date(r.updatedAt) > new Date(cur.updatedAt || 0)) {
        Object.assign(cur, r, { synced: true });
      }
    });
    list.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    this.writeAll(list);
    this.saveSettings({ lastPull: new Date().toISOString() });
    return { added, total: json.records.length };
  }
};

/* ---------- 共通ユーティリティ ---------- */
const Util = {
  uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },
  today() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  },
  ym(dateStr) { return (dateStr || '').slice(0, 7); },
  fmtDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(dateStr + 'T00:00:00').getDay()];
    return `${y}/${m}/${d}(${w})`;
  },
  // 撮影画像を縮小して DataURL 化（通信量・保存容量対策）
  compressImage(file, maxSize = 1024, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const cv = document.createElement('canvas');
          cv.width = width; cv.height = height;
          cv.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(cv.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
  /* ---------- 写真の表示・共有 ---------- */
  hasPhoto(it) { return !!(it && (it.photo || it.photoUrl)); },
  // ドライブのファイルIDを取り出す（URLからも復元できるようにする）
  photoId(it) {
    if (it.photoId) return it.photoId;
    const m = /\/d\/([^/?]+)/.exec(it.photoUrl || '');
    return m ? m[1] : '';
  },
  // 一覧に並べる縮小画像。未送信なら端末内の画像、送信済みならドライブの縮小版
  photoSrc(it) {
    if (it.photo) return it.photo;
    const id = this.photoId(it);
    return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w600' : '';
  },
  // 共有・拡大表示に使うリンク（送信後のみ）
  photoLink(it) { return it.photoUrl || ''; },
  // 対応後の写真を、点検写真と同じ形で扱えるようにする
  resolvedPhotoOf(it) {
    return {
      photo: it.resolvedPhoto || '',
      photoId: it.resolvedPhotoId || '',
      photoUrl: it.resolvedPhotoUrl || ''
    };
  },
  // 端末内の画像を共有用のファイルに変換する
  dataUrlToFile(dataUrl, name) {
    try {
      const [head, b64] = dataUrl.split(',');
      const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'image/jpeg';
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return new File([buf], name, { type: mime });
    } catch (e) {
      return null;
    }
  },

  // 記録全体の判定（不良＞要注意＞良）
  statusOf(rec) {
    const js = (rec.items || []).map(i => i.judge);
    if (js.includes('NG')) return 'NG';
    if (js.includes('CAUTION')) return 'CAUTION';
    if (js.includes('OK')) return 'OK';
    return 'NA';
  },
  csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
};
