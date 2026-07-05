# 認証統合（カスタムアプリ → acomo）

カスタムアプリトラック **A2** の認証正本。どのパターンでも、acomo API へのリクエストヘッダは共通:

```
Authorization: Bearer <アクセストークン>
x-tenant-id: <authTenantId>
```

`x-tenant-id` は **authTenantId**（acomo のサインイン URL の `authTenantId=` と同じ値）。
アーキテクチャ（[custom-app-guide.md](custom-app-guide.md) の 3 構成）に応じてトークンの入手方法が変わる。

## パターン早見

| パターン | トークン | 向く構成 | 寿命 |
|---------|---------|---------|------|
| (A) SuperTokens セッション | ユーザー本人のセッションアクセストークン | SPA 直呼び / BFF 型（画面のある業務アプリ） | 短命（SDK が自動更新） |
| (B) Client Credentials | 管理画面で発行するクライアントアクセストークン | サーバーサイド / バッチ / システム間連携 | 発行時に期限指定 |
| (C) ローカル開発の非対話サインイン | (A) と同じセッショントークンを API で取得 | 開発・検証・エージェントの自動テスト | 短命（実走直前に取得） |

## (A) SuperTokens セッション（人間ユーザー）

acomo バックエンドが SuperTokens の認証 API サーバーを兼ねる（`apiBasePath: /api/v1/auth`）。
カスタムアプリは**自前でパスワード管理をせず**、SuperTokens SDK を acomo に向けて初期化する。

### SPA 直呼び構成

フロントエンドに SuperTokens SDK（`supertokens-web-js` / `supertokens-auth-react`）を入れ、
`apiDomain` を acomo バックエンドに向ける（下記はカスタム React SPA でローカル実走検証済みの最小形 — 2026-07-04）:

```typescript
// supertokens-web-js（Multitenancy で authTenantId を固定する）
SuperTokens.init({
  appInfo: {
    appName: 'my-app',
    apiDomain: ACOMO_ORIGIN,            // 例: http://localhost:3000
    apiBasePath: '/api/v1/auth',
  },
  recipeList: [
    Session.init({ tokenTransferMethod: 'header' }),
    EmailPassword.init(),
    Multitenancy.init({ override: { functions: oI => ({ ...oI, getTenantId: async () => AUTH_TENANT_ID }) } }),
  ],
})
// サインイン: EmailPassword.signIn({ formFields: [...] })
```

API 呼び出し時はセッションからアクセストークンを取り、共通ヘッダを付ける:

```typescript
import Session from 'supertokens-web-js/recipe/session'
const token = await Session.getAccessToken()   // tokenTransferMethod: 'header' が前提
// → Authorization: Bearer <token> / x-tenant-id: <AUTH_TENANT_ID>
```

**CORS の実際（ローカル実走で確認済み・2026-07-04）**:

- アプリのオリジンを acomo の**接続許可 URL** に登録する（管理者が `POST /api/v1/cors`（`createCorsOrigins`）
  または管理画面から。登録は即時反映）。
- 許可オリジンからでも、**業務 API のブラウザ直呼びは現状できない** — CORS の `Access-Control-Allow-Headers` は
  `content-type` + SuperTokens 系ヘッダのみで **`x-tenant-id` が含まれず**、preflight で弾かれる。
  - **認証 API（`/api/v1/auth/...`）は直呼びできる**（`x-tenant-id` 不要のため）。SuperTokens SDK はそのまま acomo に向けてよい。
  - **業務 API は同一オリジン化**する: 本番はリバースプロキシ / 同一オリジン配信 / BFF、開発は dev サーバーの
    proxy（Vite `server.proxy` 等。acomo 標準フロントも nitro devProxy の同方式）。
  - 恒久対応はバックエンド CORS `allowedHeaders` への `x-tenant-id` 追加（別課題）。

### BFF 型構成（実運用実績のあるパターン）

