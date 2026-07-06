# 最小 SPA スキャフォールド（Vite + dev proxy + SuperTokens）

カスタムアプリトラック **A2** の **(a) SPA 直呼び構成**を最短で立ち上げるための最小 3 ファイル。
雛形アプリの丸コピーはアンチパターン（[custom-app-guide.md](custom-app-guide.md)）— この 3 ファイルを土台に、
A2 の積み上げ順（認証 → 一覧 → 詳細 → アクション）で必要な画面だけ足す。
コードの核は [auth-integration.md](auth-integration.md) / [client-integration.md](client-integration.md) の
**実走検証済みスニペット**（2026-07-04）の組み合わせ。設計判断・CORS の背景はそちらが正本。

## 初期化コマンド

```bash
npm create vite@latest my-acomo-app -- --template react-ts   # フレームワークは自由（Vue 等でも 3 ファイルの役割は同じ）
cd my-acomo-app
npm install @acomo/client supertokens-web-js
```

接続情報は環境変数にする（`.env.local` — Vite は `VITE_` プレフィックスが必要）:

```bash
VITE_ACOMO_ORIGIN=http://localhost:3000
VITE_AUTH_TENANT_ID=<authTenantId>
VITE_MODEL_ID=<対象モデルの modelId>
```

## 1. `vite.config.ts` — 業務 API の同一オリジン化（dev proxy）

業務 API（`x-tenant-id` 必須）はブラウザから acomo へ直呼びできない（CORS の許可ヘッダに
`x-tenant-id` が含まれない — [auth-integration.md](auth-integration.md)）。dev proxy で同一オリジン化する。

```typescript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        // 業務 API を同一オリジン化する（acomo 標準フロントも nitro devProxy の同方式）
        '/api': { target: env.VITE_ACOMO_ORIGIN, changeOrigin: true },
      },
    },
  }
})
```

本番配信では同じ役割をリバースプロキシ / 同一オリジン配信 / BFF が担う。

## 2. `src/acomoAuth.ts` — SuperTokens 初期化とサインイン

認証 API（`/api/v1/auth/...`）は `x-tenant-id` 不要のため直呼びできる。SDK は acomo に向けて初期化する。

```typescript
import SuperTokens from 'supertokens-web-js'
import Session from 'supertokens-web-js/recipe/session'
import EmailPassword from 'supertokens-web-js/recipe/emailpassword'
import Multitenancy from 'supertokens-web-js/recipe/multitenancy'

export const AUTH_TENANT_ID = import.meta.env.VITE_AUTH_TENANT_ID

export function initAcomoAuth() {
  SuperTokens.init({
    appInfo: {
      appName: 'my-acomo-app',
      apiDomain: import.meta.env.VITE_ACOMO_ORIGIN,
      apiBasePath: '/api/v1/auth',
    },
    recipeList: [
      Session.init({ tokenTransferMethod: 'header' }),   // getAccessToken() の前提
      EmailPassword.init(),
      Multitenancy.init({ override: { functions: oI => ({ ...oI, getTenantId: async () => AUTH_TENANT_ID }) } }),
    ],
  })
}

export async function signIn(email: string, password: string) {
  return EmailPassword.signIn({
    formFields: [
      { id: 'email', value: email },
      { id: 'password', value: password },
    ],
  })
}

export const getAccessToken = () => Session.getAccessToken()
export const isSignedIn = () => Session.doesSessionExist()
```

## 3. `src/acomoClient.ts` — `@acomo/client` の初期化

```typescript
import { Configuration, EngineApi, MyProcessApi, MyModelApi } from '@acomo/client'
import { getAccessToken, AUTH_TENANT_ID } from './acomoAuth'

const config = new Configuration({
  basePath: '',                                   // 同一オリジン相対（dev proxy 経由で /api/v1/... を呼ぶ）
  accessToken: async () => (await getAccessToken()) ?? '',
  apiKey: AUTH_TENANT_ID,                          // → x-tenant-id ヘッダ
})

// 一般業務ユーザーのアプリは /my 系 + engine 系で組む（/models・/processes 系は管理者向け）
export const engineApi = new EngineApi(config)
export const myProcessApi = new MyProcessApi(config)
export const myModelApi = new MyModelApi(config)
```

呼び出し規約（[client-integration.md](client-integration.md) が正本）:

- engine 系・プロセス取得系は **`*Raw` + `raw.json()`**（高レベルメソッドは実レスポンスで落ちる）
- アクションの body は **フラットな JSON**（`{"data":{...}}` で包まない）
- ボタン活性は `getProcessWithNodeActions` の `nodeActions` を使う（自作判定しない）

## 動作確認（この土台の DoD — A2 ステップ 2「認証」まで）

```typescript
// サインイン → 業務 API 疎通の最小確認（App 初期化時に initAcomoAuth() 済みであること）
await signIn('<email>', '<password>')
const res = await myModelApi.listMyModelsRaw({})   // list 系 Raw は空オブジェクトを渡す
console.log(await res.raw.json())                   // { models, total } が返れば疎通 OK
```

ここまで通ってから一覧・詳細・アクションの画面を積む（順序と各段の DoD は
[custom-app-guide.md](custom-app-guide.md) A2、画面の写像は [screen-design.md](screen-design.md)）。
