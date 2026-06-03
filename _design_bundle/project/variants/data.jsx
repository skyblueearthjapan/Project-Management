// Shared job + phase data for all variants.

const PHASES = [
  { i: 1,  ja: '出図前チェック', en: 'Pre-check',     short: '前検' },
  { i: 2,  ja: '設計出図',       en: 'Design rel.',   short: '設計' },
  { i: 3,  ja: '在庫チェック',   en: 'Stock check',   short: '在庫' },
  { i: 4,  ja: '購入',           en: 'Purchase',      short: '購入' },
  { i: 5,  ja: '材料',           en: 'Material',      short: '材料' },
  { i: 6,  ja: '材料チェック',   en: 'Mat. check',    short: 'M検' },
  { i: 7,  ja: '工場出図',       en: 'Shop release',  short: '工場' },
  { i: 8,  ja: '水すまし',       en: 'Water spider',  short: '水す' },
  { i: 9,  ja: 'ボルト',         en: 'Bolt',          short: 'ボル' },
  { i: 10, ja: '組立出図',       en: 'Asm release',   short: '組立' },
];

// status: done | inprog | pending | mixed | warn
const JOBS = [
  {
    no: '25214',
    customer: 'コマツ金沢',
    product: 'アライメント装置',
    due: '6/30',
    dueStatus: 'warn',
    daysLeft: 12,
    pct: 35,
    nowPhase: 7,
    nowLabel: '工場出図',
    axes: [
      { name: '昇降軸',   status: 'inprog',  at: 7, pct: 60 },
      { name: '回転軸',   status: 'inprog',  at: 7, pct: 45 },
      { name: '水平軸',   status: 'inprog',  at: 4, pct: 30 },
      { name: '搬送軸',   status: 'pending', at: 1, pct: 0  },
    ],
    timeline: ['mixed','mixed','mixed','inprog','mixed','mixed','inprog','mixed','mixed','mixed'],
    starred: true,
  },
  {
    no: '25215',
    customer: 'XYZ製作所',
    product: '検査ライン',
    due: '7/15',
    dueStatus: 'ok',
    daysLeft: 27,
    pct: 60,
    nowPhase: 6,
    nowLabel: '材料チェック',
    axes: [
      { name: '搬送軸', status: 'inprog', at: 6, pct: 70 },
      { name: '昇降軸', status: 'inprog', at: 6, pct: 50 },
    ],
    timeline: ['done','done','done','done','done','inprog','pending','pending','pending','pending'],
  },
  {
    no: '25216',
    customer: 'ABC工業',
    product: '搬送ユニット',
    due: '8/10',
    dueStatus: 'ok',
    daysLeft: 53,
    pct: 30,
    nowPhase: 4,
    nowLabel: '購入',
    axes: [
      { name: 'X軸', status: 'inprog',  at: 4, pct: 50 },
      { name: 'Y軸', status: 'inprog',  at: 3, pct: 35 },
      { name: 'Z軸', status: 'pending', at: 2, pct: 10 },
    ],
    timeline: ['done','mixed','inprog','inprog','pending','pending','pending','pending','pending','pending'],
  },
  {
    no: 'TS25001',
    customer: 'サンプル製作所',
    product: '評価機',
    due: '—',
    dueStatus: 'none',
    daysLeft: null,
    pct: 5,
    nowPhase: 1,
    nowLabel: '出図前チェック',
    axes: [
      { name: '本体', status: 'inprog', at: 1, pct: 20 },
    ],
    timeline: ['inprog','pending','pending','pending','pending','pending','pending','pending','pending','pending'],
  },
  {
    no: '25210',
    customer: '○○工業',
    product: 'プレス機改造',
    due: '5/20',
    dueStatus: 'over',
    daysLeft: -3,
    pct: 75,
    nowPhase: 8,
    nowLabel: '水すまし',
    axes: [
      { name: '主軸',   status: 'inprog', at: 8, pct: 80 },
      { name: '送り軸', status: 'inprog', at: 8, pct: 70 },
    ],
    timeline: ['done','done','done','done','done','done','done','inprog','pending','pending'],
    starred: true,
  },
];

// status color mapping per variant — variants can override
window.PMData = { PHASES, JOBS };
