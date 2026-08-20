import { describe, expect, it } from 'vitest'
import { CLEAN, FIXED, ISSUE, R_AUTO, R_CHOICE, R_NONE, UNCHECKED, cellIndex } from './cell.ts'
import type { MutableTable } from './edit.ts'
import {
  UNDO_LIMIT,
  applyChoice,
  applyOp,
  editCell,
  emptyEditState,
  fixColumn,
  historyRows,
  popUndo,
  pushEdit,
  recentHistoryRows,
  revertOp,
  unifyColumn,
} from './edit.ts'

const AT = '2026-08-21T09:00:00.000Z'

function table(values: string[][], flags?: number[], remedy?: number[]): MutableTable {
  const rowCount = values[0]?.length ?? 0
  return {
    columns: values.map((v, i) => ({ name: `列${i + 1}`, values: [...v] })),
    rowCount,
    flags: new Uint8Array(flags ?? new Array(values.length * rowCount).fill(UNCHECKED)),
    remedy: new Uint8Array(remedy ?? new Array(values.length * rowCount).fill(R_NONE)),
  }
}

describe('セル単位の修正', () => {
  it('値が変わり、直したという状態になる', () => {
    const t = table([['a', 'b']], [ISSUE, CLEAN], [R_AUTO, R_NONE])
    const op = editCell(t, 1, AT, 0, 0, 'A')
    expect(op).not.toBeNull()
    if (op === null) return
    applyOp(t, op)
    expect(t.columns[0]?.values[0]).toBe('A')
    expect(t.flags[0]).toBe(FIXED)
  })

  it('値が変わらないときは、操作を作らない（履歴を汚さない）', () => {
    const t = table([['a']])
    expect(editCell(t, 1, AT, 0, 0, 'a')).toBeNull()
  })
})

describe('取り消し', () => {
  it('値だけでなく、前の状態も戻る', () => {
    // 【重要】ここが CLEAN に戻ると「取り消したら問題が消えた」ことになる。
    const t = table([['a ']], [ISSUE], [R_AUTO])
    const op = editCell(t, 1, AT, 0, 0, 'a')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    expect(t.flags[0]).toBe(FIXED)

    revertOp(t, op)
    expect(t.columns[0]?.values[0]).toBe('a ')
    expect(t.flags[0]).toBe(ISSUE)
    expect(t.remedy?.[0]).toBe(R_AUTO)
  })

  it('未検査だったセルを直して取り消すと、未検査に戻る', () => {
    const t = table([['a']], [UNCHECKED], [R_NONE])
    const op = editCell(t, 1, AT, 0, 0, 'b')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    revertOp(t, op)
    expect(t.flags[0]).toBe(UNCHECKED)
  })
})

describe('列の一括置換（表記揺れの統一）', () => {
  const COL = [
    '株式会社ヤマト商事',
    '(株)ヤマト商事',
    '㈱ヤマト商事',
    'さくら物産株式会社',
    '株式会社ヤマト商事',
  ]

  it('指定した表記だけを、指定した寄せ先へ変える', () => {
    const t = table([COL], new Array(5).fill(ISSUE), new Array(5).fill(R_CHOICE))
    const op = unifyColumn(
      t,
      1,
      AT,
      0,
      new Set(['(株)ヤマト商事', '㈱ヤマト商事']),
      '株式会社ヤマト商事',
      'notation_variant',
    )
    expect(op?.changes.length).toBe(2)
    if (op === null) return
    applyOp(t, op)
    expect(t.columns[0]?.values).toEqual([
      '株式会社ヤマト商事',
      '株式会社ヤマト商事',
      '株式会社ヤマト商事',
      'さくら物産株式会社',
      '株式会社ヤマト商事',
    ])
  })

  it('関係のない値は触らない', () => {
    const t = table([COL])
    const op = unifyColumn(t, 1, AT, 0, new Set(['(株)ヤマト商事']), '株式会社ヤマト商事', 'notation_variant')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    expect(t.columns[0]?.values[3]).toBe('さくら物産株式会社')
  })

  it('一括でも、1件ずつ前の値を持つので全部戻せる', () => {
    const t = table([COL], new Array(5).fill(ISSUE), new Array(5).fill(R_CHOICE))
    const op = unifyColumn(t, 1, AT, 0, new Set(['(株)ヤマト商事', '㈱ヤマト商事']), '株式会社ヤマト商事', 'notation_variant')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    revertOp(t, op)
    expect(t.columns[0]?.values).toEqual(COL)
    expect([...t.flags]).toEqual(new Array(5).fill(ISSUE))
  })

  it('列一括は「人が決めて、列に当てた」と記録される', () => {
    const t = table([COL])
    const op = unifyColumn(t, 1, AT, 0, new Set(['(株)ヤマト商事']), '株式会社ヤマト商事', 'notation_variant')
    expect(op?.by.decidedBy).toBe('human')
    expect(op?.by.scope).toBe('column')
    expect(op?.by.column).toBe(0)
  })
})

