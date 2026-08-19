/**
 * 検出のテスト。
 *
 * 【重点】「見つけること」より「余計に見つけないこと」を多く検査する。
 * 誤検出が続くと画面を流し読みされ、本物の問題が見逃される（仕様書4章）。
 */

import { describe, expect, it } from 'vitest'
import { analyzeColumn } from './column.ts'
import { detectCell } from './cell.ts'
import { analyze, dominantRemedy } from './index.ts'
import { normalizeKey, toHalfWidth } from './normalize.ts'
import { readDate, readNumeric, readPhone, readPostal, writeDate } from './shape.ts'
import type { IssueCode } from '../issue.ts'

function codesOf(value: string, column: readonly string[]): readonly IssueCode[] {
  return detectCell(value, analyzeColumn(column)).map((i) => i.code)
}

describe('正規化', () => {
  it('法人格の違いを同じキーにする', () => {
    const keys = ['株式会社ヤマト商事', '(株)ヤマト商事', '㈱ ヤマト商事', '（株）ヤマト商事'].map(
      normalizeKey,
    )
    expect(new Set(keys).size).toBe(1)
  })

  it('別会社を同じキーにしない', () => {
    expect(normalizeKey('株式会社ヤマト商事')).not.toBe(normalizeKey('株式会社ヤマト物産'))
  })

  it('全角英数を半角にするが、日本語は変えない', () => {
    expect(toHalfWidth('０６-９８７６')).toBe('06-9876')
    expect(toHalfWidth('株式会社ヤマト')).toBe('株式会社ヤマト')
  })
})

describe('形の読み取り', () => {
  it('和暦を西暦として読める', () => {
    expect(readDate('令和8年1月25日')?.date).toEqual({ y: 2026, m: 1, d: 25 })
    expect(readDate('平成31年4月30日')?.date).toEqual({ y: 2019, m: 4, d: 30 })
  })

  it('区切り記号の違いを形式として区別する', () => {
    expect(readDate('2026/1/15')?.shape).toBe('slash')
    expect(readDate('2026-01-15')?.shape).toBe('hyphen')
    expect(readDate('2026年1月15日')?.shape).toBe('kanji')
  })

  it('日付でないものを日付にしない', () => {
    expect(readDate('2026/13/45')).toBeNull()
    expect(readDate('12345')).toBeNull()
    expect(readDate('2026/1')).toBeNull()
  })

  it('和暦へ書き戻せる', () => {
    expect(writeDate({ y: 2026, m: 1, d: 25 }, 'wareki')).toBe('令和8年1月25日')
  })

  it('前ゼロを、ただの数字と区別する', () => {
    expect(readNumeric('007')?.shape).toBe('leading_zero')
    expect(readNumeric('7')?.shape).toBe('plain')
  })

  it('桁区切り・通貨・単位を読み分ける', () => {
    expect(readNumeric('12,000')?.shape).toBe('thousands_sep')
    expect(readNumeric('¥8,500')?.shape).toBe('currency')
    expect(readNumeric('3000円')?.shape).toBe('unit')
  })

  it('電話番号をハイフン区切りに直せる', () => {
    expect(readPhone('0312345678')).toBe('03-1234-5678')
    expect(readPhone('03(1234)5678')).toBe('03-1234-5678')
    expect(readPhone('090-1234-5678')).toBe('090-1234-5678')
  })

  it('郵便番号を 123-4567 に直せる', () => {
    expect(readPostal('1000001')).toBe('100-0001')
    expect(readPostal('〒100-0001')).toBe('100-0001')
  })
})

describe('列の見立て（誤検出を抑える要）', () => {
  it('電話番号の列を電話番号と見立てる', () => {
    const col = ['03-1234-5678', '0312345678', '045-111-2222', '011-333-4444']
    expect(analyzeColumn(col).shape).toBe('phone')
  })

  it('郵便番号の列を、電話番号と取り違えない', () => {
    // 7桁の数字は電話番号としても読めてしまう。順番を誤ると取り違える。
    const col = ['100-0001', '1000001', '530-0001', '220-0011']
    expect(analyzeColumn(col).shape).toBe('postal')
  })

  it('ただの数値の列を電話番号の列にしない', () => {
    const col = ['12000', '8500', '3000', '45000']
    expect(analyzeColumn(col).shape).toBe('numeric')
  })

  it('揃っていない列は、どれとも見立てない', () => {
    const col = ['03-1234-5678', 'あいうえお', '2026/1/1', '12,000', 'ABC']
    expect(analyzeColumn(col).shape).toBe('text')
  })
})

describe('余計に検出しないこと', () => {
  it('きれいな値には何も出さない', () => {
    expect(codesOf('ヤマト商事', ['ヤマト商事', 'さくら物産'])).toEqual([])
  })

  it('表記が1種類しかない列では、表記揺れを出さない', () => {
    const col = ['株式会社ヤマト商事', '株式会社ヤマト商事', '株式会社さくら物産']
    expect(codesOf('株式会社ヤマト商事', col)).not.toContain('notation_variant')
  })

  it('法人格を含まない語では、表記揺れを見ない', () => {
    // 一般の語まで見ると、別語を同一視する事故が起きる。
    const col = ['みどり工業', 'みどり 工業', 'あおぞら商店']
    expect(codesOf('みどり工業', col)).not.toContain('notation_variant')
  })

  it('数値の列で、前ゼロのない普通の数値は指摘しない', () => {
    const col = ['100', '200', '300']
    expect(codesOf('100', col)).toEqual([])
  })

  it('日付の列で、多数派と同じ形式なら指摘しない', () => {
    const col = ['2026/1/1', '2026/2/1', '2026/3/1', '2026-04-01']
    expect(codesOf('2026/2/1', col)).not.toContain('date_format_mixed')
  })

  it('桁数が少し多いだけでは、異常値としない', () => {
    const col = ['100', '200', '3000']
    expect(codesOf('3000', col)).not.toContain('outlier_suspected')
  })
})

