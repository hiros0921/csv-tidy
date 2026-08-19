/**
 * 第2段階の暫定表示。先頭200行だけを描く。
 *
 * 【重要】これは第3段階で仮想スクロールに置き換える。
 * ここで全行を描かないのは、10万行を素のDOMに載せるとブラウザが固まるためで、
 * 「200行に切っている」ことは画面に明示する。黙って切らない。
 */

import type { Table } from '../domain/table.ts'
import { cellIndex, cellState } from '../domain/cell.ts'

const PREVIEW_ROWS = 200

type Props = { readonly table: Table }

export function PreviewTable({ table }: Props) {
  const shown = Math.min(table.rowCount, PREVIEW_ROWS)
  const rows = Array.from({ length: shown }, (_, r) => r)

  return (
    <div className="preview">
      <div className="preview__note">
        第2段階のため、先頭 {shown.toLocaleString()} 行のみ表示しています（全{' '}
        {table.rowCount.toLocaleString()} 行）。仮想スクロールは第3段階で実装します。
      </div>
      <div className="preview__scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="grid__rownum">#</th>
              {table.columns.map((col, c) => (
                <th key={c}>{col.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td className="grid__rownum">{r + 1}</td>
                {table.columns.map((col, c) => {
                  const state = cellState(
                    table.flags,
                    table.details,
                    cellIndex(c, r, table.rowCount),
                  )
                  return (
                    <td key={c} className={`cell cell--${state.kind}`}>
                      {col.values[r] ?? ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
