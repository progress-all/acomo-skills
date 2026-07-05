# @acomo/client / 公開 API 実装ガイド

カスタムアプリトラック **A2** の正本。`@acomo/client`（OpenAPI 生成 TypeScript クライアント、npm 公開）と
acomo 公開 API の呼び出しパターンをまとめる。**コード例はローカル開発スタックで実走検証済み**（2026-07-04）。
認証トークンの取得は [auth-integration.md](auth-integration.md)。

## クライアントの 2 つの使い方

| | **(1) 生成クライアントで呼ぶ** | **(2) 型のみ + 自前 fetch（BFF パターン）** |
|---|---|---|
| HTTP | `@acomo/client` の `*Api` クラス | 自前の fetch / axios ラッパー |
| 型 | 生成型をそのまま | `WorkflowProcessEntity` 等を型 import のみ |
| 向く構成 | SPA 直呼び・小さな BFF | BFF で共通ヘッダ・ロギング・リトライを一元化したい場合 |

どちらでも**認証ヘッダは同じ**: `Authorization: Bearer <token>` + `x-tenant-id: <authTenantId>`。

### (1) Configuration の初期化（検証済み）

```typescript
import { Configuration, EngineApi, MyProcessApi, MyModelApi } from '@acomo/client'

const config = new Configuration({
  basePath: process.env.ACOMO_URL,      // 例: http://localhost:3000（/api/v1 は含めない）
  accessToken: token,                    // → Authorization: Bearer <token>（async 関数も渡せる）
  apiKey: process.env.ACOMO_TENANT_ID,   // → x-tenant-id ヘッダ（authTenantId）
})
const engineApi = new EngineApi(config)
```

- `@acomo/client` は bundler 前提の ESM（拡張子なし import）。Vite / Nuxt / Next 等では素直に使える。
  素の Node スクリプトで使うときは tsx などの bundler 系ローダーで実行する。
- ブラウザ SPA では `basePath` を**空文字**にすると同一オリジン相対（`/api/v1/...`）で呼べる
  （業務 API は CORS 制約により dev proxy 等で同一オリジン化する — [auth-integration.md](auth-integration.md)。
  `accessToken: async () => Session.getAccessToken()` の形でブラウザ実走確認済み・2026-07-04）。

### API クラスの選び方（operationId から推測しない）

生成クラスは **OpenAPI の tag ごと**に `<Tag>Api` として生成される。メソッド名（operationId）の語感から
クラスを推測しない（例: `getMyModel` は `ModelApi` ではなく **`MyModelApi`** にある）。
本ガイドで使う操作の対応は次のとおり。

| 操作（operationId） | クラス |
|--------------------|--------|
| `startWorkflowProcess` / `submitWorkflowProcess` / `approveWorkflowProcess` / `rejectWorkflowProcess` / `revertWorkflowProcess` / `*WithNodeId` 系 | `EngineApi` |
| `listMyProcesses` / `getMyProcesses` / `getProcessWithNodeActions` / `getMyDiffs` / `uploadMyProcessDataFile` 等の `/my/processes` 系 | `MyProcessApi` |
| `listMyModels` / `getMyModel` / `listModelWithNodeActions`（`/my/models` 系） | `MyModelApi` |
| `listWorkflowModels` / `getWorkflowModel` / `createWorkflowModel` 等（`/models` 系・管理者向け） | `ModelApi` |
| `listWorkflowProcesses` 等（`/processes` 系・管理者向け） | `ProcessApi` |

**権限に注意**: `ModelApi` / `ProcessApi`（`/models` / `/processes`）は SystemActionPolicies
`Model:read` / `Process:read` 等を要求する**管理者向け API**。一般業務ユーザー（ロールが `Engine:execute` のみ）は
403 になるため、**エンドユーザー向けカスタムアプリは `MyModelApi` / `MyProcessApi`（`/my/...`）を使う**。

### 高レベルメソッドと `*Raw` の使い分け（重要・実測）

生成クライアントの各操作には `xxx()`（型付き値を返す）と `xxxRaw()`（`ApiResponse` を返す）がある。
**プロセスを返す操作（engine 系・プロセス取得系）は `*Raw` + `raw.json()` を使う**こと。

