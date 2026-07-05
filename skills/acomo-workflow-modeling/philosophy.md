# acomo ワークフローモデリング哲学

acomo スキル（SKILL.md）の補助資料。
ワークフローモデルを設計・生成・レビューするときの設計原則をまとめる。

---

## 基本思想

acomo のワークフローモデルは「**現実の業務フローを忠実に表現する**」ことを最優先とする。
システムの都合・実装の制約を業務モデルに持ち込まない。

---

## ノード設計の原則

### 1ノード = 1アクター × 1つの完結した作業

- 申請者が申請フォームに入力して提出する → 1ノード（タスク）
- 上司がその申請内容を確認して承認・却下する → 1ノード（タスク）
- 上記2つは**別人の作業**なので、必ず**別のノード**に分ける

**誤った例（1ノードに複数アクターの作業が混在）:**
```
× 「申請と承認」という1つのタスクノード
```

**正しい例（アクターごとにノードを分ける）:**
```
○ 「〇〇の申請」（申請者のタスク）→ 「〇〇の承認」（上司のタスク）
```

### ノードの命名規則

| ノード種別 | 命名の例 | 備考 |
|-----------|---------|------|
| 開始イベント | 「開始」 | 固定でよい |
| 申請タスク | 「経費の申請」「有給の申請」 | 「〇〇の申請」形式 |
| 承認タスク | 「経費の承認」「上長の確認」 | 「〇〇の承認」「〇〇の確認」形式 |
| 終了イベント（承認） | 「終了（承認済み）」 | 結末を明示する |
| 終了イベント（却下） | 「終了（却下）」 | 結末を明示する |

### ノード種別の使い分け

| 種別 | 使いどき |
|------|---------|
| `event`（`eventType: "start"`） | ワークフローの開始点。必ず1つ |
| `event`（`eventType: "end"`） | ワークフローの終了点。結末の数だけ作る |
| `task` | 人間が操作を行うノード（申請・承認・確認・入力）|
| `exclusiveFork` | 条件によって分岐するノード（データの値で自動判断）|
| `parallelFork` | 複数の承認者が同時並行でレビューを開始するノード |
| `parallelJoin` | 並列の全ルートが揃ったら次に進むノード。**`conditions` が必須**（`$token.approveCount` 等で合流条件と遷移先を指定 — patterns.md パターン 4） |

---

## エッジ設計の原則

### FlowType（遷移種別）の使い分け

**SSOT**: ランタイムの `FlowType`（モノレポ内の単一ソース: `acomo-backend/src/workflow/model/edge.entity.ts`）。使える値は下表の 6 種のみ。生成スキーマ（[`schemas/definition.json`](schemas/definition.json)）上は `edges[].type` が自由文字列のためスキーマ検証では拒否されない — 値の妥当性は acomo-workflow-development スキルの検証ハーネス（`E_EDGE_TYPE`）が検出する。

| 種別 | 使いどき |
|------|---------|
| `normal` | 開始イベント → 最初のタスクへの遷移。並列分岐の子タスクへの分岐など |
| `submit` | タスクノードから次のタスク（または承認ノード）へ提出する遷移 |
| `approve` | 承認タスクノードから「承認された場合」の遷移先へ |
| `reject` | 承認タスクノードから「却下された場合」の遷移先へ（通常は終了ノード）|
| `yes` / `no` | 条件分岐（`exclusiveFork` の `conditions` など、スキーマ上は `condition.type` に `normal` / `approve` / `reject` / `submit` の列挙がある箇所とエッジの `FlowType` が異なる場合がある。詳細は `model-schemas.json` の `condition` 定義を参照） |

**注意**: `revert` は **ノードアクション種別**（`NodeActionType`）としては存在するが、**エッジの `FlowType` 列挙子としては `edge.entity.ts` に含まれない**。差し戻しの業務表現はプロセス実行時の差し戻し API・メタデータ側の仕様に従い、モデル JSON の edge.type には上表の値のみを使う。

**Edge ID の命名規則**: `e{from}-{to}`（例: `e1-2`、`e3-4`）

**エッジ type は必ず配列で指定する**: `"type": ["approve"]`（文字列単体は不可）

### 基本的なエッジパターン

```
開始 --[normal]--> 申請タスク --[submit]--> 承認タスク --[approve]--> 終了（承認済み）
                                                        --[reject] --> 終了（却下）
```

---

## 終了ノードの設計原則

- **結末の数だけ終了ノードを作る**
- 承認された場合と却下された場合は別の終了ノード
- 終了ノードのノード名で「どういう結末か」を明示する

| 結末 | 終了ノード名の例 |
|------|----------------|
| 承認で完了 | 「終了（承認済み）」 |
| 却下で終了 | 「終了（却下）」 |
| 取り下げで終了 | 「終了（取り下げ）」 |
| 並列承認で1件でも否決 | 「終了（否決）」 |

---

## データスキーマの設計原則

### 含めるもの・含めないもの

| 含めるもの | 含めないもの |
|-----------|------------|
| ユーザーが入力・更新するデータ | `status`（ワークフローエンジンが管理する）|
| 承認者が参照するデータ | ノードIDやフロー制御のための内部フラグ |
| 業務上必要な情報 | システムが自動生成するタイムスタンプ等 |