describe('列全体の自動修正', () => {
  it('前後の空白を取る。値を決めたのは機械、範囲は列', () => {
    const t = table([[' a ', 'b', '　c　']])
    const op = fixColumn(t, 1, AT, 0, 'trim')
    if (op === null) throw new Error('op')
    expect(op.by.decidedBy).toBe('machine')
    expect(op.by.scope).toBe('column')
    applyOp(t, op)
    expect(t.columns[0]?.values).toEqual(['a', 'b', 'c'])
  })

  it('全角の英数字を半角にする', () => {
    const t = table([['０６-９８７６', 'ヤマト']])
    const op = fixColumn(t, 1, AT, 0, 'halfwidth')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    // 日本語は変えない
    expect(t.columns[0]?.values).toEqual(['06-9876', 'ヤマト'])
  })

  it('直すところが無ければ、操作を作らない', () => {
    const t = table([['a', 'b']])
    expect(fixColumn(t, 1, AT, 0, 'trim')).toBeNull()
  })
})

describe('undo の上限と、履歴の寿命', () => {
  const anOp = (seq: number) => ({
    seq,
    at: AT,
    by: { decidedBy: 'human' as const, scope: 'cell' as const, column: null },
    issue: null,
    label: `操作${seq}`,
    changes: [{ row: 0, col: 0, before: 'a', after: 'b', beforeFlag: CLEAN, beforeRemedy: R_NONE }],
  })

  it('上限を超えると、undo からは落ちる', () => {
    let state = emptyEditState()
    for (let i = 1; i <= UNDO_LIMIT + 10; i++) state = pushEdit(state, anOp(i))
    expect(state.undoStack.length).toBe(UNDO_LIMIT)
    expect(state.droppedFromUndo).toBe(10)
  })

  it('undo から落ちても、履歴には全部残る', () => {
    // 【重要】ここが本題。undo の都合で監査の記録を捨てない。
    let state = emptyEditState()
    for (let i = 1; i <= UNDO_LIMIT + 10; i++) state = pushEdit(state, anOp(i))
    expect(state.log.length).toBe(UNDO_LIMIT + 10)
    expect(state.log[0]?.op.seq).toBe(1)
  })

  it('取り消したことも履歴に残る', () => {
    // 「直したはずが戻っている」にも答えられるようにする。
    let state = pushEdit(emptyEditState(), anOp(1))
    const popped = popUndo(state, AT)
    expect(popped).not.toBeNull()
    if (popped === null) return
    state = popped.state
    expect(state.undoStack.length).toBe(0)
    expect(state.log.length).toBe(2)
    expect(state.log[1]?.action).toBe('undo')
  })

  it('戻すものが無ければ null', () => {
    expect(popUndo(emptyEditState(), AT)).toBeNull()
  })
})

