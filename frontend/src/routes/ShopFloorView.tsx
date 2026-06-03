// @deprecated — 現場モード (Phase G で実装) は業務利用見送りのため廃止。
// CLAUDE.md §2.1 によりファイル削除はせず、エクスポートを placeholder に置換。
//
// 旧 ShopFloorListPage / ShopFloorDetailPage は工番一覧へリダイレクトされる
// (App.tsx の <Route path="/shop/*" /> で吸収)。
// 復活する場合は git 履歴から元実装を取得すること。

import { Navigate } from "react-router-dom";

export function ShopFloorListPage(): JSX.Element {
  return <Navigate to="/" replace />;
}

export function ShopFloorDetailPage(): JSX.Element {
  return <Navigate to="/" replace />;
}
