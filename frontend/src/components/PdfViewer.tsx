// Phase F: Marin-PDF コアを統合した PDF ビューア。
//
// このコンポーネントが Project Management の柱②「製造現場の DX ツール」の核となる
// PDF 編集 UI を担う。連続スクロール / 必要ページ印刷 / ページ差替 + 新バージョン保存 の
// 各機能は frontend/src/marin 配下のコアに依存する (詳細はそちらの先頭コメント参照)。
//
// Phase A〜D の互換性:
//   - props (url, onReplaceClick, isLinkBroken) は維持。Phase F で
//     (jobId, axisId, onVersionSaved) を追加。
//   - onReplaceClick は v1 では未使用 (本ビューア内で差替が完結するため) だが、
//     既存呼出元 (JobDetailPage) からの利用を壊さないため受け取りはする。
//
// CLAUDE.md 遵守:
//   - 削除関数は使わない (Marin-PDF と同様、ファイル削除 API は呼ばない)。
//   - サーバ保存は backend の save-edited エンドポイント経由で「新規作成のみ」。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocSource, ModeId, PageSlot, ZoomPercent } from "../marin/types";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../marin/types";
import PdfPageView from "../marin/components/PdfPageView";
import Thumbpane from "../marin/components/Thumbpane";
import ReplacePicker from "../marin/components/ReplacePicker";
import { loadPdf } from "../marin/pdf/renderer";
import { buildComposite, downloadBytes } from "../marin/pdf/operations";
import {
  usePdfRotations,
  useReplacePdfRotations,
} from "../api/pdf-rotations";
import { usePdfReplacements } from "../api/attachments";
import { printPdfBytes } from "../marin/pdf/print";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { EditDocumentModal } from "./EditDocumentModal";

interface Props {
  url: string | null | undefined;
  /** リンク切れ通知 (Phase D で導入)。 */
  isLinkBroken?: boolean;
  /** 新バージョン保存 API に渡す。指定が無ければ「サーバ保存」ボタンは無効化。 */
  jobId?: string;
  axisId?: number;
  /** Phase I: 履歴パネルで「現行」表示に使う。未指定なら履歴ボタンを出さない。 */
  currentVersionId?: number | null;
  /** Phase I: 履歴パネルの「+ 新バージョン追加」を押した時の親側ハンドラ。 */
  onRequestNewVersion?: () => void;
  /** 保存成功時に呼ばれる。親が ["job", jobId] を invalidate するためのフック。 */
  onVersionSaved?: (newVersionId: number) => void;
  /** 旧 placeholder 時代の互換用 (現状では未使用)。 */
  onReplaceClick?: () => void;
  /**
   * Phase G M-3: 現場モード向け閲覧専用フラグ。
   * true のとき: モード切替 (印刷/差替) ボタン・全ページ印刷・サーバ保存・ReplacePicker を非表示。
   * mode は "view" に固定される。タブレット現場での誤操作・混乱を防ぐ。
   */
  readOnly?: boolean;
  /** 全画面 PDF トグル (ツールバー内に「⛶」ボタンを出す)。未指定なら表示しない。 */
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface SavedVersion {
  id: number;
  version_no: number;
  pdf_path: string;
}

const ACCENTS = ["#06b6d4", "#0ea5e9", "#22c55e", "#f59e0b", "#a855f7"];

function enumeratePages(doc: DocSource): PageSlot[] {
  return Array.from({ length: doc.pageCount }, (_, i) => ({
    srcDocId: doc.id,
    srcPageIndex: i,
  }));
}

function genDocId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 登録済み差替図面 (replaced_pdf_path) を取得可能な API URL に変換する。
 *  UNC (\\server\..) / Windows 絶対 (C:\..) / mnt 直書きは API 経由で実体取得できないため null。 */
function registeredDocUrl(path: string, jobId: string): string | null {
  if (path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)) return null;
  const rel = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel.startsWith("mnt/")) return null;
  if (/^(replacements|releases|scans|related-docs|parts-lists|dxf)\//.test(rel)) {
    return `/api/v1/files/uploads?path=${encodeURIComponent(rel)}`;
  }
  // ファイルサーバ相対パス: serve_fileserver は job_id がパスに含まれることを要求する。
  if (rel.split("/").includes(jobId)) {
    return `/api/v1/files/fileserver?job_id=${encodeURIComponent(jobId)}&path=${encodeURIComponent(rel)}`;
  }
  return null;
}

