# 検証ハーネスガイド

[SKILL.md](../SKILL.md) 同梱の 2 つのスクリプトの使い方と出力の読み方。
どちらも **依存ゼロの Node.js スクリプト**（Node 20+）で、acomo バックエンドへの接続は不要（完全オフライン）。

## コマンド

```bash
# モノレポ内（推奨）
npm run workflow:validate -- <draft-file> [--json] [--partial] [--schemas-dir <dir>]
npm run workflow:walkthrough -- <draft-file> [--json]

# スタンドアロン（このスキルディレクトリで）
node scripts/validate-model.mjs <draft-file>
node scripts/walkthrough-plan.mjs <draft-file>
```

**入力ファイル**は次のどちらでもよい。

1. モデル JSON そのもの: `{ "name": ..., "definition": {...}, "dataSchema": {...}, "policy": {...} }`
2. `acomo-workflow-model-draft`（または `json`）fenced ブロックを含むテキスト
   — エージェントの回答をそのままファイルに保存して検証できる（複数あれば最後のブロックを使う）

## validate-model.mjs（静的検証）

**終了コード**: `0` = エラー 0（PASS）/ `1` = エラーあり（FAIL）/ `2` = 入力不正。
`--json` で `{ok, name, errors[], warnings[]}` を出力する。

検証は 3 層で行う。

1. **スキーマ準拠** — バックエンドの AJV 定義と同一の生成 JSON Schema（`acomo-workflow-modeling` スキル同梱の `schemas/`）に対する検証。モノレポ外では `--schemas-dir` か環境変数 `ACOMO_MODEL_SCHEMAS_DIR` で `acomo schema show` 由来の `definition.json` / `dataSchema.json` / `dataAccessPolicy.json` を指すディレクトリを指定する（見つからない場合は `W_SCHEMA_MISSING` を出してこの層のみスキップ）。
2. **グラフ整合** — 開始・終了イベント、エッジの `FlowType`、到達性。
3. **policy / dataSchema 相互整合** — ノード ID・プロパティキーの対応、read/write。

### エラー（登録前に必ず修正）

| コード | 意味 | 典型的な直し方 |
|--------|------|----------------|
| `E_INPUT` | JSON / fenced ブロックが読めない | draft の構文を直す |
| `E_STRUCT` | definition / nodes / edges の骨格、または dataSchema / policy がない | draft の構造を直す（definition 先行の途中段階だけ `--partial` で警告に緩和できる。**登録前は必ず `--partial` なしで green にする**） |
| `E_SCHEMA_DEFINITION` / `E_SCHEMA_DATASCHEMA` / `E_SCHEMA_POLICY` | バックエンド AJV と同じスキーマに違反（`_order` / `_acomoType` 欠落など） | 指摘された path のプロパティ形を `acomo schema show` の定義に合わせる |
| `E_START_COUNT` / `E_END_COUNT` | 開始がちょうど 1 つでない / 終了がない | イベントノードを直す |
| `E_NODE_ID` | ノード id の重複・空 | id を一意な文字列にする |
| `E_EDGE_NODE` | エッジの from/to に対応ノードがない | id の書き間違いを直す |
| `E_EDGE_TYPE` | `FlowType` にない値（`revert` を含む）・配列でない | `normal/submit/approve/reject/yes/no` の配列にする。差し戻しはノードの `canRevert` で表現 |
| `E_START_INCOMING` / `E_END_OUTGOING` | 開始に入るエッジ / 終了から出るエッジ | エッジの向きを直す |
| `E_TASK_NO_OUTGOING` | 出口のないタスク | 次ノードへのエッジを足す |
| `E_UNREACHABLE` / `E_NO_PATH_TO_END` | 開始から到達不能 / 終了へ到達不能なノード | エッジの張り忘れ・孤立ノードを直す |
| `E_FORK_NO_CONDITIONS` / `E_CONDITION_DEST` | exclusiveFork の conditions 不備 | conditions と destination を definition の id に合わせる |
| `E_JOIN_NO_CONDITIONS` | parallelJoin に conditions がない | `{"expression": {"operator": ">=", "expression1": "$token.approveCount", "expression2": "$token.childTokenLength"}, "destination": <合流後のノード id>}` を足す（expression は**必ずオブジェクト形式** — 文字列 1 本の式はスキーマ違反。正しい形は `fixtures/sample-parallel-model.json`）。**conditions 自体はスキーマ上省略可能だが、欠落するとプロセス開始時にバックエンドが 500 になり、そのモデルは API から削除もできなくなる**（実測 2026-07-05。復旧は DB 直接削除のみ） |
| `E_POLICY_NODE` / `E_POLICY_FIELD` / `E_POLICY_VALUE` | policy のノード ID・キー・値の不整合 | definition の id / dataSchema のキー / `read`・`write` に合わせる |

### 警告（業務判断または品質改善。個別に妥当性を判断する）

