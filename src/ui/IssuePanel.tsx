/**
 * 検出結果のまとめ。三分岐がひと目で分かることを主にする。
 *
 * 【重要】多数派に印を付けない。件数は出す（仕様書4章の線引き）。
 * ここに出るのは「何件あったか」という事実だけで、
 * 「どれに寄せるべきか」は一切出さない。
 */

import type { Summary } from '../domain/detect/index.ts'
import type { IssueCode } from '../domain/issue.ts'

const CODE_LABEL: Readonly<Record<IssueCode, string>> = {
  trailing_space: '先頭・末尾の空白',
  embedded_newline: 'セル内の改行',
  fullwidth_alnum: '全角の英数字',
  notation_variant: '表記揺れ',
  duplicate_row: '重複行',
  empty: '空欄',
  date_format_mixed: '日付の形式ちがい',
  numeric_as_text: '数値に見える文字列',
  phone_format: '電話番号の形式',
  postal_format: '郵便番号の形式',
  outlier_suspected: '異常値の疑い',
  mojibake_suspected: '文字化けの疑い',
}

const SHAPE_LABEL: Readonly<Record<string, string>> = {
  phone: '電話番号',
  postal: '郵便番号',
  date: '日付',
  numeric: '数値',
  text: '文字列',
}

type Props = {
  readonly summary: Summary
  readonly columnNames: readonly string[]
}

export function IssuePanel({ summary, columnNames }: Props) {
  const codes = Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])

  return (
    <div className="panel">
      <div className="panel__three">
        <div className="three three--auto">
          <div className="three__n">{summary.byRemedy.auto.toLocaleString()}</div>
          <div className="three__t">自動で直せる</div>
          <div className="three__d">迷う余地がないもの</div>
        </div>
        <div className="three three--choice">
          <div className="three__n">{summary.byRemedy.choice.toLocaleString()}</div>
          <div className="three__t">人が決める</div>
          <div className="three__d">正解が1つに決まらないもの</div>
        </div>
        <div className="three three--none">
          <div className="three__n">{summary.byRemedy.none.toLocaleString()}</div>
          <div className="three__t">検出だけ</div>
          <div className="three__d">機械には判断できないもの</div>
        </div>
      </div>

      <p className="panel__note">
        検査したセル {summary.checkedCells.toLocaleString()} 個のうち、問題があったのは{' '}
        <strong>{summary.issueCells.toLocaleString()}</strong> 個。
        重複していた行は <strong>{summary.duplicateRows.toLocaleString()}</strong> 行。
      </p>

      <div className="panel__cols">
        <table className="tbl">
          <thead>
            <tr>
              <th>種別</th>
              <th className="tbl--num">件数</th>
            </tr>
          </thead>
          <tbody>
            {codes.map(([code, n]) => (
              <tr key={code}>
                <td>{CODE_LABEL[code as IssueCode] ?? code}</td>
                <td className="tbl--num">{n.toLocaleString()}</td>
              </tr>
            ))}
            {codes.length === 0 && (
              <tr>
                <td colSpan={2}>問題は見つかりませんでした</td>
              </tr>
            )}
          </tbody>
        </table>

        <table className="tbl">
          <thead>
            <tr>
              <th>列</th>
              <th>見立て</th>
              <th className="tbl--num">空欄率</th>
            </tr>
          </thead>
          <tbody>
            {columnNames.map((name, i) => (
              <tr key={i}>
                <td>{name}</td>
                <td>{SHAPE_LABEL[summary.columnShapes[i] ?? ''] ?? '—'}</td>
                <td className="tbl--num">
                  {((summary.emptyRates[i] ?? 0) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="panel__why">
        <strong>列の「見立て」は、誤検出を抑えるためにあります。</strong>
        1つの値だけを見て「電話番号の形が違う」とは言えません。
        列全体を見てその列が何の列かを決めてから、個々の値をその基準で見ています。
      </p>
    </div>
  )
}