export function PdfViewer({
  url,
  isLinkBroken = false,
  jobId,
  axisId,
  currentVersionId,
  onRequestNewVersion: _onRequestNewVersion, // Phase J: 履歴パネルから「+追加」を撤去したため未使用 (互換のため受け流す)
  onVersionSaved,
  readOnly = false,
  isFullscreen = false,
  onToggleFullscreen,
}: Props) {
  // Phase I: バージョン履歴モーダルの開閉状態。
  const [historyOpen, setHistoryOpen] = useState(false);
  // Phase J: 編集モーダルの開閉状態。
  const [editOpen, setEditOpen] = useState(false);
  const [docs, setDocs] = useState<DocSource[]>([]);
  // 元 PDF (= 表示中の主役) の docId。差替後も基本スロットの srcDocId はこれを指す。
  const [mainDocId, setMainDocId] = useState<string | null>(null);
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const [mode, setMode] = useState<ModeId>("view");
  const [zoom, setZoom] = useState<ZoomPercent>(ZOOM_DEFAULT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 印刷モード: 除外されたページの index 集合
  const [printOff, setPrintOff] = useState<Set<number>>(new Set());
  // 差替モード: 差替対象のページ index
  const [replaceTarget, setReplaceTarget] = useState<number | null>(null);

  // 保存ダイアログ用
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFilename, setSaveFilename] = useState("");
  const [saveLabel, setSaveLabel] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [saveReleasedBy, setSaveReleasedBy] = useState("");

  // 編集が一度でも行われたか (= 差替がスロットに反映されているか)
  const hasReplacements = useMemo(() => slots.some((s) => s.replacedBy), [slots]);

  // Phase O: 表示回転メタの取得 + 保存。
  // PDF を作り直さず、(version_id, page_index) → rotation の軽量メタだけ保持する。
  const { data: rotationsData } = usePdfRotations(currentVersionId);
  const replaceRotationsMut = useReplacePdfRotations(currentVersionId);
  // request 2: 当該軸に登録済みの差替図面 (アップロード / パス紐付け) を差込ソース候補にする。
  const { data: registeredReplacements } = usePdfReplacements(jobId ?? "", axisId);
  // どの version にメタ適用済かを追跡し、再適用を防ぐ
  const rotationsAppliedForVersionRef = useRef<number | null>(null);

  // スクロール / レイアウト用 ref
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const widthRulerRef = useRef<HTMLDivElement | null>(null);
  const thumbListRef = useRef<HTMLDivElement | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewerWidth, setViewerWidth] = useState(640);
  const scrollLockUntilRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  // ----- 元 PDF の読み込み ---------------------------------------------------
  // url が変わるたびに fetch → loadPdf → docs / slots を初期化。
  useEffect(() => {
    if (!url) {
      setDocs([]);
      setMainDocId(null);
      setSlots([]);
      return;
    }
    let cancelled = false;
    setBusy("PDFを読み込み中…");
    setError(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`PDF取得失敗: HTTP ${res.status}`);
        }
        const ab = await res.arrayBuffer();
        const bytes = new Uint8Array(ab);
        const pdf = await loadPdf(bytes);
        if (cancelled) return;
        const newDoc: DocSource = {
          id: genDocId(),
          name: "主PDF.pdf",
          size: bytes.byteLength,
          bytes,
          pdf,
          pageCount: pdf.numPages,
          accent: ACCENTS[0]!,
        };
        setDocs([newDoc]);
        setMainDocId(newDoc.id);
        setSlots(enumeratePages(newDoc));
        setPrintOff(new Set());
        setReplaceTarget(null);
        setMode("view");
        setZoom(ZOOM_DEFAULT);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Phase O: version_id が変わったら適用済フラグをリセット (新しい PDF を読み込んだ扱い)
  useEffect(() => {
    rotationsAppliedForVersionRef.current = null;
  }, [currentVersionId, url]);

  // Phase O: PDF 読み込み完了 + 回転メタ取得 完了 のタイミングで、slot に回転を反映する。
  useEffect(() => {
    if (currentVersionId == null) return;
    if (!rotationsData) return;
    if (slots.length === 0) return;
    if (rotationsAppliedForVersionRef.current === currentVersionId) return;
    setSlots((prev) => {
      const next = prev.slice();
      for (const { page_index, rotation } of rotationsData) {
        if (page_index < 0 || page_index >= next.length) continue;
        const cur = next[page_index];
        if (!cur) continue;
        if (rotation === 0) continue;
        next[page_index] = { ...cur, rotation };
      }
      return next;
    });
    rotationsAppliedForVersionRef.current = currentVersionId;
  }, [currentVersionId, rotationsData, slots.length]);

  const hasFile = docs.length > 0 && slots.length > 0;

  // ----- 差替モード遷移時のリセット ------------------------------------------
  useEffect(() => {
    if (mode === "print") setPrintOff(new Set());
    if (mode === "replace") setReplaceTarget(null);
  }, [mode]);

  // ----- viewer 幅トラッキング ----------------------------------------------
  useEffect(() => {
    const el = widthRulerRef.current;
    if (!el) return;
    const apply = () => {
      const raw = el.clientWidth;
      // 20px ステップに丸めて再レンダ頻度を抑える
      const w = Math.max(280, Math.round((raw - 4) / 20) * 20);
      setViewerWidth((prev) => (prev === w ? prev : w));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasFile]);

  // ----- スクロール → 現在ページ + サムネ追従 -------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let rafId = 0;
    const runScrollSync = () => {
      rafId = 0;
      const pages = el.querySelectorAll<HTMLDivElement>("[data-pdf-page]");
      if (pages.length === 0) return;
      let best = 0;
      let bestDist = Infinity;
      const center = el.scrollTop + el.clientHeight * 0.45;
      pages.forEach((p, i) => {
        const dist = Math.abs(p.offsetTop + p.offsetHeight / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setCurrentPage(best + 1);
      if (Date.now() < scrollLockUntilRef.current) return;
      syncThumbToPage(best);
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(runScrollSync);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    runScrollSync();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [slots.length]);

  const syncThumbToPage = (idx: number) => {
    const tl = thumbListRef.current;
    if (!tl) return;
    const cards = tl.querySelectorAll<HTMLButtonElement>("button");
    const card = cards[idx];
    if (!card) return;
    const target = card.offsetTop - tl.clientHeight / 2 + card.clientHeight / 2;
    const maxTop = tl.scrollHeight - tl.clientHeight;
    const clamped = Math.max(0, Math.min(maxTop, target));
    if (Math.abs(tl.scrollTop - clamped) < 4) return;
    scrollLockUntilRef.current = Date.now() + 500;
    tl.scrollTo({ top: clamped, behavior: "smooth" });
  };

  const jumpToPage = (idx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const pages = el.querySelectorAll<HTMLDivElement>("[data-pdf-page]");
    const target = pages[idx];
    if (target) {
      scrollLockUntilRef.current = Date.now() + 500;
      el.scrollTo({ top: target.offsetTop - 24, behavior: "smooth" });
      syncThumbToPage(idx);
    }
  };

  // ----- サムネ列スクロール → メイン PDF 連動 ------------------------------
  // 既存の「メイン → サムネ追従」と双方向化するため、サムネ列のスクロール量に
  // 応じてメイン PDF を即座にジャンプさせる。
  // - scrollLockUntilRef を共有して相互発火 (無限ループ) を防止
  // - RAF スロットルでスクロール頻度を間引き
  const thumbScrollRafRef = useRef<number>(0);
  const onThumbScroll = useCallback(() => {
    if (Date.now() < scrollLockUntilRef.current) return;
    if (thumbScrollRafRef.current) return;
    thumbScrollRafRef.current = requestAnimationFrame(() => {
      thumbScrollRafRef.current = 0;
      const tl = thumbListRef.current;
      const el = scrollRef.current;
      if (!tl || !el) return;
      const cards = tl.querySelectorAll<HTMLButtonElement>("button");
      if (cards.length === 0) return;
      // サムネ列の中心を基準に「最も近いサムネ」を選び、そのページへメインを移す
      const centerY = tl.scrollTop + tl.clientHeight / 2;
      let best = 0;
      let bestDist = Infinity;
      cards.forEach((card, i) => {
        const cardCenter = card.offsetTop + card.clientHeight / 2;
        const dist = Math.abs(cardCenter - centerY);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      const pages = el.querySelectorAll<HTMLDivElement>("[data-pdf-page]");
      const target = pages[best];
      if (!target) return;
      const desiredTop = target.offsetTop - 24;
      if (Math.abs(el.scrollTop - desiredTop) < 4) return;
      scrollLockUntilRef.current = Date.now() + 500;
      el.scrollTo({ top: desiredTop, behavior: "auto" });
      setCurrentPage(best + 1);
    });
  }, []);
  useEffect(() => {
    return () => {
      if (thumbScrollRafRef.current) {
        cancelAnimationFrame(thumbScrollRafRef.current);
      }
    };
  }, []);

  // ----- ズーム ------------------------------------------------------------
  const setZoomPreservePage = useCallback(
    (nextZoom: number) => {
      const targetIdx = Math.max(0, currentPage - 1);
      setZoom(nextZoom);
      scrollLockUntilRef.current = Date.now() + 600;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (!el) return;
          const pages = el.querySelectorAll<HTMLDivElement>("[data-pdf-page]");
          const tgt = pages[targetIdx];
          if (!tgt) return;
          scrollLockUntilRef.current = Date.now() + 500;
          el.scrollTo({ top: tgt.offsetTop - 24, behavior: "auto" });
        });
      });
    },
    [currentPage],
  );

  const adjustZoom = (delta: number) => {
    const next = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, Math.round((zoom + delta) / ZOOM_STEP) * ZOOM_STEP),
    );
    if (next === zoom) return;
    setZoomPreservePage(next);
  };

  // ----- 差替モード: 追加 PDF の取り込み ------------------------------------
  const ingestFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const list = Array.from(files).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (list.length === 0) {
        showToast("PDFファイルを選択してください");
        return;
      }
      setBusy("差替PDFを読み込み中…");
      try {
        const added: DocSource[] = [];
        for (const file of list) {
          const ab = await file.arrayBuffer();
          const bytes = new Uint8Array(ab);
          const pdf = await loadPdf(bytes);
          added.push({
            id: genDocId(),
            name: file.name,
            size: file.size,
            bytes,
            pdf,
            pageCount: pdf.numPages,
            accent: ACCENTS[(docs.length + added.length) % ACCENTS.length]!,
          });
        }
        setDocs((prev) => [...prev, ...added]);
        showToast(`${list.length} 件のPDFを追加しました`);
      } catch (e) {
        console.error(e);
        showToast("PDF読込に失敗しました");
      } finally {
        setBusy(null);
      }
    },
    [docs.length, showToast],
  );

  // ----- 差替モード: 登録済み差替図面の取り込み (request 2) --------------------
  // ReplacementsView で登録 (アップロード or パス紐付け) 済みの差替図面を、サーバから
  // バイト列で取得して docs に追加する。以降はローカル取込 PDF と同様にページ選択できる。
  const ingestFromUrl = useCallback(
    async (url: string, name: string) => {
      setBusy("差替図面を読み込み中…");
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        const bytes = new Uint8Array(ab);
        const pdf = await loadPdf(bytes);
        setDocs((prev) => [
          ...prev,
          {
            id: genDocId(),
            name,
            size: bytes.byteLength,
            bytes,
            pdf,
            pageCount: pdf.numPages,
            accent: ACCENTS[prev.length % ACCENTS.length]!,
          },
        ]);
        showToast(`「${name.replace(/\.pdf$/i, "")}」を読み込みました`);
      } catch (e) {
        console.error(e);
        showToast("差替図面の読込に失敗しました (リンク切れ/取得不可の可能性)");
      } finally {
        setBusy(null);
      }
    },
    [showToast],
  );

  // 差込ソース候補に整形 (取得不可なら url=null)。
  const registeredSources = useMemo(() => {
    if (!jobId) return [] as { id: number; name: string; url: string | null }[];
    return (registeredReplacements ?? []).map((r) => ({
      id: r.id,
      name: r.replaced_pdf_path.split(/[\\/]/).pop() ?? r.replaced_pdf_path,
      url: registeredDocUrl(r.replaced_pdf_path, jobId),
    }));
  }, [registeredReplacements, jobId]);

  const pickRegistered = useCallback(
    (url: string | null, name: string) => {
      if (!url) {
        showToast("この差替図面は実体を取得できません (パスのみ登録)");
        return;
      }
      void ingestFromUrl(url, name);
    },
    [ingestFromUrl, showToast],
  );

  // ----- 差替適用 ---------------------------------------------------------
  const applyReplace = (srcDocId: string, srcPageIndex: number) => {
    if (replaceTarget == null) return;
    setSlots((prev) => {
      const next = prev.slice();
      const cur = next[replaceTarget];
      if (!cur) return prev;
      next[replaceTarget] = { ...cur, replacedBy: { srcDocId, srcPageIndex } };
      return next;
    });
    const d = docs.find((x) => x.id === srcDocId);
    showToast(
      `${replaceTarget + 1} ページ目を「${d?.name.replace(/\.pdf$/i, "")} p.${srcPageIndex + 1}」に差し替えました`,
    );
    setReplaceTarget(null);
  };

  const clearReplaceAt = (idx: number) => {
    setSlots((prev) => {
      const next = prev.slice();
      const cur = next[idx];
      if (!cur) return prev;
      const updated: PageSlot = { srcDocId: cur.srcDocId, srcPageIndex: cur.srcPageIndex };
      if (cur.rotation !== undefined) updated.rotation = cur.rotation;
      next[idx] = updated;
      return next;
    });
    showToast(`${idx + 1} ページ目の差替を取り消しました`);
  };

  // ----- ページ回転 --------------------------------------------------------
  // Phase O: 現在表示中のページを 90° 単位で回転。回転値は slot.rotation に積み、
  // 「回転を保存」ボタン押下時に /v1/versions/{id}/rotations へ PUT してメタとして
  // 永続化する (PDF ファイル自体は変更しない)。
  const rotateCurrentPage = useCallback((delta: 90 | -90) => {
    const idx = currentPage - 1;
    if (idx < 0) return;
    setSlots((prev) => {
      if (idx >= prev.length) return prev;
      const next = prev.slice();
      const cur = next[idx];
      if (!cur) return prev;
      const nextRot = ((((cur.rotation ?? 0) + delta) % 360) + 360) % 360;
      next[idx] = { ...cur, rotation: nextRot };
      return next;
    });
    setRotationDirty(true);
  }, [currentPage]);

  // 「保存」が必要かどうか。slot.rotation の状態とサーバ側メタの差を厳密に比較する
  // 代わりに、ボタン操作で立てるフラグ + 保存後にクリアで運用する。
  const [rotationDirty, setRotationDirty] = useState(false);

  // 任意ページの回転があるか (= 「回転を保存」ボタンの表示可否判定にも使う)
  const hasAnyRotation = useMemo(
    () => slots.some((s) => s && s.rotation !== undefined && s.rotation !== 0),
    [slots],
  );

  const saveRotations = useCallback(async () => {
    if (currentVersionId == null) {
      showToast("バージョン ID が無いため回転を保存できません");
      return;
    }
    // 回転 0 以外を抽出して送信。サーバ側で未送信の page_index は削除される。
    const items = slots
      .map((s, i) => ({ page_index: i, rotation: s?.rotation ?? 0 }))
      .filter((it) => it.rotation !== 0);
    try {
      await replaceRotationsMut.mutateAsync(items);
      setRotationDirty(false);
      showToast(
        items.length === 0
          ? "回転を全て解除しました"
          : `${items.length} ページの回転を保存しました`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [currentVersionId, slots, replaceRotationsMut]);

  // ----- 印刷 ------------------------------------------------------------
  const togglePrintExclude = (idx: number) => {
    setPrintOff((prev) => {
      const s = new Set(prev);
      if (s.has(idx)) s.delete(idx);
      else s.add(idx);
      return s;
    });
  };

  const printSelected = async () => {
    if (!hasFile) return;
    const pageIndices = slots
      .map((_, i) => i)
      .filter((i) => !printOff.has(i));
    if (pageIndices.length === 0) {
      showToast("印刷するページがありません");
      return;
    }
    setBusy("印刷データを生成中…");
    try {
      const filteredSlots = pageIndices
        .map((i) => slots[i])
        .filter((s): s is PageSlot => Boolean(s));
      const bytes = await buildComposite({ docs, slots: filteredSlots });
      printPdfBytes(bytes, "pm-print.pdf");
      showToast(`${pageIndices.length} ページをプレビューに送信しました`);
      setMode("view");
    } catch (e) {
      console.error(e);
      showToast("印刷の準備に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const printAll = async () => {
    if (!hasFile) return;
    setBusy("印刷データを生成中…");
    try {
      const bytes = await buildComposite({ docs, slots });
      printPdfBytes(bytes, "pm-print.pdf");
      showToast(`${slots.length} ページをプレビューに送信しました`);
    } catch (e) {
      console.error(e);
      showToast("印刷の準備に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  // ----- サーバ保存 ----------------------------------------------------------
  // 「差替で生成された composite PDF」をサーバ側に新バージョンとして送る。
  const openSaveDialog = () => {
    // ファイル名のデフォルト推定はサーバ側に任せるので空欄スタート。
    setSaveFilename("");
    setSaveLabel("");
    setSaveNote("");
    setSaveReleasedBy("");
    setSaveDialogOpen(true);
  };

  const submitSave = async () => {
    if (!jobId || axisId == null) {
      setError("jobId / axisId が指定されていません");
      return;
    }
    if (!hasFile) return;
    setBusy("PDFを生成中…");
    setError(null);
    try {
      const bytes = await buildComposite({ docs, slots });
      setBusy("ファイルサーバに保存中…");
      const fd = new FormData();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      // フォーム送信時のファイル名は控えめに。実際の保存名はサーバが推定する。
      fd.append("file", blob, "edited.pdf");
      if (saveFilename) fd.append("filename", saveFilename);
      if (saveLabel) fd.append("label", saveLabel);
      if (saveNote) fd.append("note", saveNote);
      if (saveReleasedBy) fd.append("released_by", saveReleasedBy);
      const res = await fetch(
        `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/save-edited`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const data = (await res.json()) as { detail?: string };
          if (data.detail) detail = data.detail;
        } catch {
          /* not JSON */
        }
        throw new Error(detail);
      }
      const saved = (await res.json()) as SavedVersion;
      showToast(`新バージョン v${saved.version_no} を保存しました`);
      setSaveDialogOpen(false);
      onVersionSaved?.(saved.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ----- 直接ダウンロード ----------------------------------------------------
  // 差替を反映した結合 PDF を、サーバに版を作らずその場で端末にダウンロードする。
  // 操作中ローカル/元ファイルは一切書き換えず、人が手元フォルダへコピーする運用を想定。
  const downloadComposite = useCallback(async () => {
    if (!hasFile) return;
    setBusy("PDFを生成中…");
    setError(null);
    try {
      const bytes = await buildComposite({ docs, slots });
      const baseName =
        docs.find((d) => d.id === mainDocId)?.name.replace(/\.pdf$/i, "") ?? "図面";
      const suffix = hasReplacements ? "_差替済み" : "";
      downloadBytes(bytes, `${baseName}${suffix}.pdf`);
      showToast("PDF をダウンロードしました");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [hasFile, docs, slots, mainDocId, hasReplacements, showToast]);

  // ----- サムネ用ソースラベル -----------------------------------------------
  const sourceLabelFor = useCallback(
    (idx: number) => {
      const slot = slots[idx];
      if (!slot) return "";
      const effective = slot.replacedBy ?? slot;
      const d = docs.find((x) => x.id === effective.srcDocId);
      if (!d) return "";
      // 元 PDF と異なるソースから来ているなら、差替元の名前を出す
      if (d.id !== mainDocId) return d.name.replace(/\.pdf$/i, "");
      return `p.${effective.srcPageIndex + 1}`;
    },
    [slots, docs, mainDocId],
  );

  // ----- レンダリング --------------------------------------------------------
  const printCount = hasFile ? slots.length - printOff.size : 0;

  // URL が空 = 未出図 (親 JobDetailPage 側で先に弾いているはずだが念のため)
  if (!url) {
    return (
      <div className="h-full flex items-center justify-center text-ink3 text-sm">
        PDF未登録
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* ツールバー。
          モバイルでは完全非表示にしてビューア領域を最大化する (ピンチズーム +
          スクロールで操作)。md 以上 (PC / タブレット横) だけで表示。
          右端は JobDetailPage の DXF 折畳タブ (絶対配置) と被るため
          `pr-8` で余白を確保。 */}
      <div className="hidden md:flex bg-white border-b border-hair items-center px-2 py-1.5 pr-8 gap-2 text-xs shrink-0">
        {/* モード切替 (PC のみ — モバイルはビューア専用なので印刷/差替は隠す) */}
        {!readOnly && (
          <>
            <div className="hidden md:flex items-center gap-1">
              <ModeButton
                current={mode}
                mode="view"
                label="閲覧"
                onClick={() => setMode("view")}
                disabled={!hasFile}
              />
              <ModeButton
                current={mode}
                mode="print"
                label="印刷"
                onClick={() => setMode("print")}
                disabled={!hasFile}
              />
              <ModeButton
                current={mode}
                mode="replace"
                label="差替"
                onClick={() => setMode("replace")}
                disabled={!hasFile}
              />
            </div>

            <span className="hidden md:inline w-px h-5 bg-hair" />
          </>
        )}

        {/* ページ番号 + ジャンプ */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasFile || currentPage <= 1}
            onClick={() => jumpToPage(currentPage - 2)}
            className="px-2 py-0.5 border border-hair rounded-md text-ink2 disabled:opacity-30 hover:border-accent"
            title="前のページ"
          >
            ↑
          </button>
          <input
            type="number"
            min={1}
            max={slots.length || 1}
            value={currentPage}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!isNaN(v) && v >= 1 && v <= slots.length) {
                jumpToPage(v - 1);
              }
            }}
            disabled={!hasFile}
            className="w-12 text-center font-mono border border-hair rounded-sm py-0.5"
          />
          <span className="text-ink3 font-mono">/ {slots.length || "-"}</span>
          <button
            type="button"
            disabled={!hasFile || currentPage >= slots.length}
            onClick={() => jumpToPage(currentPage)}
            className="px-2 py-0.5 border border-hair rounded-md text-ink2 disabled:opacity-30 hover:border-accent"
            title="次のページ"
          >
            ↓
          </button>
        </div>

        <span className="w-px h-5 bg-hair" />

        {/* ズーム */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasFile || zoom <= ZOOM_MIN}
            onClick={() => adjustZoom(-ZOOM_STEP)}
            className="px-2 py-0.5 border border-hair rounded-md text-ink2 disabled:opacity-30 hover:border-accent"
            title={`縮小 (-${ZOOM_STEP}%)`}
          >
            −
          </button>
          <span className="px-1 text-ink2 font-mono w-12 text-center">{zoom}%</span>
          <button
            type="button"
            disabled={!hasFile || zoom >= ZOOM_MAX}
            onClick={() => adjustZoom(ZOOM_STEP)}
            className="px-2 py-0.5 border border-hair rounded-md text-ink2 disabled:opacity-30 hover:border-accent"
            title={`拡大 (+${ZOOM_STEP}%)`}
          >
            +
          </button>
          <button
            type="button"
            disabled={!hasFile || zoom === ZOOM_DEFAULT}
            onClick={() => setZoomPreservePage(ZOOM_DEFAULT)}
            className="px-2 py-0.5 border border-hair rounded-md text-ink2 disabled:opacity-30 hover:border-accent"
            title="幅にフィット (100%)"
          >
            100%
          </button>
        </div>

        {/* 現在ページの回転 (左右 90°)。
            slot.rotation を更新するだけで PdfPageView / MiniThumb が即時再描画。
            実 PDF への書き込みは「サーバ保存」時の buildComposite でベイク。 */}
        {!readOnly && hasFile && (
          <>
            <span className="w-px h-5 bg-hair" />
            <button
              type="button"
              onClick={() => rotateCurrentPage(-90)}
              className="px-2 py-0.5 border border-hair rounded-md text-ink2 hover:border-accent"
              title="現在のページを左に 90° 回転"
            >
              ↺ <span className="ml-0.5">左回転</span>
            </button>
            <button
              type="button"
              onClick={() => rotateCurrentPage(90)}
              className="px-2 py-0.5 border border-hair rounded-md text-ink2 hover:border-accent"
              title="現在のページを右に 90° 回転"
            >
              ↻ <span className="ml-0.5">右回転</span>
            </button>
            {/* 回転変更があれば「回転を保存」ボタンを表示。
                PDF ファイルは変更せず、(version_id, page_index) → rotation を
                サーバの pdf_rotations にメタ保存するだけ。新バージョンは作らない。 */}
            {(rotationDirty || hasAnyRotation) && currentVersionId != null && (
              <button
                type="button"
                onClick={() => {
                  void saveRotations();
                }}
                disabled={replaceRotationsMut.isPending}
                className="px-2 py-0.5 rounded-md bg-accent text-white text-xs hover:bg-cyan-600 transition disabled:opacity-50"
                title="回転だけをサーバに保存 (PDF 本体は変更しない)"
              >
                💾{" "}
                <span className="ml-0.5">
                  {replaceRotationsMut.isPending ? "保存中…" : "回転を保存"}
                </span>
              </button>
            )}
          </>
        )}

        {/* バージョン履歴 / 編集ボタン: PC のみ (モバイルはビューア専用) */}
        {jobId && axisId != null && (
          <>
            <span className="hidden md:inline w-px h-5 bg-hair" />
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="hidden md:inline-flex px-2 py-0.5 border border-hair rounded-md text-ink2 hover:border-accent"
              title="このPDFの過去バージョンを閲覧 / ダウンロード"
            >
              📑 <span className="ml-0.5">履歴</span>
            </button>
            {currentVersionId != null && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="hidden md:inline-flex px-2 py-0.5 border-2 border-accent rounded-md text-accent hover:bg-cyan-50"
                title="現行PDFの除外・入替・過去版の復元など編集操作"
              >
                ⚙ <span className="ml-0.5">PDFを編集</span>
              </button>
            )}
          </>
        )}

        <div className="flex-1" />

        {/* 全画面トグル: 「全ページ印刷」の左隣に同サイズで配置。
            デザインは「PDFを編集」と同じ「白地 + アクセント色の太枠 + アクセント色の文字」。
            通常時は「⛶ PDF全画面表示」、全画面中は「⛶ 戻る」を表示。Esc キーでも戻れる。 */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="px-3 py-1 rounded-md bg-white border-2 border-accent text-accent text-xs hover:bg-cyan-50 transition"
            title={isFullscreen ? "全画面を解除 (Esc)" : "PDFを全画面で表示 (Esc で戻る)"}
            aria-pressed={isFullscreen}
          >
            ⛶ {isFullscreen ? "戻る" : "PDF全画面表示"}
          </button>
        )}

        {/* 全ページ印刷 + ダウンロード: PC のみ (モバイルは非表示) */}
        {!readOnly && mode === "view" && (
          <>
            <button
              type="button"
              disabled={!hasFile}
              onClick={downloadComposite}
              className="hidden md:inline-block px-3 py-1 rounded-md bg-white border-2 border-accent text-accent text-xs hover:bg-cyan-50 disabled:opacity-50"
              title="表示中の PDF (差替を反映) をこの端末にダウンロード"
            >
              ⬇ ダウンロード
            </button>
            <button
              type="button"
              disabled={!hasFile}
              onClick={printAll}
              className="hidden md:inline-block px-3 py-1 rounded-md bg-accent text-white text-xs disabled:opacity-50"
            >
              全ページ印刷
            </button>
          </>
        )}
        {!readOnly && mode === "print" && (
          <>
            <button
              type="button"
              onClick={() => setPrintOff(new Set())}
              className="px-2 py-1 border border-hair rounded-md text-ink2 hover:border-accent"
            >
              すべて印刷
            </button>
            <button
              type="button"
              onClick={() => setPrintOff(new Set(slots.map((_, i) => i)))}
              className="px-2 py-1 border border-hair rounded-md text-ink2 hover:border-accent"
            >
              すべて除外
            </button>
            <button
              type="button"
              disabled={printCount === 0}
              onClick={printSelected}
              className="px-3 py-1 rounded-md bg-accent text-white disabled:opacity-50"
            >
              選択ページを印刷 ({printCount})
            </button>
          </>
        )}
        {!readOnly && mode === "replace" && (
          <>
            <span className="text-ink3">
              {replaceTarget === null
                ? "差し替えたいページをクリック"
                : `ページ ${replaceTarget + 1} を差替中`}
            </span>
            <button
              type="button"
              disabled={!hasFile}
              onClick={downloadComposite}
              className="px-3 py-1 rounded-md bg-white border-2 border-accent text-accent disabled:opacity-50 hover:bg-cyan-50"
              title="差替を反映した結合 PDF をこの端末にダウンロード (サーバに版は作りません)"
            >
              ⬇ ダウンロード
            </button>
            <button
              type="button"
              disabled={!hasReplacements || !jobId || axisId == null}
              onClick={openSaveDialog}
              className="px-3 py-1 rounded-md bg-accent text-white disabled:opacity-50"
              title={
                !hasReplacements
                  ? "差替を確定してから保存できます"
                  : "新バージョンとしてサーバに保存"
              }
            >
              サーバに保存
            </button>
          </>
        )}
      </div>

      {/* リンク切れ警告 */}
      {isLinkBroken && (
        <div
          role="alert"
          className="bg-red-50 border-b border-red-300 text-red-700 text-xs px-3 py-1.5 flex items-center gap-2"
        >
          <span aria-hidden>⚠️</span>
          このバージョンの PDF
          ファイルが見つかりません。参照先が移動または改名された可能性があります。
        </div>
      )}

      {/* エラー */}
      {error && (
        <div className="bg-red-50 border-b border-red-300 text-red-700 text-xs px-3 py-1.5">
          {error}
        </div>
      )}

      {/* 中央: ビューア + サイドサムネ */}
      <div className="flex-1 min-h-0 flex">
        {/* メインスクロール領域 */}
        <div className="flex-1 min-w-0 relative">
          {/* モバイル専用: ツールバーを隠す代わりに、画面左下に小さな
              ページ番号インジケータをオーバーレイ表示。スクロール + ピンチで
              ページ移動 / ズームができる。 */}
          {hasFile && slots.length > 0 && (
            <div className="md:hidden absolute bottom-2 left-2 z-10 bg-black/60 text-white px-2 py-0.5 rounded text-[11px] font-mono pointer-events-none">
              {currentPage} / {slots.length}
            </div>
          )}
          <div
            ref={scrollRef}
            className="absolute inset-0 overflow-y-auto px-4 py-4"
          >
            <div ref={widthRulerRef} className="w-full h-0" aria-hidden="true" />
            {!hasFile && !busy && !error && (
              <div className="text-center text-ink3 text-sm py-12">
                PDF を読み込めませんでした
              </div>
            )}
            {slots.map((slot, i) => (
              <PdfPageView
                key={i}
                slot={slot}
                docs={docs}
                zoom={zoom}
                viewerWidth={viewerWidth}
                pageNumber={i + 1}
                totalPages={slots.length}
                sourceLabel={
                  slot.replacedBy && mainDocId
                    ? docs
                        .find((d) => d.id === slot.replacedBy?.srcDocId)
                        ?.name.replace(/\.pdf$/i, "") ?? null
                    : null
                }
                selectable={mode === "replace" || mode === "print"}
                selected={mode === "replace" && replaceTarget === i}
                replacing={mode === "replace" && replaceTarget === i}
                dimmed={mode === "print" && printOff.has(i)}
                hideForPrint={mode === "print" && printOff.has(i)}
                onClick={() => {
                  if (mode === "replace") setReplaceTarget(i);
                  else if (mode === "print") togglePrintExclude(i);
                }}
                badge={
                  slot.replacedBy ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-pill bg-amber-100 border border-amber-300 text-amber-700">
                      差替済
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearReplaceAt(i);
                        }}
                        className="ml-1 text-amber-800 hover:text-amber-900"
                        title="この差替を取り消す"
                      >
                        ×
                      </button>
                    </span>
                  ) : null
                }
              />
            ))}

            {/* 差替モード時、対象ページが選ばれていれば一覧の最後にピッカーを表示
                (現場モード=readOnly では表示しない) */}
            {!readOnly && mode === "replace" && replaceTarget !== null && hasFile && (
              <ReplacePicker
                docs={docs.filter((d) => d.id !== mainDocId)}
                registered={registeredSources}
                onPick={applyReplace}
                onPickRegistered={pickRegistered}
                onCancel={() => setReplaceTarget(null)}
                onAddFiles={ingestFiles}
              />
            )}
          </div>
        </div>

        {/* 右: サムネサイドペイン */}
        {hasFile && (
          <Thumbpane
            slots={slots}
            docs={docs}
            currentPage={currentPage}
            onJump={jumpToPage}
            mode={mode}
            printOff={printOff}
            onTogglePrint={togglePrintExclude}
            replaceTarget={replaceTarget}
            sourceLabelFor={sourceLabelFor}
            listRef={thumbListRef}
            onListScroll={onThumbScroll}
          />
        )}
      </div>

      {/* 保存ダイアログ */}
      {saveDialogOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !busy && setSaveDialogOpen(false)}
        >
          <div
            className="bg-white rounded-md shadow-xl border border-hair w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-hair px-4 py-3">
              <h3 className="font-medium text-sm">新バージョンとして保存</h3>
              <button
                type="button"
                onClick={() => !busy && setSaveDialogOpen(false)}
                className="text-ink3 hover:text-ink text-lg leading-none"
                aria-label="閉じる"
              >
                ×
              </button>
            </header>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-xs text-ink3">
                編集結果をファイルサーバの元 PDF と同じフォルダに{" "}
                <strong className="text-ink2">新規ファイルとして</strong>{" "}
                書き込みます。元ファイルは変更されません。
              </p>

              <label className="block">
                <span className="text-ink2 text-xs">
                  ファイル名 (省略時はサーバが命名規約から推定)
                </span>
                <input
                  value={saveFilename}
                  onChange={(e) => setSaveFilename(e.target.value)}
                  placeholder="rev_02.pdf"
                  className="mt-1 w-full border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-ink2 text-xs">ラベル</span>
                  <input
                    value={saveLabel}
                    onChange={(e) => setSaveLabel(e.target.value)}
                    placeholder="再出図 1"
                    className="mt-1 w-full border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="text-ink2 text-xs">出図者</span>
                  <input
                    value={saveReleasedBy}
                    onChange={(e) => setSaveReleasedBy(e.target.value)}
                    placeholder="山田"
                    className="mt-1 w-full border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-ink2 text-xs">メモ</span>
                <textarea
                  value={saveNote}
                  onChange={(e) => setSaveNote(e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                />
              </label>

              {error && <p className="text-red-600 text-xs">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSaveDialogOpen(false)}
                  disabled={Boolean(busy)}
                  className="px-3 py-1.5 border border-hair rounded-md text-xs"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={submitSave}
                  disabled={Boolean(busy)}
                  className="px-3 py-1.5 rounded-md bg-accent text-white text-xs disabled:opacity-50"
                >
                  {busy ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Busy オーバーレイ */}
      {busy && !saveDialogOpen && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-30 pointer-events-none">
          <div className="bg-white rounded-md shadow-md border border-hair px-4 py-2 text-xs flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-hair border-t-accent rounded-pill animate-spin" />
            {busy}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-ink text-white text-xs px-3 py-1.5 rounded-md shadow-md z-40">
          {toast}
        </div>
      )}

      {/* Phase I: バージョン履歴モーダル (PdfViewer 外で開閉する prop はあえて受け取らず、
          ローカル state で完結させる。jobId/axisId 必須なので open ガードに含める)。
          Phase J: 履歴は閲覧+DL のみに簡素化されたため onRequestAdd は渡さない (= 編集ボタン側で行う)。 */}
      {jobId && axisId != null && (
        <VersionHistoryPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          jobId={jobId}
          axisId={axisId}
          currentVersionId={currentVersionId ?? null}
          kind="pdf"
        />
      )}

      {/* Phase J: 編集モーダル (現行除外/入替/復元/現行に戻す) */}
      {jobId && axisId != null && (
        <EditDocumentModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          kind="pdf"
          jobId={jobId}
          axisId={axisId}
          currentVersionId={currentVersionId ?? null}
        />
      )}
    </div>
  );
}

function ModeButton({
  current,
  mode,
  label,
  onClick,
  disabled,
}: {
  current: ModeId;
  mode: ModeId;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded-md border text-xs transition ${
        active
          ? "bg-cyan-50 border-accent text-accent font-medium"
          : "bg-white border-hair text-ink2 hover:border-accent"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {label}
    </button>
  );
}