| コード | 意味 | 対応 |
|--------|------|------|
| `W_NAME` | name 未設定 | 登録前に必ず設定 |
| `W_APPROVE_NO_REJECT` / `W_NO_REJECT_PATH` | 却下経路がない | 却下できない業務か**ユーザーに確認** |
| `W_END_MIXED` | 1 つの終了に承認と却下が流入 | 結末ごとに終了イベントを分けることを推奨 |
| `W_TASK_NO_POLICY` | policy のないタスク | そのタスクでデータを見せない意図か確認 |
| `W_FIELD_NOT_WRITABLE` | どのタスクでも write にならない項目 | 入力手段がない項目でよいか確認 |
| `W_POLICY_EVENT_WRITE` | タスク以外のノードに write | read に直す（終了イベントへの **read** 割り当ては「完了後も閲覧」の正当パターン） |
| `W_STATUS_FIELD` | dataSchema に `status` | 通常は削除（エンジンが管理） |
| `W_KEY_STYLE` / `W_ORDER_DUP` | 命名・表示順の品質 | 可能なら修正 |
| `W_SCHEMA_MISSING` | スキーマ未検出でスキーマ層をスキップ | schemas を配置して再実行 |

**エラーカタログの実例**: `fixtures/broken-model.json` を validate すると主要エラーが一通り出る。
PASS するお手本（すべてローカル実走確認済み）:

| fixture | パターン |
|---------|---------|
| `fixtures/sample-model.json` | 基本の 1 段階承認 |
| `fixtures/sample-branching-model.json` | 条件分岐（exclusiveFork。金額による承認段数の切り替え） |
| `fixtures/sample-parallel-model.json` | 並列審査（parallelFork / parallelJoin。conditions の正しい書き方） |
| `fixtures/sample-revert-loop-model.json` | 差し戻しループ（canRevert + 逆向き submit エッジ） |

## walkthrough-plan.mjs（ウォークスルー計画）

開始イベントから各終了イベントまでの**経路を列挙**し、経路ごとに次を出力する。

- 各ステップの CLI コマンド（`startWorkflowProcess` → `submit/approve/reject`。policy の write 項目から生成したサンプルデータを**アクションの body（フラットな JSON）**として同梱）
- 同じ操作の画面手順（非開発者向けの案内に使う）
- 実行者ヒント（definition の actionPolicies の description から抽出）
- 並列（parallelFork/Join）はブランチ別のタスクと `*WithNodeId` 系コマンドに展開
- 条件分岐（exclusiveFork）は経路ごとに満たすべき条件式を表示
- **循環エッジ**（差し戻し・再提出系）は経路に含めず巻末に列挙 — 該当業務があれば手動で 1 回通す
- 記録テンプレート（経路・プロセス ID・到達ノードの表）

`--json` で機械可読の計画（`paths[].steps[]`、`cycleEdges`、`notes`）を出力する。エージェントが実走を自動化するときはこちらを使う。

### `--json` のステップフィールド

| フィールド | 内容 |
|-----------|------|
| `kind` | `start` / `action` / `branch` / `parallel` / `auto` |
| `nodeId` / `nodeName` | 操作対象ノード |
| `action` | `submit` / `approve` / `reject`（action のみ） |
| `to` | 遷移先ノード ID（遷移後の現在ノード検証に使う） |
| `condition` | `kind: 'branch'`（exclusiveFork）でこの経路に入るための条件（`{expression, destination}`）。データ駆動テストが条件に効く入力値を導出するのに使う。branch 以外は `null` |
| `sampleData` | policy の write 項目から生成したサンプルデータ（タスクのみ） |
| `api` | そのまま再生できる REST 呼び出し情報 `{operationId, method, path, body}`。`{modelId}` / `{processId}` を実値に置換して使う。並列ブランチ内タスクは `nodeId` 付き（`*WithNodeId` 系）。アクションの `body` は常にオブジェクト（write 項目がなければ `{}` — engine 系は JSON body 必須）。`start` のみ `body: null`（body なし） |
| `branches` | 並列区間のブランチ別タスク列（各タスクにも `sampleData` / `api`） |

`api` はカスタムアプリの統合テスト・E2E が CLI を経由せずに経路を再生するためのフィールド
（使い方: [custom-app-e2e.md](custom-app-e2e.md)）。body はアクションと同じリクエストで渡すフラットな JSON。

## サーバー側検証との使い分け

バックエンドには `validateWorkflowModelSchema`（`POST /api/v1/schemas/model/validate`）があり、
同じ AJV 定義で definition / dataSchema / policy を検証できる（`acomo validateWorkflowModelSchema '{...}'`）。

- **ローカルハーネス（本スキル）**: オフライン・認証不要。スキーマ準拠に加えて**グラフ到達性・policy 相互整合・業務観点の警告**まで出す。開発ループの主役。
- **サーバー側検証**: 認証済み環境で「バックエンドの現行バージョンが受け付けるか」の最終確認に使う（スキーマ準拠のみ。グラフ・policy の意味的検証はしない）。

### 計画の限界（知っておくこと）

- サンプルデータは**型を満たすだけ**の値。条件分岐に効く入力値は branch ステップの `condition`（JSON）/ 経路の注記（Markdown）を読んで**調整**する。actionPolicies の式（実行者の条件）はデータではなくアクターの切り替えで満たす。
- ファイル型（`_acomoType: "file"`）はサンプルデータに含めない。添付の確認は画面で行う。
- 並列ブランチ内でさらに分岐する複雑な構造は先頭経路のみを辿り、注記を出す。残りは手動で計画に足す。
