# acomo-skills

acomo ワークフロー操作のための Agent Skills です。Claude（.claude/skills）や Cursor など、SKILL.md 形式をサポートする AI エージェントで利用できます。

## 含まれるスキル

| スキル | パス | 説明 |
|--------|------|------|
| acomo | `skills/acomo` | ワークフロー操作ガイド（CLI によるモデル取得・プロセス操作） |

## 前提

- [acomo CLI](https://www.npmjs.com/package/@acomo/cli) がインストールされていること（`npm install -g @acomo/cli`）
- `acomo login` でログイン済みであること

## インストール

### 手動でコピーする場合

スキルを利用したいプロジェクトまたはホームのスキルディレクトリに、このリポジトリの `skills/acomo` をコピーしてください。

例（Claude のプロジェクトスキルとして）:

```bash
git clone https://github.com/progress-all/acomo-skills.git
cp -r acomo-skills/skills/acomo .claude/skills/
```

例（Claude のユーザースキルとして）:

```bash
cp -r acomo-skills/skills/acomo ~/.claude/skills/
```

### インストーラーや「リポジトリ＋パス」で入れる場合

このリポジトリを「スキル用リポジトリ」として登録し、パス `skills/acomo` を指定してインストールする形式にも対応しています。

- リポジトリ: `https://github.com/progress-all/acomo-skills`
- スキルパス: `skills/acomo`

## 関連リンク

- [acomo](https://acomo.app)
- [@acomo/cli (npm)](https://www.npmjs.com/package/@acomo/cli)
- [acomo 本体リポジトリ](https://github.com/progress-all/acomo)
