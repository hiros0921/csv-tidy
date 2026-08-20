/**
 * 変更履歴。仕様書7章「何を直したかの一覧を出せるようにしてください」。
 *
 * 【重要】undo で戻せる件数と、履歴の件数は違う。
 * undo には上限があり、古いものから落ちる。履歴は落ちない。
 * 画面でも、その2つを別の数として出す。
 */

import type { EditState } from '../domain/edit.ts'
import { UNDO_LIMIT, recentHistoryRows } from '../domain/edit.ts'
import { visible } from './visible.ts'

const SHOW = 12

type Props = {
  readonly state: EditState
  readonly columnNames: readonly string[]
}

export function HistoryPanel({ state, columnNames }: Props) {
  // 【重要】ここで全件を開かない。列一括は1操作で数万件を持つ。
  // 件数は積むときに数えてあるので、表示するぶんだけ開けばよい。
  const recent = recentHistoryRows(state, columnNames, SHOW)
  const edited = state.editedCells
  const undone = state.undoneCells

  if (state.log.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">変更履歴</div>
        <p className="panel__note">まだ何も直していません。</p>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel__title">変更履歴</div>
      <p className="panel__note">
        操作 <strong>{state.log.length.toLocaleString()}</strong> 回、
        のべ <strong>{edited.toLocaleString()}</strong> セルを修正
        {undone > 0 && <>（うち {undone.toLocaleString()} セルは取り消し済み）</>}。
        <span className="panel__sub">
          この記録は捨てません。取り消したことも残します。第6段階で書き出せるようにします。
        </span>
      </p>

      <div className="panel__scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>操作</th>
              <th>決めたのは</th>
              <th>範囲</th>
              <th className="tbl--num">行</th>
              <th>列</th>
              <th>前</th>
              <th>後</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r, i) => (
              <tr key={i} className={r.action === '取り消し' ? 'tbl--undone' : ''}>
                <td>{r.action}</td>
                <td>{r.decidedBy}</td>
                <td>{r.scope}</td>
                <td className="tbl--num">{r.row.toLocaleString()}</td>
                <td>{r.columnName}</td>
                <td className="tbl--was">{visible(r.before)}</td>
                <td>{visible(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edited + undone > SHOW && (
        <p className="panel__sub">
          直近 {SHOW} 件だけ表示しています（全 {(edited + undone).toLocaleString()} 件）。
        </p>
      )}
      {state.droppedFromUndo > 0 && (
        <p className="warnline">
          取り消せるのは直近 {UNDO_LIMIT} 操作までです。
          <strong>{state.droppedFromUndo.toLocaleString()} 操作</strong>
          は、もう取り消せません（記録には残っています）。
        </p>
      )}
    </div>
  )
}
