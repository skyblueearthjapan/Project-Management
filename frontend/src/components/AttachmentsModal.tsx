// @deprecated — Phase B でフォルダ view 化のため未使用。Phase C 以降で完全削除予定。
//
// 旧実装: 関連資料 / 部品リスト / PDF差替を 1 つのモーダル内のタブで開く「入力モーダル中心 UI」。
// これは要件§6.1 と齟齬があり、本来は「タブ = フォルダ的 View」で書類の中身を見るのが主役。
// Phase B で `frontend/src/components/views/{RelatedDocsView,ReplacementsView,PartsListView}.tsx`
// に置き換え、JobDetailPage 下部のアコーディオンパネルで表示する方式に変更した。
//
// CLAUDE.md §2.1 (削除関数禁止) によりファイル削除はしない。
// Phase C で完全に不要となった時点で本ファイルは「削除タスク」として人手で整理する。

// 旧 Props 形状 (参考用):
// type LegacyProps = {
//   open?: boolean;
//   onClose?: () => void;
//   initialTab?: "related" | "parts" | "replace";
//   jobId?: string;
//   axisId?: number;
//   currentVersionId?: number | null;
// };

type Props = Record<string, unknown>;

export function AttachmentsModal(_props?: Props): null {
  // 何もレンダリングしない。呼出元は JobDetailPage から既に外している。
  return null;
}
