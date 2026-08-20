import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DropZone } from './DropZone.tsx'
import { EncodingBar } from './EncodingBar.tsx'
import { Grid } from './Grid.tsx'
import { IssuePanel } from './IssuePanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { ExportPanel } from './ExportPanel.tsx'
import { saveBytes } from './save.ts'
import type { OfflineState } from './offline.ts'
import { registerOffline } from './offline.ts'
import type { Inspect } from './InspectPanel.tsx'
import { InspectPanel } from './InspectPanel.tsx'
import type { CharEncoding, Detection } from '../io/encoding.ts'
import type { HeaderMode } from '../io/parse.ts'
import type { AnalyzedPart, LoadedPart, Session } from '../io/analyzeClient.ts'
import { SIZE_WARN_BYTES, kindOf, startAnalyze } from '../io/analyzeClient.ts'
import type { Progress } from '../domain/detect/index.ts'
import type { Newline, Unmappable } from '../io/write.ts'
import { buildCsv, encodeCsv, outputName } from '../io/write.ts'
import { historyRows } from '../domain/edit.ts'
import type { Table } from '../domain/table.ts'
import type { FixSource } from '../domain/cell.ts'
import { CLEAN, FIXED, cellIndex } from '../domain/cell.ts'
import type { Issue, IssueCode } from '../domain/issue.ts'
import type { ColumnFix, EditOp, MutableTable } from '../domain/edit.ts'
import {
  UNDO_LIMIT,
  applyAutoFix,
  applyChoice,
  applyOp,
  editCell,
  emptyEditState,
  fixColumn,
  popUndo,
  pushEdit,
  revertOp,
  unifyColumn,
} from '../domain/edit.ts'

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const PHASE_LABEL: Readonly<Record<Progress['phase'], string>> = {
  columns: '列の性格を調べています',
  cells: 'セルを調べています',
  rows: '重複行を調べています',
}

const EMPTY_ROW_ISSUES: ReadonlyMap<number, Issue> = new Map()

/**
 * 直したセルの、元の値と決めた人。取り消すと消える。
 *
 * gen は「何回目の検査のあとに直したか」。
 * これがいまの検査より古ければ、Worker が持っている説明文は直す前のもの
 * なので聞きに行かない。再検査を挟めば新しくなるので、聞きに行く。
 */
type FixedInfo = { readonly original: string; readonly by: FixSource; readonly gen: number }

