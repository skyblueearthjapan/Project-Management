// Phase F: Marin-PDF の差替ピッカーを移植。
// 元コード: Marin-PDF-Workspace/src/components/ReplacePicker.tsx
// 変更点:
//   - クラス名 (`.replace-picker` 等) を Tailwind に置換
//   - 取り消しボタンは「×」テキストに簡素化 (Icon コンポーネントは持ち込まない)
import { useEffect, useRef, useState } from "react";
import type { DocSource } from "../types";
import { renderThumbnailHandle } from "../pdf/renderer";

interface RegisteredSource {
  id: number;
  name: string;
  /** 取得可能な API URL。パスのみ登録で実体取得不可なら null。 */
  url: string | null;
}

interface Props {
  docs: DocSource[];
  /** 登録済み差替図面 (アップロード/パス紐付け) を差込ソースとして選べるようにする。 */
  registered?: RegisteredSource[];
  onPick: (srcDocId: string, srcPageIndex: number) => void;
  onPickRegistered?: (url: string | null, name: string) => void;
  onCancel: () => void;
  onAddFiles: (files: FileList | File[] | null) => void;
}

export default function ReplacePicker({
  docs,
  registered = [],
  onPick,
  onPickRegistered,
  onCancel,
  onAddFiles,
}: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const prevLenRef = useRef(docs.length);
  const [pickedDocId, setPickedDocId] = useState<string>(docs[0]?.id ?? "");
  const [dropOver, setDropOver] = useState(false);

  // Auto-select the newly-added doc when docs grows.
  useEffect(() => {
    if (docs.length > prevLenRef.current && docs.length > 0) {
      const last = docs[docs.length - 1];
      if (last) setPickedDocId(last.id);
    } else if (!docs.find((d) => d.id === pickedDocId) && docs[0]) {
      setPickedDocId(docs[0].id);
    }
    prevLenRef.current = docs.length;
  }, [docs, pickedDocId]);

  const doc = docs.find((d) => d.id === pickedDocId);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(false);
    onAddFiles(e.dataTransfer.files);
  };

  return (
    <div className="bg-white border border-hair rounded-md p-3 mx-2 my-2 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm">
          <strong className="text-ink2">差し替え後のページを選択</strong>
          <span className="ml-2 text-ink3 text-xs">ファイル / 登録済み差替図面から選びます</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="閉じる"
          className="text-ink3 hover:text-ink text-lg leading-none px-2"
        >
          ×
        </button>
      </div>

      <div
        className={`flex items-center gap-3 px-3 py-2 rounded-md border-2 border-dashed cursor-pointer transition ${
          dropOver
            ? "border-accent bg-cyan-50"
            : "border-hair bg-bg hover:border-accent"
        }`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropOver(true);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          setDropOver(false);
        }}
        onDrop={onDrop}
      >
        <span className="text-accent text-xl">⇪</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-ink2">差替用 PDF をドロップ</div>
          <div className="text-[10px] text-ink3">クリックして選択 / Ctrl+V で貼り付け も可</div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={(e) => onAddFiles(e.target.files)}
        />
      </div>

      {registered.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] text-ink3 mb-1">登録済み差替図面から取り込む</div>
          <div className="flex flex-wrap gap-1">
            {registered.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={!r.url}
                onClick={() => onPickRegistered?.(r.url, r.name)}
                title={
                  r.url
                    ? "読み込んでページ候補に追加"
                    : "パスのみ登録のため実体を取得できません"
                }
                className="text-[11px] px-2 py-0.5 rounded-pill border bg-white text-ink2 border-hair hover:border-accent transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                📄 {r.name.replace(/\.pdf$/i, "")}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-2">
        {docs.map((d) => (
          <button
            type="button"
            key={d.id}
            onClick={() => setPickedDocId(d.id)}
            className={`text-[11px] px-2 py-0.5 rounded-pill border transition ${
              pickedDocId === d.id
                ? "bg-accent text-white border-accent"
                : "bg-white text-ink2 border-hair hover:border-accent"
            }`}
          >
            {d.name.replace(/\.pdf$/i, "")}
          </button>
        ))}
        {docs.length === 0 && (
          <div className="text-xs text-ink3">差し替え用のPDFを追加してください</div>
        )}
      </div>

      {doc && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {Array.from({ length: doc.pageCount }, (_, i) => (
            <PickerCard
              key={`${doc.id}-${i}`}
              doc={doc}
              pageIndex={i}
              onPick={() => onPick(doc.id, i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PickerCard({
  doc,
  pageIndex,
  onPick,
}: {
  doc: DocSource;
  pageIndex: number;
  onPick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const h = renderThumbnailHandle(doc.pdf, pageIndex, 110);
    h.promise
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      h.cancel();
    };
  }, [doc, pageIndex]);
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex-shrink-0 w-[88px] bg-white border border-hair rounded-sm p-1 hover:border-accent transition"
    >
      <div className="w-full aspect-[1/1.414] bg-bg rounded-sm overflow-hidden">
        {src ? (
          <img src={src} className="w-full h-full object-contain" alt="" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-hair to-bg" />
        )}
      </div>
      <div className="text-[10px] text-ink3 mt-0.5 text-center">p.{pageIndex + 1}</div>
    </button>
  );
}