describe('検出できること', () => {
  it('末尾の空白（自動で直す）', () => {
    const issues = detectCell('佐藤 花子 ', analyzeColumn(['佐藤 花子 ', '田中 一郎']))
    const issue = issues.find((i) => i.code === 'trailing_space')
    expect(issue?.remedy.kind).toBe('auto')
    if (issue?.remedy.kind === 'auto') expect(issue.remedy.to).toBe('佐藤 花子')
  })

  it('全角の英数字（自動で直す）', () => {
    const col = ['06-9876-5432', '０６-９８７６-５４３２', '045-111-2222', '011-333-4444']
    const issue = detectCell('０６-９８７６-５４３２', analyzeColumn(col)).find(
      (i) => i.code === 'fullwidth_alnum',
    )
    expect(issue?.remedy.kind).toBe('auto')
  })

  it('表記揺れ（人が決める。件数は出すが、寄せ先は決めない）', () => {
    const col = [
      '株式会社ヤマト商事',
      '株式会社ヤマト商事',
      '(株)ヤマト商事',
      '㈱ヤマト商事',
      'さくら物産株式会社',
    ]
    const issue = detectCell('(株)ヤマト商事', analyzeColumn(col)).find(
      (i) => i.code === 'notation_variant',
    )
    expect(issue?.remedy.kind).toBe('choice')
    if (issue?.remedy.kind === 'choice') {
      // 3通りの表記と、その件数が並ぶ
      expect(issue.remedy.options.length).toBe(3)
      expect(issue.remedy.options.map((o) => o.occurrences).reduce((a, b) => a + b, 0)).toBe(4)
    }
    // 【重要】どれが推奨かを示す情報を持たない
    expect(JSON.stringify(issue)).not.toMatch(/推奨|おすすめ|recommended/)
  })

  it('和暦は choice にする（自動変換しない）', () => {
    const col = ['2026/1/15', '2026/2/1', '2026/3/3', '令和8年1月25日']
    const issue = detectCell('令和8年1月25日', analyzeColumn(col)).find(
      (i) => i.code === 'date_format_mixed',
    )
    // 変換規則は一意だが、元が和暦だった事実は失われる。だから人が決める。
    expect(issue?.remedy.kind).toBe('choice')
  })

  it('前ゼロは choice にする（自動で数値に直さない）', () => {
    const col = ['007', '015', '023', '101', '102']
    const issue = detectCell('007', analyzeColumn(col)).find((i) => i.code === 'numeric_as_text')
    expect(issue?.remedy.kind).toBe('choice')
  })

  it('文字化けは検出だけ（直す対象ではない）', () => {
    const issue = detectCell('��社', analyzeColumn(['��社', 'ヤマト'])).find(
      (i) => i.code === 'mojibake_suspected',
    )
    expect(issue?.remedy.kind).toBe('none')
  })
})

describe('行の重複', () => {
  it('完全一致の行を、どちらも印を付けて返す', () => {
    const columns = [
      ['a', 'b', 'a'],
      ['1', '2', '1'],
    ]
    const result = analyze(columns, 3)
    expect(result.rowIssues.size).toBe(2)
    expect(result.rowIssues.has(0)).toBe(true)
    expect(result.rowIssues.has(2)).toBe(true)
    // どちらを残すかは決めない
    expect(result.rowIssues.get(0)?.remedy.kind).toBe('choice')
  })

  it('全部空の行は重複としない', () => {
    const columns = [
      ['', ''],
      ['', ''],
    ]
    expect(analyze(columns, 2).rowIssues.size).toBe(0)
  })
})

describe('三分岐の寄せ方', () => {
  it('人が決めるものが1つでもあれば、そちらに寄せる', () => {
    expect(
      dominantRemedy([
        { code: 'trailing_space', remedy: { kind: 'auto', to: 'x' }, note: '' },
        { code: 'notation_variant', remedy: { kind: 'choice', options: [{ value: 'a', occurrences: 1 }] }, note: '' },
      ]),
    ).toBe('choice')
  })

  it('自動で直せるものだけなら auto', () => {
    expect(
      dominantRemedy([{ code: 'trailing_space', remedy: { kind: 'auto', to: 'x' }, note: '' }]),
    ).toBe('auto')
  })
})

describe('検査したことが型に出る', () => {
  it('検出後は、問題のないセルが clean になる（unchecked のままにしない）', () => {
    const result = analyze([['a', 'b']], 2)
    expect([...result.flags]).toEqual([1, 1]) // CLEAN
  })

  it('問題のあるセルだけが Map に入る', () => {
    const result = analyze([['a ', 'b']], 2)
    expect(result.details.size).toBe(1)
    expect(result.details.has(0)).toBe(true)
  })
})
