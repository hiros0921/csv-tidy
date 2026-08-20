/**
 * 修正と、その記録。仕様書7章。
 *
 * 【この段の要点】undo と 変更履歴を、別のものとして扱う。
 *
 *   undo     … 作業のやり直し。上限があり、古いものから捨てる
 *   変更履歴 … 監査のための記録。捨てない。取り消したことも残す
 *
 * 同じ操作（EditOp）を両方が参照するが、寿命が違う。
 * 「勝手に直された」と言われない状態を作るのが履歴の目的なので、
 * undo の都合で履歴を捨ててはいけない。
 * 逆に「直したはずが戻っている」も起きるので、取り消しも記録に残す。
 */

import type { FixSource } from './cell.ts'
import { CLEAN, FIXED, R_NONE, UNCHECKED, cellIndex } from './cell.ts'
import type { Issue, IssueCode } from './issue.ts'
import { toHalfWidth, trimBoth } from './detect/normalize.ts'

/**
 * 変更1件。
 *
 * 【重要】前の値だけでなく、前の「状態」も持つ。
 * これが無いと、取り消したときにセルの色を元へ戻せない。
 * 「直した」を取り消したら「問題あり」に戻るべきで、
 * 「問題なし」になってはいけない。
 */
export type CellChange = {
  readonly row: number
  readonly col: number
  readonly before: string
  readonly after: string
  readonly beforeFlag: number
  readonly beforeRemedy: number
}

/** 1回の操作。undo はこの単位で戻す。 */
export type EditOp = {
  readonly seq: number
  readonly at: string
  readonly by: FixSource
  /** どの問題を直したか。手で書き換えただけなら null。 */
  readonly issue: IssueCode | null
  /** 画面と履歴に出す説明。 */
  readonly label: string
  readonly changes: readonly CellChange[]
}

/** 履歴の1行。操作そのものと、それが適用か取り消しか。 */
export type LogEntry = {
  readonly op: EditOp
  readonly action: 'edit' | 'undo'
  readonly at: string
}

/** 書き換えられる表。値の配列は、読み込み時に作ったものと同じ実体を指す。 */
export type MutableTable = {
  readonly columns: readonly { readonly name: string; readonly values: string[] }[]
  readonly rowCount: number
  readonly flags: Uint8Array
  readonly remedy: Uint8Array | null
}

/**
 * undo に積んでおく上限。
 *
 * 【重要】上限を超えたら古いものから捨てる。捨てたことは画面に出す。
 * 黙って戻せなくなるのが、いちばん困る。
 */
export const UNDO_LIMIT = 50

export type EditState = {
  /** 追記のみ。捨てない。 */
  readonly log: readonly LogEntry[]
  /** 戻せる操作。新しいものが末尾。上限あり。 */
  readonly undoStack: readonly EditOp[]
  /** 上限を超えて捨てた件数。 */
  readonly droppedFromUndo: number
  readonly nextSeq: number
  /**
   * 直したセルの延べ数と、取り消した延べ数。
   *
   * 【重要】数えるために log を展開しない。
   * 列一括は1操作で3万件を持つので、画面を描くたびに展開すると
   * そこで数十ミリ秒止まる（実測で 62ms）。積むときに足しておく。
   */
  readonly editedCells: number
  readonly undoneCells: number
}

export function emptyEditState(): EditState {
  return {
    log: [],
    undoStack: [],
    droppedFromUndo: 0,
    nextSeq: 1,
    editedCells: 0,
    undoneCells: 0,
  }
}

/** 操作を積む。上限を超えたぶんは undo からだけ落ちる（履歴には残る）。 */
export function pushEdit(state: EditState, op: EditOp): EditState {
  const stack = [...state.undoStack, op]
  const over = Math.max(0, stack.length - UNDO_LIMIT)
  return {
    log: [...state.log, { op, action: 'edit', at: op.at }],
    undoStack: over > 0 ? stack.slice(over) : stack,
    droppedFromUndo: state.droppedFromUndo + over,
    nextSeq: Math.max(state.nextSeq, op.seq + 1),
    editedCells: state.editedCells + op.changes.length,
    undoneCells: state.undoneCells,
  }
}

/** いちばん新しい操作を取り出す。取り消したことも履歴に残す。 */
export function popUndo(state: EditState, at: string): { state: EditState; op: EditOp } | null {
  const op = state.undoStack[state.undoStack.length - 1]
  if (op === undefined) return null
  return {
    op,
    state: {
      log: [...state.log, { op, action: 'undo', at }],
      undoStack: state.undoStack.slice(0, -1),
      droppedFromUndo: state.droppedFromUndo,
      nextSeq: state.nextSeq,
      editedCells: state.editedCells,
      undoneCells: state.undoneCells + op.changes.length,
    },
  }
}

// ---------------------------------------------------------------- 適用

/** 操作を表に適用する。直したセルは「直した」状態になる。 */
export function applyOp(table: MutableTable, op: EditOp): void {
  for (const ch of op.changes) {
    const values = table.columns[ch.col]?.values
    if (values === undefined) continue
    values[ch.row] = ch.after
    const index = cellIndex(ch.col, ch.row, table.rowCount)
    table.flags[index] = FIXED
    if (table.remedy !== null) table.remedy[index] = R_NONE
  }
}

