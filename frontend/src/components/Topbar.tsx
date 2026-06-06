import { Link, useLocation } from "react-router-dom";

// 社内ポータル (Google Apps Script) — 在庫管理 / 残業・休日出勤申請アプリと同一の遷移先
const PORTAL_URL =
  "https://script.google.com/a/macros/lineworks-local.info/s/AKfycbx2eyJMOYP9o--GPBuhY-pj071IIR6Kqb_0xALwwNzdLQZux0dIAlL3P9EoCucnzXA/exec";

export function Topbar() {
  const loc = useLocation();
  const isAdmin = loc.pathname.startsWith("/admin");
  return (
    <header className="topbar sticky top-0 z-30">
      <Link
        to="/"
        className="font-semibold text-ink hover:text-accent flex items-center"
      >
        {/* シンボルアイコン: Topbar 高さを超える大きさで表示し、下方向にはみ出させて
            アプリの象徴である白い鳩を最大限主張する。
            内側の <span> は Topbar 高さに合わせ、<img> は absolute top-0 で
            上端をそろえつつ高さは Topbar より大きく取る → 下にはみ出る。
            Topbar の下枠線は CSS の ::after でアイコンより上の z-index に描き
            「枠線を消さない」要件を維持。 */}
        <span className="relative inline-block w-[64px] md:w-[94px] h-9 md:h-[52px] shrink-0">
          {/* 縦方向は Topbar の中央 = テキストの中心と揃える。
              top-1/2 + -translate-y-1/2 でアイコン中心を Topbar 中心へ。
              アイコン高 > Topbar 高 なので上下 ほぼ等量にはみ出す。 */}
          <img
            src="/app-icon.png"
            alt=""
            aria-hidden="true"
            className="absolute top-1/2 -translate-y-1/2 left-0 w-[64px] h-[64px] md:w-[94px] md:h-[94px] object-contain max-w-none"
          />
        </span>
        {/* アイコン画像内の余白 (鳩の周囲の白) があるため、テキストを少し左に
            寄せて視覚的にアイコンに近づける。
            アイコン span が position:relative で stacking-context を作っており、
            既定の static テキストはその下に隠れる仕様 (W3C 順序の step 3 < step 6)。
            text 側にも `relative z-10` を付けてアイコン image より上 (前面) に描画。 */}
        <span className="relative z-10 text-sm md:text-base -ml-1 md:-ml-2">
          <span className="font-bold tracking-wider text-accent">DOVE</span>
          <span className="ml-1.5">出図管理</span>
        </span>
      </Link>
      <span className="ml-2 text-ink4 text-xs hidden sm:inline">LINE WORKS</span>
      {/* ナビボタン: アクセント色 (水色) で統一。
          現在のページ = 塗りつぶし (bg-accent + 白抜き文字) で「いま居る場所」を強調、
          それ以外     = 同色アウトライン (白地 + 水色枠 + 水色文字) で行き先を示唆。
          PDF/DXF 全画面表示・DXFをダウンロード等の主要ボタンと同じ配色語彙を共有する。 */}
      <nav className="ml-auto flex items-center gap-2 text-sm">
        <Link
          to="/"
          className={`px-3 py-1 rounded-md text-xs md:text-sm transition ${
            !isAdmin
              ? "bg-accent text-white border-2 border-accent"
              : "bg-white border-2 border-accent text-accent hover:bg-cyan-50"
          }`}
        >
          一覧
        </Link>
        <Link
          to="/admin"
          className={`px-3 py-1 rounded-md text-xs md:text-sm transition ${
            isAdmin
              ? "bg-accent text-white border-2 border-accent"
              : "bg-white border-2 border-accent text-accent hover:bg-cyan-50"
          }`}
        >
          管理
        </Link>
        {/* 社内ポータルへ移動 (在庫管理アプリと同一仕様の緑ピル・外部リンク) */}
        <a
          href={PORTAL_URL}
          target="_top"
          title="社内ポータルへ移動"
          aria-label="社内ポータルへ移動"
          className="ml-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs md:text-sm font-medium text-white bg-[#1f9d55] hover:bg-[#177a43] transition"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          <span className="hidden sm:inline">社内ポータルへ移動</span>
          <span className="sm:hidden">ポータル</span>
        </a>
      </nav>
    </header>
  );
}
