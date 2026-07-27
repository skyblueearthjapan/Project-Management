import { useState } from "react";
import {
  usePurchaseRequestsByJob,
  purchaseRequestFileUrl,
  purchaseReplyFileUrl,
  PURCHASE_STATUS_LABEL,
  type PurchaseRequest,
} from "../../api/purchaseRequests";

// 購入部品追加依頼 View (WS-B・契約 §4.2)。
// - KobanInstructionView を雛形にした Job 単位の一覧 + 閲覧。
// - **v1 は閲覧のみ**。依頼の作成・回答・ステータス操作は EXE 側が主経路
//   (実務の主戦場が購買担当の手元にあるため)。ここに操作を置くと二重管理になる。
// - 工番未定の依頼はこの画面には出ない (要件 §5.3。DB には記録されている)。

interface Props {
  jobId: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: string }) {
  const done = status === "answered";
  return (
    <span
      className={
        "shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium " +
        (done ? "bg-cyan-50 text-accent" : "bg-gray-100 text-ink2")
      }
    >
      {PURCHASE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function PurchaseRequestsView({ jobId }: Props) {
  const { data, isLoading } = usePurchaseRequestsByJob(jobId);
  const [openId, setOpenId] = useState<number | null>(null);

  const opened: PurchaseRequest | undefined = data?.find((d) => d.id === openId);
  // 表示中の依頼の最新回答 (分納・追加回答があるため複数あり得る)。
  const openedLatestReply = opened?.replies[opened.replies.length - 1];

  return (
    <div className="flex h-full flex-col text-sm">
      <header className="flex shrink-0 items-center gap-2 border-b border-hair px-4 py-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
          購入部品依頼
        </h3>
        <span className="text-xs text-ink3">{data?.length ?? 0} 件</span>
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && <p className="p-4 text-ink3">読み込み中…</p>}
        {data && data.length === 0 && (
          <p className="p-4 text-ink3">この工番の購入部品依頼はまだありません。</p>
        )}
        <ul className="divide-y divide-hair">
          {data?.map((d) => (
            <li key={d.id} className="px-4 py-2">
              <div className="flex items-center gap-2">
                <span aria-hidden>🧾</span>
                <button
                  type="button"
                  onClick={() => setOpenId(d.id)}
                  className="truncate font-medium text-left hover:text-accent"
                  title="クリックで部品リストを表示"
                >
                  {d.request_file_original_name}
                </button>
                {d.branch_no && (
                  <span className="shrink-0 text-xs text-ink3">枝番 {d.branch_no}</span>
                )}
                <StatusBadge status={d.status} />
                <span className="ml-auto shrink-0 text-xs text-ink3">
                  {formatDate(d.requested_at)}
                </span>
              </div>
              <div className="pl-6 text-xs text-ink3">
                依頼者: {d.requester_name}
                {d.replies.length > 0 && (
                  <>
                    {" ／ "}
                    回答 {d.replies.length} 件
                    {d.closed_at && `（完了 ${formatDate(d.closed_at)}）`}
                  </>
                )}
              </div>
              {d.replies.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-6 pt-1">
                  {d.replies.map((rep) => (
                    <a
                      key={rep.id}
                      href={purchaseReplyFileUrl(d.id, rep.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      📄 手配結果 {formatDate(rep.replied_at)}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 部品リスト Excel はブラウザで直接表示できないため、
          モーダルではダウンロードと回答 PDF の閲覧導線だけを出す。 */}
      {opened && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3"
          onClick={() => setOpenId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[90vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-md bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-hair px-4 py-2">
              <span aria-hidden>🧾</span>
              <span className="truncate font-medium">
                {opened.request_file_original_name}
              </span>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="ml-auto shrink-0 px-1 text-lg leading-none text-ink3 hover:text-ink"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 overflow-auto p-4 text-sm">
              <p className="text-ink2">
                依頼者: {opened.requester_name}（{formatDate(opened.requested_at)}）
              </p>
              {opened.branch_no && <p className="text-ink2">枝番: {opened.branch_no}</p>}
              <p className="text-ink2">
                ステータス: {PURCHASE_STATUS_LABEL[opened.status] ?? opened.status}
                {opened.closed_at && `（完了 ${formatDate(opened.closed_at)}）`}
              </p>
              {opened.note && <p className="whitespace-pre-wrap text-ink2">{opened.note}</p>}
              <a
                href={purchaseRequestFileUrl(opened.id)}
                className="inline-block rounded-md bg-accent px-3 py-1.5 text-white hover:opacity-90"
              >
                部品リストをダウンロード
              </a>
              {openedLatestReply && (
                <a
                  href={purchaseReplyFileUrl(opened.id, openedLatestReply.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-block rounded-md border border-hair px-3 py-1.5 text-ink hover:bg-cyan-50"
                >
                  最新の手配結果を開く
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
