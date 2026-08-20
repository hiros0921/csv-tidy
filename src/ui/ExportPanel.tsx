/**
 * 書き出し。仕様書7章。
 *
 * 【画面で守ること】
 *   ・元のファイルは書き換えないと、はっきり書く
 *   ・文字コードを選ばせる。どれを選ぶとどうなるかも書く
 *   ・書けない文字があるときは、書き出す前に見せる
 */

import { useState } from 'react'
import type { CharEncoding } from '../io/encoding.ts'
import { ENCODING_LABEL } from '../io/encoding.ts'
import type { Newline, Unmappable } from '../io/write.ts'
import { WRITE_ENCODINGS, WRITE_ENCODING_NOTE } from '../io/write.ts'
import type { EditState } from '../domain/edit.ts'

type Props = {
  readonly fileName: string
  readonly readEncoding: CharEncoding | null
  readonly editState: EditState
  readonly busy: boolean
  readonly onExport: (encoding: CharEncoding, newline: Newline) => void
  readonly onExportHistory: (encoding: CharEncoding) => void
  readonly lastExport: {
    readonly bytes: number
    readonly encoding: CharEncoding
    readonly unmappable: readonly Unmappable[]
    readonly ms: number
  } | null
}

export function ExportPanel({
  fileName,
  readEncoding,
  editState,
  busy,
  onExport,
  onExportHistory,
  lastExport,
}: Props) {
  // 読んだときの文字コードを初期値にする。ただし UTF-16 は書き出せないので UTF-8 BOM へ。
  const initial: CharEncoding =
    readEncoding !== null && WRITE_ENCODINGS.includes(readEncoding) ? readEncoding : 'utf-8-bom'
  const [encoding, setEncoding] = useState<CharEncoding>(initial)
  const [newline, setNewline] = useState<Newline>('crlf')

  return (
    <div className="panel">
      <div className="panel__title">書き出し</div>
      <p className="panel__note">
        <strong>元のファイル（{fileName}）は書き換えません。</strong>
        新しいファイルとして保存します。ここでも通信は起きません。
      </p>

      <div className="export">
        <label>
          文字コード
          <select
            id="write-encoding"
            name="write-encoding"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value as CharEncoding)}
          >
            {WRITE_ENCODINGS.map((enc) => (
              <option key={enc} value={enc}>
                {ENCODING_LABEL[enc]}
              </option>
            ))}
          </select>
        </label>
        <span className="export__note">{WRITE_ENCODING_NOTE[encoding]}</span>

        <label>
          改行
          <select
            id="write-newline"
            name="write-newline"
            value={newline}
            onChange={(e) => setNewline(e.target.value as Newline)}
          >
            <option value="crlf">CRLF（Excel 向け）</option>
            <option value="lf">LF</option>
          </select>
        </label>
      </div>

      <div className="export__actions">
        <button type="button" className="btn--call" disabled={busy} onClick={() => onExport(encoding, newline)}>
          直したデータを書き出す
        </button>
        <button
          type="button"
          disabled={busy || editState.log.length === 0}
          onClick={() => onExportHistory(encoding)}
        >
          変更履歴を書き出す
          {editState.log.length > 0 && `（${editState.log.length} 操作）`}
        </button>
        {editState.log.length === 0 && (
          <span className="export__note">まだ何も直していないので、履歴は空です。</span>
        )}
      </div>

      {lastExport !== null && (
        <div className={lastExport.unmappable.length > 0 ? 'warnline' : 'export__done'}>
          {lastExport.unmappable.length === 0 ? (
            <>
              書き出しました（{ENCODING_LABEL[lastExport.encoding]}・
              {(lastExport.bytes / 1024).toFixed(0)} KB・{lastExport.ms.toFixed(0)} ms）。
              失われた文字はありません。
            </>
          ) : (
            <>
              <strong>
                {ENCODING_LABEL[lastExport.encoding]} では書けない文字が
                {lastExport.unmappable.length} 種類ありました。
              </strong>
              書き出したファイルでは <code>?</code> になっています。
              <span className="export__chars">
                {lastExport.unmappable.slice(0, 12).map((u, i) => (
                  <span key={i} className="export__char">
                    {u.char}
                    <em>{u.count.toLocaleString()}件</em>
                  </span>
                ))}
                {lastExport.unmappable.length > 12 && <span>ほか</span>}
              </span>
              <span className="export__note">
                残したい場合は、文字コードを UTF-8（BOM付き）にして書き出し直してください。
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
