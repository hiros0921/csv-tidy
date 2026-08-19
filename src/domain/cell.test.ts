/**
 * 型で何を防いでいるかを、テストとして残す。
 *
 * 【重要】@ts-expect-error を使っている行は「コンパイルが通らないこと」を検査している。
 * 型が緩められて通るようになると、@ts-expect-error 側がエラーになるので気づける。
 * 「型で防いでいます」は、防げなくなったときに壊れる形にしておかないと主張にならない。
 */

import { describe, expect, it } from 'vitest'
import type { CellDetail, CellState } from './cell.ts'
import {
  CLEAN,
  FIXED,
  ISSUE,
  R_AUTO,
  R_CHOICE,
  R_NONE,
  UNCHECKED,
  cellIndex,
  cellState,
  cellView,
} from './cell.ts'
import type { Issue, Remedy } from './issue.ts'
import { applyAuto } from './issue.ts'
import { buildTable, countUnchecked } from './table.ts'

const anIssue: Issue = {
  code: 'trailing_space',
  remedy: { kind: 'auto', to: '山田' },
  note: '末尾に空白があります',
}

describe('「未検査」と「問題なし」が型で分かれている', () => {
  it('読み込んだ直後は、全セルが未検査である', () => {
    const table = buildTable(['a', 'b'], [
      ['1', '2'],
      ['3', '4'],
    ])
    expect(countUnchecked(table)).toBe(4)
    expect(cellState(table.flags, table.details, 0).kind).toBe('unchecked')
  })

  it('clean と unchecked は別の値になる', () => {
    const flags = new Uint8Array([UNCHECKED, CLEAN])
    const details = new Map<number, CellDetail>()
    expect(cellState(flags, details, 0).kind).toBe('unchecked')
    expect(cellState(flags, details, 1).kind).toBe('clean')
  })

  it('範囲外の添字は、clean ではなく unchecked になる', () => {
    // 【重要】ここが clean に倒れると、存在しないセルが「問題なし」として
    // 書き出される。noUncheckedIndexedAccess で undefined が型に出るので、
    // default 節で拾える。
    const flags = new Uint8Array([CLEAN])
    expect(cellState(flags, new Map(), 999).kind).toBe('unchecked')
  })

  it('issue と記録されているのに詳細が無いときは、unchecked に倒す', () => {
    // 握りつぶして clean にすると、問題があったセルが素通りする。
    const flags = new Uint8Array([ISSUE])
    expect(cellState(flags, new Map(), 0).kind).toBe('unchecked')
  })
})

describe('格納は列指向、型は境界で作る', () => {
  it('添字は列ごとに連続する', () => {
    // 3行の表。列0は 0,1,2、列1は 3,4,5。
    expect(cellIndex(0, 0, 3)).toBe(0)
    expect(cellIndex(0, 2, 3)).toBe(2)
    expect(cellIndex(1, 0, 3)).toBe(3)
  })

  it('issue のセルだけが Map に入る（clean は何も持たない）', () => {
    const flags = new Uint8Array([CLEAN, ISSUE, CLEAN])
    const details = new Map<number, CellDetail>([[1, { kind: 'issue', issues: [anIssue] }]])
    expect(details.size).toBe(1)
    expect(cellState(flags, details, 1)).toEqual({ kind: 'issue', issues: [anIssue] })
  })

  it('fixed は、元の値と、誰が直したかを保持する', () => {
    const detail: CellDetail = {
      kind: 'fixed',
      original: '山田 ',
      by: { kind: 'auto' },
      resolved: [anIssue],
      remaining: [],
    }
    const state = cellState(new Uint8Array([FIXED]), new Map([[0, detail]]), 0)
    expect(state.kind).toBe('fixed')
    if (state.kind === 'fixed') {
      expect(state.original).toBe('山田 ')
      expect(state.by.kind).toBe('auto')
    }
  })
})

describe('三分岐が型で守られている', () => {
  it('auto は適用できる', () => {
    expect(applyAuto('山田 ', { kind: 'auto', to: '山田' })).toBe('山田')
  })

  it('choice を自動修正へ渡すコードは、コンパイルが通らない', () => {
    const choice: Remedy = {
      kind: 'choice',
      options: [
        { value: '株式会社ヤマト商事', occurrences: 12 },
        { value: '(株)ヤマト商事', occurrences: 3 },
      ],
    }
    // @ts-expect-error 表記揺れの統一先を機械が決めることは、型が許さない
    expect(() => applyAuto('(株)ヤマト商事', choice)).toBeTruthy()
  })

  it('none も自動修正へ渡せない', () => {
    const none: Remedy = { kind: 'none' }
    // @ts-expect-error 機械には判断できないものを自動で直すことは、型が許さない
    expect(() => applyAuto('999999999', none)).toBeTruthy()
  })
})

describe('CellState の網羅性', () => {
  it('kind を1つ足すと、switch が漏れとして検出される形になっている', () => {
    // never に落ちることで、分岐の書き漏らしがコンパイルエラーになる。
    const describeState = (s: CellState): string => {
      switch (s.kind) {
        case 'unchecked':
          return 'まだ調べていません'
        case 'clean':
          return '問題ありません'
        case 'issue':
          return `${s.issues.length}件の問題`
        case 'fixed':
          return `${s.original} から直しました`
        default: {
          const exhaustive: never = s
          return exhaustive
        }
      }
    }
    expect(describeState({ kind: 'unchecked' })).toContain('まだ')
    expect(describeState({ kind: 'issue', issues: [anIssue] })).toContain('1件')
  })
})

describe('塗るための型（CellView）と、説明するための型（CellState）', () => {
  it('検出後、詳細が手元になくても色は決まる', () => {
    // 説明文は Worker に置いたまま。メインが持つのは2バイトだけ。
    const flags = new Uint8Array([ISSUE, ISSUE, CLEAN, UNCHECKED])
    const remedy = new Uint8Array([R_AUTO, R_CHOICE, R_NONE, R_NONE])
    expect(cellView(flags, remedy, 0)).toEqual({ kind: 'issue', remedy: R_AUTO })
    expect(cellView(flags, remedy, 1)).toEqual({ kind: 'issue', remedy: R_CHOICE })
    expect(cellView(flags, remedy, 2)).toEqual({ kind: 'clean' })
    expect(cellView(flags, remedy, 3)).toEqual({ kind: 'unchecked' })
  })

  it('検出前は、区分が無くても未検査のままになる', () => {
    const flags = new Uint8Array([UNCHECKED, UNCHECKED])
    expect(cellView(flags, null, 0).kind).toBe('unchecked')
  })

  it('範囲外は未検査に倒す（clean にしない）', () => {
    expect(cellView(new Uint8Array([CLEAN]), null, 99).kind).toBe('unchecked')
  })
})
