// 依存ゼロの JSON Schema サブセット検証器。
// acomo のモデルスキーマ（acomo-backend/src/workflow/model/model.constant.ts 由来の生成物）が使う
// キーワードのみ対応する: type / const / enum / required / properties / additionalProperties /
// items / oneOf / not / minItems。format は情報扱いで検証しない。

function typeOf(value) {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

/**
 * @returns {Array<{path: string, message: string}>} 空配列なら妥当
 */
export function validateSchema(schema, data, path = '$') {
  const errors = []
  if (schema === true || schema == null) {
    return errors
  }
  if (schema === false) {
    return [{ path, message: 'このプロパティは許可されていません' }]
  }

  if (schema.oneOf) {
    const branchResults = schema.oneOf.map(branch => validateSchema(branch, data, path))
    const valid = branchResults.filter(r => r.length === 0)
    if (valid.length === 1) {
      return errors
    }
    if (valid.length > 1) {
      errors.push({ path, message: `oneOf の複数の型定義に一致しました（${valid.length} 件）` })
      return errors
    }
    // 最も惜しい branch（エラー最少）のエラーを代表として返す
    let best = branchResults[0]
    for (const r of branchResults) {
      if (r.length < best.length) {
        best = r
      }
    }
    errors.push({ path, message: 'oneOf のどの型定義にも一致しません。最も近い候補との差分:' })
    errors.push(...best)
    return errors
  }

  if (schema.not) {
    if (validateSchema(schema.not, data, path).length === 0) {
      errors.push({ path, message: 'not 条件に違反しています' })
    }
  }

  if (schema.const !== undefined) {
    if (data !== schema.const) {
      errors.push({ path, message: `値は ${JSON.stringify(schema.const)} でなければなりません（実際: ${JSON.stringify(data)}）` })
      return errors
    }
  }

  if (schema.enum) {
    if (!schema.enum.includes(data)) {
      errors.push({ path, message: `値は ${JSON.stringify(schema.enum)} のいずれかでなければなりません（実際: ${JSON.stringify(data)}）` })
      return errors
    }
  }

  if (schema.type) {
    const actual = typeOf(data)
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type]
    const ok = expected.some(t => (t === 'integer' ? actual === 'number' && Number.isInteger(data) : actual === t))
    if (!ok) {
      errors.push({ path, message: `型は ${expected.join(' | ')} でなければなりません（実際: ${actual}）` })
      return errors
    }
  }

  if (typeOf(data) === 'object') {
    const props = schema.properties ?? {}
    for (const key of schema.required ?? []) {
      if (!(key in data)) {
        errors.push({ path, message: `必須プロパティ "${key}" がありません` })
      }
    }
    for (const [key, value] of Object.entries(data)) {
      if (key in props) {
        errors.push(...validateSchema(props[key], value, `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${key}`, message: `未定義のプロパティ "${key}" は許可されていません` })
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validateSchema(schema.additionalProperties, value, `${path}.${key}`))
      }
    }
  }

  if (typeOf(data) === 'array') {
    if (schema.minItems != null && data.length < schema.minItems) {
      errors.push({ path, message: `要素数は ${schema.minItems} 以上でなければなりません（実際: ${data.length}）` })
    }
    if (schema.items) {
      data.forEach((item, i) => {
        errors.push(...validateSchema(schema.items, item, `${path}[${i}]`))
      })
    }
  }

  return errors
}
