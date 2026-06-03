# REFACTOR: メール機能の全廃と「資料特化」への整理 (設計書)

- 起票日: 2026-05-27
- 方針: 本アプリから **メール機能を全廃** し、**資料の保管・閲覧に特化** した専用ツールにする。
- 背景ポリシー: 「良いアプリは機能がシンプルで、ユーザーが全機能を最初から理解でき、詰め込みすぎない」。

## 0. 確定スコープ (ユーザー合意 2026-05-27)

| # | 論点 | 決定 |
|---|---|---|
| 1 | 範囲 | **メールのみ削除**。出図/版管理・軸別進捗・PDF/DXF閲覧・関連資料/差替図面/部品リストは**維持**。 |
| 2 | 済受領スキャン(scan-receipt) | **資料機能として存続**。mail モジュールから files 側へ移設。 |
| 3 | 管理タブ「メールテンプレ」「連絡先」 | **両方とも UI から削除**。 |
| 4 | outlook-agent/ (旧loopback方式) | 本アプリから**切り離す**。新メールexeは別物として後日開発。 |

### 将来像 (別メールexe)
ユーザーは「メール専用の別exe」を新規開発予定。そのexeが **本アプリの API 経由で接続** し、
(a) 差替図面など資料を取得して添付送信、(b) 送った資料を本アプリへ添付資料として保存する。
→ **本アプリの文書API(アップロード/配信)は維持** し、将来この用途に供する。本リファクタでは
文書APIを壊さないことを必須要件とする。

## 1. 設計原則 / 制約

- **§2.1 遵守 (最重要)**: `DROP TABLE` / `op.drop_table` / ファイル削除関数は禁止。
  - `models/__init__.py` は「autogenerate が拾えるよう必ず import」運用。**mail 系 ORM モデルを消すと
    次回 autogenerate が DROP 差分を生成し §2.1 違反** となる。
  - → **ORMモデルとテーブルは残す**。除去するのは API / service / schema / frontend / 設定のみ。
- **一方向依存**: mail コードは job/axis/version を参照するが、その逆 (業務側→mail) は
  `Job.mail_logs` の `viewonly` relationship のみ。削除しても FK 破壊なし。
- 機械整形と機能変更を混ぜない (§5)。1 commit = 1 目的。

## 2. 残すもの / 消すもの 一覧

### 2.1 残す (変更なし or 軽微)
- 工番一覧 / 工番詳細 / PDFビューア / DXFビューア / 軸別進捗
- 出図(版登録) ReleaseModal、差替 ReplacementsView、部品 PartsListView の**登録機能本体**
- 関連資料 RelatedDocsView
- **済受領スキャン** (files へ移設して存続)
- 管理タブ: 工程 / ユーザー / 作業者
- **ORMモデル/テーブル**: `mail_templates` `mail_logs` `mail_log_recipients` `contacts` (§2.1: 物理削除しない)
- **文書API全般** (アップロード/配信/添付) — 将来の別exe連携に使う

### 2.2 消す (バックエンド)
| 対象 | 内容 |
|---|---|
| `api/v1/__init__.py` | L14 `mail` import、L35 `include_router(mail.router, prefix="/mail")` を削除 |
| `api/v1/mail.py` | **scan-receipt を files へ移設後**、本ファイル削除 (templates/compose/logs/eml) |
| `schemas/mail.py` | 削除 (Recipient/MailComposeIn/AgentPayload/MailLogRead/MailTemplate* ) |
| `services/mail.py` | 削除 (build_eml / save_eml_to_uploads) |
| `services/outlook_agent.py` | 削除 (HMAC署名/agent POST) |
| `core/config.py` | `outlook_agent_port` / `outlook_agent_hmac_key` / `outlook_agent_token_ttl_sec` を削除 |
| `tests/test_mail.py` | 削除 (build_eml テスト1件) |
| `models/job.py` | `mail_logs` relationship と TYPE_CHECKING import を削除 (任意・安全) |

> 注: `models/mail.py` と `models/__init__.py` の mail import は **残す** (§2.1 / autogenerate 安全策)。
> `models/contact.py` も残す。Contact の API/管理UIは下記で除去するが、テーブルとモデルは保持。

### 2.3 消す (フロント)
| 対象 | 内容 |
|---|---|
| `api/mail.ts` | mail系(useMailLogs/useComposeMail/useGlobalMailLogs/mailEmlUrl)を削除。**scan-receipt関数は新モジュールへ移設** |
| `components/MailComposeDialog.tsx` | 削除 |
| `components/MailModal.tsx` | 削除 (既に空placeholder) |
| `components/views/MailHistoryView.tsx` | 削除 |
| `components/admin/MailHistoryAdmin.tsx` | 削除 |
| `components/admin/TemplatesAdmin.tsx` | 削除 |
| `components/admin/ContactsAdmin.tsx` | 削除 |
| `api/admin.ts` | `useMailTemplates`/`useUpsertMailTemplate`/`useContacts`系を削除 |
| `routes/AdminPage.tsx` | TABS から `mail-history`・`templates`・`contacts` を削除 → 残: 工程/ユーザー/作業者 |
| `routes/JobDetailPage.tsx` | `ActiveTab` から `"mail"` 削除、TAB_LABELS・ボタン・描画を削除 |
| `components/ReleaseModal.tsx` | T1メール連続起動・mail状態・import を削除 (出図登録で完了) |
| `components/views/ReplacementsView.tsx` | T2/T4メール連続起動・pendingMail・import を削除 (差替/受領登録で完了) |
| `components/views/PartsListView.tsx` | T3メール連続起動・mailVars・import を削除 (部品登録で完了) |

