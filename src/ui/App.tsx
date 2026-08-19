import { useCallback, useState } from 'react'
import { DropZone } from './DropZone.tsx'
import { EncodingBar } from './EncodingBar.tsx'
import { PreviewTable } from './PreviewTable.tsx'
import type { CharEncoding } from '../io/encoding.ts'
import type { HeaderMode } from '../io/parse.ts'
import type { LoadResult } from '../io/read.ts'
import { SIZE_WARN_BYTES, kindOf, loadFile } from '../io/read.ts'
import { countUnchecked } from '../domain/table.ts'

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function App() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [headerMode, setHeaderMode] = useState<HeaderMode>('first-row')
  /** 目安を超える大きさのファイル。読み込む前に確認する。 */
  const [oversized, setOversized] = useState<File | null>(null)

  const run = useCallback(
    async (target: File, mode: HeaderMode, override?: CharEncoding) => {
      setBusy(true)
      setError(null)
      try {
        const loaded = await loadFile(
          target,
          override === undefined ? { headerMode: mode } : { headerMode: mode, encodingOverride: override },
        )
        setResult(loaded)
        setFile(target)
      } catch (e) {
        setResult(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

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
      void run(target, headerMode)
    },
    [run, headerMode],
  )

  const onEncodingChange = useCallback(
    (encoding: CharEncoding) => {
      // 復号済みの文字列からは戻せない。元の File から読み直す。
      if (file !== null) void run(file, headerMode, encoding)
    },
    [file, run, headerMode],
  )

  const onHeaderModeChange = useCallback(
    (mode: HeaderMode) => {
      setHeaderMode(mode)
      if (file !== null) {
        void run(file, mode, result?.detection?.encoding)
      }
    },
    [file, run, result],
  )

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
        <DropZone onFile={onFile} disabled={busy} />

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
                  void run(target, headerMode)
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

        {busy && <p className="status">読み込んでいます…</p>}
        {error !== null && <p className="error">{error}</p>}

        {result !== null && (
          <>
            <EncodingBar
              detection={result.detection}
              onChange={onEncodingChange}
              busy={busy}
            />

            <div className="opts">
              <label>
                <input
                  type="checkbox"
                  checked={headerMode === 'first-row'}
                  disabled={busy}
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
                <dd>
                  {result.fileName}（{mb(result.bytes)}・{result.kind}）
                </dd>
              </div>
              <div>
                <dt>行 × 列</dt>
                <dd>
                  {result.table.rowCount.toLocaleString()} 行 × {result.table.columns.length} 列
                </dd>
              </div>
              <div>
                <dt>未検査のセル</dt>
                <dd>
                  {countUnchecked(result.table).toLocaleString()} 個
                  <span className="stats__note">
                    読み込んだだけでは、まだ1つも調べていません（第4段階で検査します）
                  </span>
                </dd>
              </div>
              <div>
                <dt>所要時間</dt>
                <dd>
                  合計 {result.timings.totalMs.toFixed(0)} ms
                  <span className="stats__note">
                    読込 {result.timings.readMs.toFixed(0)} / 判定{' '}
                    {result.timings.detectMs.toFixed(0)} / 復号{' '}
                    {result.timings.decodeMs.toFixed(0)} / パース{' '}
                    {result.timings.parseMs.toFixed(0)} / 構築{' '}
                    {result.timings.buildMs.toFixed(0)} ms
                  </span>
                </dd>
              </div>
            </dl>

            <PreviewTable table={result.table} />
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
