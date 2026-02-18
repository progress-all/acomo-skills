# acomo データ構造リファレンス

## ModelDefinition（ワークフロー定義）

```typescript
type ModelDefinition = {
  nodes: Node[]; // ワークフローのノード（タスク、イベント、分岐など）
  edges: Edge[]; // ノード間の接続
};
```

### Node（ノード）

```typescript
type Node = {
  id: NodeId; // ノード固有ID（文字列）
  name: string; // ノード名（日本語）
  type: NodeType; // ノード種別
  eventType?: "start" | "end"; // イベントノードの場合の種別
  actionPolicies?: {
    // 操作権限ポリシー
    type: NodeActionType; // アクション種別
    allow: BinaryExpression; // 許可条件式
    description?: string; // 説明
  }[];
  conditions?: {
    // 分岐条件（exclusiveFork, parallelJoin）
    expression: BinaryExpression;
    type?: FlowType;
    destination: NodeId;
  }[];
  position?: { x: number; y: number }; // エディタ上の座標（表示用。業務ロジックでは不要なら無視してよい）
  canRevert?: boolean; // 差し戻し可能か
};
```

### NodeType（ノード種別）

| 種別            | 説明                                                   | 自動処理            |
| --------------- | ------------------------------------------------------ | ------------------- |
| `event`         | 開始/終了イベント。eventType で判別                    | 開始: Yes, 終了: No |
| `task`          | ユーザーの操作が必要なタスク                           | No（外部入力待ち）  |
| `exclusiveFork` | 排他的条件分岐。conditions を評価して1つのルートに進む | Yes                 |
| `parallelFork`  | 並列処理の開始。複数の子プロセスに分岐                 | Yes                 |
| `parallelJoin`  | 並列処理の合流。全子プロセスが到達すると次に進む       | Yes（条件充足時）   |

### NodeActionType（アクション種別）

| 種別      | 説明                     |
| --------- | ------------------------ |
| `manage`  | 全操作が可能             |
| `read`    | 読み取りのみ             |
| `start`   | プロセス開始             |
| `submit`  | 提出（次のノードへ進む） |
| `approve` | 承認                     |
| `reject`  | 却下                     |
| `revert`  | 差し戻し                 |
| `update`  | データ更新               |

### Edge（エッジ）

```typescript
type Edge = {
  from: string; // 遷移元ノードID
  to: string; // 遷移先ノードID
  type: FlowType[]; // 遷移種別の配列
};
```

### FlowType（遷移種別）

| 種別      | 説明                              |
| --------- | --------------------------------- |
| `normal`  | 通常の遷移（開始→最初のタスク等） |
| `submit`  | 提出による遷移                    |
| `approve` | 承認による遷移                    |
| `reject`  | 却下による遷移                    |
| `yes`     | 条件分岐でTrue                    |
| `no`      | 条件分岐でFalse                   |

## ModelDataSchema（データスキーマ）

JSON Schema のサブセット。ワークフローで扱うデータの構造を定義する。

```typescript
type ModelDataSchema = {
  type: "object";
  properties: {
    [key: string]: ModelDataSchemaProperty;
  };
  required?: string[];
  additionalProperties: false;
};

type ModelDataSchemaProperty = {
  type: "string" | "number" | "date" | "object" | "array";
  title: string; // 日本語ラベル
  description?: string; // 説明
  enum?: string[]; // 列挙値（type が 'string' の場合）
  items?: any; // 配列要素のスキーマ（type が 'array' の場合）
  _order?: number; // 表示順序（10, 20, 30...）
  _acomoType?: string; // acomo 独自拡張型
  _recordKey?: string; // レコード型のキー
};
```

### \_acomoType（独自拡張型）

| 型       | 説明                               |
| -------- | ---------------------------------- |
| `string` | テキスト入力                       |
| `number` | 数値入力                           |
| `date`   | 日付選択                           |
| `enum`   | 選択肢（enum 配列から選択）        |
| `file`   | ファイルアップロード               |
| `record` | レコード型（テーブル形式のデータ） |
| `object` | オブジェクト型                     |
| `array`  | 配列型                             |

## ModelPolicy（データアクセスポリシー）

各ノードで各データフィールドに対する読み書き権限を定義する。

```typescript
type ModelPolicy = {
  [nodeId: NodeId]: {
    [propertyKey: string]: "write" | "read";
  };
};
```

- `write`: そのノードでフィールドを編集可能
- `read`: そのノードでフィールドは読み取り専用

ノードIDに対応するエントリがない場合、そのノードではフィールドにアクセスできない。

## BinaryExpression（条件式）

actionPolicies の `allow` や conditions の `expression` で使用される条件式。

```typescript
type BinaryExpression = {
  operator: "and" | "or" | "==" | "!=" | "has" | "in" | "belongsTo";
  expression1: BinaryExpression | string;
  expression2: BinaryExpression | string;
};
```

### 主なオペレーター

| オペレーター | 説明               | 例                                         |
| ------------ | ------------------ | ------------------------------------------ |
| `==`         | 等値比較           | `$user.id == $executor(nodeId).id`         |
| `!=`         | 非等値比較         | `$user.id != $executor(nodeId).id`         |
| `has`        | 配列に含む         | `$user.roles has "roleId"`                 |
| `in`         | 値が配列に含まれる | `$data.status in ["active","pending"]`     |
| `belongsTo`  | グループ所属       | `$user belongsTo $executor(nodeId).groups` |
| `and`        | 論理AND            | 2つの条件を結合                            |
| `or`         | 論理OR             | 2つの条件を結合                            |

### 式中の変数

| 変数                       | 説明                                   |
| -------------------------- | -------------------------------------- |
| `$user.id`                 | 操作ユーザーのID                       |
| `$user.roles`              | ユーザーのロール一覧                   |
| `$user.groups`             | ユーザーのグループ一覧                 |
| `$executor(nodeId).id`     | 指定ノードを実行したユーザーのID       |
| `$executor(nodeId).groups` | 指定ノードを実行したユーザーのグループ |
| `$data.{key}`              | プロセスデータの値                     |
