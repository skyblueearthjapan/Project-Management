import type { AxisProgressRead } from "../api/jobs";

interface Props {
  progress: AxisProgressRead[];
  compact?: boolean;
}

export function PhaseProgressBar({ progress, compact }: Props) {
  const total = progress.length || 10;
  const done = progress.filter((p) => p.state === "done").length;
  const pct = Math.round((done / total) * 100);
  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-1"}>
      {!compact && (
        <div className="flex justify-between text-[11px] text-ink3">
          <span>進捗</span>
          <span>
            {done}/{total} ({pct}%)
          </span>
        </div>
      )}
      <div className="progress-bar flex-1">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {compact && (
        <span className="text-[11px] text-ink3 whitespace-nowrap">{pct}%</span>
      )}
    </div>
  );
}