/**
 * 操作を取り消す。値だけでなく、状態も元へ戻す。
 *
 * 【重要】状態を CLEAN に戻してはいけない。
 * 問題があったセルを直して、それを取り消したなら、問題ありに戻るのが正しい。
 * ここを雑にすると「取り消したら問題が消えた」ことになる。
 */
export function revertOp(table: MutableTable, op: EditOp): void {
  for (const ch of op.changes) {
    const values = table.columns[ch.col]?.values
    if (values === undefined) continue
    values[ch.row] = ch.before
    const index = cellIndex(ch.col, ch.row, table.rowCount)
    table.flags[index] = ch.beforeFlag
    if (table.remedy !== null) table.remedy[index] = ch.beforeRemedy
  }
}

// ---------------------------------------------------------------- 操作を組み立てる

function snapshot(table: MutableTable, row: number, col: number, after: string): CellChange | null {
  const before = table.columns[col]?.values[row]
  if (before === undefined || before === after) return null // 変化がなければ記録しない
  const index = cellIndex(col, row, table.rowCount)
  return {
    row,
    col,
    before,
    after,
    beforeFlag: table.flags[index] ?? UNCHECKED,
    beforeRemedy: table.remedy?.[index] ?? R_NONE,
  }
}

const HUMAN_CELL: FixSource = { decidedBy: 'human', scope: 'cell', column: null }
const MACHINE_CELL: FixSource = { decidedBy: 'machine', scope: 'cell', column: null }

function op(
  seq: number,
  at: string,
  by: FixSource,
  issue: IssueCode | null,
  label: string,
  changes: readonly CellChange[],
): EditOp | null {
  return changes.length === 0 ? null : { seq, at, by, issue, label, changes }
}

/** セル1つを、人が書き換える。 */
export function editCell(
  table: MutableTable,
  seq: number,
  at: string,
  row: number,
  col: number,
  after: string,
): EditOp | null {
  const change = snapshot(table, row, col, after)
  if (change === null) return null
  const name = table.columns[col]?.name ?? `列${col + 1}`
  return op(seq, at, HUMAN_CELL, null, `${row + 1}行目「${name}」を書き換え`, [change])
}

/**
 * セル1つに、自動修正を当てる。
 *
 * 【重要】受け取れるのは auto の Remedy だけ。
 * choice を渡すコードはコンパイルが通らない（issue.ts の applyAuto と同じ仕掛け）。
 */
export function applyAutoFix(
  table: MutableTable,
  seq: number,
  at: string,
  row: number,
  col: number,
  issue: Issue & { readonly remedy: { readonly kind: 'auto'; readonly to: string } },
): EditOp | null {
  const change = snapshot(table, row, col, issue.remedy.to)
  if (change === null) return null
  const name = table.columns[col]?.name ?? `列${col + 1}`
  return op(seq, at, MACHINE_CELL, issue.code, `${row + 1}行目「${name}」を自動で修正`, [change])
}

/** セル1つに、人が選んだ候補を当てる。 */
export function applyChoice(
  table: MutableTable,
  seq: number,
  at: string,
  row: number,
  col: number,
  code: IssueCode,
  value: string,
): EditOp | null {
  const change = snapshot(table, row, col, value)
  if (change === null) return null
  const name = table.columns[col]?.name ?? `列${col + 1}`
  return op(seq, at, HUMAN_CELL, code, `${row + 1}行目「${name}」を選んだ値に変更`, [change])
}

/**
 * 列の中で、指定した値をすべて置き換える（表記揺れの統一）。
 *
 * 【重要】寄せ先は引数で受け取る。この関数は決めない（仕様書4章）。
 * 実測で10万行の列1本の走査は 2.3ms。メインスレッドで足りる。
 */
export function unifyColumn(
  table: MutableTable,
  seq: number,
  at: string,
  col: number,
  from: ReadonlySet<string>,
  to: string,
  code: IssueCode,
): EditOp | null {
  const values = table.columns[col]?.values
  if (values === undefined) return null
  const changes: CellChange[] = []
  for (let r = 0; r < table.rowCount; r++) {
    const v = values[r]
    if (v === undefined || v === to || !from.has(v)) continue
    const change = snapshot(table, r, col, to)
    if (change !== null) changes.push(change)
  }
  const name = table.columns[col]?.name ?? `列${col + 1}`
  return op(
    seq,
    at,
    { decidedBy: 'human', scope: 'column', column: col },
    code,
    `「${name}」列を「${to}」に統一（${changes.length.toLocaleString()}件）`,
    changes,
  )
}

/** 列全体に、機械が決められる直し方をまとめて当てる。 */
export type ColumnFix = 'trim' | 'halfwidth' | 'newline'

const COLUMN_FIX_LABEL: Readonly<Record<ColumnFix, string>> = {
  trim: '前後の空白を取る',
  halfwidth: '全角の英数字を半角にする',
  newline: 'セル内の改行を空白にする',
}

