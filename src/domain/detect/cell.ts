/**
 * 1つのセルを見る。列の性格（ColumnStats）を物差しにする。
 *
 * 三分岐は、ここで Remedy として付ける（仕様書4章）。
 *   auto   … 迷う余地がない
 *   choice … 正解が1つに決まらない。候補と件数を出すが、寄せ先は決めない
 *   none   … 機械には判断できない
 */

import type { Candidate, Issue, NonEmpty } from '../issue.ts'
import type { ColumnStats } from './column.ts'
import { hasFullWidthAlnum, normalizeKey, spacePosition, toHalfWidth, trimBoth } from './normalize.ts'
import {
  DATE_SHAPE_LABEL,
  NUMERIC_SHAPE_LABEL,
  readDate,
  readNumeric,
  readPhone,
  readPostal,
  writeDate,
} from './shape.ts'

const SPACE_LABEL = { lead: '先頭', trail: '末尾', both: '先頭と末尾' } as const

export function detectCell(raw: string, stats: ColumnStats): readonly Issue[] {
  const issues: Issue[] = []

  // ---- 空欄（検出だけ。埋めるかどうかは機械の判断ではない） ----
  if (trimBoth(raw) === '') {
    if (stats.emptyRate < 1) {
      issues.push({
        code: 'empty',
        remedy: { kind: 'none' },
        note: `空欄です（この列の空欄率 ${(stats.emptyRate * 100).toFixed(1)}%）`,
      })
    }
    return issues
  }

  // ---- 文字化けの疑い（検出だけ。直すのは文字コードの選び直し） ----
  if (raw.includes('�')) {
    issues.push({
      code: 'mojibake_suspected',
      remedy: { kind: 'none' },
      note: '読めない文字があります。文字コードの選択を変えると直るかもしれません',
    })
  }

  // ---- 先頭・末尾の空白（自動で直す） ----
  const pos = spacePosition(raw)
  if (pos !== null) {
    issues.push({
      code: 'trailing_space',
      remedy: { kind: 'auto', to: trimBoth(raw) },
      note: `${SPACE_LABEL[pos]}に空白があります`,
    })
  }

  // ---- セル内の改行（自動で直す） ----
  const newlines = (raw.match(/\r\n|\r|\n/g) ?? []).length
  if (newlines > 0) {
    issues.push({
      code: 'embedded_newline',
      remedy: { kind: 'auto', to: raw.replace(/\r\n|\r|\n/g, ' ') },
      note: `セルの中に改行が ${newlines} 個あります`,
    })
  }

  const v = trimBoth(raw)

  // ---- 全角の英数字（自動で直す） ----
  if (hasFullWidthAlnum(v)) {
    issues.push({
      code: 'fullwidth_alnum',
      remedy: { kind: 'auto', to: toHalfWidth(v) },
      note: '全角の英数字が混ざっています',
    })
  }

  // ---- 以降は、列の性格で分かれる ----
  switch (stats.shape) {
    case 'phone': {
      const normalized = readPhone(v)
      if (normalized === null) {
        issues.push({
          code: 'phone_format',
          remedy: { kind: 'none' },
          note: '電話番号の列ですが、電話番号として読めません',
        })
      } else if (normalized !== v) {
        issues.push({
          code: 'phone_format',
          remedy: {
            kind: 'choice',
            options: [
              { value: v, occurrences: 0 },
              { value: normalized, occurrences: 0 },
            ],
          },
          note: '電話番号の書き方がそろっていません',
        })
      }
      break
    }

    case 'postal': {
      const normalized = readPostal(v)
      if (normalized === null) {
        issues.push({
          code: 'postal_format',
          remedy: { kind: 'none' },
          note: '郵便番号の列ですが、郵便番号として読めません',
        })
      } else if (normalized !== v) {
        issues.push({
          code: 'postal_format',
          remedy: {
            kind: 'choice',
            options: [
              { value: v, occurrences: 0 },
              { value: normalized, occurrences: 0 },
            ],
          },
          note: '郵便番号の書き方がそろっていません',
        })
      }
      break
    }

    case 'date': {
      const parsed = readDate(v)
      if (parsed === null) {
        issues.push({
          code: 'date_format_mixed',
          remedy: { kind: 'none' },
          note: '日付の列ですが、日付として読めません',
        })
      } else if (stats.majorityDateShape !== null && parsed.shape !== stats.majorityDateShape) {
        const majority = stats.majorityDateShape
        // 【重要】寄せ先は決めない。候補と、その形式が列に何件あるかを並べるだけ。
        // 和暦は西暦へ一意に直せるが、元が和暦だった事実は失われる。
        // 公文書や契約書の転記では、和暦のままである必要がある（仕様書4章）。
        issues.push({
          code: 'date_format_mixed',
          remedy: {
            kind: 'choice',
            options: [
              { value: v, occurrences: stats.dateShapes.get(parsed.shape) ?? 0 },
              {
                value: writeDate(parsed.date, majority),
                occurrences: stats.dateShapes.get(majority) ?? 0,
              },
            ],
          },
          note: `この列では ${DATE_SHAPE_LABEL[majority]} の形が多数です（いまは ${DATE_SHAPE_LABEL[parsed.shape]}）`,
        })
      }
      break
    }

    case 'numeric': {
      const n = readNumeric(v)
      if (n !== null && n.shape !== 'plain') {
        // 【重要】前ゼロを数値に直すと 007 が 7 になる。商品コードが壊れる。
        // だから choice。自動では直さない。
        issues.push({
          code: 'numeric_as_text',
          remedy: {
            kind: 'choice',
            options: [
              { value: v, occurrences: stats.numericShapes.get(n.shape) ?? 0 },
              { value: String(n.value), occurrences: stats.numericShapes.get('plain') ?? 0 },
            ],
          },
          note: `数値に見えますが文字列です（${NUMERIC_SHAPE_LABEL[n.shape]}）`,
        })
      }
      // 桁数が列の中央値より3桁以上多い＝異常値の疑い。網は狭くしてある。
      if (n !== null && stats.medianDigits !== null) {
        const digits = Math.abs(Math.trunc(n.value)).toString().length
        if (digits >= stats.medianDigits + 3) {
          issues.push({
            code: 'outlier_suspected',
            remedy: { kind: 'none' },
            note: `桁数が他より多いです（この列の中央値 ${stats.medianDigits} 桁に対して ${digits} 桁）`,
          })
        }
      }
      break
    }

    case 'text': {
      const group = stats.notation.get(normalizeKey(v))
      if (group !== undefined && group.variants.length >= 2) {
        const head = group.variants[0]
        if (head !== undefined) {
          const options: NonEmpty<Candidate> = [
            { value: head.value, occurrences: head.occurrences },
            ...group.variants.slice(1).map((x) => ({ value: x.value, occurrences: x.occurrences })),
          ]
          issues.push({
            code: 'notation_variant',
            remedy: { kind: 'choice', options },
            // 【重要】多数派に印は付けない。件数は事実、推奨は判断（仕様書4章）。
            note: `同じ相手が ${group.variants.length} 通りの書き方で入っています`,
          })
        }
      }
      break
    }
  }

  return issues
}
