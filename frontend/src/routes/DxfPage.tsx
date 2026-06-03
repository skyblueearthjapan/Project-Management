// Phase M v2: DXF ビューア画面を JobDetailPage と同じ右ペイン構成に揃える。
//
// URL: /jobs/:jobId/dxf?dxfId={id}&axisId={n}&axisName={name}
//   - dxfId 経由 (DxfFileList から navigate) → 軸情報も持つ → 右ペインに同 axis の DXF 一覧
//   - path 経由 (旧フォルダブラウズ) → axis 不明 → 右ペインなし、ビューアのみ
//
// レイアウト方針 (JobDetailPage 踏襲):
//   - md 以上: 左ビューア (1fr) + 右 DXF 一覧 (380px) + 中央ハンドルで折畳
//   - md 未満: 縦積み。下部に折畳開閉
import { lazy, Suspense, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { dxfFileUrl } from "../api/dxf";
import { DxfFileList } from "../components/DxfFileList";

const DxfViewer = lazy(() =>
  import("../components/DxfViewer").then((m) => ({ default: m.DxfViewer })),
);

export function DxfPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [params] = useSearchParams();
  const dxfIdRaw = params.get("dxfId");
  const dxfId = dxfIdRaw && /^\d+$/.test(dxfIdRaw) ? Number(dxfIdRaw) : null;
  const dxfRelPath = params.get("path") ?? "";

  // 軸情報。両方そろっていれば右ペインに同 axis の DXF 一覧を表示する。
  const axisIdRaw = params.get("axisId");
  const axisId =
    axisIdRaw && /^\d+$/.test(axisIdRaw) ? Number(axisIdRaw) : null;
  const axisName = params.get("axisName") ?? "";
  const hasAxisContext = axisId !== null && axisName !== "";

  // JobDetailPage と同じく既定で「折りたたみ」(右ペイン非表示)。
  // 必要なときに右の「DXF」ボタンで開く。
  const [paneCollapsed, setPaneCollapsed] = useState(true);
  const [tabletOpen, setTabletOpen] = useState(false);

  let url: string | null = null;
  let fileName = "";
  if (dxfId !== null) {
    url = dxfFileUrl(dxfId);
    fileName = `DXF #${dxfId}`;
  } else if (dxfRelPath && jobId) {
    url = `/api/v1/files/fileserver?job_id=${encodeURIComponent(jobId)}&path=${encodeURIComponent(dxfRelPath)}`;
    fileName = dxfRelPath.split("/").pop() ?? dxfRelPath;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      {/* === モバイル用 コンパクトヘッダー (1 行) ===
          ファイル名 (左、truncate) + 「← PDFに戻る」(右端、アクセント色塗潰し)。
          ファイル名と同じ段の右端に配置することで、Topbar の「一覧/管理」のすぐ下の
          段に主要ナビボタンが収まる。 */}
      <div className="md:hidden flex items-center gap-2 px-2 py-1 border-b border-hair bg-white shrink-0 text-xs">
        <span className="font-mono text-ink truncate flex-1 min-w-0">
          {fileName}
        </span>
        <Link
          to={`/jobs/${encodeURIComponent(jobId ?? "")}`}
          className="shrink-0 whitespace-nowrap px-3 py-1 rounded-md bg-accent text-white text-xs font-bold shadow-sm hover:bg-cyan-600"
          title="工番詳細 (PDF) へ戻る"
        >
          ← PDFに戻る
        </Link>
      </div>

      {/* === PC 用 ヘッダー (パンくず + ファイル名 + DL + 戻る) === */}
      <div className="hidden md:flex bg-white border-b border-hair px-3 md:px-6 py-2 flex-wrap items-center gap-2 md:gap-3 shrink-0">
        <nav className="text-xs text-ink3 flex gap-1 items-center">
          <Link to="/" className="hover:text-accent px-1 py-1 inline-flex items-center">
            工番
          </Link>
          <span>/</span>
          <Link
            to={`/jobs/${encodeURIComponent(jobId ?? "")}`}
            className="hover:text-accent px-1 py-1 inline-flex items-center"
          >
            {jobId}
          </Link>
          <span>/</span>
          <span className="text-ink2">DXF</span>
        </nav>
        <span className="text-sm font-mono truncate flex-1 md:flex-none md:ml-2">{fileName}</span>
        {/* ダウンロード = 主アクション (青塗り)、戻る = 補助 (白地+青枠) で
            PDF 画面と配色を統一。 */}
        <span className="ml-auto flex gap-2">
          <Link
            to={`/jobs/${encodeURIComponent(jobId ?? "")}`}
            className="text-xs px-3 py-1 rounded-md bg-white border-2 border-accent text-accent hover:bg-cyan-50 transition inline-flex items-center"
          >
            ← 戻る
          </Link>
          {url && (
            <a
              href={url}
              download
              className="text-xs px-3 py-1 rounded-md bg-accent text-white hover:bg-cyan-600 transition inline-flex items-center"
            >
              📥 DXFをダウンロード
            </a>
          )}
        </span>
      </div>

      {/* 本体: グリッドで左ビューア + 右 DXF 一覧 (md 以上)、md 未満は縦積み */}
      <div
        className="relative flex-1 flex flex-col md:grid overflow-hidden md:transition-[grid-template-columns] duration-300"
        style={{
          gridTemplateColumns:
            !hasAxisContext || paneCollapsed ? "1fr 0fr" : "1fr 380px",
        }}
      >
        {/* 左カラム: DXF ビューア
            モバイルは余白ゼロでビューアを画面いっぱいに広げる。 */}
        <div className="min-w-0 flex flex-col overflow-hidden flex-1">
          <div className="flex-1 min-h-0 p-0 md:p-3">
            {url ? (
              <Suspense
                fallback={
                  <div className="h-full grid place-items-center text-ink3 text-sm">
                    DXF ビューアを読み込み中…
                  </div>
                }
              >
                <DxfViewer url={url} fullHeight />
              </Suspense>
            ) : (
              <p className="text-ink3 text-sm">
                DXF が指定されていません (?dxfId か ?path を URL に付けてください)。
              </p>
            )}
          </div>

          {/* タブレット縦 (md 未満): 下部に DXF 一覧フッター。axisContext あり時のみ。 */}
          {hasAxisContext && jobId && axisId !== null && (
            <div className="md:hidden border-t border-hair bg-white shrink-0">
              <button
                type="button"
                onClick={() => setTabletOpen((v) => !v)}
                aria-expanded={tabletOpen}
                className="w-full px-4 py-2 text-left text-xs text-ink2 flex items-center gap-2 min-h-[40px]"
              >
                <span
                  className="text-accent transition-transform"
                  style={{ transform: tabletOpen ? "rotate(90deg)" : "none" }}
                >
                  ▸
                </span>
                <span className="font-medium">DXF ファイル一覧</span>
                <span className="text-ink4 text-[11px] ml-1">
                  {tabletOpen ? "タップで閉じる" : "タップで開く"}
                </span>
              </button>
              <div
                className="overflow-hidden transition-[height] duration-200"
                style={{ height: tabletOpen ? 280 : 0 }}
              >
                <div className="p-3 overflow-auto max-h-[280px]">
                  <DxfFileList
                    jobId={jobId}
                    axisId={axisId}
                    axisName={axisName}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* デスクトップ右ペイン (md 以上): 同 axis の DXF 一覧。axisContext 無しなら非表示 */}
        {hasAxisContext && jobId && axisId !== null && (
          <aside
            className={`hidden md:flex bg-white border-l border-hair flex-col overflow-hidden transition-opacity ${
              paneCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            <header className="flex items-center gap-2 px-4 py-3 border-b border-hair shrink-0">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
                DXF ファイル
              </h3>
              <span className="text-[11px] text-ink3 truncate">{axisName}</span>
            </header>
            <div className="flex-1 overflow-auto p-3">
              <DxfFileList jobId={jobId} axisId={axisId} axisName={axisName} />
            </div>
          </aside>
        )}

        {/* 右ペイン折畳タブボタン (PC のみ)。
            モバイルでは下部フッターアコーディオンで DXF 一覧を出すので
            このタブボタンは不要。 */}
        {hasAxisContext && (
          <button
            type="button"
            onClick={() => setPaneCollapsed((v) => !v)}
            title={paneCollapsed ? "DXF 一覧を開く" : "DXF 一覧を閉じる"}
            aria-expanded={!paneCollapsed}
            className="hidden md:flex absolute top-1 z-10 w-6 h-10 bg-accent text-white border border-accent rounded-l-md shadow-md hover:bg-cyan-600 transition items-center justify-center text-[10px] font-bold tracking-wider"
            style={{ right: paneCollapsed ? 0 : 380 }}
          >
            <span style={{ writingMode: "vertical-rl" }}>DXF</span>
          </button>
        )}
      </div>
    </div>
  );
}
