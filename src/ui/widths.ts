/**
 * 列の幅を、中身から概算する。
 *
 * 【重要】DOM で実測しない。
 * 10万行のセルを測ろうとすると、そこでレイアウトが走って固まる。
 * 先頭の一部だけを見て文字数から見積もる。外れても、横スクロールで読める。
 */

import type { Table } from '../domain/table.ts'

const CHAR_PX = 7.2 // 半角1文字あたりの目安（13px フォント）
const PADDING = 22
const MIN = 72
const MAX = 340
const SAMPLE_ROWS = 200

/** 全角を2、半角を1として数える。日本語の列が細くなりすぎるのを防ぐ。 */
function visualLength(text: string): number {
  let n = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // ASCII と半角カナはそのまま。それ以外は全角とみなす。
    n += code < 0x2e80 && !(code >= 0x1100 && code <= 0x115f) ? 1 : 2
  }
  return n
}

export function computeWidths(table: Table): readonly number[] {
  const rows = Math.min(table.rowCount, SAMPLE_ROWS)
  return table.columns.map((col) => {
    let widest = visualLength(col.name)
    for (let r = 0; r < rows; r++) {
      const len = visualLength(col.values[r] ?? '')
      if (len > widest) widest = len
    }
    return Math.round(Math.min(MAX, Math.max(MIN, widest * CHAR_PX + PADDING)))
  })
}