### 使用できるデータ型（プロパティごとの oneOf）

**SSOT**: 同梱の生成スキーマ [`schemas/dataSchema.json`](schemas/dataSchema.json) の `properties` の `oneOf` 定義（モノレポ内の単一ソースは `acomo-backend/src/workflow/model/schemas/model-schemas.json`）。

| `_acomoType`（代表） | JSON 上の形の要点 | 用途 |
|---------------------|------------------|------|
| `string` | `type: "string"`、`_acomoType: "string"` | テキスト入力 |
| `number` | `type: "number"`、`_acomoType: "number"` | 数値 |
| `date` | `type: "string"`、`format: "date"`、`_acomoType: "date"` | 日付 |
| `enum` | `type: "string"`、`enum: [...]`、`_acomoType: "enum"` | 選択肢 |
| `file` | `type: "array"`（ファイル用の `items` 制約あり）、`_acomoType: "file"` | ファイル添付 |
| `array` | `type: "array"`、`items` で要素型指定、`_acomoType: "array"` | 配列（要素は string / number 等に制限） |
| `record` | `type: "object"`、`_acomoType: "record"`、`_recordKey` と `additionalProperties` | レコード型 |

- ルートは必ず `type: "object"`、`additionalProperties: false`、`properties` を持つ（スキーマ必須に準拠）。
- enum 表現の詳細は [patterns.md](patterns.md) を参照。

### キー命名・表示順序

- プロパティキーは**英語のキャメルケース**（例: `leaveStartDate`、`requestReason`）
- `title` は**日本語のラベル**（例: `"申請開始日"`）
- `_order` は **10 刻みで連番**（10, 20, 30, ...）

### API に渡す dataSchema の形（JSON）

バックエンドは JSON Schema 準拠のオブジェクトを期待する。ルートは `type: "object"`、`properties`、（推奨）`additionalProperties: false` とする。日付項目は概念上は「date」だが、プロパティ定義では `type: "string"` と `format: "date"` および `_acomoType: "date"` とする例が一般的（[patterns.md](patterns.md) のサンプル参照）。

---

## データアクセスポリシー（policy）

**policy**（型名では `ModelPolicy`）は、**各タスクノードにおいて、プロセスデータの各フィールドを編集できるか・参照だけか**を表す。definition / dataSchema と並ぶモデルの必須要素である。

### 構造

```text
{ [nodeId]: { [dataSchema のプロパティキー]: "write" | "read" } }
```

- **キー（第1層）**: definition 上の**ノード ID**（文字列）。通常は **タスクノード**のみが対象。開始・終了イベントや `parallelFork` / `parallelJoin` にはデータ入力がないため、policy を持たせないことが多い。
- **キー（第2層）**: `dataSchema.properties` にある**プロパティ名**と一致させる。
- **値**: `"write"` はそのノードで編集可能、`"read"` は参照のみ。

ノード ID に対応するエントリがない場合、またはそのノードで列挙されていないプロパティについては、**そのノードではそのフィールドにアクセスできない**扱いになる（詳細は [acomo の reference.md](../acomo/reference.md) の ModelPolicy 節）。

### 設計の指針

- 申請タスクでは申請内容の項目を主に `write`、承認タスクでは内容は `read` に寄せ、承認者だけが書く項目（例: `approverComment`）だけ `write` とする、といった業務に沿った割り当てにする。
- **差し戻し**で申請ノードに戻った場合も、同じノード ID の policy がそのまま適用される（別ノードとして切り替わらない）。
- **並列タスク**（例: 法務・経理）では、並列側の**各タスクノードごと**に、参照・入力可能な項目を policy で切り分ける。

### policy と actionPolicies の違い

| 項目 | 役割 |
|------|------|
| **policy**（モデル直下） | ノードごとの**データ項目**の read / write |
| **actionPolicies**（各ノードの任意プロパティ） | 誰が **start / submit / approve** などの**アクション**を実行できるかの条件式 |

ロールや起票者だけが開始できる等の**操作権限**は definition の `actionPolicies` で扱う。**フィールド単位の編集可否**は policy で扱う。式の構文は [acomo の reference.md](../acomo/reference.md) の Node・BinaryExpression を参照。

---

## よくある設計ミスと対処

| ミス | 正しい設計 |
|------|-----------|
| 申請と承認を1ノードにまとめる | 申請者ノードと承認者ノードを分ける |
| `status` フィールドをデータスキーマに追加する | 削除する（エンジンが管理）|
| 終了ノードが1つしかない | 承認/却下で別の終了ノードを作る |
| エッジ type を配列でなく文字列で指定する | 必ず配列 `["approve"]` で指定する |
| スキーマ未定義の形でプロパティを書く | `model-schemas.json` の `dataSchema` oneOf に沿う |
| 複数承認者を直列のタスクでモデル化してしまう | 同時判断なら `parallelFork/Join` を使う |
| policy のノード ID をノード名で書く、または誤った ID を参照する | definition の **id** と完全一致させる |
| 承認タスクで申請内容の項目をすべて `write` のままにする | 参照のみなら `read`、承認者入力欄だけ `write` など業務に合わせる |
| 並列の各タスクで同じ policy を想定する | タスクノード ID ごとに必要な read/write を定義する |
