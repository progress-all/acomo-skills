# ワークフローモデル JSON Schema（生成物）

このディレクトリの JSON は **手編集禁止** です。単一ソースは `acomo-backend/src/workflow/model/model.constant.ts` です。

`acomo-backend` を**一度起動**すると、`generateApiArtifacts` が `artifacts/workflow-model-schemas/*.json` とパッチ済み `openapi.json` を書き出します。エージェント用にここへコピーする場合の例:

```bash
cp acomo-backend/artifacts/workflow-model-schemas/*.json .agents/skills/acomo-workflow-modeling/schemas/
```
