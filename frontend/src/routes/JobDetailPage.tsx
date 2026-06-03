// Phase A 刈り込み履歴:
//  - スタンドアロン MailModal の import は削除 (Phase C で業務フロー統合予定)
//  - TODO(Phase C): メール送信は出図/差替/追加部品/済受領の業務アクション内に統合する
// Phase B 改修履歴:
//  - 旧 AttachmentsModal (入力モーダル中心) を deprecate (placeholder 化)
//  - 3 タブ (関連資料 / 差替図面 / 部品リスト) をフォルダ的な View として
//    PDF メイン領域の下にアコーディオン展開する方式に変更
//  - state は activeTab: null | "related" | "replacements" | "parts" で管理
// Phase F 改修履歴:
//  - Marin-PDF 移植版 PdfViewer に jobId / axisId / onVersionSaved を渡す
//  - 編集後の新バージョン保存に成功したら ["job", jobId] を invalidate して再取得
// Phase G 改修履歴:
//  - PdfViewer を React.lazy 化して初期バンドルから pdf-lib / pdfjs を分離
//  - タブレット縦 (md: 未満) 向けのレイアウト: DXF サイドペインをフッターに畳む
//  - タッチターゲットを 40px 以上に拡大、アコーディオン操作を指でも開けるサイズに
import { useParams, Link } from "react-router-dom";
import { useEffect, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJob, type AxisRead } from "../api/jobs";
import { DxfFileList } from "../components/DxfFileList";
import { ReleaseModal } from "../components/ReleaseModal";
import { NewAxisModal } from "../components/NewAxisModal";
import { Modal } from "../components/Modal";
import { RelatedDocsView } from "../components/views/RelatedDocsView";
import { ReplacementsView } from "../components/views/ReplacementsView";
import { PartsListView } from "../components/views/PartsListView";

