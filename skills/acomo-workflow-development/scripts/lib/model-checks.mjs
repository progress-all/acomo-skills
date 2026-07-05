// acomo ワークフローモデル draft の静的検証ロジック。
// スキーマ準拠（bundled JSON Schema）+ グラフ・policy の意味的整合を検証する。
// FlowType の SSOT: acomo-backend/src/workflow/model/edge.entity.ts

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSchema } from './mini-schema.mjs'

export const FLOW_TYPES = ['normal', 'submit', 'approve', 'reject', 'yes', 'no']
export const TASK_ACTION_FLOW_TYPES = ['submit', 'approve', 'reject']

const HERE = dirname(fileURLToPath(import.meta.url))
// 既定はモノレポ内の acomo-workflow-modeling スキルに同梱された生成スキーマ
const DEFAULT_SCHEMAS_DIR = join(HERE, '..', '..', '..', 'acomo-workflow-modeling', 'schemas')

/**
 * 入力テキストからモデル JSON を取り出す。
 * - 純粋な JSON（{name?, definition, dataSchema, policy}）
 * - `acomo-workflow-model-draft`（または json）fenced ブロックを含むテキスト
 */
export function parseModelInput(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }
  const fence = /```(?:acomo-workflow-model-draft|json)\s*\n([\s\S]*?)```/g
  let match
  let last = null
  while ((match = fence.exec(text)) !== null) {
    last = match[1]
  }
  if (last == null) {
    throw new Error('JSON も acomo-workflow-model-draft fenced ブロックも見つかりませんでした')
  }
  return JSON.parse(last)
}

/** bundled スキーマの読み込み。見つからなければ null（スキーマ検証はスキップされる） */
export function loadBundledSchemas(schemasDir = process.env.ACOMO_MODEL_SCHEMAS_DIR || DEFAULT_SCHEMAS_DIR) {
  const result = {}
  for (const name of ['definition', 'dataSchema', 'dataAccessPolicy']) {
    const file = join(schemasDir, `${name}.json`)
    if (!existsSync(file)) {
      return null
    }
    result[name] = JSON.parse(readFileSync(file, 'utf8'))
  }
  return result
}

/** definition のグラフ構造を解析する（validate / walkthrough 共用） */
export function analyzeGraph(definition) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : []
  const edges = Array.isArray(definition?.edges) ? definition.edges : []
  const nodesById = new Map()
  for (const node of nodes) {
    if (node && typeof node.id === 'string') {
      nodesById.set(node.id, node)
    }
  }
  const outgoing = new Map()
  const incoming = new Map()
  for (const edge of edges) {
    if (!outgoing.has(edge?.from)) {
      outgoing.set(edge?.from, [])
    }
    outgoing.get(edge?.from).push(edge)
    if (!incoming.has(edge?.to)) {
      incoming.set(edge?.to, [])
    }
    incoming.get(edge?.to).push(edge)
  }
  const startNodes = nodes.filter(n => n?.type === 'event' && n?.eventType === 'start')
  const endNodes = nodes.filter(n => n?.type === 'event' && n?.eventType === 'end')
  return { nodes, edges, nodesById, outgoing, incoming, startNodes, endNodes }
}