const COLUMN_FIX_CODE: Readonly<Record<ColumnFix, IssueCode>> = {
  trim: 'trailing_space',
  halfwidth: 'fullwidth_alnum',
  newline: 'embedded_newline',
}

function fixValue(kind: ColumnFix, value: string): string {
  switch (kind) {
    case 'trim':
      return trimBoth(value)
    case 'halfwidth':
      return toHalfWidth(value)
    case 'newline':
      return value.replace(/\r\n|\r|\n/g, ' ')
  }
}

export function fixColumn(
  table: MutableTable,
  seq: number,
  at: string,
  col: number,
  kind: ColumnFix,
): EditOp | null {
  const values = table.columns[col]?.values
  if (values === undefined) return null
  const changes: CellChange[] = []
  for (let r = 0; r < table.rowCount; r++) {
    const v = values[r]
    if (v === undefined) continue
    const change = snapshot(table, r, col, fixValue(kind, v))
    if (change !== null) changes.push(change)
  }
  const name = table.columns[col]?.name ?? `列${col + 1}`
  return op(
    seq,
    at,
    // 【重要】値を決めたのは機械。範囲は列。2つの軸は別。
    { decidedBy: 'machine', scope: 'column', column: col },
    COLUMN_FIX_CODE[kind],
    `「${name}」列の${COLUMN_FIX_LABEL[kind]}（${changes.length.toLocaleString()}件）`,
    changes,
  )
}

// ---------------------------------------------------------------- 履歴の書き出し用

export type HistoryRow = {
  readonly seq: number
  readonly at: string
  readonly action: '修正' | '取り消し'
  readonly decidedBy: '機械' | '人'
  readonly scope: 'セル' | '列'
  readonly row: number
  readonly columnName: string
  readonly before: string
  readonly after: string
  readonly issue: string
}

/**
 * 履歴を、1変更＝1行の形に開く。第6段階でこれを CSV にする。
 *
 * 【重要】画面の表示にこれを使わない。列一括は1操作で数万件を持つので、
 * 描画のたびに全部を開くと止まる。画面には recentHistoryRows を使う。
 */
export function historyRows(
  state: EditState,
  columnNames: readonly string[],
): readonly HistoryRow[] {
  const out: HistoryRow[] = []
  for (const entry of state.log) {
    for (const ch of entry.op.changes) {
      // 取り消しの行では、前と後ろが入れ替わる。実際に起きたことをそのまま書く。
      const undone = entry.action === 'undo'
      out.push({
        seq: entry.op.seq,
        at: entry.at,
        action: undone ? '取り消し' : '修正',
        decidedBy: entry.op.by.decidedBy === 'machine' ? '機械' : '人',
        scope: entry.op.by.scope === 'column' ? '列' : 'セル',
        row: ch.row + 1,
        columnName: columnNames[ch.col] ?? `列${ch.col + 1}`,
        before: undone ? ch.after : ch.before,
        after: undone ? ch.before : ch.after,
        issue: entry.op.issue ?? '',
      })
    }
  }
  return out
}

/** 直したセルの詳細。CellState を組み立てるために持っておく。 */
export function fixedDetail(
  original: string,
  by: FixSource,
  resolved: readonly Issue[],
): { readonly kind: 'fixed'; readonly original: string; readonly by: FixSource; readonly resolved: readonly [Issue, ...Issue[]]; readonly remaining: readonly Issue[] } | null {
  const head = resolved[0]
  if (head === undefined) return null
  return { kind: 'fixed', original, by, resolved: [head, ...resolved.slice(1)], remaining: [] }
}

/** 直したセルを、検査済み（問題なし）として数え直すための補助。 */
export function markClean(table: MutableTable, row: number, col: number): void {
  const index = cellIndex(col, row, table.rowCount)
  table.flags[index] = CLEAN
}

/**
 * 新しいほうから、表示するぶんだけ開く。
 *
 * 全部を開かないので、3万件の一括操作があっても画面は重くならない。
 */
export function recentHistoryRows(
  state: EditState,
  columnNames: readonly string[],
  limit: number,
): readonly HistoryRow[] {
  const out: HistoryRow[] = []
  for (let i = state.log.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = state.log[i]
    if (entry === undefined) continue
    const undone = entry.action === 'undo'
    for (let k = entry.op.changes.length - 1; k >= 0 && out.length < limit; k--) {
      const ch = entry.op.changes[k]
      if (ch === undefined) continue
      out.push({
        seq: entry.op.seq,
        at: entry.at,
        action: undone ? '取り消し' : '修正',
        decidedBy: entry.op.by.decidedBy === 'machine' ? '機械' : '人',
        scope: entry.op.by.scope === 'column' ? '列' : 'セル',
        row: ch.row + 1,
        columnName: columnNames[ch.col] ?? `列${ch.col + 1}`,
        before: undone ? ch.after : ch.before,
        after: undone ? ch.before : ch.after,
        issue: entry.op.issue ?? '',
      })
    }
  }
  return out
}
