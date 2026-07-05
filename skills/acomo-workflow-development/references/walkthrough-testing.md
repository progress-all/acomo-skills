# ウォークスルーテスト手順（実走）

登録・公開したモデルを、[walkthrough-plan](harness-guide.md) の計画に沿って実際に走らせるときの正本。
CLI 操作の規約は acomo スキル（[SKILL.md](../../acomo/SKILL.md)。モノレポでは外部スキル — 無ければ `npm run skills:install`。配布リポジトリでは併設済み）に従う。

## 前提

1. モデルが `createWorkflowModel` で登録済み（modelId を控えている）
2. `acomo publishWorkflowModel --modelId <ID>` で公開済み（公開しないとプロセスを開始できない）
3. 実行ユーザーの認証が済んでいる（下記）

## 認証の準備

### 運用テナント（本番・dev 環境）

- `ACOMO_BASE_URL` / `ACOMO_TENANT_ID` / `ACOMO_ACCESS_TOKEN` を設定する。
- アクセストークンは管理者がサイドメニュー「認証」（`/authConfig`）の「アクセストークン」タブで発行する（acomo-ui スキル参照）。
- 認証エラー（終了コード 2）は試行錯誤せず、ユーザーにトークンの準備を依頼する。

### ローカル開発スタック（このモノレポの `dev:up` 環境）

エージェントが非対話でユーザーとして実走する場合、SuperTokens のパスワードサインイン API から
**セッションアクセストークン**を取得し、`ACOMO_ACCESS_TOKEN` に使える（短命なので実走の直前に取得する）。

```bash
# 例: 対象テナントのユーザーでサインインしてトークンを取得（jq 不要の最小形）
# <authTenantId> / <email> / <password> はテナントの実値に置換する
TOKEN=$(curl -s -D - -o /dev/null \
  -X POST "http://localhost:3000/api/v1/auth/<authTenantId>/signin" \
  -H 'Content-Type: application/json' -H 'st-auth-mode: header' \
  -d '{"formFields":[{"id":"email","value":"<email>"},{"id":"password","value":"<password>"}]}' \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="st-access-token"{print $2}')

export ACOMO_BASE_URL="http://localhost:3000"
export ACOMO_TENANT_ID="<authTenantId>"   # authTenantId を指定する
export ACOMO_ACCESS_TOKEN="$TOKEN"
acomo getCurrentUser   # 疎通確認
```

- `ACOMO_TENANT_ID` は **authTenantId**（サインイン URL の `authTenantId=` と同じ値）。
- このモノレポのローカル seed テナント・ユーザーは `AGENTS.md` の「Hello world（手動確認）」と
  `acomo-backend/prisma/seed*.data.ts` を参照。
- CLI 未インストールなら `npm -w @acomo/cli run build` 後に `acomo-cli/bin/acomo` を使う。

## アクター切り替え

タスクの actionPolicies により「誰が実行できるか」が縛られる。計画の「実行者」ヒントを見て、
経路上の各タスクを実行できるユーザーでトークンを取り直す（同一ユーザーで通せる場合はそのままでよい）。

- 実行できないはずのユーザーで操作して**拒否されること**も最低 1 ケース確認する（権限どおりに動く証跡になる）。
- **テスト用アクターの準備**（ローカル開発スタックで実走確認・2026-07-05）: 各アクターのロールに、モデルの actionPolicies が参照するロール + `Engine:execute` を含むロールが必要。ロール付与（`updateUser`）は OpenAPI 上 requestBody 未定義で CLI から body を渡せないため、curl で行う: `curl -X PUT $BASE/api/v1/users/<userId> -H "Authorization: Bearer <管理者token>" -H "x-tenant-id: <tenantId>" -H "Content-Type: application/json" -d '{"name":"...","email":"...","roleIds":["<roleId>", ...]}'`（`listUsers` / `listRoles` で id を確認）。

## 実走の型（1 経路あたり）

（ローカル開発スタック + CLI で実走検証済みの形）

```bash
# 0. 登録内容のサーバー側スキーマ検証（任意。ローカルの validate ハーネスと同じ AJV 定義）
acomo validateWorkflowModelSchema '{"definition":{...},"dataSchema":{...},"policy":{...}}'

# 1. 開始
acomo startWorkflowProcess --modelId <MODEL_ID>        # → 出力 JSON の id を PROCESS_ID に控える

# 2. タスクごとに: アクション（データ入り body）→ 現在ノード確認
#    body は dataSchema のキーをトップレベルに持つ「フラットな JSON」。{"data":{...}} で包まない。
acomo submitWorkflowProcess --processId <PROCESS_ID> '{"itemName":"...","amount":1000}'
acomo approveWorkflowProcess --processId <PROCESS_ID> '{"approverComment":"..."}'   # または reject
acomo getWorkflowProcess --processId <PROCESS_ID>      # token.nodeId が期待ノードか確認
acomo getProcessWithNodeActions --processId <PROCESS_ID>   # 残っているアクションの確認

# 3. 終了確認: status が DONE で、token.nodeId が期待した終了イベントのノード ID であること
```

- 並列区間は `approveWorkflowProcessWithNodeId` 等の `--nodeId` 付きコマンドを使う（計画に出力される）。
- 差し戻し（`canRevert`）を業務で使うなら `revertWorkflowProcess --processId <ID> --nodeId <戻り先nodeId>` を 1 回は通す。

### 既知の制約（実測）

- **`saveWorkflowProcess` は CLI からデータを渡せない**（OpenAPI 上 requestBody が定義されておらず、生成クライアントに body 引数がない）。CLI 実走ではデータは**アクションコマンドの body で一緒に渡す**。画面のフォーム保存は別経路なので影響しない。
- **完了後のプロセスデータの見え方は終了イベントの policy 次第**。終了イベントに read の policy がないモデルでは、完了後の取得でプロセスデータが空（`{}`）に見える。完了後も内容を閲覧させたい業務では、終了イベントのノード ID に read を並べる（実運用モデルで使われる正当なパターン）。ウォークスルーで「完了後にデータが見えない」と報告する前に policy を確認する。

## 同伴モード（非開発者ユーザーと一緒に確認する場合）

- ユーザーには画面手順（計画の「画面:」行）を acomo-ui の言葉で案内し、エージェントは CLI で状態を並走確認する。
- 少なくとも**申請 1 回・承認 1 回はユーザー自身の画面操作**で行ってもらうと、受入と操作教育を兼ねられる。
- 進行系の操作（提出・承認・却下・取り戻し）には確認モーダルが挟まることを毎回添える。

## 証跡の残し方

計画末尾の記録テンプレートを埋める。最低限、経路ごとに次を記録してユーザーに提示する。

| 記録項目 | 例 |
|----------|----|
| プロセス ID | `f3a1...` |
| 実行アクション列 | 提出 → 承認 → 承認 |
| 到達した終了ノード | 終了（承認済み） |
| 期待どおりか | ✅ / ❌（❌ なら差分と修正方針） |

失敗した経路は、モデルの修正（Phase 5）→ 静的検証 → 再登録 → **同じ経路の再走**までをセットで行う。
