/**
 * 仮想スクロールの表。仕様書6章。
 *
 * 【この実装の分担】
 *   可視範囲の座標計算 … TanStack Virtual に任せる
 *   再描画を抑えること … こちらで持つ
 *
 * 実際に引っかかる原因は仮想化そのものではなく、スクロールのたびに
 * 全体が再レンダリングされることのほうが多い。だから
 *   - 見出し行と行番号列は、スクロール時に「state を更新しない」。
 *     ref から transform を直接書き換える（React を通さない）
 *   - セルは列指向の配列から直接読む。行オブジェクトを組み立てない
 * としてある。
 *
 * 縦と横の両方を仮想化している。列が40本ある CSV では、行だけ仮想化しても
 * 可視30行 × 40列 = 1,200セルを描くことになる。
 */

import { useCallback, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Table } from '../domain/table.ts'
import type { CellView } from '../domain/cell.ts'
import { R_AUTO, R_CHOICE, R_DETECT, cellIndex, cellView } from '../domain/cell.ts'
import type { Issue } from '../domain/issue.ts'
import { computeWidths } from './widths.ts'

/**
 * セルの見た目を、状態と三分岐の区分コードから決める。
 *
 * 未検査（灰）／問題なし（無地）／自動で直せる（青）／人が決める（黄）／検出だけ（赤）。
 * 色は「どれくらい人手が要るか」を表す。深刻さの順ではない。
 *
 * 【重要】ここで詳細（説明文）を見ない。1バイトの区分だけで塗る。
 * 詳細の Map を待つと、11万件のときに 138ms 止まる（実測）。
 */
function cellClass(view: CellView): string {
  switch (view.kind) {
    case 'unchecked':
      return 'cell--unchecked'
    case 'clean':
      return 'cell--clean'
    case 'fixed':
      return 'cell--fixed'
    case 'issue':
      return view.remedy === R_AUTO
        ? 'cell--auto'
        : view.remedy === R_CHOICE
          ? 'cell--choice'
          : view.remedy === R_DETECT
            ? 'cell--none'
            : 'cell--clean'
  }
}

const ROW_H = 26
const HEADER_H = 30
const GUTTER_W = 64

type Props = {
  readonly table: Table
  /** 三分岐の区分コード。検出前は null。 */
  readonly remedy: Uint8Array | null
  /** 行単位の問題（重複行）。セルではなく行に付く。 */
  readonly rowIssues: ReadonlyMap<number, Issue>
  /** カーソルが乗ったセル。説明文はここから Worker に聞きに行く。 */
  readonly onHover: (index: number, row: number, col: number, value: string) => void
}

export function Grid({ table, remedy, rowIssues, onHover }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const headerInnerRef = useRef<HTMLDivElement>(null)
  const gutterInnerRef = useRef<HTMLDivElement>(null)

  const widths = useMemo(() => computeWidths(table), [table])

  const rowVirt = useVirtualizer({
    count: table.rowCount,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_H,
    overscan: 6,
  })

  const colVirt = useVirtualizer({
    horizontal: true,
    count: table.columns.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: (i) => widths[i] ?? 120,
    overscan: 2,
  })

  /**
   * 見出しと行番号を、本体のスクロールに追随させる。
   *
   * 【重要】ここで setState を呼ばない。スクロールは毎フレーム起きるので、
   * state を更新すると1フレームごとに React の再レンダリングが走る。
   * DOM を直接書き換えれば、React は関与しない。
   */
  const onScroll = useCallback(() => {
    const el = bodyRef.current
    if (el === null) return
    if (headerInnerRef.current !== null) {
      headerInnerRef.current.style.transform = `translateX(${-el.scrollLeft}px)`
    }
    if (gutterInnerRef.current !== null) {
      gutterInnerRef.current.style.transform = `translateY(${-el.scrollTop}px)`
    }
  }, [])

  const rows = rowVirt.getVirtualItems()
  const cols = colVirt.getVirtualItems()
  const totalW = colVirt.getTotalSize()
  const totalH = rowVirt.getTotalSize()

  return (
    <div className="vgrid" style={{ ['--row-h' as string]: `${ROW_H}px` }}>
      {/* 見出し（横だけ追随） */}
      <div className="vgrid__header" style={{ left: GUTTER_W, height: HEADER_H }}>
        <div ref={headerInnerRef} style={{ position: 'relative', width: totalW, height: '100%' }}>
          {cols.map((c) => (
            <div
              key={c.key}
              className="vgrid__th"
              style={{ left: c.start, width: c.size, height: HEADER_H }}
              title={table.columns[c.index]?.name ?? ''}
            >
              {table.columns[c.index]?.name ?? ''}
            </div>
          ))}
        </div>
      </div>

      {/* 行番号（縦だけ追随） */}
      <div className="vgrid__gutter" style={{ top: HEADER_H, width: GUTTER_W }}>
        <div ref={gutterInnerRef} style={{ position: 'relative', height: totalH }}>
          {rows.map((r) => (
            <div
              key={r.key}
              className={`vgrid__rownum ${rowIssues.has(r.index) ? 'vgrid__rownum--dup' : ''}`}
              style={{ top: r.start, height: ROW_H }}
              title={rowIssues.get(r.index)?.note ?? ''}
            >
              {r.index + 1}
            </div>
          ))}
        </div>
      </div>

      {/* 本体 */}
      <div
        ref={bodyRef}
        className="vgrid__body"
        style={{ left: GUTTER_W, top: HEADER_H }}
        onScroll={onScroll}
      >
        <div style={{ position: 'relative', width: totalW, height: totalH }}>
          {rows.map((r) =>
            cols.map((c) => {
              const column = table.columns[c.index]
              if (column === undefined) return null
              const index = cellIndex(c.index, r.index, table.rowCount)
              const view = cellView(table.flags, remedy, index)
              return (
                <div
                  key={`${r.key}:${c.key}`}
                  className={`vgrid__cell ${cellClass(view)}`}
                  data-vrow={r.index}
                  onMouseEnter={() =>
                    onHover(index, r.index, c.index, column.values[r.index] ?? '')
                  }
                  style={{ top: r.start, left: c.start, width: c.size, height: ROW_H }}
                >
                  {column.values[r.index] ?? ''}
                </div>
              )
            }),
          )}
        </div>
      </div>
    </div>
  )
}
