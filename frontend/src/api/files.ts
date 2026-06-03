import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface BrowseEntry {
  name: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
  relpath: string;
}

export interface BrowseResult {
  path: string;
  // H-3: backend が echo する対象工番 (= Drawings/{job_id}/ 配下を列挙した証跡)
  job_id?: string;
  entries: BrowseEntry[];
}

// H-3: /v1/files/browse は job_id 必須化された。
// jobId が未指定 (=falsy) の場合は呼び出さない (enabled=false で空応答)。
export function useBrowse(jobId: string | undefined, path: string, enabled = true) {
  // path === "" は Drawings/{jobId}/ 直下を意味する。
  return useQuery({
    queryKey: ["browse", jobId ?? "", path],
    queryFn: () =>
      api<BrowseResult>(
        `/v1/files/browse?job_id=${encodeURIComponent(jobId ?? "")}&path=${encodeURIComponent(path)}`,
      ),
    enabled: enabled && Boolean(jobId),
    retry: 0,
  });
}

// 共通 URL 組み立てヘルパ (job_id 必須化に伴う重複コード削減用)。
// 既存呼び出し箇所は段階的にこのヘルパへ移行する。
export function fileserverUrl(jobId: string, relPath: string): string {
  return `/api/v1/files/fileserver?job_id=${encodeURIComponent(jobId)}&path=${encodeURIComponent(relPath)}`;
}
