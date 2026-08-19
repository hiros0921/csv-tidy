/// <reference lib="webworker" />
/**
 * 読み込みと検出を、まとめて Worker の中でやる。
 *
 * 【なぜ読み込みごと Worker に移したか】
 * 実測すると、100万セルの配列を postMessage したときに止まるのは
 * 「送る側」だけで、受け取る側は 0ms だった（V8 が遅延で実体化するため）。
 *   main → worker で送ると、止まるのはメインスレッド（約45ms）
 *   worker → main で送ると、止まるのは Worker 側（約32ms）。メインは 0ms
 * つまり、パースまで Worker でやって結果を送り返すほうが、メインは止まらない。
 *
 * 併せて、第1段階で検討した「1本の平坦なバッファに詰め替えて転送する」案は
 * 捨てた。詰め替えに 621ms かかり、避けようとしたコスト（45ms）より
 * 14倍高い。測ってから決めた。
 */

import type { CharEncoding, Detection } from '../io/encoding.ts'
import { decode, detectEncoding } from '../io/encoding.ts'
import type { HeaderMode } from '../io/parse.ts'
import { parseCsv, parseXlsx } from '../io/parse.ts'
import type { CellDetail } from '../domain/cell.ts'
import type { Issue } from '../domain/issue.ts'
import type { Progress, Summary } from '../domain/detect/index.ts'
import { analyze } from '../domain/detect/index.ts'

export type FileKind = 'csv' | 'xlsx'

export type LoadRequest = {
      readonly kind: 'load'
      readonly buffer: ArrayBuffer
      readonly fileKind: FileKind
      readonly headerMode: HeaderMode
      readonly encodingOverride?: CharEncoding
    }

/** セル1つの説明文を聞く。画面がカーソルを合わせたときだけ来る。 */
export type AskRequest = { readonly kind: 'ask'; readonly index: number }

export type WorkerRequest = LoadRequest | AskRequest

export type LoadTimings = {
  readonly detectMs: number
  readonly decodeMs: number
  readonly parseMs: number
  readonly pivotMs: number
}

export type WorkerResponse =
  | {
      readonly kind: 'loaded'
      readonly header: readonly string[]
      readonly columns: readonly (readonly string[])[]
      readonly rowCount: number
      readonly detection: Detection | null
      readonly timings: LoadTimings
    }
  | { readonly kind: 'progress'; readonly progress: Progress }
  | {
      readonly kind: 'analyzed'
      readonly flags: Uint8Array
      readonly remedy: Uint8Array
      readonly rowIssues: readonly (readonly [number, Issue])[]
      readonly summary: Summary
      readonly analyzeMs: number
    }
  | { readonly kind: 'detail'; readonly index: number; readonly detail: CellDetail | null }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Worker の中の self は Window ではない（postMessage の引数の形が違う）。
 * tsconfig の lib は DOM 側なので、ここだけ Worker の型に読み替える。
 * このファイル以外に影響しない、局所的な読み替え。
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer === undefined) ctx.postMessage(message)
  else ctx.postMessage(message, transfer)
}

/**
 * 検出した説明文は、ここに置いたままにする。
 *
 * 【重要】メインスレッドへ送らない。
 * 11万件の入れ子オブジェクトを postMessage すると、受け取る側が
 * ハンドラに入る前に 151ms 止まる（実測）。復元はハンドラの外で起きるので、
 * 受け取ってから分割しても間に合わない。送らないのが唯一の解になる。
 * 画面が要るのは、カーソルを合わせた1セルの説明文だけである。
 */
let heldDetails: ReadonlyMap<number, CellDetail> = new Map()

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  if (req.kind === 'ask') {
    post({ kind: 'detail', index: req.index, detail: heldDetails.get(req.index) ?? null })
    return
  }
  void run(req)
}

async function run(req: LoadRequest): Promise<void> {
  try {
    const bytes = new Uint8Array(req.buffer)

    // ---- 読み込み ----
    let detection: Detection | null = null
    let header: readonly string[]
    let rows: readonly (readonly string[])[]
    let detectMs = 0
    let decodeMs = 0

    const p0 = performance.now()
    if (req.fileKind === 'xlsx') {
      // SheetJS は動的 import のまま。CSV しか使わない人に読ませないため。
      const parsed = await parseXlsx(bytes, req.headerMode)
      header = parsed.header
      rows = parsed.rows
    } else {
      const d0 = performance.now()
      detection =
        req.encodingOverride === undefined
          ? detectEncoding(bytes)
          : { encoding: req.encodingOverride, confidence: 'certain', reason: '人が指定しました' }
      const d1 = performance.now()
      const text = decode(bytes, detection.encoding)
      const d2 = performance.now()
      detectMs = d1 - d0
      decodeMs = d2 - d1
      const parsed = parseCsv(text, req.headerMode)
      header = parsed.header
      rows = parsed.rows
    }
    const p1 = performance.now()

    // 行の配列を、列ごとの配列に組み替える。以降の処理はすべて列単位。
    const colCount = header.length
    const rowCount = rows.length
    const columns: string[][] = []
    for (let c = 0; c < colCount; c++) {
      const values = new Array<string>(rowCount)
      for (let r = 0; r < rowCount; r++) values[r] = rows[r]?.[c] ?? ''
      columns.push(values)
    }
    const p2 = performance.now()

    post({
      kind: 'loaded',
      header,
      columns,
      rowCount,
      detection,
      timings: {
        detectMs,
        decodeMs,
        parseMs: p1 - p0 - detectMs - decodeMs,
        pivotMs: p2 - p1,
      },
    })

    // ---- 検出 ----
    const a0 = performance.now()
    const result = analyze(columns, rowCount, (progress) => post({ kind: 'progress', progress }))
    const a1 = performance.now()

    heldDetails = result.details
    // 表の中身はメイン側が持っている。ここで抱えたままにすると二重に持つことになる。
    columns.length = 0

    post(
      {
        kind: 'analyzed',
        flags: result.flags,
        remedy: result.remedy,
        rowIssues: [...result.rowIssues.entries()],
        summary: result.summary,
        analyzeMs: a1 - a0,
      },
      // Uint8Array は Transferable。ここはコピーせずに渡る。
      [result.flags.buffer, result.remedy.buffer],
    )
  } catch (e) {
    post({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
  }
}
