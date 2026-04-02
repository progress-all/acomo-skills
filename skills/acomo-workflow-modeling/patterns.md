# acomo ワークフローパターン集

acomo スキル（SKILL.md）の補助資料。
代表的な業務ワークフローのモデル定義（definition + dataSchema + policy）サンプルをまとめる。

`createWorkflowModel` のリクエストボディは OpenAPI 上 **CreateModelDto**（フラットな JSON）。トップレベルに `name` / `definition` / `dataSchema` / `policy` を並べる（`createModelDto` などのラップは不要）。

---

## パターン 1: 基本申請承認フロー

**シナリオ**: 申請者が申請し、1人の承認者が承認・却下する最もシンプなフロー。
**使いどき**: 1段階の承認で完結する業務（経費精算、休暇申請、備品購入など）。

ノード ID は **申請 = `"2"`**、**承認 = `"3"`**（以下の policy で使用）。

### definition

```json
{
  "nodes": [
    { "id": "1", "type": "event", "eventType": "start", "name": "開始" },
    { "id": "2", "type": "task", "name": "申請" },
    { "id": "3", "type": "task", "name": "承認" },
    { "id": "4", "type": "event", "eventType": "end", "name": "終了（承認済み）" },
    { "id": "5", "type": "event", "eventType": "end", "name": "終了（却下）" }
  ],
  "edges": [
    { "from": "1", "to": "2", "type": ["normal"] },
    { "from": "2", "to": "3", "type": ["submit"] },
    { "from": "3", "to": "4", "type": ["approve"] },
    { "from": "3", "to": "5", "type": ["reject"] }
  ]
}
```

### dataSchema（例：経費申請）

