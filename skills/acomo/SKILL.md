---
name: acomo
description: "@acomo/cli を使い、acomo コマンドを使って acomo と連携したワークフローアプリの開発を支援する"
allowed-tools: Bash(acomo *), Read
---

# acomo Agent Skill

あなたは acomo ワークフロー管理プラットフォームを操作するエージェントです。

## 現在の認証状態

!`acomo config show 2>/dev/null || echo "未ログイン: acomo login --tenant-id <TENANT_ID> --token <TOKEN> を実行してください"`

## 引数

$ARGUMENTS が指定された場合はそれを最優先タスクとして処理してください。引数なしで起動された場合は、現在のコンテキスト（ファイル、会話）から acomo に関するタスクを推定してください。

## 基本方針

- コマンドの構文や引数は `acomo --help` および `acomo <command> --help` を参照すること
- 通常は `--format text`（デフォルト）を使用。APIレスポンスの正確な構造が必要な場合のみ `--format json` を使う
- データを変更する操作の後は、必ず取得系コマンドで結果を確認する
- エラーが発生したらまず `acomo config show` で認証状態を確認する。未認証の場合はユーザーにログインを依頼し、処理を停止する。

## コマンド早見表

必須パラメータは JSON で渡す（例: `acomo getWorkflowModel '{"modelId":"<ID>"}'`）。詳細は `acomo <command> --help` を参照すること。

### モデル

| コマンド                                 | 主な必須パラメータ                                | 用途             |
| ---------------------------------------- | ------------------------------------------------- | ---------------- |
| `listWorkflowModels`                     | -                                                 | モデル一覧取得   |
| `getWorkflowModel`                       | modelId                                           | 公開中モデル取得 |
| `getWorkflowModelWithLatestModelHistory` | modelId                                           | 編集中モデル取得 |
| `createWorkflowModel`                    | body (name, description 等)                       | モデル作成       |
| `saveWorkflowModel`                      | modelId, body (definition, dataSchema, policy 等) | モデル保存       |
| `publishWorkflowModel`                   | modelId                                           | モデル公開       |
| `deleteWorkflowModel`                    | modelId                                           | モデル削除       |

### プロセス

| コマンド                          | 主な必須パラメータ          | 用途               |
| --------------------------------- | --------------------------- | ------------------ |
| `startWorkflowProcess`            | modelId                     | プロセス開始       |
| `getWorkflowProcess`              | processId                   | プロセス取得       |
| `saveWorkflowProcess`             | processId, updateProcessDto | プロセスデータ保存 |
| `submitWorkflowProcess`           | processId                   | 提出               |
| `submitWorkflowProcessWithNodeId` | processId, nodeId           | 提出（ノード指定） |
| `approveWorkflowProcess`          | processId                   | 承認               |
| `rejectWorkflowProcess`           | processId                   | 却下               |
| `revertWorkflowProcess`           | processId, nodeId           | 取り戻し           |
| `listWorkflowProcessHistories`    | processId                   | プロセス履歴一覧   |

### その他

| コマンド          | 主な必須パラメータ | 用途                         |
| ----------------- | ------------------ | ---------------------------- |
| `listMyModels`    | -                  | 自分が操作可能なモデル一覧   |
| `listMyProcesses` | -                  | 自分が操作可能なプロセス一覧 |

## ドメイン概念

### モデルとプロセス

- **WorkflowModel**: ワークフローの「設計図」。定義（nodes/edges）、データスキーマ、データアクセスポリシーを持つ
- **WorkflowProcess**: モデルから生成される「実行インスタンス」。トークンで現在のノード位置を追跡する
- モデルは **publish（公開）** しないとプロセスを開始できない
- 編集中モデルは `getWorkflowModelWithLatestModelHistory`、公開版は `getWorkflowModel` で取得する

### ノードの種類

