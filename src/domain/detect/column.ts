/**
 * 列を先に見る。
 *
 * 【この段の役割】誤検出を抑える。
 *
 * 仕様書4章：「誤検出が続くと、人は画面を流し読みするようになる。本物の問題が
 * 出たときに見逃されるので、検出の網を広げすぎないこと」。
 *
 * そこで、個々のセルを見る前に列全体を見て、**その列が何の列かを決める**。
 * 電話番号の列だと決まって初めて「電話番号の形が揃っていない」と言える。
 * ただの数字の列に電話番号の物差しを当てない。
 */

import { hasCorporateForm, normalizeKey, trimBoth } from './normalize.ts'
import type { DateShape, NumericShape } from './shape.ts'
import { readDate, readNumeric, readPhone, readPostal } from './shape.ts'

/** 列の性格。多数決で決める。 */
export type ColumnShape = 'phone' | 'postal' | 'date' | 'numeric' | 'text'

/** どれくらい揃っていれば「その列」と見なすか。 */
const DOMINANT = 0.8

export type NotationGroup = {
  /** 正規化キー */
  readonly key: string
  /** 表記ごとの出現回数。多い順。印は付けない（事実だけ） */
  readonly variants: readonly { readonly value: string; readonly occurrences: number }[]
}

export type ColumnStats = {
  readonly shape: ColumnShape
  readonly nonEmpty: number
  readonly emptyCount: number
  readonly emptyRate: number
  /** 日付列のときだけ。形式ごとの件数。 */
  readonly dateShapes: ReadonlyMap<DateShape, number>
  /** 日付列のときだけ。いちばん多い形式。 */
  readonly majorityDateShape: DateShape | null
  /** 数値列のときだけ。形ごとの件数。 */
  readonly numericShapes: ReadonlyMap<NumericShape, number>
  /** 文字列の列のときだけ。揺れているグループ（表記が2種類以上あるものだけ）。 */
  readonly notation: ReadonlyMap<string, NotationGroup>
  /** 数値列のときだけ。桁数の中央値。異常値の目安に使う。 */
  readonly medianDigits: number | null
}

function topShape(counts: ReadonlyMap<string, number>, nonEmpty: number): string | null {
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  if (best === null) return null
  return bestN / nonEmpty >= DOMINANT ? best : null
}

export function analyzeColumn(values: readonly string[]): ColumnStats {
  let nonEmpty = 0
  let emptyCount = 0

  const phoneish = new Map<string, number>()
  const postalish = new Map<string, number>()
  const dateShapes = new Map<DateShape, number>()
  const numericShapes = new Map<NumericShape, number>()

  for (const raw of values) {
    const v = trimBoth(raw)
    if (v === '') {
      emptyCount++
      continue
    }
    nonEmpty++
    if (readPhone(v) !== null) phoneish.set('y', (phoneish.get('y') ?? 0) + 1)
    if (readPostal(v) !== null) postalish.set('y', (postalish.get('y') ?? 0) + 1)
    const d = readDate(v)
    if (d !== null) dateShapes.set(d.shape, (dateShapes.get(d.shape) ?? 0) + 1)
    const n = readNumeric(v)
    if (n !== null) numericShapes.set(n.shape, (numericShapes.get(n.shape) ?? 0) + 1)
  }

  const total = (m: ReadonlyMap<string, number>): number => {
    let s = 0
    for (const n of m.values()) s += n
    return s
  }

  let shape: ColumnShape = 'text'
  if (nonEmpty > 0) {
    const dateTotal = total(dateShapes as ReadonlyMap<string, number>)
    const numTotal = total(numericShapes as ReadonlyMap<string, number>)
    const postalTotal = postalish.get('y') ?? 0
    const phoneTotal = phoneish.get('y') ?? 0

    // 【重要】郵便番号を電話番号より先に見る。7桁は電話番号としても読めるため、
    // 順番を逆にすると郵便番号の列が電話番号の列と判定される。
    if (postalTotal / nonEmpty >= DOMINANT) shape = 'postal'
    else if (phoneTotal / nonEmpty >= DOMINANT) shape = 'phone'
    else if (dateTotal / nonEmpty >= DOMINANT) shape = 'date'
    else if (numTotal / nonEmpty >= DOMINANT) shape = 'numeric'
  }

  // 日付列の多数派
  const majorityDateShape =
    shape === 'date' ? ((topShape(dateShapes as ReadonlyMap<string, number>, nonEmpty) as DateShape | null) ??
      // 8割に届かなくても、日付列である以上は最多の形式を基準にする
      [...dateShapes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null

  // 数値列の桁数の中央値
  let medianDigits: number | null = null
  if (shape === 'numeric') {
    const digits: number[] = []
    for (const raw of values) {
      const n = readNumeric(trimBoth(raw))
      if (n !== null) digits.push(Math.abs(Math.trunc(n.value)).toString().length)
    }
    digits.sort((a, b) => a - b)
    medianDigits = digits[Math.floor(digits.length / 2)] ?? null
  }

  // 表記揺れ。文字列の列だけを見る。
  const notation = new Map<string, NotationGroup>()
  if (shape === 'text') {
    const groups = new Map<string, Map<string, number>>()
    for (const raw of values) {
      const v = trimBoth(raw)
      // 【重要】絞り込み。網を広げると誤検出が増える。
      //  ・空と1文字は見ない
      //  ・法人格を含むものだけを見る（一般の語まで見ると別語を同一視する）
      if (v.length <= 1) continue
      if (!hasCorporateForm(v)) continue
      const key = normalizeKey(v)
      if (key === '') continue
      const bucket = groups.get(key) ?? new Map<string, number>()
      bucket.set(v, (bucket.get(v) ?? 0) + 1)
      groups.set(key, bucket)
    }
    for (const [key, bucket] of groups) {
      // 表記が1種類しかなければ、揺れていない。
      if (bucket.size < 2) continue
      const variants = [...bucket.entries()]
        .map(([value, occurrences]) => ({ value, occurrences }))
        .sort((a, b) => b.occurrences - a.occurrences)
      notation.set(key, { key, variants })
    }
  }

  return {
    shape,
    nonEmpty,
    emptyCount,
    emptyRate: values.length === 0 ? 0 : emptyCount / values.length,
    dateShapes,
    majorityDateShape,
    numericShapes,
    notation,
    medianDigits,
  }
}
