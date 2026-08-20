import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DropZone } from './DropZone.tsx'
import { EncodingBar } from './EncodingBar.tsx'
import { Grid } from './Grid.tsx'
import { IssuePanel } from './IssuePanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import type { Inspect } from './InspectPanel.tsx'
import { InspectPanel } from './InspectPanel.tsx'
import type { CharEncoding, Detection } from '../io/encoding.ts'
import type { HeaderMode } from '../io/parse.ts'
import type { AnalyzedPart, LoadedPart, Session } from '../io/analyzeClient.ts'
import { SIZE_WARN_BYTES, kindOf, startAnalyze } from '../io/analyzeClient.ts'
import type { Progress } from '../domain/detect/index.ts'
import type { Table } from '../domain/table.ts'
import type { FixSource } from '../domain/cell.ts'
import { FIXED, cellIndex } from '../domain/cell.ts'
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

/** 直したセルの、元の値と決めた人。取り消すと消える。 */
type FixedInfo = { readonly original: string; readonly by: FixSource }

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

  const sessionRef = useRef<Session | null>(null)
  /** 直したセルの元の値。表示のためだけに持つ。件数は直した数だけ。 */
  const fixedRef = useRef<Map<number, FixedInfo>>(new Map())
  useEffect(() => () => sessionRef.current?.cancel(), [])

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
    fixedRef.current = new Map()
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
          setAnalyzed(part)
          setProgress(null)
          setBusy(false)
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
        fixedRef.current.set(index, { original: known?.original ?? ch.before, by: op.by })
      }
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
    setInspect(null)
  }, [mutable, editState])

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
      // 直したセルの説明は、Worker が持っている「直す前」のものなので聞かない。
      if (ask === undefined || table?.flags[index] === FIXED) {
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
          <strong>ファイルは送信されません。</strong>
          すべてブラウザの中だけで処理します。ブラウザにも保存しません（タブを閉じると消えます）。
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

            {editState.log.length > 0 && (
              <p className="warnline">
                下の集計は<strong>検出したときのもの</strong>です。
                いま直したぶんは反映されていません（もう一度調べ直す機能は入れていません）。
                直した箇所は、表の中で緑になります。
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
          </>
        )}
      </main>

      <footer className="foot">
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
