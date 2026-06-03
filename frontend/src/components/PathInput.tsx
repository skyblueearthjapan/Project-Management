import { useEffect, useRef, useState } from "react";
import { FolderBrowserModal } from "./FolderBrowserModal";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  initialBrowsePath?: string;
  fileFilter?: string[];
  className?: string;
  // 親で「貼付主役」と判断した時のみ初回フォーカスを要求する。
  // 汎用 PathInput が画面に複数あっても暴発しないよう、明示 opt-in。
  autoFocus?: boolean;
  // H-3: backend の /v1/files/browse は job_id 必須化された。
  // 「サーバを探す」モーダル経由のブラウズを工番に固定するために必須。
  jobId: string;
  // Phase J: フォルダ選択モード。
  //   "file"   = ファイルを 1 つ選ばせる (デフォルト、従来挙動)
  //   "folder" = フォルダを 1 つ選ばせる (DXF フォルダ単位登録用)
  selectMode?: "file" | "folder";
}

// パス入力欄。テキスト直接入力 (貼付OK) + 「サーバを探す」モーダル併用。
export function PathInput({
  value,
  onChange,
  placeholder,
  initialBrowsePath,
  fileFilter,
  className,
  autoFocus,
  jobId,
  selectMode = "file",
}: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // autoFocus 要求時は初回マウントで input にフォーカス。
  // ref ベースなのでブラウザ実装差や React の autofocus 警告を回避できる。
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  // selectMode 未指定 (= "file") の場合は従来の placeholder を維持。
  // "folder" モードは placeholder 未指定なら汎用文言を当てる。
  const effectivePlaceholder =
    placeholder ?? (selectMode === "folder" ? "フォルダパス…" : undefined);

  return (
    <>
      <div className={`flex gap-1 ${className ?? ""}`}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={effectivePlaceholder}
          spellCheck={false}
          className="flex-1 border border-hair rounded-md px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-xs border border-hair rounded-md bg-white hover:bg-slate-50 whitespace-nowrap"
        >
          サーバを探す
        </button>
      </div>
      <FolderBrowserModal
        open={open}
        onClose={() => setOpen(false)}
        onPick={(rel) => {
          onChange(rel);
          setOpen(false);
        }}
        initialPath={initialBrowsePath}
        fileFilter={fileFilter}
        jobId={jobId}
        selectMode={selectMode}
      />
    </>
  );
}
