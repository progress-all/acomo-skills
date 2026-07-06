# カスタムアプリ開発トラック（A1〜A4）

acomo をワークフローエンジンとして裏に置き、**独自の申請画面・ダッシュボード等のカスタムフロントエンド**を開発して
運用まで回し切るときの正本。モデル開発ループ（[loop-guide.md](loop-guide.md) Phase 0〜6）を完走してから入る。

```
Phase 0〜6（モデル開発ループ） → カスタム UI が必要か? ─ 不要 → 標準 UI で引き渡し（Phase 6）
                                            │
                                            └ 必要 → A1 画面設計 → A2 実装 → A3 検証・E2E → A4 引き渡し
```

**前提（入口条件）**: モデルが公開済みで、全結末経路のウォークスルー（Phase 4）が green。
モデルが揺れているままアプリを書き始めない — dataSchema のキー改名 1 つでアプリの型・フォーム・テストが連鎖的に壊れる。

## 関連 references

| ファイル | 役割 |
|---------|------|
| 本ファイル | トラック全体・アーキテクチャ選定・スキャフォールドレシピ |
| [screen-design.md](screen-design.md) | A1: モデル → 画面・フォーム・操作への写像規則と設計書テンプレート |
| [spa-scaffold-minimal.md](spa-scaffold-minimal.md) | A2: (a) SPA 直呼び構成の最小 3 ファイル（Vite + dev proxy + SuperTokens）— 初速用の土台 |
| [client-integration.md](client-integration.md) | A2: `@acomo/client` / 公開 API の呼び出しパターン（検証済み） |
| [auth-integration.md](auth-integration.md) | A2: 認証統合（セッション透過 / Client Credentials / ローカル開発） |
| [custom-app-e2e.md](custom-app-e2e.md) | A3: walkthrough JSON を正本にしたカスタム UI の E2E |

## アーキテクチャ選定（A1 の最初に決める）

固定の雛形は持たない。**要件に合わせて次の 3 構成から選び、選定理由をユーザーに 1〜2 文で説明**する。
フレームワーク・UI ライブラリは自由（ユーザーの指定・チームの慣れを優先する）。

| | **(a) SPA 直呼び** | **(b) BFF 型** | **(c) サーバーサイド** |
|---|---|---|---|
| 構成 | ブラウザ → acomo API | ブラウザ → 自前 API（BFF）→ acomo API | バッチ / ジョブ → acomo API |
| 認証 | SuperTokens セッション（ブラウザが直接持つ） | セッション JWT を BFF が検証して透過転送 | Client Credentials |
| 向く要件 | 画面数が少ない・独自データなし・最短で作る | 独自 DB / 独自権限 / 複数モデル統合 / 外部連携 | 定期処理・システム間連携・通知 |
| 追加で必要なもの | CORS 登録 + 業務 API の同一オリジン化（プロキシ。auth-integration.md） | BFF の実装・運用（JWKS 検証、トークン転送） | service ユーザーとトークン管理 |
| 参照実装 | acomo 標準フロントエンド（Nuxt） | NestJS BFF + Next.js 構成（実運用実績あり） | acomo CLI |

選定の目安:

- **独自のデータベースを持つか?**（acomo のプロセスデータに収まらない情報がある）→ (b)
- **acomo の権限（actionPolicies）以外の独自権限が要るか?** → (b)
- **画面なし・人手なしか?** → (c)。画面ありでも夜間バッチ等は (c) を併設してよい
- 上記すべて No → (a) が最小コスト

(a) の注意（実走確認済み）: SuperTokens 認証 API はブラウザから acomo へ直呼びできるが、
**業務 API（`x-tenant-id` 必須）は CORS の許可ヘッダに含まれず直呼びできない**。
同一オリジン配信 / リバースプロキシ / dev proxy を挟む（詳細: [auth-integration.md](auth-integration.md)）。

(b) の要点（実運用で実証されたパターン）: フロントは acomo API を直接呼ばず、自前 BFF だけを呼ぶ。
BFF は受け取った Bearer JWT を acomo の JWKS で検証し、そのまま `Authorization` + `x-tenant-id` として acomo へ転送する。
`@acomo/client` は型として使い、ワークフローごとに「dataSchema キー ↔ アプリ DTO」のマッピング層を薄く書く。

## A1: 画面設計

**入口**: アーキテクチャが決まっている。

**作業**: [screen-design.md](screen-design.md) の写像規則に従い、モデル（definition / dataSchema / policy / actionPolicies）から
画面一覧・遷移・フォーム・操作・API 呼び出しの設計 Markdown を作る。