// Phase G: PdfViewer は重い (pdf-lib + pdfjs-dist で 1MB+) ため初期バンドルから除外。
// タブレット回線 / メモリ制約への配慮 + JobDetailPage 以外では使わない依存なので
// 詳細画面に入って初めてロードする方が起動が速い。
const PdfViewer = lazy(() =>
  import("../components/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);

type ActiveTab = null | "related" | "replacements" | "parts";

const TAB_LABELS: Record<Exclude<ActiveTab, null>, string> = {
  related: "関連資料",
  replacements: "差替図面",
  parts: "部品リスト",
};

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data: job, isLoading, error } = useJob(jobId);
  const qc = useQueryClient();
  const [activeAxisId, setActiveAxisId] = useState<number | null>(null);
  // 既定で「折りたたみ」(右ペイン非表示)。
  // - DXF 一覧が常時開いていると工程詳細やビューアの作業領域が狭くなる
  // - 必要時に右の「DXF」ボタンで開けば良い
  const [paneCollapsed, setPaneCollapsed] = useState(true);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(null);
  const [newAxisOpen, setNewAxisOpen] = useState(false);
  // Phase G: タブレット縦持ち向けに DXF ペインを下部に折り畳む状態。
  // デスクトップ (md: 以上) では従来通りサイドカラム表示。
  const [tabletDxfOpen, setTabletDxfOpen] = useState(false);
  // Phase H: PDF 全画面トグル。ヘッダ/軸タブ/進捗/DXF/View パネルを全て隠して
  // PDF を Topbar 下の全領域に拡大する。Esc キーで復帰。
  const [pdfFullscreen, setPdfFullscreen] = useState(false);

  // Phase B レビュー M-5: View パネルを Esc キーで閉じられるようにする。
  // モーダル類 (ReleaseModal / NewAxisModal) は内部で keydown を購読していて
  // 自身で Esc を捌くので、ここでは activeTab が null でない時のみ閉じ動作を発火する。
  useEffect(() => {
    if (activeTab === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveTab(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab]);

  // Phase H: PDF 全画面モード中は Esc で復帰させる。
  // activeTab の Esc ハンドラよりも先に発火させたいので独立した effect で購読する。
  useEffect(() => {
    if (!pdfFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPdfFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfFullscreen]);

  if (isLoading) return <p className="text-ink3 text-sm p-6">読み込み中…</p>;
  if (error)
    return <p className="text-red-600 text-sm p-6">エラー: {(error as Error).message}</p>;
  if (!job) return null;

  // 軸を sort_order で並べた配列。モバイル用 prev/next 軸切替で利用。
  const sortedAxes = [...job.axes].sort((a, b) => a.sort_order - b.sort_order);
  const axis: AxisRead | undefined =
    sortedAxes.find((a) => a.id === activeAxisId) ?? sortedAxes[0];
  const axisIdx = axis ? sortedAxes.findIndex((a) => a.id === axis.id) : -1;
  const prevAxis = (): void => {
    if (axisIdx > 0) {
      const target = sortedAxes[axisIdx - 1];
      if (target) setActiveAxisId(target.id);
    }
  };
  const nextAxis = (): void => {
    if (axisIdx >= 0 && axisIdx < sortedAxes.length - 1) {
      const target = sortedAxes[axisIdx + 1];
      if (target) setActiveAxisId(target.id);
    }
  };

  const pdfUrl = axis?.current_version_id
    ? `/api/v1/files/version/${axis.current_version_id}`
    : null;

  const toggleTab = (t: Exclude<ActiveTab, null>) => {
    setActiveTab((current) => (current === t ? null : t));
  };

  // Phase G: タブレットで指で押しやすいタッチターゲット (~40px) を確保。
  // Phase H: デスクトップ時は py-0.5 でさらに高さを 4px 削減 (PDF 領域確保のため)。
  const tabButtonClass = (t: Exclude<ActiveTab, null>) =>
    `text-xs md:text-xs px-3 py-2 md:py-0.5 rounded-md border transition min-h-[40px] md:min-h-0 ${
      activeTab === t
        ? "bg-cyan-50 border-accent text-accent"
        : "border-hair text-ink2 hover:border-accent"
    }`;

  return (
    // `min-h-0` を入れてブラウザの外側スクロールを抑止し、内側 (PDF / サムネ) だけ
    // でスクロールが完結するようにする。flex-1 だけだと子の min-height: auto により
    // コンテンツが伸びて画面全体スクロールが出てしまう。
    <div className="flex-1 min-h-0 flex flex-col bg-bg relative">
      {/* === モバイル用 コンパクトヘッダー (1 行のみ、~36px) ===
          横画面の図面ビュー時に画面領域を最大化するため、パンくず + 軸切替を
          単一行に圧縮 (← + 工番ID + 軸名 + ‹ › 切替)。 */}
      {!pdfFullscreen && (
        <div className="md:hidden flex items-center gap-1 px-2 py-1 border-b border-hair bg-white shrink-0 text-xs">
          <Link
            to="/"
            className="px-2 py-0.5 text-ink2 hover:text-accent inline-flex items-center"
            title="工番一覧へ戻る"
          >
            ←
          </Link>
          <span className="font-medium text-ink truncate">{job.id}</span>
          {axis && sortedAxes.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={prevAxis}
                disabled={axisIdx <= 0}
                className="px-2 py-0.5 border border-hair rounded text-ink2 disabled:opacity-30"
                title="前の軸"
              >
                ‹
              </button>
              <span className="text-ink font-medium px-1 min-w-[3rem] text-center truncate">
                {axis.name}
              </span>
              <span className="text-ink4 text-[10px] font-mono">
                {axisIdx + 1}/{sortedAxes.length}
              </span>
              <button
                type="button"
                onClick={nextAxis}
                disabled={axisIdx >= sortedAxes.length - 1}
                className="px-2 py-0.5 border border-hair rounded text-ink2 disabled:opacity-30"
                title="次の軸"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}

      {/* === PC 用 上部パネル (パンくず / 軸タブ / アクション) === */}
      <div
        className={`bg-white border-b border-hair shrink-0 hidden md:block ${pdfFullscreen ? "md:hidden" : ""}`}
      >
        {/* Phase H A1: パンくず + 工番タイトルを 1 行に統合し縦サイズを圧縮 (56px → 36px) */}
        <div className="px-4 md:px-6 py-2 flex items-baseline gap-3 flex-wrap text-sm">
          <Link to="/" className="text-ink3 hover:text-accent text-xs">
            工番
          </Link>
          <span className="text-ink4 text-xs">/</span>
          <h1 className="text-base font-semibold text-ink">{job.id}</h1>
          {job.customer && <span className="text-ink2">· {job.customer}</span>}
          {job.title && <span className="text-ink3 text-xs">· {job.title}</span>}
          <span className="ml-auto flex items-center gap-3">
            <span className="text-xs text-ink3">
              {job.delivery_date && `納期 ${job.delivery_date.slice(5).replace("-", "/")}`}
            </span>
            {/* 現場モード廃止 (Phase G 実装したが業務利用見送り)。 */}
          </span>
        </div>

        {/* Phase H A3: 軸タブ + アクション行をコンパクト化 (py-2 → py-1.5, ボタン py-1 → py-0.5) */}
        <div className="px-4 md:px-6 py-1.5 flex flex-wrap items-center gap-2 border-t border-hair">
          {job.axes.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveAxisId(a.id)}
              className={`px-3 py-2 md:py-0.5 rounded-pill text-sm border transition min-h-[40px] md:min-h-0 ${
                axis?.id === a.id
                  ? "bg-cyan-50 border-accent text-accent"
                  : "bg-white border-hair text-ink2 hover:border-accent"
              }`}
            >
              {a.name}
              {a.current_version_no != null && (
                <span className="ml-1 text-[10px] text-ink3">v{a.current_version_no}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNewAxisOpen(true)}
            className="px-3 py-2 md:py-0.5 rounded-pill text-sm border border-dashed border-hair text-ink3 hover:border-accent hover:text-accent min-h-[40px] md:min-h-0"
          >
            + 軸追加
          </button>
          {/* 管理系タブ (関連資料 / 差替図面 / 部品リスト):
              PC のみ表示。モバイルはビューア専用にして画面領域を広く取るため非表示。 */}
          <span className="ml-auto hidden md:flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => toggleTab("related")}
              aria-pressed={activeTab === "related"}
              className={tabButtonClass("related")}
            >
              関連資料
            </button>
            <button
              type="button"
              onClick={() => toggleTab("replacements")}
              aria-pressed={activeTab === "replacements"}
              className={tabButtonClass("replacements")}
            >
              差替図面
            </button>
            <button
              type="button"
              onClick={() => toggleTab("parts")}
              aria-pressed={activeTab === "parts"}
              className={tabButtonClass("parts")}
            >
              部品リスト
            </button>
          </span>
        </div>
      </div>

      {/* Phase H C2: 全画面 PDF 復帰は PdfViewer ツールバー内の「⛶ 復帰」ボタン
          または Esc キーで行う (フローティングボタンは廃止)。*/}

      {!axis && (
        <div className="p-6 text-sm space-y-2">
          <p className="text-ink3">軸が登録されていません。</p>
          <button
            type="button"
            onClick={() => setNewAxisOpen(true)}
            className="px-3 py-2 rounded-md bg-accent text-white min-h-[40px]"
          >
            + 軸を追加
          </button>
        </div>
      )}

      {axis && (
        <>
          {/* 進捗サブヘッダー: PC のみ表示。
              モバイル / 全画面時は非表示にしてビューア領域を最大化。 */}
          {/* 進捗サブヘッダーは完全撤去。詳細画面は PDF 表示にフォーカスし、
              工程進捗は工番一覧 (JobsListPage) で確認する設計とする。
              「軸を出図」ボタンも撤去 (新版アップロードは履歴パネル/編集モーダル経由)。 */}

          {/* Phase G:
              - md 以上 (デスクトップ): 従来通り左 PDF + 右 DXF サイドペインのグリッド
              - md 未満 (タブレット縦): 縦積み。PDF 全幅、DXF はフッターに折り畳み
                + 中央のドラッグハンドル (右ペインの開閉ボタン) は md 以上のみ
              全画面 PDF 時でも DXF ペインを開けるよう、grid 列幅は paneCollapsed のみで判定。
              ユーザーが DXF タブをタップ → ペインを開く → DXF を選んで DXFページへ
              というフローを全画面中も維持できる。 */}
          <div
            className="relative flex-1 flex flex-col md:grid overflow-hidden md:transition-[grid-template-columns] duration-300"
            style={{
              gridTemplateColumns: paneCollapsed ? "1fr 0fr" : "1fr 380px",
            }}
          >
            {/* 左カラム: PDF メイン領域 + 下に View パネルがアコーディオン展開 */}
            <div className="min-w-0 flex flex-col overflow-hidden flex-1">
              <div className="flex-1 min-h-0">
                {pdfUrl ? (
                  <Suspense
                    fallback={
                      <div className="h-full flex items-center justify-center text-ink3 text-sm">
                        PDFビューアを読み込み中…
                      </div>
                    }
                  >
                    <PdfViewer
                      url={pdfUrl}
                      isLinkBroken={axis.current_version_link_broken}
                      jobId={job.id}
                      axisId={axis.id}
                      currentVersionId={axis.current_version_id}
                      onRequestNewVersion={() => setReleaseOpen(true)}
                      isFullscreen={pdfFullscreen}
                      onToggleFullscreen={() => setPdfFullscreen((v) => !v)}
                      onVersionSaved={() => {
                        // Phase F: 保存成功時、軸の最新版とリンク切れ状態を再取得する。
                        void qc.invalidateQueries({ queryKey: ["job", job.id] });
                        void qc.invalidateQueries({ queryKey: ["jobs"] });
                        void qc.invalidateQueries({
                          queryKey: ["versions", axis.id],
                        });
                      }}
                    />
                  </Suspense>
                ) : (
                  <div className="h-full flex items-center justify-center text-ink3 text-sm">
                    <div className="text-center space-y-2">
                      <p>この軸はまだ出図されていません。</p>
                      <button
                        type="button"
                        onClick={() => setReleaseOpen(true)}
                        className="px-3 py-2 rounded-md bg-accent text-white text-xs min-h-[40px]"
                      >
                        + 出図 (PDFを登録)
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* View パネル: 旧来は画面下端 320px のアコーディオン展開だったが、
                  ストックマネジメント風モーダルポップアップへ刷新。
                  - activeTab がセットされた時のみ Modal を開く
                  - 各 View は内部に既にヘッダ (件数表示 / + 追加ボタン等) を持つ
                  - Modal は背景クリック / Esc で閉じる (Modal コンポーネント側で実装済)
                  - 高さは Modal 内に min-h-[60vh] で確保し、内部スクロールに任せる */}
              <Modal
                open={!!activeTab && !pdfFullscreen}
                onClose={() => setActiveTab(null)}
                title={activeTab ? TAB_LABELS[activeTab] : ""}
                width="960px"
              >
                <div className="h-[60vh] min-h-[420px] flex flex-col">
                  {activeTab === "related" && job && axis && (
                    <RelatedDocsView jobId={job.id} axisId={axis.id} />
                  )}
                  {activeTab === "replacements" && job && axis && (
                    <ReplacementsView
                      jobId={job.id}
                      axisId={axis.id}
                      currentVersionId={axis.current_version_id}
                    />
                  )}
                  {activeTab === "parts" && job && axis && (
                    <PartsListView jobId={job.id} axisId={axis.id} />
                  )}
                </div>
              </Modal>

              {/* Phase G: タブレット縦 (md 未満) 用 DXF フッター開閉ボタン。
                  md 以上では非表示 (サイドペインを使う)。
                  Phase H: 全画面 PDF 時は隠す */}
              <div
                className={`md:hidden border-t border-hair bg-white shrink-0 ${
                  pdfFullscreen ? "hidden" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setTabletDxfOpen((v) => !v)}
                  aria-expanded={tabletDxfOpen}
                  className="w-full px-4 py-2 text-left text-xs text-ink2 flex items-center gap-2 min-h-[40px]"
                >
                  <span
                    className="text-accent transition-transform"
                    style={{ transform: tabletDxfOpen ? "rotate(90deg)" : "none" }}
                  >
                    ▸
                  </span>
                  <span className="font-medium">DXF ファイル</span>
                  <span className="text-ink4 text-[11px] ml-1">
                    {tabletDxfOpen ? "タップで閉じる" : "タップで開く"}
                  </span>
                </button>
                <div
                  className="overflow-hidden transition-[height] duration-200"
                  style={{ height: tabletDxfOpen ? 240 : 0 }}
                >
                  <div className="p-3 overflow-auto max-h-[240px]">
                    <DxfFileList
                      jobId={job.id}
                      axisId={axis.id}
                      axisName={axis.name}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* デスクトップ専用: 右側 DXF サイドペイン (md 以上)。
                全画面 PDF 時もアクセスできるよう、paneCollapsed のみで開閉判定。 */}
            <aside
              className={`hidden md:flex bg-white border-l border-hair flex-col overflow-hidden transition-opacity ${
                paneCollapsed
                  ? "opacity-0 pointer-events-none"
                  : "opacity-100"
              }`}
            >
              <header className="flex items-center gap-2 px-4 py-3 border-b border-hair shrink-0">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
                  DXF ファイル
                </h3>
              </header>
              <div className="flex-1 overflow-auto p-3">
                <DxfFileList jobId={job.id} axisId={axis.id} axisName={axis.name} />
              </div>
            </aside>

            {/* デスクトップ専用: 右ペイン開閉タブボタン。
                全画面 PDF 時も表示し、DXF 一覧へアクセスできるようにする。 */}
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
          </div>

          <ReleaseModal
            open={releaseOpen}
            onClose={() => setReleaseOpen(false)}
            jobId={job.id}
            axisId={axis.id}
          />
        </>
      )}

      <NewAxisModal
        open={newAxisOpen}
        onClose={() => setNewAxisOpen(false)}
        jobId={job.id}
        nextSortOrder={(job.axes[job.axes.length - 1]?.sort_order ?? 0) + 1}
      />
    </div>
  );
}
