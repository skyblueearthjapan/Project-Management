import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useJobs,
  type SortKey,
  type JobRead,
} from "../api/jobs";
import { MasterProgressBar, aggregatePhases } from "../components/MasterProgressBar";
import { NewJobModal } from "../components/NewJobModal";
import { StampGrid } from "../components/StampGrid";
import { AxisTabBar } from "../components/AxisTabBar";

type UiSort = Extract<SortKey, "due" | "id">;

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function DueDisplay({ deliveryDate }: { deliveryDate: string | null }) {
  const days = daysUntil(deliveryDate);
  if (deliveryDate === null) return <span className="text-ink4">納期未定</span>;
  const m = deliveryDate.slice(5).replace("-", "/");
  const tone =
    days === null
      ? "text-ink3"
      : days < 0
      ? "text-red-600 font-medium"
      : days <= 7
      ? "text-amber-700 font-medium"
      : "text-ink2";
  const note =
    days === null
      ? null
      : days < 0
      ? `${-days}日超過`
      : days === 0
      ? "本日"
      : `あと${days}日`;
  return (
    <span className={tone}>
      納期 {m}
      {note && <span className="ml-1 text-[11px]">· {note}</span>}
    </span>
  );
}

/**
 * 単一の軸の進捗 % を返す (done な工程数 / 全工程数)。
 * 工番一覧の右上大数字 / 軸タブ切替時の表示用。
 */
function axisPct(axis: { progress: { state: string }[] }): number {
  if (axis.progress.length === 0) return 0;
  const done = axis.progress.filter((p) => p.state === "done").length;
  return Math.round((done / axis.progress.length) * 100);
}

/**
 * 一覧行の左端に出す PDF 表紙サムネイル。
 *   - 出図済 PDF があれば 1 ページ目を画像表示 (loading="lazy" で遅延読込)
 *   - 無ければプレースホルダ
 *   - 画像取得失敗 (404 等) はプレースホルダにフォールバック
 *
 * アスペクト比は A3 横向き (420mm × 297mm ≒ √2 : 1)。
 *   - object-contain で「ページ全体が必ず収まる」(A4 縦などはレターボックス)
 *   - 横向き図面 (A3 landscape) が左右ピッタリ入る
 */