API ではルートを `type: "object"` とし、各プロパティを `properties` に置く。日付は `type: "string"` + `format: "date"` + `_acomoType: "date"` とする。

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "itemName": {
      "type": "string",
      "title": "品名",
      "description": "購入した物品の名称",
      "_order": 10,
      "_acomoType": "string"
    },
    "amount": {
      "type": "number",
      "title": "金額",
      "description": "購入金額（円）",
      "_order": 20,
      "_acomoType": "number"
    },
    "purchaseDate": {
      "type": "string",
      "format": "date",
      "title": "購入日",
      "description": "物品を購入した日付",
      "_order": 30,
      "_acomoType": "date"
    },
    "category": {
      "type": "string",
      "enum": ["交通費", "消耗品", "接待費", "その他"],
      "title": "費目",
      "description": "経費の種別",
      "_order": 40,
      "_acomoType": "enum"
    },
    "reason": {
      "type": "string",
      "title": "申請理由",
      "description": "購入の目的・理由",
      "_order": 50,
      "_acomoType": "string"
    },
    "approverComment": {
      "type": "string",
      "title": "承認者コメント",
      "description": "承認者が入力するコメント",
      "_order": 60,
      "_acomoType": "string"
    }
  }
}
```

### policy（データアクセス）

タスク `"2"`（申請）では申請内容を編集、`"3"`（承認）では内容は参照のみとし、承認者コメントだけ編集可能にする例。

```json
{
  "2": {
    "itemName": "write",
    "amount": "write",
    "purchaseDate": "write",
    "category": "write",
    "reason": "write",
    "approverComment": "read"
  },
  "3": {
    "itemName": "read",
    "amount": "read",
    "purchaseDate": "read",
    "category": "read",
    "reason": "read",
    "approverComment": "write"
  }
}
```

---

## パターン 2: 差し戻し付き申請承認フロー

**シナリオ**: 承認者が却下する代わりに申請者へ差し戻し（修正して再提出を促す）できるフロー。
**使いどき**: 不備があっても取り下げではなく修正して再提出させたい業務。

### definition

```json
{
  "nodes": [
    { "id": "1", "type": "event", "eventType": "start", "name": "開始" },
    { "id": "2", "type": "task", "name": "申請", "canRevert": true },
    { "id": "3", "type": "task", "name": "承認" },
    { "id": "4", "type": "event", "eventType": "end", "name": "終了（承認済み）" },
    { "id": "5", "type": "event", "eventType": "end", "name": "終了（却下）" }
  ],
  "edges": [
    { "from": "1", "to": "2", "type": ["normal"] },
    { "from": "2", "to": "3", "type": ["submit"] },
    { "from": "3", "to": "4", "type": ["approve"] },
    { "from": "3", "to": "5", "type": ["reject"] },
    { "from": "3", "to": "2", "type": ["revert"] }
  ]
}
```

**ポイント**:
- 差し戻し先ノードに `"canRevert": true` を設定する
- 差し戻しエッジ（`revert`）は承認ノード → 申請ノードに向かう
- **dataSchema / policy**: 差し戻し後も申請は同じノード ID `"2"` のため、**パターン 1 と同じ dataSchema・policy** でよい（`"2"` のタスクで再び申請項目が `write` になる）

---

## パターン 3: 多段承認フロー

**シナリオ**: 申請者 → 係長承認 → 部長承認 → 完了の2段階承認フロー。
**使いどき**: 金額や重要度に応じて複数の階層で承認が必要な業務。

### definition

```json
{
  "nodes": [
    { "id": "1", "type": "event", "eventType": "start", "name": "開始" },
    { "id": "2", "type": "task", "name": "申請" },
    { "id": "3", "type": "task", "name": "係長承認" },
    { "id": "4", "type": "task", "name": "部長承認" },
    { "id": "5", "type": "event", "eventType": "end", "name": "終了（承認済み）" },
    { "id": "6", "type": "event", "eventType": "end", "name": "終了（係長却下）" },
    { "id": "7", "type": "event", "eventType": "end", "name": "終了（部長却下）" }
  ],
  "edges": [
    { "from": "1", "to": "2", "type": ["normal"] },
    { "from": "2", "to": "3", "type": ["submit"] },
    { "from": "3", "to": "4", "type": ["approve"] },
    { "from": "3", "to": "6", "type": ["reject"] },
    { "from": "4", "to": "5", "type": ["approve"] },
    { "from": "4", "to": "7", "type": ["reject"] }
  ]
}
```

**ポイント**:
- 各承認者の却下は別々の終了ノードへ（誰が却下したか追跡できる）
- 段階数に応じてタスクノードと終了ノードを追加する
- **policy**: タスクノード `"2"` / `"3"` / `"4"` それぞれに、read/write を定義する（係長・部長で入力できるコメント欄を分ける場合は dataSchema にキーを増やし、ノードごとに `write` を割り当てる）

---

## パターン 4: 並列審査フロー

**シナリオ**: 申請後、法務部と経理部が同時並行でレビューし、両方が承認したら完了するフロー。
**使いどき**: 複数の部門・担当者が独立して同時に審査する必要がある業務。

### definition

```json
{
  "nodes": [
    { "id": "1", "type": "event", "eventType": "start", "name": "開始" },
    { "id": "2", "type": "task", "name": "申請" },
    { "id": "3", "type": "parallelFork", "name": "並列審査開始" },
    { "id": "4", "type": "task", "name": "法務審査" },
    { "id": "5", "type": "task", "name": "経理審査" },
    { "id": "6", "type": "parallelJoin", "name": "並列審査完了" },
    { "id": "7", "type": "event", "eventType": "end", "name": "終了（承認済み）" }
  ],
  "edges": [
    { "from": "1", "to": "2", "type": ["normal"] },
    { "from": "2", "to": "3", "type": ["submit"] },
    { "from": "3", "to": "4", "type": ["normal"] },
    { "from": "3", "to": "5", "type": ["normal"] },
    { "from": "4", "to": "6", "type": ["approve"] },
    { "from": "5", "to": "6", "type": ["approve"] },
    { "from": "6", "to": "7", "type": ["normal"] }
  ]
}
```

**ポイント**:
- `parallelFork` ノードから複数のタスクノードへ `normal` エッジで分岐
- 各並列タスクから `parallelJoin` へ `approve` エッジで合流
- `parallelJoin` は全ルートが揃うと自動的に次へ進む
- 並列処理中の却下ハンドリングが必要な場合は別途設計が必要
- **policy**: 並列側は **タスク `"4"` と `"5"` それぞれ**に、参照・更新できるフィールドを定義する。法務だけが見てよい項目・経理だけが編集する項目など、業務に応じて分ける（同一の dataSchema でもノード ID ごとに read/write の組み合わせが異なってよい）

---

## CLIでモデルを作成する手順

definition・dataSchema・policy を設計したら `acomo createWorkflowModel` で登録する。引数 JSON の形は **`acomo createWorkflowModel --help`** の例に従う（プロジェクトの OpenAPI ではリクエストボディは **CreateModelDto そのもの** であり、トップレベルに `name` / `definition` / `dataSchema` / `policy` を置く）。

```bash
# 1. モデルを作成（ドラフト状態）
# policy はドラフト登録時も必須フィールドのため、未設計なら {} でよいが、公開前にタスクごとに埋める
acomo createWorkflowModel '{
  "name": "モデル名",
  "description": "説明（任意）",
  "definition": { },
  "dataSchema": { "type": "object", "additionalProperties": false, "properties": { } },
  "policy": { }
}'

# 2. モデルを公開（テナント内で利用可能にする）
acomo publishWorkflowModel '{"modelId": "<作成されたmodelId>"}'
```

**注意**:

- `policy` は**データ項目**の read/write。運用前に各タスクノード ID ごとに埋めることを推奨する。空オブジェクト `{}` は通るが、意図しないアクセス制御になる可能性がある。
- モデル更新 API で後から policy を差し替えてもよい。
