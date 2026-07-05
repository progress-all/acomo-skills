# カスタム UI の E2E（walkthrough JSON 起点）

カスタムアプリトラック **A3** の正本。モデル開発ループ Phase 4 の DoD（全結末経路の実走）を、
**カスタムアプリの UI 経由で再達成**する。テストランナーは自由（Playwright 推奨。規約はアプリのリポジトリに従う。
acomo 標準フロントの E2E 規約 = acomo-e2e スキルはこのモノレポ専用なので、そのまま持ち出さない）。

## 経路の正本 = walkthrough JSON

テスト対象の経路・入力データ・API 呼び出しを手で列挙しない。ハーネスの機械可読出力を正本にする。

```bash
npm run workflow:walkthrough -- model.json --json > walkthrough.json
# モノレポ外: node <スキルの scripts/>walkthrough-plan.mjs model.json --json
```

`paths[]` が「開始 → 各終了イベント」の全結末経路。各 `steps[]` に次が入っている
（フィールド仕様: [harness-guide.md](harness-guide.md)）。

| フィールド | E2E での使い方 |
|-----------|---------------|
| `kind: 'action'` の `nodeId` / `action` | どの画面状態で・どの操作ボタンを押すか |
| `sampleData` | フォームに入力する値の雛形（型を満たすだけの値 — 条件分岐に効く値は `condition` を見て調整） |
| `kind: 'branch'` の `condition` | この経路に入るための exclusiveFork 条件（`{expression, destination}`）。条件に効く入力値の導出に使う |
| `to` | 操作後に到達すべきノード（アサーション対象） |
| `api` | UI を介さない事前準備・並走検証・API 層テストにそのまま使える REST 呼び出し |
| `branches` | 並列区間のブランチ別操作（`*WithNodeId` 系） |

## テストの組み立て方

### 1. ステップ → 画面操作のマッピング表を作る

A1 の設計書（[screen-design.md](screen-design.md)）どおりなら機械的に対応が取れる。

| walkthrough ステップ | カスタム UI の操作 |
|---------------------|-------------------|
| `kind: 'start'` | 「新規申請」ボタン → 作成画面 |
| `action: 'submit'` @ nodeId X | X に対応する画面でフォーム入力（`sampleData`）→ 提出ボタン → 確認 |
| `action: 'approve'` / `'reject'` | 承認者アカウントに切り替え → 詳細画面 → 承認 / 却下 |
| `to` | 遷移後の画面表示（ステータス・現在ノード名）をアサート |

### 2. spec の骨格（経路をデータ駆動で回す）

```typescript
import { test, expect } from '@playwright/test'
import walkthrough from './walkthrough.json'

for (const path of walkthrough.paths) {
  test(`経路: ${path.outcome.name}`, async ({ page }) => {
    for (const step of path.steps) {
      if (step.kind === 'start') { /* 新規申請 → プロセス ID を控える */ }
      if (step.kind === 'action') { /* アクター切替 → 入力(step.sampleData) → step.action のボタン */ }
      // 各操作後: UI 表示 + API 並走検証（下記）で step.to への遷移を確認
    }
    // 終了: path.outcome.name に対応する完了表示をアサート
  })
}
```

- **アクター切り替え**: タスクの actionPolicies に合わせてテストユーザーを切り替える。認証セットアップは
  [auth-integration.md](auth-integration.md) (C)（非対話サインイン）を使い、ロールに `Engine:execute` があるユーザーを使う。
- **権限外ケースを最低 1 本**: 権限のないユーザーでは操作ボタンが**表示されない**こと（UI）と、
  API 直叩きが 403 になること（`api` フィールドで再生）を確認する。
- **循環エッジ**（`cycleEdges`: 差し戻し・再提出）は自動列挙されないため、業務にあるなら手動で 1 spec 足す。

### 3. API 並走検証（UI アサーションの裏取り）

画面表示だけでなく、各操作後にエンジンの実状態を確認する（UI のバグとモデルのバグを切り分けられる）。

```typescript
// GET /my/processes/nodeActions/{processId} で現在状態と残アクションを取得
const { process } = await fetchAcomo(`/my/processes/nodeActions/${processId}`)
expect(process.token.nodeId).toBe(step.to)
```

`steps[].api` を順に再生すれば **UI を介さない API 層の経路テスト**にもなる（バックエンド統合テストとして
UI テストより先に green にしておくと、失敗時の切り分けが速い）。

## DoD（A3 の出口条件）

1. `walkthrough.json` の**全 `paths`**（全結末）がカスタム UI 経由で期待した終了ノードに到達した
2. 権限外ユーザーの操作不可を UI / API の両方で 1 ケース以上確認した
3. 経路ごとの証跡（プロセス ID・実行アクション列・到達ノード）が記録されている（walkthrough-testing.md の記録テンプレート）
4. モデルを更新したら `walkthrough.json` を再生成してテストを回し直した（経路・項目の差分がテストに自動反映される）

## Known failure modes

- **UI のアクションボタンをクリックした直後に並走 API で現在ノードを同期確認して flake する** —
  クリック時点ではアプリの engine 呼び出しがまだ完了していないことがある（実測）。並走検証は
  `expect.poll`（または UI の遷移後表示を待ってから）で `token.nodeId` が `step.to` になるのを待つ。
- **sampleData をそのまま送って条件分岐が期待経路に入らない** — `sampleData` は型を満たすだけの値。
  exclusiveFork の条件に効く項目は、branch ステップの `condition`（`{expression: {operator, expression1, expression2}, destination}`）
  から経路ごとに満たす値を導出して上書きする（例: `$data.amount >= 100000` の経路なら `amount: 150000` を送る）。
- **UI テストが落ちたときにモデル起因かアプリ起因か切り分けない** — 同じ経路を `api` フィールドで再生して
  API 層が green ならアプリ起因、API 層でも落ちるならモデル / 権限起因。
- **テストユーザーに `Engine:execute` ロールがなく全経路が 403** — actionPolicies 以前にロールで弾かれている
  （client-integration.md の権限の前提）。
