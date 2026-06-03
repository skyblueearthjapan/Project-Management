# Codex 引き渡しレポート

> Project Management v2 の最終仕上げ前の状態。Codex に「最終レビューと修正」を依頼するための引き継ぎ資料。
> 最終更新: 2026-05-24

---

## 1. 現状の到達点

### 動作状態
- `docker compose up -d --build` で **全 5 サービス起動 OK** (api / db / web / backup)
- `/api/v1/health` → `{"status":"ok","db":"ok"}` 応答
- `/api/v1/jobs?filter=all` → 工番一覧 OK
- `/api/v1/jobs/master/search?q=...` → 日程表 8,303 行から検索 OK
- `/shop` 現場モード → 200 OK
- バンドルサイズ: 初期 index 304KB / PdfViewer chunk 802KB (lazy 分離成功)
- 削除関数 grep: コードベース全体で **0 件** (CLAUDE.md §2.1 完全遵守)

### 実装フェーズ全完了
- **Phase A**: 刈り込み (★/Meili/MailModal/PdfViewer placeholder 化)
- **Phase B**: 4タブをフォルダ的 view (関連資料/差替/部品リスト/メール履歴) に再設計
- **Phase C**: メール業務統合 (T1〜T4 / MailComposeDialog / グローバル履歴)
- **Phase D**: リンク切れインライン表示 (link_check_results JOIN + 再チェック + 赤バッジ)
- **Phase E**: パス取得 UI (貼付 + アプリ内 Explorer 風フォルダブラウザ)
- **Phase F**: Marin-PDF 移植 (連続スクロール / 印刷 / ページ差替) + save-edited (新バージョンをサーバ元フォルダに保存、`open(path, "xb")` 排他作成)
- **Phase G**: タブレット最適化 (DXF タッチ対応 / 詳細画面タブレットレイアウト / `/shop` 現場モード) + PdfViewer lazy 化

### 各フェーズのレビュー実績
| フェーズ | Score | 修正済 |
|---|---|---|
| A | 6/10 | Blocker 1 + Major 4 |
| B | 8.5/10 | Major 5 (Phase C で吸収) |
| C | 8.5/10 | Major 4 |
| D | 8.5/10 | Major 4 |
| E | 7.5/10 | Major 4 |
| F | 7.5/10 | Blocker 1 + Major 2 |
| G | 8.0/10 | Major 2 |

### 最終レビュー (Opus × 2)
- **critic**: Blocker 2 + High 5 / Score 6.5/10 / 微修正後リリース可
- **security-reviewer**: Critical 1 + High 4 / Score 6/10 / 修正後可

→ Critical + High 9 件はすべて修正済み (LAN 制限配線・ActionLog 全API追記・HMAC・files API job_id 必須化・現場モード DXF タブ追加)

---

## 2. Codex に依頼したい残課題

### High 優先 (本番リリース前に対処推奨)

#### A. 差替フロー二重実装の統合 (critic H-3)
- 現状: `ReplacementsView.tsx` (旧 pdf_replacements 経路) + `PdfViewer` の save-edited (新経路) の **2 系統並走**
- 要件 §6.4 では「pdf_replacements は新規 UI では使わない」と明記
- 修正方針:
  - `ReplacementsView` の「+ 差替を登録」アクションを **「PdfViewer の差替モードを開く」誘導ボタン** に置換
  - 旧 `uploadPdfReplacement` 経路は backward compat のため残すが UI 経路は閉じる
- 影響ファイル: `frontend/src/components/views/ReplacementsView.tsx`

#### B. save-edited リトライループの siblings 再列挙 (critic H-5)
- 現状: IntegrityError → rollback → retry でも `siblings` は最初の 1 回しか列挙されない
- 並行 save-edited で同名衝突 → 409 で UX 悪化の可能性
- 修正: `_insert_version_with_retry` 風のループで毎回 `src_dir.iterdir()` を再列挙
- 影響ファイル: `backend/app/api/v1/axes.py` (`save_edited_version`)

#### C. Phase F Major 1: ピンチ Y 軸式の妥当性検証
- `frontend/src/components/DxfViewer.tsx` のピンチ補正式の Y 軸が「中点固定の厳密解」になっていないとレビュー指摘
- 実機タブレットで Y 方向ピンチが期待通り動くか実機検証必要
- 修正: 数式 derivation コメント + 実機テスト

### Medium 優先 (Phase 2 で対応推奨)

