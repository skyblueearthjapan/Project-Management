// Phase F: Marin-PDF の印刷ヘルパを移植 (印刷は元コードそのまま流用)。
// 元コード: Marin-PDF-Workspace/src/pdf/print.ts

/**
 * Open a PDF (as bytes) in a hidden iframe and trigger the browser's print dialog.
 * Falls back to opening the PDF in a new tab if iframe printing is blocked.
 */
export function printPdfBytes(bytes: Uint8Array, filename = "pm-print.pdf") {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.title = filename;
  iframe.src = url;
  document.body.appendChild(iframe);

  let printed = false;
  const tryPrint = () => {
    if (printed) return;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      printed = true;
    } catch (_) {
      // Cross-origin? fall back to new tab.
      window.open(url, "_blank", "noopener,noreferrer");
      printed = true;
    }
  };
  iframe.onload = () => {
    setTimeout(tryPrint, 250);
  };
  // Cleanup after print dialog closes (heuristic; we cannot reliably observe it).
  // CLAUDE.md §2.1: ファイル削除関数は使わず、DOM 要素の remove() のみ。
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (iframe.parentNode) iframe.remove();
  }, 60_000);
}
