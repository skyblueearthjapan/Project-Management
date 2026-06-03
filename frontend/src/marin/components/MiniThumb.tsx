// Phase F: Marin-PDF の小サムネ。
// 元コード: Marin-PDF-Workspace/src/components/MiniThumb.tsx
// 変更点:
//   - クラス名 (.mini-page-thumb 等) を Tailwind に置換
import { useEffect, useRef, useState } from "react";
import type { DocSource, PageSlot } from "../types";
import { renderThumbnailHandle } from "../pdf/renderer";

interface Props {
  slot: PageSlot;
  docs: DocSource[];
}

// 同セッション内でサムネを使い回すための簡易キャッシュ。
// M-5: data URL (base64) が累積するとメモリリークになるため、LRU 風に最大件数を
// 制限する (Map は挿入順を保つ → アクセス時に末尾へ詰め直し、上限超過時は最古を削除)。
const CACHE_MAX = 256;
const cache = new Map<string, string>();
const key = (id: string, idx: number) => `${id}#${idx}`;

function setCache(k: string, value: string): void {
  if (cache.has(k)) {
    // 既存キーは末尾に詰め直して LRU 順を更新
    cache.delete(k);
  } else if (cache.size >= CACHE_MAX) {
    // 容量超過 → 挿入順の先頭 (= 最古) を 1 件落とす
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, value);
}

function getCache(k: string): string | undefined {
  const value = cache.get(k);
  if (value !== undefined) {
    // LRU 風: アクセス時に末尾へ詰め直す
    cache.delete(k);
    cache.set(k, value);
  }
  return value;
}

export default function MiniThumb({ slot, docs }: Props) {
  const effective = slot.replacedBy ?? slot;
  const doc = docs.find((d) => d.id === effective.srcDocId);
  const rotation = slot.rotation ?? 0;
  const cacheKey = doc ? `${key(doc.id, effective.srcPageIndex)}@${rotation}` : "";
  const initial = cacheKey ? (getCache(cacheKey) ?? null) : null;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(initial);
  const [visible, setVisible] = useState<boolean>(initial !== null);

  useEffect(() => {
    if (initial !== null) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setVisible(true);
      },
      { rootMargin: "300px 0px 300px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [initial]);

  useEffect(() => {
    if (!doc) return;
    const cached = getCache(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }
    if (!visible) return;
    let cancelled = false;
    const h = renderThumbnailHandle(doc.pdf, effective.srcPageIndex, 110, rotation);
    h.promise
      .then((url) => {
        setCache(cacheKey, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        /* aborted or failed silently */
      });
    return () => {
      cancelled = true;
      h.cancel();
    };
  }, [doc, effective.srcPageIndex, rotation, cacheKey, visible]);

  return (
    <div
      ref={wrapRef}
      className={`w-full aspect-[1/1.414] bg-bg rounded-sm overflow-hidden border ${
        slot.replacedBy ? "border-amber-300" : "border-hair"
      }`}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-contain" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-hair to-bg" />
      )}
    </div>
  );
}
