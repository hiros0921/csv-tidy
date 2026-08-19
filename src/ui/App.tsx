import { useCallback, useEffect, useRef, useState } from 'react'
import { DropZone } from './DropZone.tsx'
import { EncodingBar } from './EncodingBar.tsx'
import { Grid } from './Grid.tsx'
import { IssuePanel } from './IssuePanel.tsx'
import type { CharEncoding, Detection } from '../io/encoding.ts'
import type { HeaderMode } from '../io/parse.ts'
import type { AnalyzedPart, LoadedPart } from '../io/analyzeClient.ts'
import type { Session } from '../io/analyzeClient.ts'
import { SIZE_WARN_BYTES, kindOf, startAnalyze } from '../io/analyzeClient.ts'
import type { Progress } from '../domain/detect/index.ts'
import type { Table } from '../domain/table.ts'
import type { Issue } from '../domain/issue.ts'

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const PHASE_LABEL: Readonly<Record<Progress['phase'], string>> = {
  columns: '列の性格を調べています',
  cells: 'セルを調べています',
  rows: '重複行を調べています',
}

const EMPTY_ROW_ISSUES: ReadonlyMap<number, Issue> = new Map()

const REMEDY_LABEL = {
  auto: '自動で直せる',
  choice: '人が決める',
  none: '検出だけ',
} as const

type Inspect = {
  readonly row: number
  readonly colName: string
  readonly value: string
  readonly issues: readonly Issue[]
  readonly rowIssue: Issue | null
}

export function App() {
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<Table | null>(null)
  const [detection, setDetection] = useState<Detection | null>(null)
  const [loaded, setLoaded] = useState<LoadedPart | null>(null)
  const [analyzed, setAnalyzed] = useState<AnalyzedPart | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [headerMode, setHeaderMode] = useState<HeaderMode>('first-row')
  const [oversized, setOversized] = useState<File | null>(null)
  const [inspect, setInspect] = useState<Inspect | null>(null)

  /** 走っている Worker を止めるための取っ手。読み直すときに前のを捨てる。 */
  const sessionRef = useRef<Session | null>(null)
  useEffect(() => () => sessionRef.current?.cancel(), [])

  const run = useCallback((target: File, mode: HeaderMode, override?: CharEncoding) => {
    sessionRef.current?.cancel()
    setBusy(true)
    setError(null)
    setAnalyzed(null)
    setProgress(null)
    setFile(target)

    sessionRef.current = startAnalyze(
      target,
      override === undefined ? { headerMode: mode } : { headerMode: mode, encodingOverride: override },
      {
        onLoaded: (part) => {
          // 表は先に出す。検出を待たせない。
          setTable(part.table)
          setDetection(part.detection)
          setLoaded(part)
        },
        onProgress: setProgress,
        onAnalyzed: (part) => {
          setAnalyzed(part)
          setProgress(null)
          setBusy(false)
          // 色分けに要るものだけ、先に反映する。flags も remedy も転送済み（コピーなし）。
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
      // 復号済みの文字列からは戻せない。元の File から読み直す。
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

  const onHover = useCallback(
    (index: number, row: number, col: number, value: string) => {
      const colName = table?.columns[col]?.name ?? ''
      const rowIssue = analyzed?.rowIssues.get(row) ?? null
      const ask = analyzed?.askDetail
      if (ask === undefined) {
        setInspect({ row, colName, value, issues: [], rowIssue })
        return
      }
      void ask(index).then((detail) => {
        const issues =
          detail === null ? [] : detail.kind === 'issue' ? detail.issues : detail.resolved
        setInspect({ row, colName, value, issues, rowIssue })
      })
    },
    [table, analyzed],
  )

  const pct =
    progress === null || progress.total === 0
      ? 0
      : Math.round((progress.done / progress.total) * 100)

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
                  onChange={(e) =>
                    onHeaderModeChange(e.target.checked ? 'first-row' : 'generated')
                  }
                />
                1行目を見出しとして扱う
              </label>
            </div>

            <dl className="stats">
              <div>
                <dt>ファイル</dt>
                <dd>{file?.name ?? ''}（{mb(file?.size ?? 0)}）</dd>
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
                    判定 {loaded.detail.detectMs.toFixed(0)} / 復号{' '}
                    {loaded.detail.decodeMs.toFixed(0)} / パース{' '}
                    {loaded.detail.parseMs.toFixed(0)} / 列に組替{' '}
                    {loaded.detail.pivotMs.toFixed(0)} ms（すべて別スレッド）
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
              <IssuePanel
                summary={analyzed.summary}
                columnNames={table.columns.map((c) => c.name)}
              />
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
                <i className="sw sw--dup" />重複行（行番号に印）
              </span>
            </div>

            <Grid
              table={table}
              remedy={analyzed?.remedy ?? null}
              rowIssues={analyzed?.rowIssues ?? EMPTY_ROW_ISSUES}
              onHover={onHover}
            />

            <div className="inspect">
              {inspect === null ? (
                <span className="inspect__idle">
                  セルにカーソルを合わせると、そのセルで見つかったことが出ます。
                </span>
              ) : (
                <>
                  <div className="inspect__head">
                    {inspect.row + 1} 行目・{inspect.colName}
                    <span className="inspect__val">{inspect.value === '' ? '（空欄）' : inspect.value}</span>
                  </div>
                  {inspect.issues.length === 0 && inspect.rowIssue === null && (
                    <div className="inspect__ok">
                      {analyzed === null ? 'まだ調べていません' : '問題は見つかりませんでした'}
                    </div>
                  )}
                  {inspect.issues.map((issue, i) => (
                    <div key={i} className={`inspect__row inspect__row--${issue.remedy.kind}`}>
                      <span className="inspect__tag">{REMEDY_LABEL[issue.remedy.kind]}</span>
                      <span>{issue.note}</span>
                      {issue.remedy.kind === 'choice' && (
                        <span className="inspect__opts">
                          {issue.remedy.options.map((o, j) => (
                            <span key={j} className="inspect__opt">
                              {o.value}
                              {o.occurrences > 0 && (
                                <em className="inspect__cnt">{o.occurrences.toLocaleString()}件</em>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                      {issue.remedy.kind === 'auto' && (
                        <span className="inspect__opts">
                          <span className="inspect__opt">→ {issue.remedy.to}</span>
                        </span>
                      )}
                    </div>
                  ))}
                  {inspect.rowIssue !== null && (
                    <div className="inspect__row inspect__row--choice">
                      <span className="inspect__tag">人が決める</span>
                      <span>{inspect.rowIssue.note}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <p className="gridnote">
              全 {table.rowCount.toLocaleString()} 行のうち、実際に DOM
              に載っているのは表示範囲のぶんだけです。行数を10倍にしても DOM の数は変わりません。
            </p>
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