ブラウザは acomo API を直接呼ばず、自前 BFF だけを呼ぶ。BFF は受け取った Bearer を検証して透過転送する。

1. フロント: 上記 SPA と同じく SuperTokens でサインインし、**BFF へのリクエスト**に Bearer + `x-tenant-id` を付ける。
2. BFF: JWT を acomo の JWKS で検証する（ローカルで疎通確認済みのエンドポイント）:

```typescript
import { JwksClient } from 'jwks-rsa'
const client = new JwksClient({ jwksUri: `${ACOMO_ORIGIN}/api/v1/auth/jwt/jwks.json` })
// jsonwebtoken の verify に getSigningKey で解決した公開鍵を渡す
```

3. BFF → acomo: 検証済みトークンを**そのまま** `Authorization: Bearer` として転送する
   （リクエストスコープ（CLS 等）に保存して acomo fetch ラッパーが常に付けるのが実績のある形）。
4. 必要なら `GET /api/v1/profile/user` で acomo ユーザー ID を取り、BFF 側 DB のユーザーと突合する。

## (B) Client Credentials（サービスユーザー / M2M）

画面のないサーバー処理・システム間連携用。**ユーザーのセッションを持たないリクエスト**は、
acomo の認証ガードが `Authorization` ヘッダをクライアントアクセストークンとして検証する
（トークンはテナント内で発行済み・失効していない・紐づくユーザーが有効、が条件）。

### トークンの発行

- **画面**: 管理者がサイドメニュー「認証」（`/authConfig`）の「アクセストークン」タブで発行する（acomo-ui スキル参照）。
  発行時に**紐づくユーザー**（サービスユーザー推奨）と **scope**（`<Subject>:<type>` 形式。実行時に
  SystemActionPolicies として合成される）を指定する。
- **API**: `POST /api/v1/clientAuth/oauth/token`（`generateToken`。管理者権限 `AuthConfig:write` が必要）。
- 発行可否は `GET /api/v1/clientAuth/status/client-credentials-availability` で確認できる。
  **サーバー側に OAuth クレデンシャル（`ACOMO_CLIENT_ID` / `ACOMO_CLIENT_SECRET`）が未設定の環境では発行不可**
  （ローカル開発スタックはデフォルト未設定 — `{"available":false}` を実測確認）。その場合ローカルの開発・検証は (C) を使う。
- 発行数のクォータ（月次）があるため、トークンは使い捨てにせず安全に保管して使い回す。

### 使い方

(A)(C) と同じ共通ヘッダで呼ぶだけ（コード側の分岐は不要）:

```
Authorization: Bearer <クライアントアクセストークン>
x-tenant-id: <authTenantId>
```

- プロセスを操作するなら、紐づくユーザーのロールまたは scope に **`Engine:execute`** が要る
  （[client-integration.md](client-integration.md) の権限の前提）。
- 失効は管理画面または `POST /api/v1/clientAuth/oauth/revoke`。

## (C) ローカル開発の非対話サインイン（開発・自動テスト用）

SuperTokens のパスワードサインイン API からセッションアクセストークンを直接取得する。
手順の正本は [walkthrough-testing.md](walkthrough-testing.md)（`st-auth-mode: header` + `st-access-token` ヘッダ）。
カスタムアプリの統合テスト・E2E のセットアップでもこのトークンをそのまま使える（短命なので実行直前に取得する）。

## 共通の注意

- **トークン種別によらず認可は 2 段**: ロール / scope の SystemActionPolicies（例: `Engine:execute`）→
  モデルの actionPolicies（タスク単位の実行者制限）。403 が出たらどちらで弾かれたかをエラーメッセージで確認する
  （`権限不足: Engine:execute が必要...` は前者）。
- 401 はトークン期限切れ・失効。セッション系は SDK の自動更新に任せ、自前 fetch では 401 時に再サインインへ誘導する。
- トークン・パスワードをフロントのコード・リポジトリに埋め込まない。接続先（acomo URL・authTenantId・モデル ID）は
  環境変数にする。
