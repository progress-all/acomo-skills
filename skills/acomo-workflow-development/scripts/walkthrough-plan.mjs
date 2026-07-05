#!/usr/bin/env node
// acomo ワークフローモデルからウォークスルーテスト計画を生成する。
// 開始イベントから各終了イベントまでの経路を列挙し、経路ごとに
// CLI コマンド列・画面操作・保存データ例・遷移後の期待ノードを出力する。
// 使い方: node walkthrough-plan.mjs <draft.json> [--json]
// 終了コード: 0 = 生成成功 / 2 = 入力不正（経路が列挙できない場合もエラーメッセージ付き 0 で計画に注記）

import { readFileSync } from 'node:fs'
import { parseModelInput, analyzeGraph, TASK_ACTION_FLOW_TYPES } from './lib/model-checks.mjs'

const MAX_PATHS = 30
const MAX_STEPS = 200

const ACTION_LABEL = { submit: '提出', approve: '承認', reject: '却下' }
const ACTION_CLI = {
  submit: 'submitWorkflowProcess',
  approve: 'approveWorkflowProcess',
  reject: 'rejectWorkflowProcess',
}

/**
 * --json 出力のステップにそのまま再生できる REST 呼び出し情報を付ける。
 * カスタムアプリの統合テスト / E2E が CLI を経由せずに経路を再生するための情報。
 * body は dataSchema のキーをトップレベルに持つフラットな JSON（アクションと同じリクエストで渡す）。
 */
function apiForStart() {
  return {
    operationId: 'startWorkflowProcess',
    method: 'POST',
    path: '/api/v1/engine/start/{modelId}',
    body: null,
  }
}

function apiForAction(action, sampleData, { nodeId = null } = {}) {
  return {
    operationId: ACTION_CLI[action] + (nodeId ? 'WithNodeId' : ''),
    method: 'POST',
    path: `/api/v1/engine/${action}/{processId}${nodeId ? '/{nodeId}' : ''}`,
    ...(nodeId ? { nodeId } : {}),
    // engine 系は JSON body が必須（write 項目がなければ空オブジェクトを送る）
    body: sampleData ?? {},
  }
}

function sampleValue(key, prop) {
  switch (prop?._acomoType) {
    case 'number':
      return 1000
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'enum':
      return prop.enum?.[0] ?? ''
    case 'file':
      return null // ファイルは CLI から添付しない（UI で確認する）
    case 'array':
      return []
    case 'record':
      return {}
    default:
      return `サンプル（${prop?.title ?? key}）`
  }
}

function actorHint(node) {
  const hints = (node.actionPolicies ?? []).map(p => p?.description).filter(Boolean)
  return hints.length > 0 ? [...new Set(hints)].join(' / ') : null
}

/** parallelFork を展開する: 各ブランチを parallelJoin まで直進で辿る */
function expandParallel(graph, forkNode, notes) {
  const branches = []
  let joinNode = null
  for (const edge of graph.outgoing.get(forkNode.id) ?? []) {
    const tasks = []
    let currentId = edge.to
    const guard = new Set()
    while (currentId && !guard.has(currentId)) {
      guard.add(currentId)
      const node = graph.nodesById.get(currentId)
      if (!node) {
        break
      }
      if (node.type === 'parallelJoin') {
        joinNode = node
        break
      }
      if (node.type === 'event' && node.eventType === 'end') {
        tasks.push({ node, action: null, end: true })
        break
      }
      const outs = graph.outgoing.get(currentId) ?? []
      const next = outs.find(e => (e.type ?? []).some(t => TASK_ACTION_FLOW_TYPES.includes(t) || t === 'normal'))
      if (!next) {
        break
      }
      const action = (next.type ?? []).find(t => TASK_ACTION_FLOW_TYPES.includes(t)) ?? null
      if (node.type === 'task') {
        tasks.push({ node, action })
      }
      if (outs.length > 1) {
        notes.push(
          `並列ブランチ内のノード「${node.name}」に複数の遷移先があります。この計画では ${JSON.stringify(next.type)} → ${next.to} のみを辿っています。他の遷移は手動で計画に追加してください。`
        )
      }
      currentId = next.to
    }
    branches.push({ entry: edge.to, tasks })
  }
  return { branches, joinNode }
}