| ノードtype                   | 説明                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `event` (eventType: `start`) | ワークフロー開始点                                         |
| `event` (eventType: `end`)   | ワークフロー終了点                                         |
| `task`                       | 人が操作するタスクノード。`canRevert: true` で取り戻し可能 |
| `exclusiveFork`              | 条件式に基づく排他分岐                                     |
| `parallelFork`               | 並行処理の分岐（`keys` で展開キーを指定）                  |
| `parallelJoin`               | 並行処理の合流                                             |

### エッジ（フロー）

ノード間の接続。`type` に `normal`, `submit`, `approve`, `reject` を指定する。

### アクションの流れ

```
start → submit → approve（承認）/ reject（却下）
                ↘ revert（取り戻し：canRevert=true のとき）
```

- `save` / `update`: データ保存のみ（状態遷移なし）
- `submit` / `approve` / `reject`: データ保存 + 状態遷移

### ノードのアクションポリシー (actionPolicies)

各ノードの `actionPolicies` で、誰がどのアクションを実行できるかを条件式で制御する:

- `type`: アクション種別（`manage`, `read`, `approve`, `reject`, `submit`, `revert`, `start`, `update`）
- `allow`: 条件式（BinaryExpression）。ユーザー属性（ロール、グループ等）に基づく判定

### データスキーマ

JSON Schema ベースにacomo独自の `_acomoType` 拡張を持つ:

| \_acomoType | JSON Schema type                   | 備考             |
| ----------- | ---------------------------------- | ---------------- |
| `string`    | `string`                           | テキスト         |
| `number`    | `number`                           | 数値             |
| `date`      | `string` (format: "date")          | 日付             |
| `enum`      | `string` + `enum` 配列             | 選択肢           |
| `file`      | `array` (items: pattern付きstring) | ファイル添付     |
| `array`     | `array` (items: string\|number)    | 配列             |
| `record`    | `object` + `_recordKey`            | キー付きレコード |

共通プロパティ: `title`（表示名）, `description`（説明）, `_order`（表示順序・必須）

### データアクセスポリシー (policy)

ノードごとに、各データプロパティの読み書き権限を制御:

```
{ "ノードID": { "プロパティ名": "read" | "write" } }
```

## ワークフローパターン

### モデルの新規作成と公開

1. `acomo createWorkflowModel` でモデル作成（name, description を指定）
2. `acomo getWorkflowModelWithLatestModelHistory` で編集中モデルを取得しIDを確認
3. `acomo saveWorkflowModel` で definition（ノード・エッジ）、dataSchema、policy を設定
4. `acomo publishWorkflowModel` で公開
5. `acomo getWorkflowModel` で公開版を確認

### プロセスの実行テスト

1. `acomo listWorkflowModels` で対象モデルのIDを取得
2. `acomo startWorkflowProcess` でプロセス開始
3. `acomo getWorkflowProcess` で現在状態（token.nodeId, status）を確認
4. `acomo submitWorkflowProcess` / `approveWorkflowProcess` / `rejectWorkflowProcess` でアクション実行
5. `acomo listWorkflowProcessHistories` で履歴を確認

### AIを使ったモデル設計

1. `acomo chatForWorkflowModeling` で自然言語からモデル定義とデータスキーマを生成
2. 返却された definition と dataSchema を確認・調整
3. `acomo saveWorkflowModel` で保存

### 既存モデルの調査

1. `acomo listWorkflowModels` で一覧取得
2. `acomo getWorkflowModel` で公開版を取得
3. definition.nodes でノード構成、dataSchema でデータ項目、policy でアクセス権限を把握

## 操作上の注意

### 出力の扱い

- デフォルトの text 形式はAI向けに最適化済み。通常はこちらを使う
- `--format json` はIDの抽出やプログラム的な処理が必要な場合に使用

### エラー対処

- **401エラー**: `acomo login` で再認証
- **パラメータエラー**: `acomo <command> --help` で構文を確認
- **必須パラメータ不足**: エラーメッセージに従う

### データ操作の注意

- プロセスデータは dataSchema に定義されたフィールドのみ受け付ける
- モデルは publish 前に十分テストすること（公開後はプロセスが参照する）
- `save` は状態遷移なし、`submit`/`approve`/`reject` は状態遷移あり
