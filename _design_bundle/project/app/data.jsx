// Full dataset for the interactive prototype
const PHASES = [
  { i: 1,  ja: '出図前チェック', short: '前検' },
  { i: 2,  ja: '設計出図',       short: '設計' },
  { i: 3,  ja: '在庫チェック',   short: '在庫' },
  { i: 4,  ja: '購入',           short: '購入' },
  { i: 5,  ja: '材料',           short: '材料' },
  { i: 6,  ja: '材料チェック',   short: 'M検' },
  { i: 7,  ja: '工場出図',       short: '工場' },
  { i: 8,  ja: '水すまし',       short: '水す' },
  { i: 9,  ja: 'ボルト',         short: 'ボル' },
  { i: 10, ja: '組立出図',       short: '組立' },
];

const JOBS = [
  {
    no: '25214', customer: 'コマツ金沢', product: 'アライメント装置',
    due: '6/30', dueStatus: 'warn', daysLeft: 12, pct: 35, nowPhase: 7, nowLabel: '工場出図',
    starred: true,
    axes: [
      { name: '全体図', status: 'done',    at: 10, pct: 100 },
      { name: '昇降軸', status: 'inprog',  at: 7,  pct: 60 },
      { name: '旋回軸', status: 'inprog',  at: 7,  pct: 45 },
      { name: '走行軸', status: 'pending', at: 1,  pct: 0  },
    ],
    files: [
      { name: '25214_全体図.pdf',  type: 'pdf', axis: '全体図', date: '5/12' },
      { name: '25214_昇降.pdf',    type: 'pdf', axis: '昇降軸', date: '5/15' },
      { name: '25214_旋回.pdf',    type: 'pdf', axis: '旋回軸', date: '5/18' },
      { name: '25214_本体01.dxf',  type: 'dxf', axis: '全体図', date: '5/12' },
      { name: '25214_昇降_ASM.dxf', type: 'dxf', axis: '昇降軸', date: '5/15' },
      { name: '25214_BOM.xlsx',    type: 'xlsx', axis: '全体図', date: '5/10' },
    ],
    activity: [
      { t: '5/22 14:30', who: '山田', what: '工場出図 — 昇降軸',     kind: 'release' },
      { t: '5/22 11:02', who: '田中', what: '材料チェック完了 — 旋回軸', kind: 'check' },
      { t: '5/20 09:15', who: '佐藤', what: '購入発注 — 走行軸',       kind: 'edit' },
      { t: '5/18 16:40', who: '山田', what: '設計出図',                kind: 'release' },
      { t: '5/15 10:00', who: '山田', what: '工番作成',                kind: 'create' },
    ],
  },
  {
    no: '25215', customer: 'XYZ製作所', product: '検査ライン',
    due: '7/15', dueStatus: 'ok', daysLeft: 27, pct: 60, nowPhase: 6, nowLabel: '材料チェック',
    axes: [
      { name: '搬送軸', status: 'inprog', at: 6, pct: 70 },
      { name: '昇降軸', status: 'inprog', at: 6, pct: 50 },
    ],
    files: [
      { name: '25215_搬送.pdf', type: 'pdf', axis: '搬送軸', date: '5/02' },
      { name: '25215_昇降.pdf', type: 'pdf', axis: '昇降軸', date: '5/02' },
    ],
    activity: [
      { t: '5/21 10:30', who: '田中', what: '材料入荷', kind: 'check' },
      { t: '5/15 09:00', who: '山田', what: '購入発注', kind: 'edit' },
    ],
  },
  {
    no: '25216', customer: 'ABC工業', product: '搬送ユニット',
    due: '8/10', dueStatus: 'ok', daysLeft: 53, pct: 30, nowPhase: 4, nowLabel: '購入',
    axes: [
      { name: 'X軸', status: 'inprog',  at: 4, pct: 50 },
      { name: 'Y軸', status: 'inprog',  at: 3, pct: 35 },
      { name: 'Z軸', status: 'pending', at: 2, pct: 10 },
    ],
    files: [],
    activity: [{ t: '5/19 14:00', who: '山田', what: '工番作成', kind: 'create' }],
  },
  {
    no: 'TS25001', customer: 'サンプル製作所', product: '評価機',
    due: '—', dueStatus: 'none', daysLeft: null, pct: 5, nowPhase: 1, nowLabel: '出図前チェック',
    axes: [{ name: '本体', status: 'inprog', at: 1, pct: 20 }],
    files: [],
    activity: [],
  },
  {
    no: '25210', customer: '○○工業', product: 'プレス機改造',
    due: '5/20', dueStatus: 'over', daysLeft: -3, pct: 75, nowPhase: 8, nowLabel: '水すまし',
    starred: true,
    axes: [
      { name: '主軸',   status: 'inprog', at: 8, pct: 80 },
      { name: '送り軸', status: 'inprog', at: 8, pct: 70 },
    ],
    files: [
      { name: '25210_主軸.pdf', type: 'pdf', axis: '主軸',   date: '4/20' },
      { name: '25210_送り.pdf', type: 'pdf', axis: '送り軸', date: '4/20' },
    ],
    activity: [{ t: '5/22 09:00', who: '山田', what: '工場出図 — 主軸', kind: 'release' }],
  },
];

const CONTACTS = [
  { name: 'コマツ金沢 田中様', email: 'tanaka@komatsu.co.jp', company: 'コマツ金沢', note: '納入連絡担当' },
  { name: 'コマツ金沢 鈴木様', email: 'suzuki@komatsu.co.jp', company: 'コマツ金沢', note: '設計受領担当' },
  { name: '○○商事 佐藤様',  email: 'sato@oo-shoji.co.jp',  company: '○○商事',  note: 'ベアリング納期' },
  { name: '△△精機 高橋様',  email: 'takahashi@sankakukoki.co.jp', company: '△△精機', note: '板金加工依頼' },
  { name: '社内設計部',      email: 'design@example.com',   company: '(社内)',   note: 'CCで常時通知' },
];

const TEMPLATES = [
  { name: '出図通知（標準）', subject: '【出図通知】{{job_no}} {{customer_name}} / {{axis_name}}', default: true },
  { name: '差替連絡',        subject: '【差替】{{job_no}} {{axis_name}} 差し替え図面のお知らせ' },
  { name: '納期回答',        subject: 'Re: 納期について {{job_no}}' },
];

window.AppData = { PHASES, JOBS, CONTACTS, TEMPLATES };
