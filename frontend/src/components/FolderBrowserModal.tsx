import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useBrowse, type BrowseEntry } from "../api/files";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (relativePath: string) => void;
  initialPath?: string;
  fileFilter?: string[];
  // H-3: backend が job_id 必須化されたため、ブラウズスコープを工番に固定する。
  // 未指定の場合はモーダルを開いても空表示にする (任意工番のフォルダ列挙を遮断)。
  jobId: string;
  // Phase J: 選択対象。
  //   "file"   = ファイル/フォルダどちらも選択可 (フォルダはダブルクリックで降下、シングルで選択も可)
  //   "folder" = フォルダのみ選択可。ファイル行はクリック不可 (グレーアウト)。
  //              「このフォルダを選ぶ」ボタンで現在のフォルダ自体を確定もできる。
  selectMode?: "file" | "folder";
}

// 末尾スラッシュを整理して相対パスとして正規化。
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function parentOf(p: string): string {
  const n = normalize(p);
  if (!n) return "";
  const idx = n.lastIndexOf("/");
  return idx < 0 ? "" : n.slice(0, idx);
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function matchesFilter(name: string, filter: string[] | undefined): boolean {
  if (!filter || filter.length === 0) return true;
  const lower = name.toLowerCase();
  return filter.some((ext) => lower.endsWith(ext.toLowerCase()));
}

export function FolderBrowserModal({
  open,
  onClose,
  onPick,
  initialPath,
  fileFilter,
  jobId,
  selectMode = "file",
}: Props) {
  // 現在閲覧中のフォルダ (相対パス、空文字 = 最上位)
  const [currentPath, setCurrentPath] = useState<string>("");
  // ユーザが選択中のエントリ (フォルダ or ファイル)。「選ぶ」で確定。
  const [selected, setSelected] = useState<BrowseEntry | null>(null);
  // initialPath で 404 が返ったら最上位にフォールバックするためのフラグ
  const [fellBack, setFellBack] = useState(false);
  // キーボードでフォーカス中の行 (Explorer 風)。-1 は無選択。
  const [highlightIdx, setHighlightIdx] = useState<number>(-1);
  // 最初のフォーカス起点 (Tab トラップを擬似実現するため)
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // モーダルを開く度に初期化
  useEffect(() => {
    if (!open) return;
    setCurrentPath(normalize(initialPath ?? ""));
    setSelected(null);
    setFellBack(false);
    setHighlightIdx(-1);
  }, [open, initialPath]);

  // H-3: backend が job_id 必須化されたため jobId を必ず渡す。
  // currentPath="" は Drawings/{jobId}/ 直下を意味する。
  const { data, isLoading, isError } = useBrowse(jobId, currentPath, open);

  // エラー時は最上位にフォールバック (一度きり、無限ループ防止)
  useEffect(() => {
    if (isError && !fellBack && currentPath !== "") {
      setCurrentPath("");
      setFellBack(true);
    }
  }, [isError, fellBack, currentPath]);

  // パンくず生成
  const crumbs = useMemo(() => {
    if (!currentPath) return [] as { label: string; path: string }[];
    const parts = currentPath.split("/");
    const acc: { label: string; path: string }[] = [];
    let p = "";
    for (const part of parts) {
      p = p ? `${p}/${part}` : part;
      acc.push({ label: part, path: p });
    }
    return acc;
  }, [currentPath]);

  function enterFolder(entry: BrowseEntry) {
    if (!entry.is_dir) return;
    setCurrentPath(normalize(entry.relpath));
    setSelected(null);
    setHighlightIdx(-1);
  }

  function goUp() {
    if (!currentPath) return;
    setCurrentPath(parentOf(currentPath));
    setSelected(null);
    setHighlightIdx(-1);
  }

  function confirmPick() {
    if (!selected) return;
    onPick(selected.relpath);
  }

  const entries = data?.entries ?? [];

  // フォルダ移動でリストが変わった時、ハイライトを 0 番にリセットして起点を作る。
  // (load 中は空配列なので無効。データ着地後に初期化する。)
  useEffect(() => {
    if (!open) return;
    if (entries.length === 0) {
      setHighlightIdx(-1);
      return;
    }
    setHighlightIdx((prev) => (prev < 0 || prev >= entries.length ? 0 : prev));
    // entries の参照は変わるが length が変わらなければ維持する意図。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentPath, entries.length]);

  // モーダル開直後に list コンテナへフォーカスを移し、Tab の起点を作る。
  useEffect(() => {
    if (!open) return;
    // 描画後にフォーカスしないと null。setTimeout(0) で 1tick 後にずらす。
    const id = window.setTimeout(() => {
      listContainerRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // テキスト入力中 (パンくず内 button は除外) は素通り。今回 input は無いが将来に備える。
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (entries.length === 0) return;
      setHighlightIdx((prev) => {
        const next = prev < 0 ? 0 : Math.min(prev + 1, entries.length - 1);
        const entry = entries[next];
        if (entry) setSelected(entry);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (entries.length === 0) return;
      setHighlightIdx((prev) => {
        const next = prev <= 0 ? 0 : prev - 1;
        const entry = entries[next];
        if (entry) setSelected(entry);
        return next;
      });
    } else if (e.key === "Enter") {
      // ボタンや他要素上の Enter は素通し (ボタン click が走る)
      if (target.tagName === "BUTTON") return;
      e.preventDefault();
      const entry = highlightIdx >= 0 ? entries[highlightIdx] : null;
      if (entry) {
        if (entry.is_dir) {
          // folder モードでは Enter で「降下」ではなく「選択確定」とする。
          // (降下したい時はダブルクリックを使う)
          if (selectMode === "folder") {
            setSelected(entry);
          } else {
            enterFolder(entry);
          }
        } else if (selectMode !== "folder" && matchesFilter(entry.name, fileFilter)) {
          setSelected(entry);
          onPick(entry.relpath);
        }
      } else if (selected) {
        confirmPick();
      }
    } else if (e.key === "Backspace") {
      // テキスト入力以外での Backspace は「上へ」。
      e.preventDefault();
      goUp();
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="サーバを探す"
      width="720px"
    >
      <div className="space-y-3 text-sm" onKeyDown={handleKeyDown}>
        {/* パンくず + 上へボタン */}
        <div className="flex items-center gap-2 border-b border-hair pb-2">
          <button
            type="button"
            onClick={goUp}
            disabled={!currentPath}
            className="px-2 py-1 text-xs border border-hair rounded-md disabled:opacity-40 hover:bg-slate-50"
            title="上の階層へ"
          >
            ↑ 上へ
          </button>
          <div className="flex items-center gap-1 text-xs font-mono text-ink2 overflow-x-auto whitespace-nowrap">
            <button
              type="button"
              onClick={() => {
                setCurrentPath("");
                setSelected(null);
              }}
              className="hover:text-accent"
            >
              /
            </button>
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                <span className="text-ink4">/</span>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPath(c.path);
                    setSelected(null);
                  }}
                  className={
                    i === crumbs.length - 1
                      ? "text-ink font-medium"
                      : "hover:text-accent"
                  }
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* エントリ一覧 (listbox 風)。tabIndex=0 で Tab の起点になる。 */}
        <div
          ref={listContainerRef}
          tabIndex={0}
          role="listbox"
          aria-activedescendant={
            highlightIdx >= 0 && entries[highlightIdx]
              ? `browse-entry-${highlightIdx}`
              : undefined
          }
          className="border border-hair rounded-md h-72 overflow-auto bg-white focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {isLoading ? (
            <p className="p-4 text-ink3 text-xs">読み込み中…</p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-ink3 text-xs">このフォルダは空です。</p>
          ) : (
            <ul>
              {entries.map((e, idx) => {
                // folder モード: ファイル行は常に dimmed (選択不可)
                // file モード  : 既存挙動 (fileFilter にマッチしないファイルだけ dimmed)
                const dimmed =
                  selectMode === "folder"
                    ? !e.is_dir
                    : !e.is_dir && !matchesFilter(e.name, fileFilter);
                const isSelected = selected?.relpath === e.relpath;
                const isHighlighted = idx === highlightIdx;
                return (
                  <li key={e.relpath}>
                    <button
                      type="button"
                      id={`browse-entry-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={dimmed}
                      onClick={() => {
                        if (dimmed) return;
                        setSelected(e);
                        setHighlightIdx(idx);
                      }}
                      onDoubleClick={() => {
                        if (e.is_dir) enterFolder(e);
                        else if (!dimmed && selectMode !== "folder") {
                          setSelected(e);
                          onPick(e.relpath);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 border-b border-hair/60 last:border-b-0 text-xs text-left ${
                        isHighlighted
                          ? "bg-cyan-50"
                          : isSelected
                            ? "bg-cyan-50/60"
                            : dimmed
                              ? "text-ink4 cursor-not-allowed"
                              : "hover:bg-slate-50"
                      }`}
                    >
                      <span className="w-4 text-center">
                        {e.is_dir ? "📁" : "📄"}
                      </span>
                      <span className="flex-1 truncate font-mono">{e.name}</span>
                      <span className="w-20 text-right text-ink3">
                        {formatSize(e.size)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 選択中表示 + アクション */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-ink3 whitespace-nowrap">選択:</span>
          <span className="flex-1 text-xs font-mono text-ink2 truncate">
            {selected ? selected.relpath : "(未選択)"}
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-hair rounded-md text-xs"
          >
            キャンセル
          </button>
          {/* Phase J: folder モードでは「このフォルダを選ぶ」(= 現在の階層を確定) を追加。
              フォルダに降下した状態のまま「ここ」を選択するためのショートカット。 */}
          {selectMode === "folder" && (
            <button
              type="button"
              onClick={() => onPick(currentPath)}
              disabled={!currentPath}
              title="現在開いているフォルダ自体を選択する"
              className="px-3 py-1.5 border border-accent rounded-md text-xs text-accent hover:bg-cyan-50 disabled:opacity-50"
            >
              このフォルダを選ぶ
            </button>
          )}
          <button
            type="button"
            onClick={confirmPick}
            disabled={!selected || (selectMode === "folder" && !selected.is_dir)}
            className="px-3 py-1.5 rounded-md bg-accent text-white text-xs disabled:opacity-50"
          >
            選ぶ
          </button>
        </div>
      </div>
    </Modal>
  );
}
