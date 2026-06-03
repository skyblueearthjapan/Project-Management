import { type ReactNode, useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

export function Modal({ open, title, onClose, children, width = "560px" }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-md shadow-xl border border-hair w-full"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-hair px-4 py-3">
          <h3 className="font-medium">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink3 hover:text-ink text-lg leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
