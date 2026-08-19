/**
 * セルの状態。
 *
 * 【この設計の要点】型と格納を分けている。
 *
 * 画面に見せる型は判別可能な合併型（CellState）だが、
 * それを全セル分のオブジェクトとして持つことはしない。
 * 10万行 × 20列 = 200万セル。オブジェクトを200万個作るとメモリが持たない。
 *
 *   格納: 状態コードは Uint8Array 1本（1セル1バイト）。200万セルで 2MB。
 *         詳細は issue / fixed のセルだけ Map に入れる。clean なセルは何も持たない。
 *   型:   画面に出す100行分だけ、読み出すときに CellState を組み立てる。
 *
 * Uint8Array は Transferable なので、Worker からの戻りもゼロコピーになる。
 * 「メモリが持たない」と「Worker の戻りが重い」が、同じ形で解ける。
 */

import type { Issue, NonEmpty } from './issue.ts'

/** 状態コード。Uint8Array に入る値。 */
export const UNCHECKED = 0
export const CLEAN = 1
export const ISSUE = 2
export const FIXED = 3

export type StateCode = typeof UNCHECKED | typeof CLEAN | typeof ISSUE | typeof FIXED

/**
 * 三分岐の区分コード。色分けだけに使う1バイト。
 *
 * 【なぜ別に持つか】
 * 色を塗るのに必要なのは「どの区分か」だけで、説明文は要らない。
 * 説明文まで含む詳細を Map に組み立てると、11万件で 138ms 止まった（実測）。
 * 区分を Uint8Array にすれば転送はゼロコピーで、Map を待たずに色が出る。
 * 説明文（ツールチップ）は、あとから空き時間に組み立てる。
 */
export const R_NONE = 0 // 問題なし
export const R_AUTO = 1 // 自動で直せる
export const R_CHOICE = 2 // 人が決める
export const R_DETECT = 3 // 検出だけ

/** 誰が直したか。7章「自動で直したものと人が直したものを区別すること」。 */
export type FixSource =
  | { readonly kind: 'auto' }
  | { readonly kind: 'manual' }
  | { readonly kind: 'bulk'; readonly column: number }

/**
 * セルの状態。境界（画面に出すとき）で組み立てる。
 *
 * 【重要】'unchecked' と 'clean' を分けてある。
 * 「まだ調べていない」を「問題なし」と同じ扱いにすると、
 * 解析が途中で止まったセルが、きれいなセルとして書き出される。
 */
export type CellState =
  | { readonly kind: 'unchecked' }
  | { readonly kind: 'clean' }
  | { readonly kind: 'issue'; readonly issues: NonEmpty<Issue> }
  | {
      readonly kind: 'fixed'
      readonly original: string
      readonly by: FixSource
      readonly resolved: NonEmpty<Issue>
      /** 直したが、まだ残っている問題。空でありうる。 */
      readonly remaining: readonly Issue[]
    }

/** Map に入れる、issue / fixed のセルだけが持つ情報。 */
export type CellDetail =
  | { readonly kind: 'issue'; readonly issues: NonEmpty<Issue> }
  | {
      readonly kind: 'fixed'
      readonly original: string
      readonly by: FixSource
      readonly resolved: NonEmpty<Issue>
      readonly remaining: readonly Issue[]
    }

/**
 * 列指向の添字。index = col * rowCount + row。
 *
 * 列単位の一括置換と、列ごとの検出（空欄率・表記揺れ）が主な操作なので、
 * 同じ列のセルが連続して並ぶほうが都合がよい。
 */
export function cellIndex(col: number, row: number, rowCount: number): number {
  return col * rowCount + row
}

/**
 * 画面に色を塗るために必要な最小の情報。説明文を含まない。
 *
 * 【なぜ CellState と分けるか】
 * 説明文は Worker に置いたままにした（メインへ送ると 151ms 止まるため）。
 * つまりメインスレッドが持っているのは、1セルあたり2バイト
 * ——状態コードと三分岐の区分——だけである。
 * 塗るのに必要なのはそれで足り、説明文は見に行った1セルにしか要らない。
 *
 *   CellView  … 塗るための型。2バイトから作る
 *   CellState … 説明するための型。詳細が手元にあるときに作る
 *
 * 型を1つにまとめて「説明文が無い issue」を許すと、
 * 「まだ調べていない」と「調べたが説明文がここに無い」が混ざる。
 * それは最初に潰したはずの混同なので、型を2つに分けた。
 */
export type CellView =
  | { readonly kind: 'unchecked' }
  | { readonly kind: 'clean' }
  | { readonly kind: 'issue'; readonly remedy: RemedyCode }
  | { readonly kind: 'fixed' }

export type RemedyCode = typeof R_NONE | typeof R_AUTO | typeof R_CHOICE | typeof R_DETECT

export function cellView(flags: Uint8Array, remedy: Uint8Array | null, index: number): CellView {
  switch (flags[index]) {
    case CLEAN:
      return { kind: 'clean' }
    case FIXED:
      return { kind: 'fixed' }
    case ISSUE: {
      const code = remedy?.[index]
      // 区分が無い＝色を決められない。塗らずに済ませる（clean と同じ見た目）。
      if (code === undefined) return { kind: 'clean' }
      return { kind: 'issue', remedy: code === R_AUTO ? R_AUTO : code === R_CHOICE ? R_CHOICE : code === R_DETECT ? R_DETECT : R_NONE }
    }
    default:
      return { kind: 'unchecked' }
  }
}

/** 状態コードと詳細から、CellState を組み立てる。説明が要るときに使う。 */
export function cellState(
  flags: Uint8Array,
  details: ReadonlyMap<number, CellDetail>,
  index: number,
): CellState {
  const code = flags[index]
  switch (code) {
    case CLEAN:
      return { kind: 'clean' }
    case ISSUE:
    case FIXED: {
      const detail = details.get(index)
      // 詳細が無いのに issue/fixed になっている＝不整合。
      // 握りつぶすと「問題なし」として書き出されるので、未検査に倒す。
      if (detail === undefined) return { kind: 'unchecked' }
      return detail
    }
    // UNCHECKED、および範囲外（noUncheckedIndexedAccess により undefined）
    default:
      return { kind: 'unchecked' }
  }
}