function CoverThumb({ versionId }: { versionId: number | null }) {
  // versionId 変化時は failed フラグもリセット (前の軸の失敗を引き摺らない)
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [versionId]);
  if (versionId === null || failed) {
    return (
      <div className="shrink-0 w-[140px] md:w-[192px] aspect-[1.414/1] bg-bg border border-hair rounded grid place-items-center text-ink4 text-[11px] select-none text-center px-2">
        PDFがありません
      </div>
    );
  }
  return (
    <div className="shrink-0 w-[140px] md:w-[192px] aspect-[1.414/1] bg-white border border-hair rounded overflow-hidden grid place-items-center">
      <img
        src={`/api/v1/files/version/${versionId}/thumbnail?w=400`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}

/**
 * Phase N-2: 工番一覧の 1 行全体を担うコンポーネント。
 *
 * 「選択中の軸」を state で保持し、以下を **その軸に連動** して切替える:
 *   - サムネイル (左側) — その軸の current_version の PDF 1 ページ目
 *   - 進捗バー — 単一軸ベースで描く
 *   - 押印グリッド — その軸の phase_stamps
 *
 * 並びは以下のとおり (上から順):
 *   1. タイトル行 (工番 / 客先 / 件名 / 軸数 / 納期 / %)
 *   2. 軸タブ (← Phase N-2 v2 でタイトル直下に移動)
 *   3. 進捗バー (← 軸タブの下)
 *   4. 押印グリッド (md 以上)
 *
 * 工番ごとに独立した state を持つため、別コンポーネントとして切出している。
 */
function JobRowBody({ job }: { job: JobRead }) {
  const sortedAxes = [...job.axes].sort((a, b) => a.sort_order - b.sort_order);
  const firstAxisId = sortedAxes[0]?.id ?? 0;
  const [selectedAxisId, setSelectedAxisId] = useState<number>(firstAxisId);
  // データ更新で軸構成が変わった場合のフォールバック
  const selectedAxis =
    sortedAxes.find((a) => a.id === selectedAxisId) ?? sortedAxes[0];

  // 右上の % は「選択中の軸」のみの進捗 (軸タブ切替で変化)。
  // ユーザー要望により、工番一覧では軸単位の数字を主体に据える。
  const pct = selectedAxis ? axisPct(selectedAxis) : 0;

  // 押印グリッド向け工程順は単一軸ベース (10 工程は全軸共通の前提)
  const phasesForGrid = selectedAxis ? aggregatePhases([selectedAxis]) : [];

  return (
    <>
      {/* 左: サムネイル (選択中の軸の current_version_id に連動) */}
      <CoverThumb versionId={selectedAxis?.current_version_id ?? null} />

      {/* 右カラム */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* タイトル行。モバイルは シンプル化 (工番 + 件名 + 客先 のみ)。
            PC のみ 軸数 / 納期 / % を追加表示する。 */}
        <div className="flex flex-wrap items-baseline gap-2">
          <Link
            to={`/jobs/${encodeURIComponent(job.id)}`}
            className="font-medium text-ink hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            {job.id}
          </Link>
          {job.customer && (
            <span className="text-ink3 text-xs">{job.customer}</span>
          )}
          <span className="text-ink2 truncate">{job.title}</span>
          {/* 軸数 / 納期 / % は PC のみ */}
          <span className="hidden md:inline text-ink4 text-xs">
            · {job.axes.length}軸
          </span>
          <span className="hidden md:inline ml-auto text-xs">
            <DueDisplay deliveryDate={job.delivery_date} />
          </span>
          <span className="hidden md:inline text-base font-semibold text-ink tabular-nums">
            {pct}
            <span className="text-xs text-ink3 font-normal">%</span>
          </span>
        </div>

        {/* 以下 (軸タブ / 進捗バー / 押印グリッド) はすべて PC のみ表示。
            モバイルは ビューア起動用カタログとして、検索 + サムネ + ID + 件名 のみで運用。 */}
        <div className="hidden md:block">
          {sortedAxes.length > 0 && selectedAxis && (
            <div className="mt-2">
              <AxisTabBar
                axes={sortedAxes}
                selectedAxisId={selectedAxis.id}
                onSelect={setSelectedAxisId}
              />
            </div>
          )}

          <div className="mt-2">
            {selectedAxis ? (
              <MasterProgressBar axes={[selectedAxis]} />
            ) : (
              <p className="text-[11px] text-ink4">軸未登録</p>
            )}
          </div>

          {selectedAxis && (
            <StampGrid axis={selectedAxis} phases={phasesForGrid} />
          )}
        </div>
      </div>
    </>
  );
}

export function JobsListPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<UiSort>("due");
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading, error } = useJobs({ q, sort });
  const navigate = useNavigate();

  const showingCount = useMemo(() => data?.items.length ?? 0, [data]);

  return (
    <div className="space-y-4">
      {/* ページタイトル + 件数 */}
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">工番</h1>
        <div className="text-xs text-ink3">{data ? `${data.total}件` : "..."}</div>
      </div>

      {/* 検索 + 並び順 + 新規 */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="工番 / 件名 / 客先で検索"
          className="border border-hair rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2 text-xs text-ink3">
          <span>並び順</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as UiSort)}
            className="border border-hair rounded-md px-2 py-1 text-sm bg-white"
          >
            <option value="due">納期</option>
            <option value="id">工番</option>
          </select>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="ml-auto px-3 py-1.5 rounded-md bg-accent text-white text-sm hover:bg-cyan-600"
        >
          + 新規工番
        </button>
      </div>

      <NewJobModal open={newOpen} onClose={() => setNewOpen(false)} />

      {isLoading && <p className="text-ink3 text-sm">読み込み中…</p>}
      {error && <p className="text-red-600 text-sm">エラー: {(error as Error).message}</p>}

      {data && data.items.length === 0 && (
        <div className="text-ink3 text-sm space-y-2">
          <p>該当する工番がありません。</p>
          {q && (
            <button
              onClick={() => setQ("")}
              className="text-accent text-xs hover:underline"
            >
              検索をクリア
            </button>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {data?.items.map((job) => (
          <article
            key={job.id}
            onClick={() => navigate(`/jobs/${encodeURIComponent(job.id)}`)}
            className="bg-white border border-hair rounded-md p-3 hover:border-accent transition cursor-pointer flex gap-3"
          >
            <JobRowBody job={job} />
          </article>
        ))}
      </div>

      {data && data.total > showingCount && (
        <p className="text-xs text-ink4 text-center">
          {showingCount} / {data.total} 件表示中
        </p>
      )}
    </div>
  );
}