- 非開発者ユーザーには JSON ではなく「画面一覧・誰が何をできるか」の表で合意を取る。
- 複数モデルを束ねるアプリでは、モデルカタログ（どの業務か選ぶ画面）を起点にナビゲーションを組む。

**出口（DoD)**: 画面一覧・各画面のフォーム項目（policy 由来の read/write/非表示）・操作ボタン（nodeActions 由来）・
呼び出す operationId が表で揃い、ユーザーが画面構成に合意した。

## A2: 実装（スキャフォールドレシピ）

**入口**: A1 の設計書がある。

**作業**: 雛形アプリのコピーではなく、**次の積み上げ順で都度生成**する。各段が動いてから次に進む（一気に全画面を書かない）。

1. **プロジェクト初期化** — 選んだフレームワークの標準ジェネレーターで作る。`@acomo/client` を依存に追加
   （npm 公開パッケージ。型のみ使う場合も入れる）。acomo 接続情報は環境変数にする
   （`ACOMO_URL` / 認証テナント ID。モデル ID もワークフローごとに環境変数化してハードコードしない）。
   **(a) SPA 直呼び構成なら [spa-scaffold-minimal.md](spa-scaffold-minimal.md) の最小 3 ファイル**
   （Vite proxy / SuperTokens 初期化 / client 初期化）から積む — references から都度組み立て直さない。
2. **認証** — [auth-integration.md](auth-integration.md) の該当パターンを実装し、
   「サインイン → `getCurrentUser` 相当が通る」までを最初に確認する。**認証が通る前に画面を作らない。**
3. **一覧画面** — `listMyProcesses`（`permitted=true` で「自分が操作できるプロセス」）から始める。
   [client-integration.md](client-integration.md) の呼び出しパターンを使う。
4. **詳細画面** — `getProcessWithNodeActions` で「プロセス + 今の自分ができる操作」を取り、
   policy でフォーム項目の read/write/非表示、`nodeActions` でボタンの活性を制御する。
5. **アクション実行** — engine 系（`start` / `submit` / `approve` / `reject`）を呼ぶ。
   **body は dataSchema のキーをトップレベルに持つフラットな JSON**（`{"data":{...}}` で包まない）。
6. **残りの画面** — A1 の設計書に沿って横展開する。ファイル添付・履歴表示などは client-integration.md の該当節を参照。

**出口（DoD)**: 設計書の全画面が実装され、開発環境で主要経路（申請 → 承認）が画面から通る。

## A3: 検証・E2E

**入口**: A2 の主要経路が手で通る。

**作業**: [custom-app-e2e.md](custom-app-e2e.md) に従う。要点:

- `npm run workflow:walkthrough -- <model.json> --json` の `paths` を**経路の正本**にし、
  全結末経路をカスタム UI 上で通す（モデル開発ループ Phase 4 の DoD をカスタム UI で再達成する）。
- 画面操作の裏で `getProcessWithNodeActions` / `getWorkflowProcess` により**現在ノードを並走確認**する。
- 権限外ユーザーに操作が出ないことを最低 1 ケース確認する。

**出口（DoD)**: 全結末経路がカスタム UI 経由で期待した終了ノードに到達し、証跡（経路・プロセス ID・到達ノード）が残っている。

## A4: 引き渡し

**入口**: A3 green。

**作業**: モデル開発ループの Phase 6 に加えて、カスタムアプリ特有の引き渡し物を揃える。

1. 運用手順 — **カスタムアプリの画面の言葉**で説明する（acomo 標準画面の用語を混ぜない）。
2. モデル変更時の影響範囲 — 「dataSchema のキー変更はアプリの改修を伴う」ことと、変更時の再走手順
   （モデルの Phase 2〜4 → アプリの A3）を伝える。
3. 接続情報の一覧 — 環境変数（acomo URL・テナント ID・モデル ID・トークンの発行方法）。

**出口（DoD)**: ユーザーがアプリを運用でき、モデル改善の依頼経路を理解している。

## アンチパターン

| アンチパターン | 正しい進め方 |
|----------------|--------------|
| モデルのウォークスルー前にアプリを書き始める | Phase 4 green を入口条件にする（モデルの揺れがアプリに波及する） |
| 全画面を一括生成してから動作確認する | 認証 → 一覧 → 詳細 → アクションの順に、動くたびに積む |
| dataSchema キーをアプリ側にハードコピーして二重管理する | `@acomo/client` の型 + マッピング層 1 箇所に集約する |
| ボタン表示をロール名や status 文字列の判定で自作する | `nodeActions`（サーバー側の判定結果）を使う |
| acomo の権限で足りるのに独自権限テーブルを作る | actionPolicies で表現できないか先に検討する |
| 雛形アプリを丸コピーして要件に合わない構造を残す | 3 構成から選定し、必要な段だけ積む |
