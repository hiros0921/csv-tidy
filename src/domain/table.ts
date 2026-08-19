/**
 * 読み込んだ表。列指向で持つ。
 *
 * 行ごとの配列（string[][]）ではなく列ごとの配列にしてあるのは、
 * このツールの操作が列単位だからである。
 *   - 列の一括置換（表記揺れの統一）
 *   - 列ごとの空欄率
 *   - 列の多数派と比べる（日付形式のばらつき）
 * 行を1本取り出す操作は表示のときだけで、そのときは100行分しか要らない。
 */

import type { CellDetail } from './cell.ts'
import { UNCHECKED } from './cell.ts'

export type Column = {
  readonly name: string
  readonly values: readonly string[]
}

export type Table = {
  readonly columns: readonly Column[]
  readonly rowCount: number
  /** 状態コード。列指向。index = col * rowCount + row */
  readonly flags: Uint8Array
  /** issue / fixed のセルだけが入る。clean なセルは持たない。 */
  readonly details: ReadonlyMap<number, CellDetail>
}

/**
 * 行の配列から表を作る。
 *
 * 読み込んだ直後は、全セルが UNCHECKED（＝0）である。
 * Uint8Array は 0 で初期化されるので、これは書き込みなしで成立する。
 * 「読んだだけでは、まだ何も調べていない」が既定になる。
 */
export function buildTable(header: readonly string[], rows: readonly (readonly string[])[]): Table {
  const colCount = header.length
  const rowCount = rows.length

  const columns: Column[] = []
  for (let c = 0; c < colCount; c++) {
    const values = new Array<string>(rowCount)
    for (let r = 0; r < rowCount; r++) {
      values[r] = rows[r]?.[c] ?? ''
    }
    columns.push({ name: header[c] ?? `列${c + 1}`, values })
  }

  return {
    columns,
    rowCount,
    flags: new Uint8Array(colCount * rowCount), // 全セル UNCHECKED
    details: new Map(),
  }
}

/** 表示用に、1行分を横に取り出す。列指向なので、ここだけは列をまたぐ。 */
export function rowAt(table: Table, row: number): readonly string[] {
  return table.columns.map((col) => col.values[row] ?? '')
}

/** 未検査のセルが何個あるか。読み込み直後は全セル。 */
export function countUnchecked(table: Table): number {
  let n = 0
  for (let i = 0; i < table.flags.length; i++) {
    if (table.flags[i] === UNCHECKED) n++
  }
  return n
}
