// Phase J: DXF はフォルダ単位で扱う。
//   - 旧 「📁 フォルダから一括取込」ボタンは廃止 (常に 404 で機能していなかった)。
//   - 「+ DXF を追加」 → AddDxfModal (フォルダ選択)。
//   - 「📑 履歴」 → VersionHistoryPanel (閲覧 + DL のみ)。
//   - 「⚙ DXF を編集」 → EditDocumentModal (削除/入替/復元)。
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDxfFiles, type DxfFile } from "../api/dxf";
import { AddDxfModal } from "./AddDxfModal";
import { EditDocumentModal } from "./EditDocumentModal";
import { LinkBrokenBadge, linkBrokenRowClass } from "./LinkBrokenBadge";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

interface Props {
  jobId: string;
  axisId: number;
  axisName: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * 現行 DXF 一覧から「共通フォルダパス」を推定する (Phase J)。
 *   - 全 file_path の親フォルダが揃っていればそれを返す
 *   - 揃わなければ最新行の親フォルダを返す (fallback)
 *   - データなしは null
 */
function inferCurrentFolder(files: DxfFile[]): string | null {
  if (files.length === 0) return null;
  const parents = files.map((f) => {
    const idx = f.file_path.lastIndexOf("/");
    return idx >= 0 ? f.file_path.slice(0, idx) : "";
  });
  const unique = new Set(parents);
  if (unique.size === 1) {
    return parents[0] ?? null;
  }
  return parents[0] ?? null;
}

export function DxfFileList({ jobId, axisId, axisName }: Props) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useDxfFiles(jobId, axisId);
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Phase I: DXF には PDF のような version_no が無いので、active 行のうち
  // 最新 created_at のものを「現行」扱いにする (useDxfFiles は created_at DESC で返す)。
  const currentDxfId = data && data.length > 0 ? (data[0]?.id ?? null) : null;
  const hasActiveDxf = data !== undefined && data.length > 0;

  // 規約フォルダ: 設計/{jobId}/{axisName}
  const conventionFolder = `設計/${jobId}/${axisName}`;
  const currentFolderPath = inferCurrentFolder(data ?? []) ?? conventionFolder;

  const open = (d: DxfFile) => {
    // Phase M: DXF ページの右ペイン (DxfFileList そのもの) も同じパス上に置くため、
    // 軸情報 (axisId / axisName) も URL に含めて DxfPage 側で再利用できるようにする。
    const qs = new URLSearchParams({
      dxfId: String(d.id),
      axisId: String(axisId),
      axisName,
    });
    navigate(`/jobs/${encodeURIComponent(jobId)}/dxf?${qs.toString()}`);
  };

  return (
    <div className="space-y-2 text-sm h-full flex flex-col min-h-0">
      {isLoading && <p className="text-ink3 text-xs">読み込み中…</p>}
      {error && (
        <p className="text-red-600 text-xs">
          一覧の取得に失敗しました ({(error as Error).message})
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-ink3 text-xs">
          この軸にはまだ DXF が登録されていません。
        </p>
      )}
      <ul className="space-y-1 overflow-auto flex-1 min-h-0">
        {data?.map((d) => {
          const name = d.file_path.split("/").pop() ?? d.file_path;
          return (
            <li
              key={d.id}
              className={`rounded-md ${linkBrokenRowClass(d.is_link_broken)}`}
            >
              <button
                type="button"
                onClick={() => open(d)}
                className="w-full text-left px-2 py-1.5 rounded-md text-xs border border-hair bg-white hover:border-accent hover:text-accent"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-accent">›</span>
                  <span className="font-mono truncate flex-1" title={d.file_path}>
                    {name}
                  </span>
                  {d.is_link_broken && (
                    <LinkBrokenBadge filePath={d.file_path} />
                  )}
                </div>
                <div className="flex items-baseline gap-2 mt-0.5 pl-4 text-[10px] text-ink4">
                  {d.label && (
                    <span className="text-ink3">{d.label}</span>
                  )}
                  <span>登録 {fmtDate(d.created_at)}</span>
                  {d.size != null && <span>{(d.size / 1024).toFixed(0)} KB</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2 pt-1 border-t border-hair shrink-0">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex-1 text-xs px-2 py-2 rounded-md border-2 border-accent text-accent hover:bg-cyan-50 min-h-[40px]"
        >
          + DXF を追加
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          title="アーカイブ済の DXF を含む全件履歴を閲覧 (DL のみ)"
          className="text-xs px-2 py-2 rounded-md border border-hair text-ink2 hover:border-accent hover:text-accent min-h-[40px]"
        >
          📑 履歴
        </button>
        {hasActiveDxf && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            title="DXF を編集 (削除・入替・復元)"
            className="text-xs px-2 py-2 rounded-md border-2 border-accent text-accent hover:bg-cyan-50 min-h-[40px]"
          >
            ⚙ DXF を編集
          </button>
        )}
      </div>

      <AddDxfModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        jobId={jobId}
        axisId={axisId}
        defaultBrowsePath={conventionFolder}
      />

      <VersionHistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        jobId={jobId}
        axisId={axisId}
        currentVersionId={currentDxfId}
        kind="dxf"
      />

      <EditDocumentModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        kind="dxf"
        jobId={jobId}
        axisId={axisId}
        currentDxfFolderPath={currentFolderPath}
      />
    </div>
  );
}
