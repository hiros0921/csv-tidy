import { describe, expect, it } from 'vitest'
import { buildTable } from '../domain/table.ts'
import { computeWidths } from './widths.ts'

function widthsOf(header: string[], rows: string[][]): readonly number[] {
  return computeWidths(buildTable(header, rows))
}

describe('列幅の概算', () => {
  it('日本語の列は、同じ文字数の英数より広くなる', () => {
    const [ja, en] = widthsOf(['a', 'b'], [['取引先名称', 'ABCDE']])
    expect(ja).toBeGreaterThan(en ?? 0)
  })

  it('見出しのほうが長ければ、見出しに合わせる', () => {
    const [w] = widthsOf(['とても長い見出しの列'], [['1']])
    const [narrow] = widthsOf(['x'], [['1']])
    expect(w).toBeGreaterThan(narrow ?? 0)
  })

  it('極端に長い値でも、上限で止まる', () => {
    const [w] = widthsOf(['x'], [['あ'.repeat(500)]])
    expect(w).toBeLessThanOrEqual(340)
  })

  it('空の列でも、下限を下回らない', () => {
    const [w] = widthsOf([''], [['']])
    expect(w).toBeGreaterThanOrEqual(72)
  })

  it('先頭200行までしか見ない（10万行を測りに行かない）', () => {
    // 201行目に長い値を置いても、幅は広がらない。
    const rows = Array.from({ length: 300 }, (_, i) => [i === 250 ? 'あ'.repeat(100) : 'a'])
    const [w] = widthsOf(['x'], rows)
    const [base] = widthsOf(['x'], [['a']])
    expect(w).toBe(base)
  })
})