```typescript
// NG: engine 系・プロセス取得系の高レベルメソッドは実レスポンスで落ちる
const proc = await engineApi.startWorkflowProcess({ modelId })   // TypeError

// OK: Raw + json()（acomo CLI も同じ方式）
const res = await engineApi.startWorkflowProcessRaw({ modelId })
const proc = await res.raw.json()
```

理由（実測 2026-07-04）: OpenAPI 上 `ProcessTokenEntity.childProcessTokens` が required 宣言だが、
非並列プロセスの実レスポンスでは省略される。高レベルメソッドの FromJSON マッパーが
`childProcessTokens.map` で TypeError になる。`getCurrentUser` などレスポンス型未宣言の操作も
高レベル版は `Promise<void>` なので Raw を使う。エラー判定は `res.raw.ok` / `ResponseError` で行う。

### (2) 型のみ + 自前 fetch（BFF での実績パターン）

```typescript
import type { WorkflowProcessEntity, ProcessWithNodeActionsEntity, NodeActionsEntity } from '@acomo/client'

async function fetchAcomo<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${process.env.ACOMO_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getToken()}`,   // auth-integration.md
      'x-tenant-id': process.env.ACOMO_TENANT_ID,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) throw new Error(`acomo API ${res.status}: ${await res.text()}`)
  return res.json()
}
```

## 主要 API 呼び出しパターン

パスはすべて `/api/v1` プレフィックス付き。`{...}` は実値に置換する。

### 一覧（自分のワーク）

| 目的 | 呼び出し |
|------|---------|
| モデルカタログ（自分が開始できる公開モデル） | `GET /my/models`（`listMyModels`）。ポータル型アプリの「新規申請」起点 |
| 自分が今操作できるプロセス | `GET /my/processes?permitted=true`（`listMyProcesses`） |
| 特定アクション待ちだけ | `...&nodeActionType=approve`（承認待ち一覧） |
| 自分が関与した履歴 | `GET /my/processes?actioned=true`（+`processHistoryType` で絞り込み） |
| 管理者向け全プロセス | `GET /processes`（`listWorkflowProcesses`。filter / skip / take。`Process:read` が必要 — 一般業務ユーザーは不可） |

戻り値は `{ processes: WorkflowProcessEntity[], total }`（モデル一覧 `listWorkflowModels` / `listMyModels` は `{ models, total }`）。
list 系の `*Raw` は TypeScript 型上リクエスト引数が必須（実行時は省略可）— クエリなしでも `listMyModelsRaw({})` のように空オブジェクトを渡す（実測 2026-07-05）。

### 詳細 + 操作可否（画面の中心）

```typescript
// プロセス + 「今の自分ができる操作」を 1 リクエストで取る
const res = await myProcessApi.getProcessWithNodeActionsRaw({ processId })
const { process, nodeActions } = await res.raw.json()
// nodeActions: { node: Node, nodeActionTypes: ('submit'|'approve'|'reject'|'revert'|'update'|...)[] }[]
```

**ボタンの活性判定は必ず `nodeActions` を使う**（サーバー側で actionPolicies を評価した結果）。
actionPolicies の式やロール判定をアプリ側で再実装しない。

```typescript
const canApprove = (nodeActions: NodeActionsEntity[], nodeId: string) =>
  nodeActions.some(a => a.node.id === nodeId && a.nodeActionTypes.includes('approve'))