function reachableFrom(startIds, neighborMap, edgeKey) {
  const seen = new Set(startIds)
  const queue = [...startIds]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const edge of neighborMap.get(current) ?? []) {
      const next = edge[edgeKey]
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/

/**
 * モデル draft を検証する。
 * @returns {{errors: Array<{code,message,path?}>, warnings: Array<{code,message,path?}>}}
 */
export function checkModel(model, schemas, options = {}) {
  const errors = []
  const warnings = []
  const error = (code, message, path) => errors.push({ code, message, ...(path ? { path } : {}) })
  const warn = (code, message, path) => warnings.push({ code, message, ...(path ? { path } : {}) })

  const definition = model?.definition
  const dataSchema = model?.dataSchema
  const policy = model?.policy

  if (!model || typeof model !== 'object') {
    error('E_STRUCT', 'モデルはオブジェクトである必要があります')
    return { errors, warnings }
  }
  if (typeof model.name !== 'string' || model.name.trim() === '') {
    warn('W_NAME', 'name が未設定です。createWorkflowModel には name が必須です')
  }
  if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    error('E_STRUCT', 'definition に nodes / edges の配列が必要です', '$.definition')
    return { errors, warnings }
  }
  // createWorkflowModel は dataSchema / policy も必須。definition 先行の途中段階は options.partial で警告に緩和できる
  const missingPart = (code, message, path) =>
    options.partial ? warn(code, `${message}（--partial のため警告扱い）`, path) : error(code, message, path)
  if (!dataSchema || typeof dataSchema !== 'object') {
    missingPart('E_STRUCT', 'dataSchema がありません。createWorkflowModel には dataSchema が必須です', '$.dataSchema')
  }
  if (!policy || typeof policy !== 'object') {
    missingPart('E_STRUCT', 'policy がありません。createWorkflowModel には policy が必須です（最低限 {}）', '$.policy')
  }

  // --- 1. bundled JSON Schema（バックエンド AJV と同一の生成物）への準拠 ---
  if (schemas) {
    for (const [key, target, code] of [
      ['definition', definition, 'E_SCHEMA_DEFINITION'],
      ['dataSchema', dataSchema, 'E_SCHEMA_DATASCHEMA'],
      ['dataAccessPolicy', policy, 'E_SCHEMA_POLICY'],
    ]) {
      if (target === undefined) {
        continue
      }
      for (const issue of validateSchema(schemas[key], target, `$.${key === 'dataAccessPolicy' ? 'policy' : key}`)) {
        error(code, issue.message, issue.path)
      }
    }
  } else {
    warn('W_SCHEMA_MISSING', 'モデル JSON Schema が見つからないため、スキーマ準拠検証をスキップしました（--schemas-dir か ACOMO_MODEL_SCHEMAS_DIR で指定、または acomo schema show の出力を配置）')
  }

  // --- 2. ノード ---
  const graph = analyzeGraph(definition)
  const seenIds = new Set()
  for (const node of graph.nodes) {
    if (typeof node?.id !== 'string' || node.id === '') {
      error('E_NODE_ID', 'ノード id は空でない文字列が必要です', `$.definition.nodes[name=${node?.name ?? '?'}]`)
      continue
    }
    if (seenIds.has(node.id)) {
      error('E_NODE_ID', `ノード id "${node.id}" が重複しています`)
    }
    seenIds.add(node.id)
  }
  if (graph.startNodes.length !== 1) {
    error('E_START_COUNT', `開始イベント（type=event, eventType=start）はちょうど 1 つ必要です（実際: ${graph.startNodes.length}）`)
  }
  if (graph.endNodes.length < 1) {
    error('E_END_COUNT', '終了イベント（type=event, eventType=end）が 1 つ以上必要です')
  }

  // --- 3. エッジ ---
  graph.edges.forEach((edge, i) => {
    const path = `$.definition.edges[${i}]`
    for (const key of ['from', 'to']) {
      if (!graph.nodesById.has(edge?.[key])) {
        error('E_EDGE_NODE', `${key} "${edge?.[key]}" に対応するノードがありません`, path)
      }
    }
    if (!Array.isArray(edge?.type)) {
      error('E_EDGE_TYPE', 'エッジ type は配列で指定します（例: ["approve"]）', path)
      return
    }
    for (const t of edge.type) {
      if (!FLOW_TYPES.includes(t)) {
        const hint = t === 'revert' ? '（差し戻しはエッジではなくノードの canRevert とランタイム API で扱う）' : ''
        error('E_EDGE_TYPE', `エッジ type "${t}" は使えません。使用可能: ${FLOW_TYPES.join(', ')}${hint}`, path)
      }
    }
  })

  // --- 4. ノード種別ごとの入出力・到達性 ---
  const startId = graph.startNodes[0]?.id
  for (const node of graph.nodes) {
    if (!node?.id) {
      continue
    }
    const out = graph.outgoing.get(node.id) ?? []
    const inc = graph.incoming.get(node.id) ?? []
    if (node.type === 'event' && node.eventType === 'start' && inc.length > 0) {
      error('E_START_INCOMING', `開始イベント "${node.name}" に入ってくるエッジがあります`)
    }
    if (node.type === 'event' && node.eventType === 'end' && out.length > 0) {
      error('E_END_OUTGOING', `終了イベント "${node.name}" から出ていくエッジがあります`)
    }
    if (node.type === 'task' && out.length === 0) {
      error('E_TASK_NO_OUTGOING', `タスク "${node.name}"（id=${node.id}）から出ていくエッジがありません`)
    }
    if (node.type === 'task') {
      const types = new Set(out.flatMap(e => (Array.isArray(e.type) ? e.type : [])))
      if (types.has('approve') && !types.has('reject')) {
        warn('W_APPROVE_NO_REJECT', `承認タスク "${node.name}"（id=${node.id}）に却下（reject）の遷移先がありません。却下で終了しない業務か確認すること`)
      }
    }
    if (node.type === 'exclusiveFork' && (!Array.isArray(node.conditions) || node.conditions.length === 0)) {
      error('E_FORK_NO_CONDITIONS', `条件分岐 "${node.name}"（id=${node.id}）に conditions がありません`)
    }
    // parallelJoin の conditions はスキーマ上必須ではないが、欠落するとバックエンドの
    // model-history.mapper が node.conditions.map() で落ち、起動時 500 + モデル削除不能になる（実測）。
    if (node.type === 'parallelJoin' && (!Array.isArray(node.conditions) || node.conditions.length === 0)) {
      error(
        'E_JOIN_NO_CONDITIONS',
        `並列合流 "${node.name}"（id=${node.id}）に conditions がありません。欠落するとプロセス開始時に 500 になりモデルが API から削除できなくなる。例: {"expression": {"operator": ">=", "expression1": "$token.approveCount", "expression2": "$token.childTokenLength"}, "destination": <合流後のノード id>}（expression は必ずオブジェクト形式）`
      )
    }
    for (const cond of node.conditions ?? []) {
      if (cond?.destination != null && !graph.nodesById.has(cond.destination)) {
        error('E_CONDITION_DEST', `ノード "${node.name}" の condition destination "${cond.destination}" に対応するノードがありません`)
      }
    }
  }

  if (startId) {
    const reachable = reachableFrom([startId], graph.outgoing, 'to')
    const canReachEnd = reachableFrom(graph.endNodes.map(n => n.id), graph.incoming, 'from')
    for (const node of graph.nodes) {
      if (!node?.id) {
        continue
      }
      if (!reachable.has(node.id)) {
        error('E_UNREACHABLE', `ノード "${node.name}"（id=${node.id}）は開始イベントから到達できません`)
      } else if (!canReachEnd.has(node.id) && !(node.type === 'event' && node.eventType === 'end')) {
        error('E_NO_PATH_TO_END', `ノード "${node.name}"（id=${node.id}）からどの終了イベントにも到達できません`)
      }
    }
  }

  const hasReject = graph.edges.some(e => Array.isArray(e.type) && e.type.includes('reject'))
  const hasApprovableTask = graph.nodes.some(
    n => n?.type === 'task' && (graph.outgoing.get(n.id) ?? []).some(e => Array.isArray(e.type) && e.type.includes('approve'))
  )
  if (hasApprovableTask && !hasReject) {
    warn('W_NO_REJECT_PATH', '承認遷移はあるのに却下（reject）遷移がモデル全体にありません。却下できない業務か確認すること')
  }
  for (const end of graph.endNodes) {
    const types = new Set((graph.incoming.get(end.id) ?? []).flatMap(e => (Array.isArray(e.type) ? e.type : [])))
    if (types.has('approve') && types.has('reject')) {
      warn('W_END_MIXED', `終了イベント "${end.name}" に承認と却下の両方が流入します。結末ごとに終了イベントを分けることを推奨`)
    }
  }

  // --- 5. dataSchema ---
  const properties = dataSchema && typeof dataSchema === 'object' ? dataSchema.properties ?? {} : {}
  if ('status' in properties) {
    warn('W_STATUS_FIELD', 'dataSchema に "status" があります。プロセスの状態はエンジンが管理するため通常は含めない')
  }
  const orders = new Map()
  const badKeys = []
  for (const [key, prop] of Object.entries(properties)) {
    if (!CAMEL_CASE.test(key)) {
      badKeys.push(key)
    }
    const order = prop?._order
    if (typeof order === 'number') {
      if (orders.has(order)) {
        warn('W_ORDER_DUP', `_order=${order} が "${orders.get(order)}" と "${key}" で重複しています`)
      }
      orders.set(order, key)
    }
  }
  if (badKeys.length > 0) {
    const shown = badKeys.slice(0, 5).map(k => `"${k}"`).join(', ')
    warn('W_KEY_STYLE', `英語キャメルケース推奨（例: leaveStartDate）に沿わないプロパティキーが ${badKeys.length} 件あります: ${shown}${badKeys.length > 5 ? ' ほか' : ''}`)
  }

  // --- 6. policy ---
  const taskIds = new Set(graph.nodes.filter(n => n?.type === 'task').map(n => n.id))
  if (policy && typeof policy === 'object') {
    for (const [nodeId, fields] of Object.entries(policy)) {
      if (!graph.nodesById.has(nodeId)) {
        error('E_POLICY_NODE', `policy のノード ID "${nodeId}" は definition に存在しません（ノード名ではなく id を使う）`)
        continue
      }
      if (!taskIds.has(nodeId)) {
        // タスク以外（特に終了イベント）への read 割り当ては「完了後も閲覧させる」正当なパターン（実運用モデルで確認済み）。
        // write はタスク以外では意味を持たないため警告する。
        const writes = Object.entries(fields ?? {}).filter(([, v]) => v === 'write')
        if (writes.length > 0) {
          const node = graph.nodesById.get(nodeId)
          warn('W_POLICY_EVENT_WRITE', `タスクではないノード "${node?.name}"（id=${nodeId}）の policy に write（${writes.map(([k]) => k).join(', ')}）があります。write が意味を持つのはタスクノードのみ`)
        }
      }
      for (const [field, value] of Object.entries(fields ?? {})) {
        if (!(field in properties)) {
          error('E_POLICY_FIELD', `policy（ノード ${nodeId}）の "${field}" は dataSchema.properties に存在しません`)
        }
        if (value !== 'read' && value !== 'write') {
          error('E_POLICY_VALUE', `policy（ノード ${nodeId}）の "${field}" の値 "${value}" は read | write のいずれかが必要です`)
        }
      }
    }
    for (const taskId of taskIds) {
      if (!(taskId in policy)) {
        const node = graph.nodesById.get(taskId)
        warn('W_TASK_NO_POLICY', `タスク "${node?.name}"（id=${taskId}）に policy がありません。このタスクではどのデータ項目にもアクセスできない扱いになる`)
      }
    }
    for (const key of Object.keys(properties)) {
      const writable = Object.values(policy).some(fields => fields?.[key] === 'write')
      if (!writable) {
        warn('W_FIELD_NOT_WRITABLE', `データ項目 "${key}" はどのタスクでも write になっていません。入力できない項目でよいか確認すること`)
      }
    }
  }

  return { errors, warnings }
}
