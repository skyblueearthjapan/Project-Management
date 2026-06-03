import type { AxisProgressRead } from "../api/jobs";
import { useUpdateProgress } from "../api/jobs";

const STATE_NEXT: Record<AxisProgressRead["state"], AxisProgressRead["state"]> = {
  notstarted: "inprogress",
  inprogress: "done",
  done: "notstarted",
};

const STATE_CLASS: Record<AxisProgressRead["state"], string> = {
  notstarted: "bg-white text-ink3 border-hair",
  inprogress: "bg-cyan-50 text-accent border-accent",
  done: "bg-accent text-white border-accent",
};

export function PhaseChips({ axisId, progress }: { axisId: number; progress: AxisProgressRead[] }) {
  const update = useUpdateProgress();
  return (
    <div className="flex flex-wrap gap-1.5">
      {progress.map((p) => (
        <button
          key={p.step_id}
          type="button"
          onClick={() =>
            p.code &&
            update.mutate({
              axisId,
              stepCode: p.code,
              state: STATE_NEXT[p.state],
            })
          }
          className={`px-2 py-0.5 text-[11px] rounded-pill border transition ${
            STATE_CLASS[p.state]
          }`}
          title={`${p.code ?? ""}: ${p.state}`}
        >
          {p.short_label ?? "?"}
        </button>
      ))}
    </div>
  );
}
