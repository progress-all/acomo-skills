# 画面設計（モデル → UI の写像規則）

カスタムアプリトラック **A1** の正本。ワークフローモデル（definition / dataSchema / policy / actionPolicies）を入力に、
**スタック非依存**の画面設計 Markdown を組み立てる。フレームワーク選定・実装コードは扱わない
（実装は [client-integration.md](client-integration.md)）。
モデルの型・用語は acomo スキルの `reference.md` を正とする。

## 写像規則（モデル → UI 要素）

### definition → 業務状態・遷移・画面骨格

| モデル側 | UI 側 |
|---------|------|
| タスクノード | 「そのアクターが操作する局面」。詳細画面の 1 状態（＝現在ノード別の表示バリエーション） |
| 開始イベント + `start` の actionPolicy | 「新規申請」ボタン・作成画面 |
| 終了イベント（複数） | 一覧のステータス表示・完了画面の結末別メッセージ |
| exclusiveFork の conditions | UI には出さない（自動遷移）。ただし条件に効く入力項目はフォームで目立たせる |
| parallelFork / Join | 詳細画面で「並行して進んでいる作業」の並列表示。操作は nodeId 付き API |
| `canRevert` | 差し戻しボタン（戻り先ノードの選択が要る場合は選択 UI） |
| エッジの `FlowType`（submit/approve/reject） | ボタンの意味と強弱（進める操作を最も強く、reject は視覚的に分離） |

### dataSchema → フォーム項目

`properties` を `_order` 昇順に並べ、各プロパティを次で写像する。

| スキーマ属性 | UI 側 |
|-------------|------|
| `title` | 表示ラベル（キー名を画面に出さない） |
| `description` | ヒント・プレースホルダ |
| `_acomoType: string` | 1 行テキスト |
| `_acomoType: number` | 数値入力 |
| `_acomoType: date` | 日付ピッカー |
| `_acomoType: enum`（`enum` 配列） | セレクト / ラジオ |
| `_acomoType: file` | ファイル添付（アップロードは専用 API — client-integration.md） |
| `_acomoType: record` | テーブル型入力（`_recordKey` が行キー） |
| `_acomoType: object` / `array` | グループ化した入れ子フォーム / 繰り返し行 |

**必須項目について**: dataSchema はトップレベルの `required` 配列を受け付けない
（バックエンドのスキーマ検証が `未定義のプロパティ "required" は許可されていません` で拒否する — 実測 2026-07-05）。
エンジンは項目の必須性を強制しないため、必須マーク・送信前バリデーションは**アプリ側の責務**として
設計書に明記する（どの項目を必須扱いにするかは業務ヒアリングで決める）。

### policy → 項目の表示制御

現在ノード ID × プロパティキーで決まる（正: acomo 標準 UI の `WorkflowProcessDataForm.vue` と同じ規則）。

| policy の値 | UI |
|------------|----|
| `write` | 編集可能フィールド |
| `read` | 読み取り専用フィールド |
| **未定義** | **非表示**（グレーアウトではなく描画しない） |

- 並列区間では現在ノード ID にインスタンス接尾辞（`<nodeId>_<n>`）が付くことがある。
  **policy 参照時は `currentNodeId.split('_')[0]` で正規化**する（acomo 標準 UI と同じ処理）。
- 完了後の閲覧画面は「終了イベントノードの policy」で決まる。read が並んでいなければデータは見えない（仕様）。

### actionPolicies + nodeActions → 操作ボタン

- **設計時**: 各タスクの `actionPolicies` から「誰が・何をできるか」の表を作る（`allow` 式は値でなく形を読む —
  `$user.id == $executor(<開始ノードid>).id` は「起票者本人」、`$user.roles has "<roleId>"` は「ロール保持者」）。
- **実行時**: ボタンの活性判定は式をアプリで再実装せず、`getProcessWithNodeActions` が返す
  `nodeActions[]`（`{node, nodeActionTypes}`）**サーバー側の判定結果**を使う（client-integration.md）。

### 複数モデル

ポータル型アプリでは**モデルカタログ（業務の選択）を起点**にナビゲーションを組む。
一覧・詳細・作成の画面骨格はモデル間で共通化し、フォームだけ dataSchema で差し替える。

## 標準の画面セット

単一モデルの最小構成は次の 4 画面 + 認証。これを土台に要件で増減する。

| 画面 | 主データ源（operationId） | 主要素 |
|------|--------------------------|--------|
| 一覧（自分のワーク） | `listMyProcesses`（`permitted=true` で要対応、`actioned=true` で自分の履歴） | ステータス・現在ノード名・詳細への導線 |
| 詳細 | `getProcessWithNodeActions` | policy 準拠フォーム + nodeActions 準拠ボタン + 履歴 |
| 作成 | `startWorkflowProcess` → 詳細へ | 「新規申請」CTA |
| 完了 / 結末 | 詳細の状態バリエーション | 終了イベント名に応じたメッセージ |

## 設計書テンプレート

設計 Markdown は次の見出しで書く（AI 実装エージェント・人間の開発者どちらにも渡せる粒度にする）。

```markdown
# <アプリ名> 画面設計

## 1. 対象モデルと正本         … modelId・バージョン・モデル名（複数ならモデルカタログ表）
## 2. アーキテクチャ           … custom-app-guide.md の 3 構成のどれか + 選定理由
## 3. アクターと権限           … actionPolicies 由来の「誰が・どのタスクで・何をできる」表
## 4. 画面一覧と遷移           … 画面名・URL 案・遷移図（画面間の内部参照表）
## 5. 画面別仕様               … 画面ごとに: 表示条件 / フォーム項目表（キー・ラベル・型・read|write|非表示 の policy 対照）/
##                              操作ボタン表（ボタン・nodeActionType・operationId 対照）/ 空状態・エラー
## 6. API 呼び出し一覧         … operationId・メソッド・パス・呼び出し画面の対照表
## 7. 受け入れ条件             … walkthrough の全結末経路がこのアプリの画面操作で通ること（custom-app-e2e.md）
## 8. 未確定事項               … 業務判断待ちの項目（勝手に確定しない）
```

書き方の規律:

- **正本との対照を欠かさない** — フォーム項目表には dataSchema のキー、ボタン表には nodeId / operationId を必ず併記する
  （実装時の突合とテスト生成が機械的にできる）。
- **未確定は未確定と書く** — 仮定で埋めた箇所は「8. 未確定事項」に集約し、実装前にユーザーへ確認する。
- **抽象度を混ぜない** — 見た目の詳細（色・余白）はスタック依存なので書かない。意味（強い操作・弱い操作、必須、非表示）を書く。