/** 開始 → 終了の経路を列挙する（サイクルはスキップして記録） */
function enumeratePaths(graph) {
  const paths = []
  const cycleEdges = []
  const notes = []
  const start = graph.startNodes[0]
  if (!start) {
    notes.push('開始イベントが見つからないため経路を列挙できません。先に validate-model.mjs を通してください。')
    return { paths, cycleEdges, notes }
  }

  function walk(nodeId, steps, visited) {
    if (paths.length >= MAX_PATHS || steps.length >= MAX_STEPS) {
      notes.push(`経路数またはステップ数が上限（${MAX_PATHS} 経路 / ${MAX_STEPS} ステップ）に達したため打ち切りました。`)
      return
    }
    const node = graph.nodesById.get(nodeId)
    if (!node) {
      return
    }
    if (node.type === 'event' && node.eventType === 'end') {
      paths.push({ steps: [...steps], outcome: node })
      return
    }

    if (node.type === 'parallelFork') {
      const { branches, joinNode } = expandParallel(graph, node, notes)
      const step = { kind: 'parallel', node, branches, join: joinNode }
      if (joinNode) {
        walk(joinNode.id, [...steps, step], new Set([...visited, nodeId, joinNode.id]))
      } else {
        notes.push(`parallelFork「${node.name}」に対応する parallelJoin が見つかりません。並列経路は手動で確認してください。`)
        const endBranch = branches.flatMap(b => b.tasks).find(t => t.end)
        if (endBranch) {
          paths.push({ steps: [...steps, step], outcome: endBranch.node })
        }
      }
      return
    }

    const outs = graph.outgoing.get(nodeId) ?? []
    if (node.type === 'exclusiveFork') {
      const destinations =
        Array.isArray(node.conditions) && node.conditions.length > 0
          ? node.conditions.map(c => ({ to: c.destination, condition: c }))
          : outs.map(e => ({ to: e.to, condition: null }))
      for (const dest of destinations) {
        if (visited.has(dest.to)) {
          cycleEdges.push({ from: nodeId, to: dest.to, type: ['(condition)'] })
          continue
        }
        const step = { kind: 'branch', node, condition: dest.condition, to: dest.to }
        walk(dest.to, [...steps, step], new Set([...visited, nodeId]))
      }
      return
    }

    for (const edge of outs) {
      const types = Array.isArray(edge.type) ? edge.type : []
      for (const t of types) {
        if (visited.has(edge.to)) {
          cycleEdges.push({ from: nodeId, to: edge.to, type: [t] })
          continue
        }
        let step
        if (node.type === 'event' && node.eventType === 'start') {
          step = { kind: 'start', node, to: edge.to }
        } else if (node.type === 'task' && TASK_ACTION_FLOW_TYPES.includes(t)) {
          step = { kind: 'action', node, action: t, to: edge.to }
        } else {
          step = { kind: 'auto', node, to: edge.to, flowType: t }
        }
        walk(edge.to, [...steps, step], new Set([...visited, nodeId]))
      }
    }
  }

  walk(start.id, [], new Set([start.id]))
  return { paths, cycleEdges, notes }
}

function writableFields(model, nodeId) {
  const fields = model.policy?.[nodeId] ?? {}
  const properties = model.dataSchema?.properties ?? {}
  const result = {}
  for (const [key, mode] of Object.entries(fields)) {
    if (mode !== 'write' || !(key in properties)) {
      continue
    }
    const value = sampleValue(key, properties[key])
    if (value !== null) {
      result[key] = value
    }
  }
  return result
}

function nodeName(graph, id) {
  return graph.nodesById.get(id)?.name ?? id
}

