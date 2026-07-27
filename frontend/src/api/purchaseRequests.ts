import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// 購入部品追加依頼 (WS-B): 工番詳細タブ用の API クライアント。
// - 契約: docs/DESIGN_購入部品追加依頼.md §4.3
// - jobs.ts / attachments.ts / jobInstructions.ts は触らず、本ファイルで独立フェッチする。
// - v1 は **閲覧のみ**。登録・回答・ステータス操作は EXE 側が主経路のため画面には置かない。
// - 工番未定の依頼と、購入依頼だけで発生した工番は DOVE UI には出さない (要件 §5.3)。
//   そのため本フックは「工番に紐づいた依頼」だけを取得する。

export interface PurchaseReply {
  id: number;
  request_id: number;
  pdf_path: string;
  original_name: string | null;
  size: number | null;
  replied_by_account: string;
  replied_by_name: string | null;
  replied_at: string;
  note: string | null;
  created_at: string;
}

export interface PurchaseRequest {
  id: number;
  job_id: string | null;
  job_no_input: string | null;
  branch_no: string | null;
  requester_account: string;
  requester_name: string;
  requester_email: string;
  requested_at: string;
  request_file_path: string;
  request_file_original_name: string;
  request_file_size: number | null;
  subject: string | null;
  note: string | null;
  status: string;
  closed_at: string | null;
  archived_at: string | null;
  created_at: string;
  replies: PurchaseReply[];
  job_title: string | null;
  customer: string | null;
}

// アップロード実体は /mnt/uploads 配下。DB-id 解決型の専用配信を使う
// (パスを直接受け取る配信は使わない = Path Traversal 面を増やさない)。
export function purchaseRequestFileUrl(id: number): string {
  return `/api/v1/purchase-requests/${id}/file`;
}

export function purchaseReplyFileUrl(requestId: number, replyId: number): string {
  return `/api/v1/purchase-requests/${requestId}/replies/${replyId}/file`;
}

// GET /api/v1/purchase-requests/jobs/{job_id} → 工番に紐づく active な依頼 (依頼日 DESC)
export function usePurchaseRequestsByJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-requests", jobId],
    queryFn: () =>
      api<PurchaseRequest[]>(
        `/v1/purchase-requests/jobs/${encodeURIComponent(jobId ?? "")}`,
      ),
    enabled: Boolean(jobId),
  });
}

// ステータスの表示名。DB の値 (requested / ordered / answered) は変えずに画面側で訳す。
export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  requested: "依頼済",
  ordered: "手配済",
  answered: "回答済",
};