describe('変更履歴の中身', () => {
  it('自動と手動を、行ごとに区別できる', () => {
    const t = table([[' a ', 'x']])
    let state = emptyEditState()

    const auto = fixColumn(t, 1, AT, 0, 'trim')
    if (auto === null) throw new Error('auto')
    applyOp(t, auto)
    state = pushEdit(state, auto)

    const manual = applyChoice(t, 2, AT, 1, 0, 'notation_variant', 'y')
    if (manual === null) throw new Error('manual')
    applyOp(t, manual)
    state = pushEdit(state, manual)

    const rows = historyRows(state, ['取引先名'])
    expect(rows.map((r) => r.decidedBy)).toEqual(['機械', '人'])
    expect(rows.map((r) => r.scope)).toEqual(['列', 'セル'])
  })

  it('取り消しの行は、前と後ろが入れ替わる（実際に起きたことを書く）', () => {
    const t = table([['a']])
    const op = editCell(t, 1, AT, 0, 0, 'b')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    let state = pushEdit(emptyEditState(), op)
    const popped = popUndo(state, AT)
    if (popped === null) throw new Error('undo')
    revertOp(t, popped.op)
    state = popped.state

    const rows = historyRows(state, ['列1'])
    expect(rows[0]).toMatchObject({ action: '修正', before: 'a', after: 'b' })
    expect(rows[1]).toMatchObject({ action: '取り消し', before: 'b', after: 'a' })
  })

  it('どの行・どの列を変えたかが残る', () => {
    const t = table([['a', 'b'], ['c', 'd']])
    const op = editCell(t, 1, AT, 1, 1, 'D')
    if (op === null) throw new Error('op')
    const rows = historyRows(pushEdit(emptyEditState(), op), ['取引先名', '担当者'])
    expect(rows[0]).toMatchObject({ row: 2, columnName: '担当者', before: 'd', after: 'D' })
  })
})

describe('添字の対応', () => {
  it('列指向の添字で、正しいセルが書き換わる', () => {
    const t = table([
      ['a1', 'a2', 'a3'],
      ['b1', 'b2', 'b3'],
    ])
    const op = editCell(t, 1, AT, 2, 1, 'B3')
    if (op === null) throw new Error('op')
    applyOp(t, op)
    expect(t.columns[1]?.values[2]).toBe('B3')
    expect(t.flags[cellIndex(1, 2, 3)]).toBe(FIXED)
    // 別の列は触られていない
    expect(t.flags[cellIndex(0, 2, 3)]).toBe(UNCHECKED)
  })
})

describe('件数は積むときに数える（描画のたびに展開しない）', () => {
  it('列一括でも、件数がすぐ取れる', () => {
    const t = table([Array.from({ length: 1000 }, () => '(株)ヤマト')])
    const op = unifyColumn(t, 1, AT, 0, new Set(['(株)ヤマト']), '株式会社ヤマト', 'notation_variant')
    if (op === null) throw new Error('op')
    const state = pushEdit(emptyEditState(), op)
    expect(state.editedCells).toBe(1000)
    expect(state.undoneCells).toBe(0)
    // log は1件のまま（操作の数）。展開しなくても件数が分かる。
    expect(state.log.length).toBe(1)
  })

  it('取り消すと、取り消した件数が増える', () => {
    const t = table([Array.from({ length: 500 }, () => 'a')])
    const op = unifyColumn(t, 1, AT, 0, new Set(['a']), 'b', 'notation_variant')
    if (op === null) throw new Error('op')
    let state = pushEdit(emptyEditState(), op)
    const popped = popUndo(state, AT)
    if (popped === null) throw new Error('undo')
    state = popped.state
    expect(state.editedCells).toBe(500)
    expect(state.undoneCells).toBe(500)
  })

  it('表示用は、新しいほうから必要な数だけ開く', () => {
    const t = table([Array.from({ length: 1000 }, () => 'a')])
    const op = unifyColumn(t, 1, AT, 0, new Set(['a']), 'b', 'notation_variant')
    if (op === null) throw new Error('op')
    const state = pushEdit(emptyEditState(), op)
    const rows = recentHistoryRows(state, ['列1'], 5)
    expect(rows.length).toBe(5) // 1000件あっても5件しか作らない
    expect(rows[0]?.row).toBe(1000) // 新しい（末尾の）ほうから
  })
})
