/**
 * CSV / xlsx を、見出しと行の配列にする。
 *
 * 【重要】パース結果を信用しない（仕様書3章）。
 * ライブラリは string を返すと型で言っているが、実際には number や null が
 * 混ざることがある。unknown として受けて、こちらで文字列にする。
 */

import Papa from 'papaparse'

export type Parsed = {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

/** 何が来ても文字列にする。null / undefined は空欄として扱う。 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function toRows(raw: readonly unknown[]): readonly (readonly string[])[] {
  const rows: string[][] = []
  for (const line of raw) {
    if (!Array.isArray(line)) continue
    rows.push((line as readonly unknown[]).map(asText))
  }
  return rows
}

/** 見出しの扱い。1行目を見出しにするか、列1・列2… を振るか。 */
export type HeaderMode = 'first-row' | 'generated'

function split(all: readonly (readonly string[])[], mode: HeaderMode): Parsed {
  if (all.length === 0) return { header: [], rows: [] }

  const width = all.reduce((max, r) => Math.max(max, r.length), 0)

  if (mode === 'first-row') {
    const first = all[0] ?? []
    const header = Array.from({ length: width }, (_, i) => {
      const name = first[i] ?? ''
      return name.trim() === '' ? `列${i + 1}` : name
    })
    return { header, rows: all.slice(1) }
  }

  return {
    header: Array.from({ length: width }, (_, i) => `列${i + 1}`),
    rows: all,
  }
}

export function parseCsv(text: string, mode: HeaderMode): Parsed {
  // 【実装メモ】Papa の worker オプションは使わない。
  // このコード自体が Worker の中で動くので、そこでさらに Worker を作ると
  // 二重になり、受け渡しのコストだけが増える。同期パースを呼ぶ。
  const result = Papa.parse<unknown[]>(text, {
    skipEmptyLines: 'greedy',
    // 型変換はしない。前ゼロ（007）や桁区切りを壊さないため。
    // 数値に見える文字列は、第4段階で「検出」として扱う。
    dynamicTyping: false,
  })
  return split(toRows(result.data), mode)
}

/**
 * xlsx を読む。
 *
 * 【重要】SheetJS は動的 import にしてある。実測でバンドルの大半（gzip 275kB のうち
 * 約 240kB）がこれだった。CSV しか扱わない人にまで読ませる理由がない。
 * xlsx をドロップしたときだけ取りに行く。
 *
 * 取りに行く先は自分のサーバー（同じ配信元）で、外部CDNではない。
 * ビルド時に同梱したファイルを、後から読むだけである。
 */
export async function parseXlsx(bytes: Uint8Array, mode: HeaderMode): Promise<Parsed> {
  const XLSX = await import('xlsx')
  const book = XLSX.read(bytes, { type: 'array' })
  const sheetName = book.SheetNames[0]
  if (sheetName === undefined) return { header: [], rows: [] }
  const sheet = book.Sheets[sheetName]
  if (sheet === undefined) return { header: [], rows: [] }

  // raw: false … 表示されている見た目の文字列を取る。
  // defval: ''  … 空セルを飛ばさない。列がずれるのを防ぐ。
  const raw: unknown[] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  return split(toRows(raw), mode)
}