#### D. フロントテスト整備 (critic H-4)
- 現状: `frontend/` に `.test.*` / `.spec.*` ファイル 0 件
- 推奨: `vitest` でユニットテスト、`playwright` で smoke E2E
- 最優先候補:
  - `_infer_next_filename` 相当のフロント側挙動
  - MailComposeDialog のプレースホルダ展開
  - PdfViewer の差替フロー

#### E. critic Medium 全 6 件
- M-1: `Path.write_bytes` での同名衝突サイレント上書き (`mail.py:269`, `services/mail.py:52`) — UUID 接尾辞推奨
- M-2: `Axis.versions` の order_by を `version_no.desc()` に統一
- M-3: outlook-agent exe の配布手順を `DEPLOY.md` に追記
- M-4: `Path.resolve()` のシンボリックリンク追跡確認
- M-5: 廃止 `services/meili_sync.py` のヘッダコメント統一
- M-6: PdfViewer 820KB の追加分割 (pdf-lib を差替モード切替時に lazy)

#### F. critic Medium 補足
- 認証なし環境で X-Admin-Token 等の admin API 保護を追加検討
- CORS の `allow_headers=["*"]` を必要ヘッダに絞る

### Low 優先 (運用後段階で対応)

- Phase B レビュー Minor 7 件 (DRY / ヘッダ統合 / Tailwind 整理)
- Phase D レビュー Minor 7 件
- Phase E レビュー Minor 7 件
- Phase G レビュー Minor 7 件

---

## 3. Codex への作業依頼内容

以下を順番に潰してください:

1. **A (差替フロー統合)** — 1-2 時間
2. **B (siblings 再列挙)** — 30 分
3. **C (ピンチ Y 軸検証)** — 実機テストを伴うので簡易ドキュメント化で OK
4. **D (フロントテスト基盤)** — vitest 設定 + 5-10 ケースのサンプル
5. **E + F (Medium)** — できる範囲で

各修正後に:
- `cd backend && python -m compileall -q app`
- `cd frontend && npx tsc --noEmit && npm run build`
- `docker compose config --quiet`
- 削除関数 grep (`os.remove|Path.unlink|shutil.rmtree|fs.unlink|fs.rm|fs.rename`)
- Git commit 単位は「1 修正 = 1 コミット」推奨

---

## 4. CLAUDE.md 厳守事項 (引き継ぎ時必読)

- **§2.1 削除関数禁止**: `os.remove` / `Path.unlink` / `shutil.rmtree` / `fs.unlink` / `fs.rm` / `fs.rename` / `rm` / `mv` / `DROP TABLE` / `TRUNCATE` の使用禁止
  - ファイル削除が必要に見える場合は「中身書き換え」「placeholder 化」「new file with timestamp」で対応
- **§2.2 SMB 書込制限**: `/mnt/fileserver` は `:rw` だが新規作成のみ (`open(path, "xb")`)、上書き / rename / 削除禁止
- **§2.3 機密情報**: PII / メール本文 / SMTP 認証情報はログに出さない、`SecretStr` 使用
- **§2.4 入力検証**: Pydantic v2 / SQLAlchemy ORM のみ / React 自動エスケープ / `resolve_under` でパス検証
- **§3 言語規約**: Python 3.12 + ruff + mypy strict / TS 5.x + strict + noUncheckedIndexedAccess

---

## 5. 主要ファイル参照

| 用途 | ファイル |
|---|---|
| 要件定義 (v2) | `docs/REQUIREMENTS_v2.md` |
| 旧仕様 (archive) | `docs/REQUIREMENTS.md` (v1.0.4) |
| デプロイ手順 | `docs/DEPLOY.md` |
| 監査ログヘルパ | `backend/app/services/audit.py` |
| LAN 制限 | `backend/app/core/security.py` |
| save-edited | `backend/app/api/v1/axes.py:save_edited_version` |
| Marin-PDF コア | `frontend/src/marin/` |
| 統合 PDF Viewer | `frontend/src/components/PdfViewer.tsx` |
| 現場モード | `frontend/src/routes/ShopFloorView.tsx` |
| HMAC outlook-agent | `outlook-agent/agent/main.py` |

---

## 6. 起動手順 (動作確認用)

```powershell
cd "C:\Users\imaizumi.LINEWORKS-NET\Documents\Project Management"
# .env.example をコピーして必要に応じて OUTLOOK_AGENT_HMAC_KEY を上書き
Copy-Item .env.example .env -Force
docker compose up -d --build
docker compose exec api alembic upgrade head
# http://localhost:18080  (デスクトップモード)
# http://localhost:18080/shop  (現場モード)
```

本番デプロイは `docs/DEPLOY.md` を参照 (Windows Server + SMB :rw + ACL 二重防御)。
