import { api } from "./client";

export interface JobMasterItem {
  job_no: string;
  title: string | null;
  customer: string | null;
  delivery_date: string | null;
  is_active: boolean;
  owner: string | null;
  source: string | null;
}

export interface JobMasterSearchResult {
  q: string;
  count: number;
  items: JobMasterItem[];
}

export async function searchJobMaster(
  q: string,
  opts: { onlyActive?: boolean; excludeExisting?: boolean; limit?: number } = {}
): Promise<JobMasterSearchResult> {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("only_active", String(opts.onlyActive ?? true));
  params.set("exclude_existing", String(opts.excludeExisting ?? true));
  params.set("limit", String(opts.limit ?? 20));
  return await api<JobMasterSearchResult>(`/v1/jobs/master/search?${params}`);
}
