import { useState } from "react";
import { Modal } from "./Modal";
import { useCreateAxis } from "../api/jobs";

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  nextSortOrder: number;
}

const PRESETS = ["昇降軸", "旋回軸", "走行軸", "搬送軸", "傾斜軸"];

export function NewAxisModal({ open, onClose, jobId, nextSortOrder }: Props) {
  const create = useCreateAxis();
  const [name, setName] = useState("");
  const [thirdParty, setThirdParty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal open={open} onClose={onClose} title="軸を追加" width="480px">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          create.mutate(
            {
              jobId,
              body: { name: name.trim(), sort_order: nextSortOrder, third_party_required: thirdParty },
            },
            {
              onSuccess: () => {
                setName("");
                setThirdParty(false);
                onClose();
              },
              onError: (e) => setErr((e as Error).message),
            }
          );
        }}
      >
        <label className="block">
          <span className="text-ink2">軸名 (必須)</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="昇降軸"
            className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setName(p)}
                className="px-2 py-0.5 text-[11px] rounded-pill border border-hair text-ink3 hover:border-accent hover:text-accent"
              >
                {p}
              </button>
            ))}
          </div>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={thirdParty}
            onChange={(e) => setThirdParty(e.target.checked)}
          />
          <span className="text-ink2">第三者チェック必須</span>
        </label>
        {err && <p className="text-red-600 text-xs">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-hair rounded-md">
            キャンセル
          </button>
          <button
            type="submit"
            disabled={!name || create.isPending}
            className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
          >
            {create.isPending ? "追加中…" : "追加"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
