#!/usr/bin/env node
// acomo ワークフローモデル draft の静的検証ハーネス。
// 使い方: node validate-model.mjs <draft.json> [--json] [--partial] [--schemas-dir <dir>]
// --partial: definition 先行の途中段階向けに、dataSchema / policy の欠落を警告に緩和する
// 入力: {name?, definition, dataSchema, policy} の JSON、または
//       acomo-workflow-model-draft fenced ブロックを含むテキストファイル。
// 終了コード: 0 = エラーなし / 1 = エラーあり / 2 = 入力不正

import { readFileSync } from 'node:fs'
import { parseModelInput, loadBundledSchemas, checkModel } from './lib/model-checks.mjs'

function usage() {
  console.error('使い方: validate-model.mjs <draft.json> [--json] [--partial] [--schemas-dir <dir>]')
  process.exit(2)
}

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const partial = args.includes('--partial')
const schemasDirIndex = args.indexOf('--schemas-dir')
const schemasDir = schemasDirIndex >= 0 ? args[schemasDirIndex + 1] : undefined
const file = args.find((a, i) => !a.startsWith('--') && (schemasDirIndex < 0 || i !== schemasDirIndex + 1))
if (!file) {
  usage()
}

let model
try {
  model = parseModelInput(readFileSync(file, 'utf8'))
} catch (err) {
  const message = `入力の読み込みに失敗しました: ${err.message}`
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, errors: [{ code: 'E_INPUT', message }], warnings: [] }, null, 2))
  } else {
    console.error(`✖ ${message}`)
  }
  process.exit(2)
}

const schemas = loadBundledSchemas(schemasDir)
const { errors, warnings } = checkModel(model, schemas, { partial })
const ok = errors.length === 0

if (jsonMode) {
  console.log(JSON.stringify({ ok, name: model?.name ?? null, errors, warnings }, null, 2))
} else {
  const name = model?.name ? `「${model.name}」` : '(名称未設定)'
  console.log(`# 検証対象: ${name}`)
  console.log(`# 結果: ${ok ? 'PASS' : 'FAIL'} — エラー ${errors.length} 件 / 警告 ${warnings.length} 件`)
  for (const issue of errors) {
    console.log(`  ✖ [${issue.code}] ${issue.message}${issue.path ? `  (${issue.path})` : ''}`)
  }
  for (const issue of warnings) {
    console.log(`  ⚠ [${issue.code}] ${issue.message}${issue.path ? `  (${issue.path})` : ''}`)
  }
  if (ok && warnings.length === 0) {
    console.log('  ✓ 問題は見つかりませんでした')
  }
}

process.exit(ok ? 0 : 1)
