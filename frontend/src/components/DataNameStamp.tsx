// 日本のオフィスで広く使われているシヤチハタ「データーネーム EX」等の
// データネーム印 (日付印) を SVG で再現。
//
// 実物仕様 (公式カタログ / 商品写真の調査結果):
//   - 外周は **単一円** (二重円は実印・法人印の特徴であり、データネーム印には無い)
//   - 上段の氏名・下段の所属は **水平配置** (textPath で湾曲はさせない)
//   - 中央 3 段は「元号略+年 / 月 / 日」をピリオド区切り、
//     `年` `月` `日` の漢字は入れない。例: `令7.` `11.` `26`
//   - 横線 2 本で中央帯を上下と区切る
//   - 色: 朱色 (#C0392B 系)。純赤 (#FF0000) は鮮やかすぎて不自然
//   - 軽い -2〜-3° 回転で押した感
//
// 文字サイズはユーザー要望 (はっきり見える) を優先。文字数で適応的に縮小する。

interface Props {
  name: string;
  department?: string | null;
  color: string;
  /** YYYY-MM-DD 形式 (押印日)。null なら日付帯は空欄。 */
  date: string | null;
  /** px。デフォルトは 56 (StampGrid 内). */
  size?: number;
}

interface DateParts {
  era: string; // 例: "令7" (令和元年=2019)
  month: string; // 例: "11"
  day: string; // 例: "26"
}

function toEraLabel(year: number): string {
  // 令和元年 = 2019。R+年でなく漢字「令」+ 年 のほうが実物に近い。
  const n = year - 2018;
  if (n >= 1) return `令${n}`;
  // 想定外 (押印日は当日のみのため事実上来ない) は西暦下 2 桁
  return String(year % 100);
}

function parseDate(date: string | null): DateParts | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return { era: toEraLabel(y), month: String(mo), day: String(d) };
}

/** 文字数で適応的にフォントサイズを決める。「はっきり見える」を優先。 */
function pickNameFontSize(name: string): number {
  const len = name.length;
  if (len <= 1) return 17;
  if (len === 2) return 14;
  if (len === 3) return 11;
  return 9;
}

function pickDeptFontSize(dept: string): number {
  const len = dept.length;
  if (len <= 2) return 11;
  if (len === 3) return 10;
  if (len === 4) return 8.5;
  return 7;
}

export function DataNameStamp({
  name,
  department,
  color,
  date,
  size = 56,
}: Props) {
  const parts = parseDate(date);

  // ViewBox 60×60 (size px にスケール)。
  // r=28 → 外周ギリギリ。
  const VB = 60;
  const C = VB / 2;
  const R = 28;
  // 横線 2 本の y 座標 (中央帯の上下端)。
  // 中央帯は日付 1 行のみ (例「令7. 11. 26」) なので高さ 11 で十分。
  // 上下ゾーンを広げ、氏名・所属がゆったり収まるようにする。
  const dy1 = 26;
  const dy2 = 37;
  // 横線は円弧内に収まる範囲で長めに。
  const dx1 = 6;
  const dx2 = 54;

  const nameFs = pickNameFontSize(name);
  const deptFs = department ? pickDeptFontSize(department) : 8;
  // 日付 1 行のフォント。中央帯 11 の中央に置くので、線高さ込みでも余裕で収まる。
  const dateFs = 8;

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      style={{
        color,
        // 軽い傾きで押した感。決定論的に -2.5° (毎レンダ同じ角度に固定)。
        transform: "rotate(-2.5deg)",
        display: "block",
      }}
      aria-label={`${name} 印 ${date ?? ""}`}
    >
      {/* 外周: 単一円 (二重ではない) */}
      <circle
        cx={C}
        cy={C}
        r={R}
        fill="white"
        stroke="currentColor"
        strokeWidth={1.8}
      />

      {/* 横線 2 本 — 中央の日付帯を上下と区切る */}
      <line
        x1={dx1}
        y1={dy1}
        x2={dx2}
        y2={dy1}
        stroke="currentColor"
        strokeWidth={1}
      />
      <line
        x1={dx1}
        y1={dy2}
        x2={dx2}
        y2={dy2}
        stroke="currentColor"
        strokeWidth={1}
      />

      {/* 上段: 氏名 (水平・中央揃え)。
          dy1=26 の上、y=17 を中心に。ユーザー要望に従い「円の中心側に寄せる」 -
          以前の y=14 だと上に張り付き気味だったため、中央帯ぎりぎり手前まで降ろす。 */}
      <text
        x={C}
        y={17}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={nameFs}
        fontFamily="'Yu Mincho', 'Hiragino Mincho ProN', serif"
        fontWeight={700}
        fill="currentColor"
      >
        {name}
      </text>

      {/* 中央 1 段: 令X. Y. Z (元号年・月・日をピリオド区切り、横並び)。
          dy1=26, dy2=37 の間 (中心 y=31.5)。 */}
      {parts && (
        <text
          x={C}
          y={31.5}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={dateFs}
          fontFamily="'Yu Gothic', 'Hiragino Sans', sans-serif"
          fontWeight={700}
          fill="currentColor"
        >
          {`${parts.era}. ${parts.month}. ${parts.day}`}
        </text>
      )}

      {/* 下段: 所属 (水平・中央揃え)。dy2=37 の下、y=45 (中心寄り) に配置。
          氏名と対称的に中央へ少し寄せる。 */}
      {department && (
        <text
          x={C}
          y={45}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={deptFs}
          fontFamily="'Yu Gothic', 'Hiragino Sans', sans-serif"
          fontWeight={600}
          fill="currentColor"
        >
          {department}
        </text>
      )}
    </svg>
  );
}
