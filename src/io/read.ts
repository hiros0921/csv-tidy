/**
 * ファイル1本を読み込んで、表にするまで。
 *
 * 【重要】File オブジェクトは捨てない。
 * 文字コードの判定が外れたときは、同じファイルをもう一度バイト列から読み直す。
 * 復号済みの文字列からは元のバイト列を復元できないので、ここを手放すと
 * 「判定を変更できること」（仕様書5章）が成立しなくなる。
 */

import type { CharEncoding, Detection } from './encoding.ts'
import { decode, detectEncoding } from './encoding.ts'
import type { HeaderMode } from './parse.ts'
import { parseCsv, parseXlsx } from './parse.ts'
import type { Table } from '../domain/table.ts'
import { buildTable } from '../domain/table.ts'

export type FileKind = 'csv' | 'xlsx'

export type Timings = {
  readonly readMs: number
  readonly detectMs: number
  readonly decodeMs: number
  readonly parseMs: number
  readonly buildMs: number
  readonly totalMs: number
}

export type LoadResult = {
  readonly table: Table
  readonly kind: FileKind
  /** xlsx は中身が UTF-8 の XML なので、文字コードの判定という概念がない。 */
  readonly detection: Detection | null
  readonly timings: Timings
  readonly bytes: number
  readonly fileName: string
}

export function kindOf(fileName: string): FileKind | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) return 'xlsx'
  return null
}

/** 10万行を目安とする（README に明記）。目安を超えそうなら、読み込む前に確認する。 */
export const SIZE_WARN_BYTES = 30 * 1024 * 1024

export async function loadFile(
  file: File,
  options: { readonly headerMode: HeaderMode; readonly encodingOverride?: CharEncoding },
): Promise<LoadResult> {
  const t0 = performance.now()

  const kind = kindOf(file.name)
  if (kind === null) {
    throw new Error(`対応していない拡張子です: ${file.name}`)
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const t1 = performance.now()

  if (kind === 'xlsx') {
    const p0 = performance.now()
    const parsed = await parseXlsx(bytes, options.headerMode)
    const p1 = performance.now()
    const table = buildTable(parsed.header, parsed.rows)
    const p2 = performance.now()
    return {
      table,
      kind,
      detection: null,
      bytes: bytes.length,
      fileName: file.name,
      timings: {
        readMs: t1 - t0,
        detectMs: 0,
        decodeMs: 0,
        parseMs: p1 - p0,
        buildMs: p2 - p1,
        totalMs: p2 - t0,
      },
    }
  }

  const d0 = performance.now()
  const detection =
    options.encodingOverride === undefined
      ? detectEncoding(bytes)
      : ({
          encoding: options.encodingOverride,
          confidence: 'certain',
          reason: '人が指定しました',
        } satisfies Detection)
  const d1 = performance.now()

  const text = decode(bytes, detection.encoding)
  const d2 = performance.now()

  const parsed = parseCsv(text, options.headerMode)
  const d3 = performance.now()

  const table = buildTable(parsed.header, parsed.rows)
  const d4 = performance.now()

  return {
    table,
    kind,
    detection,
    bytes: bytes.length,
    fileName: file.name,
    timings: {
      readMs: t1 - t0,
      detectMs: d1 - d0,
      decodeMs: d2 - d1,
      parseMs: d3 - d2,
      buildMs: d4 - d3,
      totalMs: d4 - t0,
    },
  }
}
