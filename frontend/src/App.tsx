import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { JobsListPage } from "./routes/JobsListPage";
import { JobDetailPage } from "./routes/JobDetailPage";
import { DxfPage } from "./routes/DxfPage";
import { AdminPage } from "./routes/AdminPage";
import { Topbar } from "./components/Topbar";

// 現場モード (/shop, /shop/jobs/:jobId) は Phase G で実装したが業務利用見送りで廃止。
// CLAUDE.md §2.1 によりファイル削除はせず、ShopFloorView.tsx は placeholder 化済。
// ルート定義もここから外し、誤って踏まれた場合は工番一覧へリダイレクトする。

export default function App() {
  const loc = useLocation();
  // 詳細画面 / DXF ページは画面いっぱいに広げる
  const isDetail = loc.pathname.startsWith("/jobs/");
  return (
    // DXF / 詳細画面では子の `flex-1` チェインが下まで正しく伸びる必要があるため、
    // root を `h-full`(=100%) に固定する。`min-h-full` だとビューポート高が確定せず、
    // 子の `flex-1 min-h-0` が 0px に潰れて WebGL canvas が描画されない問題があった。
    <div className="h-full flex flex-col">
      <Topbar />
      <main
        className={
          isDetail
            ? "flex-1 w-full flex flex-col min-h-0"
            : "flex-1 max-w-[1280px] mx-auto w-full px-4 py-6"
        }
      >
        <Routes>
          <Route path="/" element={<JobsListPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/jobs/:jobId/dxf" element={<DxfPage />} />
          <Route path="/admin" element={<AdminPage />} />
          {/* /shop と /shop/jobs/:jobId は廃止 → 工番一覧へ */}
          <Route path="/shop/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