```

現在ノードは `process.token.nodeId`（並列区間は `token.childProcessTokens` を再帰的に見る）。

### フォームの表示制御（policy）

モデルの `policy[<現在ノードID>][<キー>]` で決める。モデルの取得は **`getMyModel`（`MyModelApi`。
`GET /my/models/{modelId}`）** を使う — ログイン済みユーザーなら呼べて、definition / dataSchema / policy を含む
`WorkflowModelEntity` を返す。`getWorkflowModel`（`ModelApi`）は `Model:read` が要る管理者向けで、
一般業務ユーザーは 403 になる。

- `write` → 編集可 / `read` → 読み取り専用 / **未定義 → 非表示**
- 並列区間の現在ノード ID はインスタンス接尾辞付き（`<nodeId>_<n>`）のことがある —
  **`currentNodeId.split('_')[0]` で正規化してから policy を引く**（acomo 標準 UI と同じ規則）。
- 項目の並び・ラベル・入力型は dataSchema の `_order` / `title` / `_acomoType`（写像は [screen-design.md](screen-design.md)）。

### アクション実行（engine 系）

| 操作 | 呼び出し |
|------|---------|
| 開始 | `POST /engine/start/{modelId}`（`startWorkflowProcess`） |
| 提出 | `POST /engine/submit/{processId}`（`submitWorkflowProcess`） |
| 承認 / 却下 | `POST /engine/approve/{processId}` / `POST /engine/reject/{processId}` |
| 並列区間 | `POST /engine/submit/{processId}/{nodeId}` 等の `*WithNodeId` 系 |
| 差し戻し | `POST /engine/revert/{processId}/{nodeId}`（戻り先 nodeId を指定） |

**body は dataSchema のキーをトップレベルに持つフラットな JSON**（実走確認済み）:

```typescript
const res = await engineApi.submitWorkflowProcessRaw({
  processId,
  body: { itemName: '出張旅費', amount: 12800 },   // フラット。{"data":{...}} で包まない
})
const updated = await res.raw.json()
// updated.token.nodeId が期待した次ノードかを確認する
```

- `{"data":{...}}` で包むと dataSchema 外のキーとして無視される（無言で捨てられる — エラーにならない）。
- 現在ノードで `write` の項目だけを送る。`read` の項目・policy 未定義の項目は送っても反映されない。
- **`saveWorkflowProcess`（`PUT /engine/save/{processId}`）は OpenAPI 上 requestBody 未定義**のため
  生成クライアントからデータを渡せない。データは submit / approve / reject のアクション body で一緒に渡すか、
  自前 fetch で PUT する（恒久対応はバックエンドの `@ApiBody` 追加 — 別課題）。

### ファイル添付

| 操作 | 呼び出し |
|------|---------|
| アップロード | `POST /my/processes/{processId}/files/upload`（`uploadMyProcessDataFile`、multipart） |
| ダウンロード URL | `POST /my/processes/{processId}/files/getDownloadUrl` |
| 削除 | `POST /my/processes/{processId}/files/delete` |

dataSchema 側は `_acomoType: "file"` の項目にファイル名を持たせる。

### 履歴・差分

`GET /my/processes/{processId}/diffs`（`getMyDiffs`）でプロセスの変更履歴差分を取得できる（タイムライン表示用）。

## 権限の前提（実測）

- **engine 系 API はロールの SystemActionPolicies `Engine:execute` が必要**。ロールを持たないユーザーは
  actionPolicies 以前に 403（`権限不足: Engine:execute が必要`）になる。カスタムアプリの利用者には
  最低限 `{ type: 'execute', subject: 'Engine' }` を含むロール（「一般社員」相当の実行ロール）を割り当てる。
- **`/models` / `/processes`（`ModelApi` / `ProcessApi`）は `Model:read` / `Process:read` 等が要る管理者向け**。
  一般業務ユーザーのアプリ機能は `/my/models` / `/my/processes`（`MyModelApi` / `MyProcessApi`）で組む。
- タスク単位の「誰ができるか」はモデルの actionPolicies が決め、その評価結果が `nodeActions` に出る。
- **完了後のプロセスデータの見え方は終了イベントの policy 次第**。read が並んでいないモデルでは完了後の取得で
  `data` が `{}` になる（仕様。walkthrough-testing.md の既知の制約と同じ）。

## 実装チェックリスト（A2 の DoD 前確認）

- [ ] engine 系・プロセス取得系は `*Raw` + `raw.json()` を使っている
- [ ] body はフラット JSON（`{"data":{...}}` で包んでいない）
- [ ] ボタン活性は `nodeActions` 由来（ロール名・status 文字列の自作判定をしていない）
- [ ] フォーム項目は policy（write / read / 非表示）と `_order` に従っている
- [ ] 並列区間で nodeId 正規化（`split('_')[0]`）と `*WithNodeId` 系を使っている
- [ ] アクション後に `token.nodeId` で遷移先を検証している