### 2.4 インフラ / 設定
| 対象 | 内容 |
|---|---|
| `docker-compose.yml` | api env の `OUTLOOK_AGENT_HMAC_KEY` / `OUTLOOK_AGENT_TOKEN_TTL_SEC` を削除。`CORS_ORIGINS` は維持(フロント用) |
| `.env` / `.env.example` | `OUTLOOK_AGENT_*` を削除。mail 関連コメント整理 |
| `outlook-agent/` | 本アプリのビルド対象外(既にスタンドアロン)。レガシー参照として残置(削除しない) |

## 3. scan-receipt の移設 (存続させるための具体策)

現状 `api/v1/mail.py` に同居している以下を **files 側へ移す**:
- `POST /scan-receipts` (受領PDFアップロード) → `POST /api/v1/files/scan-receipts`
- `POST /scan-receipts/by-path` (既存ファイル参照登録) → `POST /api/v1/files/scan-receipts/by-path`
- スキーマ `ScanReceiptOut` / `ScanReceiptByPathIn` も files 側へ
- audit action_type `scan_receipt.upload` / `scan_receipt.register_by_path` は維持

フロント:
- `api/mail.ts` の `uploadScanReceipt` / `registerScanReceiptByPath` を `api/files.ts`(新規 or 既存) へ移設し、URL を `/api/v1/files/...` に更新
- `LinkModal.tsx` の scan-receipt モードは存続。import 先のみ差し替え
- `ReplacementsView.tsx` の「+ 済受領」ボタンは存続。ただし登録後の **T4メール連続起動は削除**

## 4. DB の扱い (§2.1 準拠)

- `mail_templates` / `mail_logs` / `mail_log_recipients` / `contacts` テーブルは **物理削除しない**。
- 新規 migration は作らない (DROP も rename もしない)。ORM モデルを残すことで autogenerate も
  これらを「既存」と認識し DROP 差分を出さない。
- 既存データは保持される (過去のメール履歴は参照されなくなるが残る)。
- 本番で将来本当に削除したい場合は、運用契約上の承認を得てから別途対応 (本リファクタの対象外)。

## 5. 実装フェーズ (推奨順)

1. **scan-receipt 移設** (files へ): backend エンドポイント+schema 移動 → frontend api 移動 → LinkModal 参照更新。ここで疎通確認。
2. **フロント業務フローの脱メール**: ReleaseModal / ReplacementsView / PartsListView から mail 起動を除去 (登録で完了)。
3. **フロント mail UI 削除**: MailComposeDialog / MailModal / MailHistoryView / MailHistoryAdmin / TemplatesAdmin / ContactsAdmin、AdminPage・JobDetailPage のタブ、api/mail.ts 残部・api/admin.ts の mail/contacts hook。
4. **バックエンド mail 削除**: ルーター登録除去 → api/v1/mail.py 削除 → schemas/mail.py → services/mail.py → services/outlook_agent.py → config の outlook_agent_* → tests/test_mail.py → job.py の relationship。
5. **インフラ**: docker-compose / .env の OUTLOOK_AGENT_* 除去。
6. **検証** (§8 完了条件): `ruff check`/`ruff format --check`、`mypy`、`pytest`、フロント `tsc --noEmit`/`eslint`、削除系関数の grep 再確認、主要パスのブラウザ動作確認。

## 6. 検証チェックリスト

- [ ] backend 起動 OK、`/api/v1/mail/*` が消えている (404)
- [ ] `/api/v1/files/scan-receipts*` が動作 (済受領アップロード/参照)
- [ ] 出図/差替/部品/関連資料/済受領 の各登録が**メールダイアログを出さずに**完了
- [ ] 管理画面タブ: 工程/ユーザー/作業者 のみ
- [ ] 工番詳細タブ: 関連資料/差替図面/部品リスト (メール履歴なし)
- [ ] `tsc --noEmit` / `eslint .` エラー0、`ruff`/`mypy`/`pytest` パス
- [ ] mail 系テーブルは DB に**残っている** (DROP していない)

## 7. 影響を受けないことの確認 (将来の別exe連携)

- 文書アップロード/配信API (related/parts/replacement/attachments/files serve) は**全て維持**。
- → 別メールexe は将来これらの API を叩いて資料取得・添付保存が可能。
