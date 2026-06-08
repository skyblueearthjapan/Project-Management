import { useEffect } from "react";

// 共通: ファイルを大きなポップアップ(モーダル)で表示する。
// - PDF は iframe で埋め込みプレビュー(クリック即・画面いっぱい)。
// - PDF 以外(Excel 等)はブラウザに埋め込めないため、呼び出し側で別タブを開く想定
//   (openFile ヘルパが出し分ける)。
// - 背景クリック / ✕ / Esc で閉じる。右上に「別タブで開く」リンクを残置。

export function isPdfPath(p: string): boolean {
  return /\.pdf$/i.test(p.trim());
}

export function fileBaseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

/**
 * クリック時の出し分け: PDF はポップアップ(setPreview)、それ以外は別タブ。
 */
export function openFile(
  url: string,
  name: string,
  setPreview: (v: { url: string; name: string } | null) => void,
): void {
  if (isPdfPath(name)) {
    setPreview({ url, name });
  } else {
    window.open(url, "_blank", "noreferrer");
  }
}

interface Props {
  url: string;
  name: string;
  onClose: () => void;
}

export function FilePreviewModal({ url, name, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-[94vh] w-[96vw] flex-col overflow-hidden rounded-md bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-4 py-2 shrink-0">
          <span aria-hidden>📄</span>
          <span className="font-medium truncate">{name}</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-accent hover:underline shrink-0"
          >
            別タブで開く
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-1 text-lg leading-none text-ink3 hover:text-ink shrink-0"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <iframe src={url} title={name} className="w-full flex-1 border-0" />
      </div>
    </div>
  );
}
