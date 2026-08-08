/* =========================================================
   マスターデータ（点検場所・点検機械・点検項目）
   type: 'judge' = 良/要注意/不良/対象外
         'num'   = 数値入力（判定も併記）
   ========================================================= */

/* 点検場所の初期値。
   実際の工場名はアプリの「設定」タブで登録してください（端末内にのみ保存されます）。
   id は名称を変更しても過去の記録と紐付けが切れないようにするための内部キーです。 */
const DEFAULT_SITES = [
  { id: 's1', name: 'A工場' },
  { id: 's2', name: 'B工場' },
  { id: 's3', name: 'C工場' },
  { id: 's4', name: 'D工場' },
  { id: 's5', name: 'E工場' }
];

const JUDGE = {
  OK: { key: 'OK', label: '良', cls: 'ok' },
  CAUTION: { key: 'CAUTION', label: '要注意', cls: 'caution' },
  NG: { key: 'NG', label: '不良', cls: 'ng' },
  NA: { key: 'NA', label: '対象外', cls: 'na' }
};

/* 点検機械と点検項目の初期値。
   アプリの「設定 → 点検機械・点検項目の編集」で追加・変更した内容が優先されます
   （変更内容は端末内に保存されます）。 */
const DEFAULT_MACHINES = [
  {
    id: 'm01', name: '回収乾燥機', icon: '🌀',
    items: [
      { name: 'リントフィルター' },
      { name: '給気ストレーナー' },
      { name: 'クーラーケース内部' },
      { name: 'ドアパッキン' },
      { name: 'リントボックスパッキン' },
      { name: '蒸気ストレーナー' },
      { name: '蒸気電磁弁' },
      { name: 'ダンパ動作' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: '室外機フィン' },
      { name: '分離機' }
    ]
  },
  {
    id: 'm02', name: '静止立体乾燥機', icon: '🧺',
    items: [
      { name: 'リントフィルター' },
      { name: '給気ストレーナー' },
      { name: 'クーラーケース内部' },
      { name: '蒸気ストレーナー' },
      { name: '室外機フィン' },
      { name: 'サーミスタ検知棒' },
      { name: '分離機' }
    ]
  },
  {
    id: 'm03', name: 'ドライ機', icon: '🧴',
    items: [
      { name: 'フィルター圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: 'ドアパッキン' },
      { name: 'ドアスイッチ' },
      { name: 'ボタントラップ' },
      { name: '溶剤ポンプ異音・液漏れ' },
      { name: 'ホース破れ・漏れ' },
      { name: '冷凍機フィルター' }
    ]
  },
  {
    id: 'm04', name: '水洗機', icon: '💧',
    items: [
      { name: 'ドアパッキン' },
      { name: '配管漏れ' },
      { name: '蒸気漏れ' },
      { name: 'Ｖベルト' },
      { name: 'グリスカップ' },
      { name: '給気フィルター' }
    ]
  },
  {
    id: 'm05', name: 'トンネルフィニッシャー', icon: '🚇',
    items: [
      { name: 'リントフィルター' },
      { name: 'スチーム噴射状態' },
      { name: 'グリスアップ' },
      { name: '搬送チェーン' },
      { name: '異音' },
      { name: '排気ダクト' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' }
    ]
  },
  {
    id: 'm06', name: '立体自動包装機', icon: '📦',
    items: [
      { name: 'レールグリスアップ' },
      { name: 'カッター刃' },
      { name: 'テフロンシート・ヒーター線' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: '異音' }
    ]
  },
  {
    id: 'm07', name: '平包装機', icon: '📄',
    items: [
      { name: 'フィルム巻取り' },
      { name: 'ヒーター線・テフロンシート' }
    ]
  },
  {
    id: 'm08', name: '立体手動包装機', icon: '🎁',
    items: [
      { name: 'カッター刃' },
      { name: 'ヒーター線・テフロンシート' }
    ]
  },
  {
    id: 'm09', name: 'シーツローラー', icon: '🛏️',
    items: [
      { name: 'グリスアップ' },
      { name: '駆動チェーン潤滑スプレー' },
      { name: '異音' }
    ]
  },
  {
    id: 'm10', name: 'カッタープレス機', icon: '✂️',
    items: [
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: '蒸気漏れ' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' }
    ]
  },
  {
    id: 'm11', name: '三ツ山プレス機', icon: '⛰️',
    items: [
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: '蒸気漏れ' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' }
    ]
  },
  {
    id: 'm12', name: 'ズボンプレス機', icon: '👖',
    items: [
      { name: 'フィルター' },
      { name: '排気ホース' },
      { name: '蒸気漏れ' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' }
    ]
  },
  {
    id: 'm13', name: '万能プレス機', icon: '🔧',
    items: [
      { name: 'フィルター' },
      { name: '排気ホース' },
      { name: '蒸気漏れ' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' }
    ]
  },
  {
    id: 'm14', name: '綿プレス機', icon: '🧵',
    items: [
      { name: '排気ホース' },
      { name: '蒸気漏れ' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' }
    ]
  },
  {
    id: 'm15', name: '人体', icon: '🧍',
    items: [
      { name: '蒸気漏れ' },
      { name: 'エアー漏れ' },
      { name: 'エアー圧力', type: 'num', unit: 'MPa', step: '0.01' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' }
    ]
  },
  {
    id: 'm16', name: 'パフ台', icon: '💨',
    items: [
      { name: '蒸気漏れ' },
      { name: 'カバー汚れ・破れ・しわ' },
      { name: '各動作確認' },
      { name: 'アイロン動作確認' }
    ]
  },
  {
    id: 'm17', name: '平台', icon: '🪟',
    items: [
      { name: '各動作確認' },
      { name: 'アイロン動作確認' }
    ]
  },
  {
    id: 'm18', name: 'ボイラー', icon: '🔥',
    items: [
      { name: '灯油ストレーナー' },
      { name: 'ドレンタンク確認' }
    ]
  },
  {
    id: 'm19', name: 'コンプレッサー', icon: '🌬️',
    items: [
      { name: 'オイル確認' },
      { name: '圧力確認', type: 'num', unit: 'MPa', step: '0.01' },
      { name: 'Ｖベルト' },
      { name: 'エアードライヤーフィルター' }
    ]
  },
  {
    id: 'm20', name: '投入機', icon: '⚗️',
    items: [
      { name: '流量測定', type: 'num', unit: 'mL/min', step: '0.1' },
      { name: '漏れ確認' },
      { name: '溶剤残量確認', type: 'num', unit: '%', step: '1' }
    ]
  },
  {
    id: 'm21', name: '軟水器', icon: '🚰',
    items: [
      { name: '硬度検査', type: 'num', unit: 'mg/L', step: '1' },
      { name: '水漏れ確認' }
    ]
  },
  {
    id: 'm22', name: 'その他', icon: '📝',
    freeOnly: true,
    items: []
  }
];