export function App() {
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<Table | null>(null)
  const [values, setValues] = useState<string[][] | null>(null)
  const [detection, setDetection] = useState<Detection | null>(null)
  const [loaded, setLoaded] = useState<LoadedPart | null>(null)
  const [analyzed, setAnalyzed] = useState<AnalyzedPart | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [headerMode, setHeaderMode] = useState<HeaderMode>('first-row')
  const [oversized, setOversized] = useState<File | null>(null)
  const [inspect, setInspect] = useState<Inspect | null>(null)
  const [editState, setEditState] = useState(emptyEditState())
  /** 前回の検査のあとに直した操作の数。0 でなければ集計が古い。 */
  const [editsSinceCheck, setEditsSinceCheck] = useState(0)
  const [offline, setOffline] = useState<OfflineState>({ kind: 'unsupported' })
  const [lastExport, setLastExport] = useState<{
    readonly bytes: number
    readonly encoding: CharEncoding
    readonly unmappable: readonly Unmappable[]
    readonly ms: number
  } | null>(null)

  const sessionRef = useRef<Session | null>(null)
  /** 何回目の検査か。1回目の検出が 1。再検査のたびに増える。 */
  const genRef = useRef(0)
  /** 直したセルの元の値。表示のためだけに持つ。件数は直した数だけ。 */
  const fixedRef = useRef<Map<number, FixedInfo>>(new Map())
  useEffect(() => () => sessionRef.current?.cancel(), [])
  useEffect(() => registerOffline(setOffline), [])

  const mutable = useMemo<MutableTable | null>(() => {
    if (table === null || values === null) return null
    return {
      columns: table.columns.map((c, i) => ({ name: c.name, values: values[i] ?? [] })),
      rowCount: table.rowCount,
      flags: table.flags,
      remedy: analyzed?.remedy ?? null,
    }
  }, [table, values, analyzed])

  const run = useCallback((target: File, mode: HeaderMode, override?: CharEncoding) => {
    sessionRef.current?.cancel()
    setBusy(true)
    setError(null)
    setAnalyzed(null)
    setProgress(null)
    setInspect(null)
    setEditState(emptyEditState())
    setEditsSinceCheck(0)
    setLastExport(null)
    fixedRef.current = new Map()
    genRef.current = 0
    setFile(target)

    sessionRef.current = startAnalyze(
      target,
      override === undefined ? { headerMode: mode } : { headerMode: mode, encodingOverride: override },
      {
        onLoaded: (part) => {
          setTable(part.table)
          setValues(part.values)
          setDetection(part.detection)
          setLoaded(part)
        },
        onProgress: setProgress,
        onAnalyzed: (part) => {
          genRef.current += 1
          // 【重要】直したセルのうち、問題が無くなったものは「直した」色のままにする。
          // 検査そのものは直したセルも例外にしない（いまの値で判定し直している）。
          // 問題が残っていれば、ここで上書きされないので issue の色に戻る。
          for (const index of fixedRef.current.keys()) {
            if (part.flags[index] === CLEAN) part.flags[index] = FIXED
          }
          setAnalyzed(part)
          setProgress(null)
          setBusy(false)
          setEditsSinceCheck(0)
          setInspect(null)
          setTable((prev) => (prev === null ? prev : { ...prev, flags: part.flags }))
        },
        onFailed: (message) => {
          setError(message)
          setBusy(false)
          setProgress(null)
        },
      },
    )
  }, [])

  const onFile = useCallback(
    (target: File) => {
      if (kindOf(target.name) === null) {
        setError(`対応していない拡張子です: ${target.name}`)
        return
      }
      if (target.size > SIZE_WARN_BYTES) {
        setOversized(target)
        return
      }
      run(target, headerMode)
    },
    [run, headerMode],
  )

  const onEncodingChange = useCallback(
    (encoding: CharEncoding) => {
      if (file !== null) run(file, headerMode, encoding)
    },
    [file, run, headerMode],
  )

  const onHeaderModeChange = useCallback(
    (mode: HeaderMode) => {
      setHeaderMode(mode)
      if (file !== null) run(file, mode, detection?.encoding)
    },
    [file, run, detection],
  )

  // ---------------------------------------------------------------- 修正

  /** 操作を1つ適用して、履歴に積む。値が変わらない操作は何もしない。 */
  const commit = useCallback(
    (op: EditOp | null) => {
      if (op === null || mutable === null) return
      applyOp(mutable, op)
      for (const ch of op.changes) {
        const index = cellIndex(ch.col, ch.row, mutable.rowCount)
        // すでに直したセルを直し直したときは、いちばん最初の値を残す。
        const known = fixedRef.current.get(index)
        fixedRef.current.set(index, {
          original: known?.original ?? ch.before,
          by: op.by,
          gen: genRef.current,
        })
      }
      setEditsSinceCheck((n) => n + 1)
      // 【重要】値の配列は書き換えても参照が変わらないので、React 単体では
      // 変化に気づけない。ここで editState が新しくなることが、そのまま
      // 「描き直して」の合図になっている。10万行の配列を作り直す必要はない。
      setEditState((s) => pushEdit(s, op))
      setInspect(null)
    },
    [mutable],
  )

  const undo = useCallback(() => {
    if (mutable === null) return
    const popped = popUndo(editState, new Date().toISOString())
    if (popped === null) return
    revertOp(mutable, popped.op)
    for (const ch of popped.op.changes) {
      fixedRef.current.delete(cellIndex(ch.col, ch.row, mutable.rowCount))
    }
    setEditState(popped.state)
    setEditsSinceCheck((n) => n + 1)
    setInspect(null)
  }, [mutable, editState])

  /** 直したデータを CSV で書き出す。元のファイルには触らない。 */
  const onExport = useCallback(
    (encoding: CharEncoding, newline: Newline) => {
      if (values === null || table === null || file === null) return
      setBusy(true)
      const t0 = performance.now()
      void sessionRef.current
        ?.exportCsv(values, table.rowCount, encoding, {
          header: table.columns.map((c) => c.name),
          // 1行目を見出しとして読んだときだけ、見出しの行を書く。
          // 「列1, 列2…」を書き足すと、元に無かった行が増える。
          writeHeader: headerMode === 'first-row',
          newline,
        })
        .then((result) => {
          setBusy(false)
          if (result === null) return
          saveBytes(result.bytes, outputName(file.name, '_tidy'))
          setLastExport({
            bytes: result.bytes.length,
            encoding,
            unmappable: result.unmappable,
            ms: performance.now() - t0,
          })
        })
    },
    [values, table, file, headerMode],
  )

  /**
   * 変更履歴を書き出す。
   *
   * 【重要】こちらは Worker へ回さない。履歴は操作の数だけで、
   * 表そのものより桁が小さい。ここで全件を開くのは、書き出すときだけ。
   */
  const onExportHistory = useCallback(
    (encoding: CharEncoding) => {
      if (file === null || table === null) return
      const rows = historyRows(editState, table.columns.map((c) => c.name))
      const header = ['通番', '日時', '操作', '決めたのは', '範囲', '行', '列', '前', '後', '種別']
      const columns: string[][] = header.map(() => [])
      for (const r of rows) {
        const cells = [
          String(r.seq),
          r.at,
          r.action,
          r.decidedBy,
          r.scope,
          String(r.row),
          r.columnName,
          r.before,
          r.after,
          r.issue,
        ]
        cells.forEach((v, i) => columns[i]?.push(v))
      }
      const csv = buildCsv(columns, rows.length, { header, writeHeader: true, newline: 'crlf' })
      saveBytes(encodeCsv(csv, encoding), outputName(file.name, '_changes'))
    },
    [file, table, editState],
  )

  /** いまの値で調べ直す。人が押したときだけ。 */
  const recheck = useCallback(() => {
    if (values === null || table === null) return
    setBusy(true)
    setProgress({ phase: 'columns', done: 0, total: table.columns.length })
    sessionRef.current?.recheck(values, table.rowCount)
  }, [values, table])

  const now = (): string => new Date().toISOString()

  const onAutoFix = useCallback(
    (row: number, col: number, issue: Issue) => {
      if (mutable === null || issue.remedy.kind !== 'auto') return
      // 【重要】auto であることを絞ってから渡す。applyAutoFix は auto しか受け取らない。
      commit(applyAutoFix(mutable, editState.nextSeq, now(), row, col, { ...issue, remedy: issue.remedy }))
    },
    [mutable, editState.nextSeq, commit],
  )

  const onColumnFix = useCallback(
    (col: number, kind: ColumnFix) => {
      if (mutable === null) return
      commit(fixColumn(mutable, editState.nextSeq, now(), col, kind))
    },
    [mutable, editState.nextSeq, commit],
  )

  const onChoose = useCallback(
    (row: number, col: number, code: IssueCode, value: string) => {
      if (mutable === null) return
      commit(applyChoice(mutable, editState.nextSeq, now(), row, col, code, value))
    },
    [mutable, editState.nextSeq, commit],
  )

  const onUnify = useCallback(
    (col: number, from: readonly string[], to: string, code: IssueCode) => {
      if (mutable === null) return
      commit(unifyColumn(mutable, editState.nextSeq, now(), col, new Set(from), to, code))
    },
    [mutable, editState.nextSeq, commit],
  )

  const onEdit = useCallback(
    (row: number, col: number, value: string) => {
      if (mutable === null) return
      commit(editCell(mutable, editState.nextSeq, now(), row, col, value))
    },
    [mutable, editState.nextSeq, commit],
  )

  // ---------------------------------------------------------------- 表示

  const onHover = useCallback(
    (index: number, row: number, col: number, value: string) => {
      const colName = table?.columns[col]?.name ?? ''
      const rowIssue = analyzed?.rowIssues.get(row) ?? null
      const fixed = fixedRef.current.get(index) ?? null
      const base: Inspect = {
        index,
        row,
        col,
        colName,
        value,
        issues: [],
        rowIssue,
        fixed,
        analyzed: analyzed !== null,
      }
      const ask = analyzed?.askDetail
      // 直したあと、まだ調べ直していないセルは聞かない。
      // Worker が持っているのは「直す前」の説明文で、いま出すと嘘になる。
      const stale = fixed !== null && fixed.gen >= genRef.current
      if (ask === undefined || stale) {
        setInspect(base)
        return
      }
      void ask(index).then((detail) => {
        const issues = detail === null ? [] : detail.kind === 'issue' ? detail.issues : detail.resolved
        setInspect({ ...base, issues })
      })
    },
    [table, analyzed],
  )

  const pct =
    progress === null || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)

  const columnNames = table?.columns.map((c) => c.name) ?? []

  return (
    <div className="app">
      <header className="head">
        <div>
          <h1 className="head__title">csv-tidy</h1>
          <p className="head__sub">CSV / Excel の汚れを見つけて直す</p>
        </div>
        {/* 仕様書2章：画面に常時表示すること */}
        <div className="privacy" role="status">
          <strong>データの送信は一切ありません。</strong>
          読み込んだファイルは、すべてブラウザの中だけで処理します。
          どこにも送りませんし、ブラウザにも残しません（タブを閉じると消えます）。
          {/* 【重要】保存し終わるまでは「使えます」と言わない。
              登録できたことと、取り終わったことは別である。 */}
          {offline.kind === 'ready' && (
            <span className="privacy__offline">
              ネットワークを切っても、そのまま使えます（{offline.total} 件を保存済み）。
            </span>
          )}
          {offline.kind === 'preparing' && (
            <span className="privacy__offline">
              オフラインで使えるように保存しています（{offline.stored} / {offline.total} 件）。
              {offline.missing.length > 0 && (
                <> 残り：{offline.missing.map((m) => m.split('/').pop() || m).join('、')}</>
              )}
            </span>
          )}
          {offline.kind === 'failed' && (
            <span className="privacy__offline">
              オフラインの保存はできていません。ネットワークがあれば、そのまま使えます。
            </span>
          )}
        </div>
      </header>

      <main>
        <DropZone onFile={onFile} disabled={false} />

        {oversized !== null && (
          <div className="warn">
            <p>
              <strong>{oversized.name}</strong>（{mb(oversized.size)}）は、目安としている大きさを
              超えています。本ツールは <strong>10万行程度</strong>{' '}
              を想定しています。読み込むとブラウザが重くなるか、メモリ不足で落ちることがあります。
            </p>
            <div className="warn__actions">
              <button
                type="button"
                onClick={() => {
                  const target = oversized
                  setOversized(null)
                  run(target, headerMode)
                }}
              >
                それでも読み込む
              </button>
              <button type="button" onClick={() => setOversized(null)}>
                やめる
              </button>
            </div>
          </div>
        )}

        {error !== null && <p className="error">{error}</p>}

        {progress !== null && (
          <div className="prog">
            <div className="prog__bar">
              <div className="prog__fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="prog__text">
              {PHASE_LABEL[progress.phase]} — {progress.done.toLocaleString()} /{' '}
              {progress.total.toLocaleString()}（{pct}%）
              <span className="prog__note">この間も画面は動きます（別スレッドで処理しています）</span>
            </div>
          </div>
        )}

        {table !== null && loaded !== null && (
          <>
            <EncodingBar detection={detection} onChange={onEncodingChange} busy={busy} />

            <div className="opts">
              <label>
                <input
                  type="checkbox"
                  checked={headerMode === 'first-row'}
                  onChange={(e) => onHeaderModeChange(e.target.checked ? 'first-row' : 'generated')}
                />
                1行目を見出しとして扱う
              </label>

              <span className="opts__gap" />

              <button type="button" onClick={undo} disabled={editState.undoStack.length === 0}>
                元に戻す
              </button>
              <button
                type="button"
                className={editsSinceCheck > 0 ? 'btn--call' : ''}
                onClick={recheck}
                disabled={busy || analyzed === null}
              >
                再検査
              </button>
              <span className="opts__note">
                戻せる操作 {editState.undoStack.length} / {UNDO_LIMIT}
                {editState.droppedFromUndo > 0 && (
                  <strong className="opts__dropped">
                    （{editState.droppedFromUndo} 操作は上限を超えたため戻せません）
                  </strong>
                )}
              </span>
            </div>

            <dl className="stats">
              <div>
                <dt>ファイル</dt>
                <dd>
                  {file?.name ?? ''}（{mb(file?.size ?? 0)}）
                </dd>
              </div>
              <div>
                <dt>行 × 列</dt>
                <dd>
                  {table.rowCount.toLocaleString()} 行 × {table.columns.length} 列
                </dd>
              </div>
              <div>
                <dt>読み込み</dt>
                <dd>
                  {loaded.loadMs.toFixed(0)} ms
                  <span className="stats__note">
                    判定 {loaded.detail.detectMs.toFixed(0)} / 復号 {loaded.detail.decodeMs.toFixed(0)} /
                    パース {loaded.detail.parseMs.toFixed(0)} / 列に組替 {loaded.detail.pivotMs.toFixed(0)} ms
                    （すべて別スレッド）
                  </span>
                </dd>
              </div>
              <div>
                <dt>検出</dt>
                <dd>
                  {analyzed === null ? '調べています…' : `${analyzed.analyzeMs.toFixed(0)} ms`}
                  <span className="stats__note">
                    {analyzed === null
                      ? '結果が出るまで、表はそのまま操作できます'
                      : `${analyzed.summary.checkedCells.toLocaleString()} セルを検査しました`}
                  </span>
                </dd>
              </div>
            </dl>

            {analyzed !== null && (
              <IssuePanel summary={analyzed.summary} columnNames={columnNames} />
            )}

            {editsSinceCheck > 0 && (
              <p className="warnline">
                直したあと、まだ調べ直していません。上の集計は
                <strong>{editsSinceCheck} 操作ぶん古い</strong>状態です。
                <button type="button" className="btn--call" onClick={recheck} disabled={busy}>
                  いまの値で再検査する
                </button>
              </p>
            )}

            <div className="legend">
              <span className="legend__item">
                <i className="sw sw--unchecked" />未検査
              </span>
              <span className="legend__item">
                <i className="sw sw--clean" />問題なし
              </span>
              <span className="legend__item">
                <i className="sw sw--auto" />自動で直せる
              </span>
              <span className="legend__item">
                <i className="sw sw--choice" />人が決める
              </span>
              <span className="legend__item">
                <i className="sw sw--none" />検出だけ
              </span>
              <span className="legend__item">
                <i className="sw sw--fixed" />直した
              </span>
              <span className="legend__item">
                <i className="sw sw--dup" />重複行（行番号に印）
              </span>
            </div>

            <Grid
              table={table}
              remedy={analyzed?.remedy ?? null}
              rowIssues={analyzed?.rowIssues ?? EMPTY_ROW_ISSUES}
              onHover={onHover}
            />

            <InspectPanel
              inspect={inspect}
              onAutoFix={onAutoFix}
              onColumnFix={onColumnFix}
              onChoose={onChoose}
              onUnify={onUnify}
              onEdit={onEdit}
            />

            <HistoryPanel state={editState} columnNames={columnNames} />

            <ExportPanel
              fileName={file?.name ?? ''}
              readEncoding={detection?.encoding ?? null}
              editState={editState}
              busy={busy}
              onExport={onExport}
              onExportHistory={onExportHistory}
              lastExport={lastExport}
            />
          </>
        )}
      </main>

      <footer className="foot">
        {/* 免責は1行だけ。長く書くと、かえって不安にさせる。 */}
        <p className="foot__note">
          元のファイルは変更しません。書き出した結果は必ずご確認ください。
        </p>
        <a href="https://lightech.co.jp/" target="_blank" rel="noreferrer">
          株式会社LIGHTECH
        </a>
        <span className="foot__sep">·</span>
        <a href="https://lightech.co.jp/" target="_blank" rel="noreferrer">
          業務効率化のご相談
        </a>
      </footer>
    </div>
  )
}