function renderTaskStep(lines, model, graph, node, action, { nodeIdSuffix = false, indent = '   ' } = {}) {
  const hint = actorHint(node)
  if (hint) {
    lines.push(`${indent}- 実行者: ${hint}`)
  }
  if (action) {
    // このノードで write 可能な項目はアクションと同じリクエストの body（フラットな JSON）で渡す。
    // saveWorkflowProcess は OpenAPI 上 requestBody を持たず CLI からデータを渡せない（画面の保存は別経路）。
    const data = writableFields(model, node.id)
    const bodyPart = Object.keys(data).length > 0 ? ` '${JSON.stringify(data)}'` : ''
    const op = ACTION_CLI[action] + (nodeIdSuffix ? 'WithNodeId' : '')
    lines.push(`${indent}- ${ACTION_LABEL[action]}（CLI）: \`acomo ${op} --processId <PROCESS_ID>${nodeIdSuffix ? ` --nodeId ${node.id}` : ''}${bodyPart}\``)
    lines.push(`${indent}- ${ACTION_LABEL[action]}（画面）: プロセスを開き、必要な項目を入力して「${ACTION_LABEL[action]}」系のボタンを押す（確認モーダルで確定）`)
  }
}

function renderMarkdown(model, graph, { paths, cycleEdges, notes }) {
  const lines = []
  lines.push(`# ウォークスルー計画: ${model.name ?? '(名称未設定)'}`)
  lines.push('')
  lines.push('前提:')
  lines.push('- モデルが登録済み（`createWorkflowModel`）で、`<MODEL_ID>` を控えていること')
  lines.push('- 公開済みであること: `acomo publishWorkflowModel --modelId <MODEL_ID>`')
  lines.push('- データはアクションコマンドの body（dataSchema のキーをトップレベルに持つ**フラットな JSON**）で渡す')
  lines.push('- 各遷移後の確認: `acomo getWorkflowProcess --processId <PROCESS_ID>` の `token.nodeId` が期待ノードであること（残アクションは `getProcessWithNodeActions`）')
  lines.push('- タスクごとの実行者制限（actionPolicies）に合わせ、必要なら実行ユーザーを切り替えること')
  lines.push('')

  paths.forEach((path, i) => {
    const actions = path.steps.filter(s => s.kind === 'action').map(s => ACTION_LABEL[s.action])
    lines.push(`## 経路 ${i + 1}: ${path.outcome.name}（${actions.join(' → ') || '自動遷移のみ'}）`)
    lines.push('')
    let stepNo = 1
    for (const step of path.steps) {
      if (step.kind === 'start') {
        lines.push(`${stepNo++}. **プロセス開始** — 「${nodeName(graph, step.to)}」に進む`)
        const hint = actorHint(step.node)
        if (hint) {
          lines.push(`   - 実行者: ${hint}`)
        }
        lines.push('   - CLI: `acomo startWorkflowProcess --modelId <MODEL_ID>` → 出力の `id` を `<PROCESS_ID>` として控える')
        lines.push('   - 画面: サイドメニュー「モデル」から対象モデルを開き、「プロセスを開始する」')
      } else if (step.kind === 'action') {
        lines.push(`${stepNo++}. **「${step.node.name}」で${ACTION_LABEL[step.action]}** — 「${nodeName(graph, step.to)}」に進む`)
        renderTaskStep(lines, model, graph, step.node, step.action)
      } else if (step.kind === 'branch') {
        const conditionText = step.condition?.expression ? `条件: \`${JSON.stringify(step.condition.expression)}\`` : '条件は definition の conditions を参照'
        lines.push(`${stepNo++}. **条件分岐「${step.node.name}」** — 「${nodeName(graph, step.to)}」へ自動遷移する経路。${conditionText}`)
        lines.push('   - この経路に入るよう、直前のデータ保存で条件を満たす値を入れること')
      } else if (step.kind === 'parallel') {
        lines.push(`${stepNo++}. **並列処理「${step.node.name}」** — 全ブランチを完了すると「${step.join?.name ?? '(join 不明)'}」に合流する`)
        step.branches.forEach((branch, bi) => {
          lines.push(`   - ブランチ ${bi + 1}:`)
          for (const t of branch.tasks) {
            if (t.end) {
              lines.push(`     - 終了イベント「${t.node.name}」に到達`)
              continue
            }
            lines.push(`     - 「${t.node.name}」で${t.action ? ACTION_LABEL[t.action] : '完了'}する`)
            renderTaskStep(lines, model, graph, t.node, t.action, { nodeIdSuffix: true, indent: '       ' })
          }
        })
      } else if (step.kind === 'auto') {
        lines.push(`${stepNo++}. 自動遷移（${step.flowType}）で「${nodeName(graph, step.to)}」に進む`)
      }
    }
    lines.push(`${stepNo}. **終了確認** — プロセスが終了イベント「${path.outcome.name}」で完了していることを確認する`)
    lines.push('')
  })

  if (cycleEdges.length > 0) {
    lines.push('## 循環エッジ（差し戻し・再提出系）')
    lines.push('')
    lines.push('次のエッジは循環になるため上の経路には含めていない。差し戻し・再提出の業務がある場合は手動で 1 回は通すこと。')
    const seen = new Set()
    for (const edge of cycleEdges) {
      const key = `${edge.from}->${edge.to}:${edge.type}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      lines.push(`- 「${nodeName(graph, edge.from)}」→「${nodeName(graph, edge.to)}」（${edge.type.join(', ')}）`)
    }
    lines.push('')
  }

  if (notes.length > 0) {
    lines.push('## 注記')
    lines.push('')
    for (const note of [...new Set(notes)]) {
      lines.push(`- ${note}`)
    }
    lines.push('')
  }

  lines.push('## 記録テンプレート')
  lines.push('')
  lines.push('| 経路 | プロセス ID | 実行アクション列 | 到達した終了ノード | 期待どおり |')
  lines.push('|------|------------|------------------|--------------------|------------|')
  paths.forEach((path, i) => {
    lines.push(`| 経路 ${i + 1} | | | ${path.outcome.name} | |`)
  })
  return lines.join('\n')
}

// --- main ---
const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const file = args.find(a => !a.startsWith('--'))
if (!file) {
  console.error('使い方: walkthrough-plan.mjs <draft.json> [--json]')
  process.exit(2)
}

let model
try {
  model = parseModelInput(readFileSync(file, 'utf8'))
} catch (err) {
  console.error(`✖ 入力の読み込みに失敗しました: ${err.message}`)
  process.exit(2)
}

const graph = analyzeGraph(model.definition ?? {})
const result = enumeratePaths(graph)

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        name: model.name ?? null,
        paths: result.paths.map(p => ({
          outcome: { id: p.outcome.id, name: p.outcome.name },
          steps: p.steps.map(s => {
            const sampleData = s.node.type === 'task' ? writableFields(model, s.node.id) : undefined
            let api
            if (s.kind === 'start') {
              api = apiForStart()
            } else if (s.kind === 'action') {
              api = apiForAction(s.action, sampleData)
            }
            return {
              kind: s.kind,
              nodeId: s.node.id,
              nodeName: s.node.name,
              action: s.action ?? null,
              to: s.to ?? null,
              // branch ステップの分岐条件（exclusiveFork の conditions 要素）。
              // データ駆動テストでこの経路に入るための入力値を決めるのに必要。
              condition: s.condition ?? null,
              sampleData,
              api,
              branches: s.branches?.map(b => ({
                tasks: b.tasks.map(t => {
                  const branchSampleData = t.node.type === 'task' ? writableFields(model, t.node.id) : undefined
                  return {
                    nodeId: t.node.id,
                    nodeName: t.node.name,
                    action: t.action ?? null,
                    sampleData: branchSampleData,
                    api: t.action ? apiForAction(t.action, branchSampleData, { nodeId: t.node.id }) : undefined,
                  }
                }),
              })),
            }
          }),
        })),
        cycleEdges: result.cycleEdges,
        notes: [...new Set(result.notes)],
      },
      null,
      2
    )
  )
} else {
  console.log(renderMarkdown(model, graph, result))
}
