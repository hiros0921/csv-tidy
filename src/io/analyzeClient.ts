/**
 * Worker を呼ぶ側。メインスレッドから見た窓口。
 *
 * 読み込みと検出は別々に返る。表は先に出して、検出はあとから塗る。
 * 待たせないほうが、10万行では体感が変わる。
 */

import type { CharEncoding, Detection } from './encoding.ts'
import type { HeaderMode } from './parse.ts'
import type { FileKind, WorkerRequest, WorkerResponse } from '../worker/analyze.worker.ts'
import type { Table } from '../domain/table.ts'
import type { CellDetail } from '../domain/cell.ts'
import type { Issue } from '../domain/issue.ts'
import type { Progress, Summary } from '../domain/detect/index.ts'

export type LoadedPart = {
  readonly table: Table
  readonly detection: Detection | null
  readonly loadMs: number
  readonly detail: { readonly detectMs: number; readonly decodeMs: number; readonly parseMs: number; readonly pivotMs: number }
}

export type AnalyzedPart = {
  readonly flags: Uint8Array
  /** 三分岐の区分。色分けはこれだけで足りる。 */
  readonly remedy: Uint8Array
  readonly rowIssues: ReadonlyMap<number, Issue>
  readonly summary: Summary
  readonly analyzeMs: number
  /**
   * セル1つの説明文を、Worker に聞く。
   *
   * 【重要】説明文をまとめて受け取らないのは、11万件の入れ子オブジェクトを
   * postMessage すると、受け取る側がハンドラに入る前に 151ms 止まるため（実測）。
   * 復元はハンドラの外で起きるので、受け取ってから分割しても間に合わない。
   */
  readonly askDetail: (index: number) => Promise<CellDetail | null>
}

export type Handlers = {
  readonly onLoaded: (part: LoadedPart) => void
  readonly onProgress: (p: Progress) => void
  readonly onAnalyzed: (part: AnalyzedPart) => void
  readonly onFailed: (message: string) => void
}

export function kindOf(fileName: string): FileKind | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) return 'xlsx'
  return null
}

/** 10万行を目安とする。目安を超えそうなら、読み込む前に確認する。 */
export const SIZE_WARN_BYTES = 30 * 1024 * 1024

export type Session = {
  /** 止める。Worker を捨てる。 */
  readonly cancel: () => void
}

/**
 * 走らせる。返り値の cancel を呼ぶと、途中でも打ち切れる。
 *
 * 【重要】File は呼び出し側が持ち続けること。
 * ArrayBuffer は Worker へ transfer するので、こちら側では空になる。
 * 文字コードを選び直すときは、同じ File からもう一度読む。
 */
export function startAnalyze(
  file: File,
  options: { readonly headerMode: HeaderMode; readonly encodingOverride?: CharEncoding },
  handlers: Handlers,
): Session {
  const fileKind = kindOf(file.name)
  if (fileKind === null) {
    handlers.onFailed(`対応していない拡張子です: ${file.name}`)
    return { cancel: () => {} }
  }

  const worker = new Worker(new URL('../worker/analyze.worker.ts', import.meta.url), {
    type: 'module',
  })
  let alive = true
  const started = performance.now()
  /** 聞いた説明文の返事を待っている人たち。index ごとに1つ。 */
  const waiting = new Map<number, (detail: CellDetail | null) => void>()

  const askDetail = (index: number): Promise<CellDetail | null> =>
    new Promise((resolve) => {
      if (!alive) {
        resolve(null)
        return
      }
      waiting.set(index, resolve)
      worker.postMessage({ kind: 'ask', index })
    })

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (!alive) return
    const msg = event.data
    switch (msg.kind) {
      case 'loaded': {
        const table: Table = {
          columns: msg.header.map((name, c) => ({ name, values: msg.columns[c] ?? [] })),
          rowCount: msg.rowCount,
          // 検出前は全セル未検査。Uint8Array は 0 で初期化される。
          flags: new Uint8Array(msg.header.length * msg.rowCount),
          details: new Map(),
        }
        handlers.onLoaded({
          table,
          detection: msg.detection,
          loadMs: performance.now() - started,
          detail: msg.timings,
        })
        break
      }
      case 'progress':
        handlers.onProgress(msg.progress)
        break
      case 'analyzed': {
        // 渡すのは色分けに要るものだけ。Uint8Array なのでコピーなし。
        // 説明文は Worker に置いたまま。聞かれたときに1件ずつ返ってくる。
        handlers.onAnalyzed({
          flags: msg.flags,
          remedy: msg.remedy,
          rowIssues: new Map(msg.rowIssues),
          summary: msg.summary,
          analyzeMs: msg.analyzeMs,
          askDetail,
        })
        break
      }
      case 'detail': {
        const resolve = waiting.get(msg.index)
        if (resolve !== undefined) {
          waiting.delete(msg.index)
          resolve(msg.detail)
        }
        break
      }
      case 'failed':
        handlers.onFailed(msg.message)
        worker.terminate()
        break
    }
  }

  worker.onerror = (e) => {
    if (!alive) return
    handlers.onFailed(e.message)
    worker.terminate()
  }

  void file.arrayBuffer().then((buffer) => {
    if (!alive) return
    const req: WorkerRequest =
      options.encodingOverride === undefined
        ? { kind: 'load', buffer, fileKind, headerMode: options.headerMode }
        : {
            kind: 'load',
            buffer,
            fileKind,
            headerMode: options.headerMode,
            encodingOverride: options.encodingOverride,
          }
    worker.postMessage(req, [buffer])
  })

  return {
    cancel: () => {
      alive = false
      for (const resolve of waiting.values()) resolve(null)
      waiting.clear()
      worker.terminate()
    },
  }
}
