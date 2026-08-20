/**
 * カーソルを合わせたセルについて、見つかったことと、直す手を出す。
 *
 * 【重要】ここが三分岐の境目になる。
 *   auto   … 「直す」ボタンを出す。値は機械が決めている
 *   choice … 候補を並べる。押すのは人。件数は出すが、印は付けない
 *   none   … 何も出さない。機械には決められない
 */

import { useEffect, useState } from 'react'
import type { FixSource } from '../domain/cell.ts'
import type { ColumnFix } from '../domain/edit.ts'
import type { Issue, IssueCode } from '../domain/issue.ts'
import { visible } from './visible.ts'

const REMEDY_LABEL = {
  auto: '自動で直せる',
  choice: '人が決める',
  none: '検出だけ',
} as const

/** 列全体にまとめて当てられる自動修正。auto の種類ごとに決まっている。 */
const COLUMN_FIX: Partial<Record<IssueCode, { readonly kind: ColumnFix; readonly label: string }>> =
  {
    trailing_space: { kind: 'trim', label: 'この列すべての前後の空白を取る' },
    fullwidth_alnum: { kind: 'halfwidth', label: 'この列すべての全角英数字を半角にする' },
    embedded_newline: { kind: 'newline', label: 'この列すべての改行を空白にする' },
  }

export type Inspect = {
  readonly index: number
  readonly row: number
  readonly col: number
  readonly colName: string
  readonly value: string
  readonly issues: readonly Issue[]
  readonly rowIssue: Issue | null
  /** 直したあとのセルなら、元の値と誰が決めたか。 */
  readonly fixed: { readonly original: string; readonly by: FixSource } | null
  readonly analyzed: boolean
}

type Props = {
  readonly inspect: Inspect | null
  readonly onAutoFix: (row: number, col: number, issue: Issue) => void
  readonly onColumnFix: (col: number, kind: ColumnFix) => void
  readonly onChoose: (row: number, col: number, code: IssueCode, value: string) => void
  readonly onUnify: (col: number, from: readonly string[], to: string, code: IssueCode) => void
  readonly onEdit: (row: number, col: number, value: string) => void
}

export function InspectPanel({ inspect, onAutoFix, onColumnFix, onChoose, onUnify, onEdit }: Props) {
  const [draft, setDraft] = useState('')

  // 別のセルへ移ったら、書きかけを捨てて今の値に合わせる。
  useEffect(() => {
    setDraft(inspect?.value ?? '')
  }, [inspect?.index, inspect?.value])

  if (inspect === null) {
    return (
      <div className="inspect">
        <span className="inspect__idle">
          セルにカーソルを合わせると、そのセルで見つかったことと、直す手が出ます。
        </span>
      </div>
    )
  }

  return (
    <div className="inspect">
      <div className="inspect__head">
        {inspect.row + 1} 行目・{inspect.colName}
        <span className="inspect__val">{visible(inspect.value)}</span>
      </div>

      {inspect.fixed !== null && (
        <div className="inspect__row inspect__row--fixed">
          <span className="inspect__tag">
            直しました（{inspect.fixed.by.decidedBy === 'machine' ? '機械が決定' : '人が決定'}・
            {inspect.fixed.by.scope === 'column' ? '列一括' : 'セル単位'}）
          </span>
          <span>
            元の値：<span className="inspect__was">{visible(inspect.fixed.original)}</span>
          </span>
        </div>
      )}

      {inspect.issues.length === 0 && inspect.rowIssue === null && inspect.fixed === null && (
        <div className="inspect__ok">
          {inspect.analyzed ? '問題は見つかりませんでした' : 'まだ調べていません'}
        </div>
      )}

      {inspect.issues.map((issue, i) => (
        <div key={i} className={`inspect__row inspect__row--${issue.remedy.kind}`}>
          <span className="inspect__tag">{REMEDY_LABEL[issue.remedy.kind]}</span>
          <span>{issue.note}</span>

          {issue.remedy.kind === 'auto' && (
            <span className="inspect__opts">
              <button type="button" onClick={() => onAutoFix(inspect.row, inspect.col, issue)}>
                このセルを直す（→ {visible(issue.remedy.to)}）
              </button>
              {(() => {
                const bulk = COLUMN_FIX[issue.code]
                return bulk === undefined ? null : (
                  <button type="button" onClick={() => onColumnFix(inspect.col, bulk.kind)}>
                    {bulk.label}
                  </button>
                )
              })()}
            </span>
          )}

          {issue.remedy.kind === 'choice' && (
            <span className="inspect__opts">
              {issue.remedy.options.map((o, j) => (
                <span key={j} className="inspect__choice">
                  <button
                    type="button"
                    onClick={() => onChoose(inspect.row, inspect.col, issue.code, o.value)}
                  >
                    {visible(o.value)}
                    {o.occurrences > 0 && (
                      <em className="inspect__cnt">{o.occurrences.toLocaleString()}件</em>
                    )}
                  </button>
                  {/* 表記揺れだけは、列ごと寄せられる。寄せ先を決めるのは人。 */}
                  {issue.code === 'notation_variant' && issue.remedy.kind === 'choice' && (
                    <button
                      type="button"
                      className="btn--sub"
                      onClick={() =>
                        onUnify(
                          inspect.col,
                          issue.remedy.kind === 'choice'
                            ? issue.remedy.options.map((x) => x.value)
                            : [],
                          o.value,
                          issue.code,
                        )
                      }
                    >
                      列ごとこれに統一
                    </button>
                  )}
                </span>
              ))}
            </span>
          )}
        </div>
      ))}

      {inspect.rowIssue !== null && (
        <div className="inspect__row inspect__row--choice">
          <span className="inspect__tag">人が決める</span>
          <span>{inspect.rowIssue.note}</span>
          <span className="inspect__note">
            どちらを残すかは決めません。行の削除は第6段階の書き出しでは扱いません。
          </span>
        </div>
      )}

      <div className="inspect__edit">
        <label>
          このセルを直接書き換える
          <input
            id="cell-value"
            name="cell-value"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEdit(inspect.row, inspect.col, draft)
            }}
          />
        </label>
        <button
          type="button"
          disabled={draft === inspect.value}
          onClick={() => onEdit(inspect.row, inspect.col, draft)}
        >
          この値にする
        </button>
      </div>
    </div>
  )
}
