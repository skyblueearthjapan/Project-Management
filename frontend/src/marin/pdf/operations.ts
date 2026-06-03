// Phase F: Marin-PDF の pdf-lib ベースの結合/差替適用ロジックを移植。
// 元コード: Marin-PDF-Workspace/src/pdf/operations.ts
// 変更点:
//   - PM v1 では split は使わない (= buildSplitSegments / zipSegments は持ち込まない)
//   - merge も持ち込まない (= mergeOrder 関連は持ち込まない)
//   - 必要なのは buildComposite (差替適用 + 必要ページ抽出) のみ
//   - downloadBytes は v1 では「サーバ保存」が主用途のため未使用だが、デバッグ用に残す
import { PDFDocument, degrees } from "pdf-lib";
import type { DocSource, PageSlot } from "../types";

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadBytes(bytes: Uint8Array, name: string) {
  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), name);
}

interface BuildArgs {
  docs: DocSource[];
  slots: PageSlot[];
}

async function loadSources(
  docs: DocSource[],
  slots: PageSlot[],
): Promise<Map<string, PDFDocument>> {
  const ids = new Set<string>();
  for (const slot of slots) {
    const eff = slot.replacedBy ?? slot;
    ids.add(eff.srcDocId);
  }
  const map = new Map<string, PDFDocument>();
  for (const id of ids) {
    const d = docs.find((x) => x.id === id);
    if (!d) continue;
    map.set(id, await PDFDocument.load(new Uint8Array(d.bytes)));
  }
  return map;
}

async function appendSlots(
  out: PDFDocument,
  slots: PageSlot[],
  sources: Map<string, PDFDocument>,
) {
  // ユーザー要件: ページ毎の回転 (slot.rotation) を保存時に PDF にベイクする。
  // 旧実装は同一ソースの連続スロットを 1 回の copyPages にまとめていたが、
  // ページ毎に setRotation する必要があるため 1 枚ずつ処理に変更
  // (PM の通常ファイルサイズ (~50 ページ程度) なら性能的に問題なし)。
  for (const raw of slots) {
    if (!raw) continue;
    const eff = raw.replacedBy ?? raw;
    const src = sources.get(eff.srcDocId);
    if (!src) continue;
    const [copied] = await out.copyPages(src, [eff.srcPageIndex]);
    if (!copied) continue;
    // slot.rotation は元のページ回転に対する追加角度。
    // ベイク後の回転 = 元の page.rotate + slot.rotation。
    const slotRot = raw.rotation ?? 0;
    if (slotRot) {
      const current = copied.getRotation().angle;
      const final = (((current + slotRot) % 360) + 360) % 360;
      copied.setRotation(degrees(final));
    }
    out.addPage(copied);
  }
}

export async function buildComposite({ docs, slots }: BuildArgs): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const sources = await loadSources(docs, slots);
  await appendSlots(out, slots, sources);
  return out.save();
}
