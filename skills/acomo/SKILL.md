---
name: acomo
description: >
  プラットフォーム利用者（acomo 上でワークフローモデルを使って開発する開発者）向け。
  公開API・ワークフローの考え方・CLIによるモデル取得とプロセス操作を支援する。
  acomo 本体の内部実装は対象外。自前アプリでワークフロー画面や連携を構築する際のガイド。
user-invocable: true
allowed-tools: Bash(acomo *)
argument-hint: [modelId]
---

# acomo ワークフロー操作ガイド

acomo はワークフロー管理プラットフォームです。CLI や公開 API でモデル定義の取得・プロセス操作を行い、利用者が自前のアプリでワークフロー画面や連携を構築できるようにするためのガイドです。

## ワークフロー操作の典型フロー

### Step 1: モデル一覧を取得

```bash
acomo listWorkflowModels
```

モデル ID、名前、ノード数、フィールド数などを取得します。出力形式は `acomo listWorkflowModels --help` で確認してください。

### Step 2: モデル定義を理解する

```bash
acomo describe-model --model-id $ARGUMENTS
```

ワークフローのフロー（ノード・エッジ）、データスキーマ、データアクセスポリシーを構造的なテキストで出力します。

### Step 3: 完全な定義が必要な場合

```bash
acomo getWorkflowModel '{"modelId":"$ARGUMENTS"}'
```

definition / dataSchema / policy の完全な JSON を取得します。コンテキストを大量に消費するため、必要な場合のみ使用してください。

### Step 4: プロセスを操作する

```bash
# プロセス開始
acomo startWorkflowProcess '{"modelId":"<MODEL_ID>"}'

# 提出
acomo submitWorkflowProcess '{"processId":"<PROCESS_ID>"}'
# または特定ノードを指定
acomo submitWorkflowProcessWithNodeId '{"processId":"<PROCESS_ID>","nodeId":"<NODE_ID>"}'

# 承認
acomo approveWorkflowProcess '{"processId":"<PROCESS_ID>"}'

# 却下
acomo rejectWorkflowProcess '{"processId":"<PROCESS_ID>"}'

# 差し戻し
acomo revertWorkflowProcess '{"processId":"<PROCESS_ID>","nodeId":"<NODE_ID>"}'

# プロセスデータ保存
acomo saveWorkflowProcess '{"processId":"<PROCESS_ID>","updateProcessDto":{"data":{...}}}'
```

## コマンドグループ早見表

### Model（モデル管理）

| コマンド | 必須パラメータ | 説明 |
| --- | --- | --- |
| `listWorkflowModels` | - | モデル一覧を取得 |
| `getWorkflowModel` | modelId | 公開中モデルを取得 |
| `getWorkflowModelWithLatestModelHistory` | modelId | 編集中モデルを取得 |
| `createWorkflowModel` | createModelDto (body) | モデル作成 |
| `saveWorkflowModel` | modelId, updateModelDto (body) | モデル保存 |
| `publishWorkflowModel` | modelId | モデル公開 |
| `deleteWorkflowModel` | modelId | モデル削除 |
| `describe-model` | --model-id | モデル定義の構造的要約 |

### Engine（プロセス実行）

| コマンド | 必須パラメータ | 説明 |
| --- | --- | --- |
| `startWorkflowProcess` | modelId | プロセス開始 |
| `saveWorkflowProcess` | processId | プロセスデータ保存 |
| `submitWorkflowProcess` | processId | 提出 |
| `approveWorkflowProcess` | processId | 承認 |
| `rejectWorkflowProcess` | processId | 却下 |
| `revertWorkflowProcess` | processId, nodeId | 差し戻し |

### MyModel / MyProcess（自分のタスク）

| コマンド | 説明 |
| --- | --- |
| `listMyModels` | 権限ありモデル一覧 |
| `getMyModel` | 権限ありモデル取得 (modelId) |
| `listMyProcesses` | 自分のプロセス一覧 |
| `getMyProcesses` | 自分のプロセス取得 (processId) |
| `listModelWithNodeActions` | モデル+アクション可能ノード一覧 |
| `listProcessWithNodeActions` | プロセス+アクション可能ノード一覧 |

## 自前アプリでワークフローを扱うときの考え方

### モデル取得で得られる情報の使い道

- **`listWorkflowModels`**: 利用可能なワークフローモデル一覧（ID・名前・ノード数・フィールド数）を取得。どのモデルを扱うか選ぶときに使う。出力形式は `acomo listWorkflowModels --help` で確認すること。
- **`describe-model --model-id <ID>`**: 指定モデルのフロー（ノード・エッジ）、データスキーマ、データアクセスポリシーをテキストで要約。**どのノードでどの操作（提出・承認・却下など）ができるか**、**各ノードでどのフィールドを編集・参照できるか**を把握できる。
- **`getWorkflowModel`**: definition / dataSchema / policy の完全な JSON。自前アプリでフォームや画面を組み立てる際に厳密な型が必要な場合のみ利用するとよい（出力が大きいためコンテキストを消費する）。

### プロセス操作の流れ

1. **開始**: `startWorkflowProcess` で modelId を指定してプロセスを開始する。
2. **データ入力・保存**: タスクノードでは dataSchema に沿ったデータを入力する。`saveWorkflowProcess` で processId と `updateProcessDto.data` を送り、途中保存できる。
3. **遷移**: 提出は `submitWorkflowProcess`（必要に応じて nodeId 指定）、承認は `approveWorkflowProcess`、却下は `rejectWorkflowProcess`、差し戻しは `revertWorkflowProcess`（processId と nodeId）で実行する。

describe-model の「Data Access Policy」を見れば、各ノードで write/read できるフィールドが分かる。自前アプリでは、現在のノードに応じて編集可能な項目だけをフォームに出すようにするとよい。

データ構造（definition / dataSchema / policy / 条件式）の詳細は reference.md を参照してください。
