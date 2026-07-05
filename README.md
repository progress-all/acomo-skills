# acomo-skills

acomo ワークフロー操作のための Agent Skills です。Claude（.claude/skills）や Cursor など、SKILL.md 形式をサポートする AI エージェントで利用できます。

## 含まれるスキル

| スキル | パス | 説明 |
|--------|------|------|
| acomo | `skills/acomo` | ワークフロー操作ガイド（CLI によるモデル取得・プロセス操作） |
| acomo-workflow-development | `skills/acomo-workflow-development` | ワークフローシステム開発ループ（設計 → 検証 → 登録 → ウォークスルー → 改善）。ハーネス同梱 |
| acomo-workflow-modeling | `skills/acomo-workflow-modeling` | ワークフローモデル設計・生成（definition + dataSchema + policy） |
| acomo-ui | `skills/acomo-ui` | acomo プロダクト画面の操作案内（メニュー導線・業務フロー） |

## 前提

- [acomo CLI](https://www.npmjs.com/package/@acomo/cli) がインストールされていること（`npm install -g @acomo/cli`）
- `acomo login` でログイン済みであること
- `acomo-workflow-development` のハーネス（`scripts/validate-model.mjs` 等）を実行する場合は **Node.js 20+**

## インストール

### 手動でコピーする場合

スキルを利用したいプロジェクトまたはホームのスキルディレクトリに、このリポジトリの `skills/` 配下をコピーしてください。4 スキルは同じ親ディレクトリに併設される前提です（相対リンクが解決されます）。

例（Claude のプロジェクトスキルとして）:

```bash
git clone https://github.com/progress-all/acomo-skills.git
cp -r acomo-skills/skills/* .claude/skills/
```

例（Claude のユーザースキルとして）:

```bash
cp -r acomo-skills/skills/* ~/.claude/skills/
```

### インストーラーや「リポジトリ＋パス」で入れる場合

このリポジトリを「スキル用リポジトリ」として登録し、パス `skills/<name>` を指定してインストールする形式にも対応しています。

- リポジトリ: `https://github.com/progress-all/acomo-skills`
- スキルパス例: `skills/acomo`, `skills/acomo-workflow-development`, `skills/acomo-workflow-modeling`, `skills/acomo-ui`

## 関連リンク

- [acomo](https://acomo.app)
- [@acomo/cli (npm)](https://www.npmjs.com/package/@acomo/cli)
- [acomo 本体リポジトリ](https://github.com/progress-all/acomo)
