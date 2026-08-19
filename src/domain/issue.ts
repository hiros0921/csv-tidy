/**
 * 検出した問題と、その直し方。
 *
 * 【重要】仕様書4章の三分岐（自動で直す／候補を出す／検出だけ）を、
 * 画面の分岐ではなく型として持つ。こうすると「表記揺れの統一先を機械が決める」が
 * 規約ではなくコンパイルエラーになる（下の applyAuto の引数を参照）。
 *
 * 検出そのものは第4段階で実装する。ここは型だけを先に決めてある。
 * 型が先に決まっていないと、格納（Uint8Array + Map）の設計ができないため。
 */

/** 空配列を作れない配列。 */
export type NonEmpty<T> = readonly [T, ...T[]]

/** 何を根拠に、どう直せるか。 */
export type Remedy =
  /** 迷う余地がない。自動で直す（末尾の空白、全角英数など） */
  | { readonly kind: 'auto'; readonly to: string }
  /** 正解が1つに決まらない。候補を出して人が決める（表記揺れ、重複行など） */
  | { readonly kind: 'choice'; readonly options: NonEmpty<Candidate> }
  /** 機械には判断できない。検出だけする（異常値、文字化けの疑いなど） */
  | { readonly kind: 'none' }

/**
 * 候補と、その出現回数。
 *
 * 【重要】occurrences は事実であって、推奨ではない。
 * 「12件と3件」を見せるのは判断材料を渡しているだけで、
 * 多数派に印を付けた時点で、機械が決めたことになる。印は付けない。
 */
export type Candidate = {
  readonly value: string
  readonly occurrences: number
}

export type IssueCode =
  | 'trailing_space'
  | 'embedded_newline'
  | 'fullwidth_alnum'
  | 'notation_variant'
  | 'duplicate_row'
  | 'empty'
  | 'date_format_mixed'
  | 'numeric_as_text'
  | 'phone_format'
  | 'postal_format'
  | 'outlier_suspected'
  | 'mojibake_suspected'

export type Issue = {
  readonly code: IssueCode
  readonly remedy: Remedy
  /** 画面に出す短い説明。検出した側が言葉を持つ。 */
  readonly note: string
}

/** 自動修正。auto しか受け取らないので、choice を渡すコードは書けない。 */
export type AutoRemedy = Extract<Remedy, { kind: 'auto' }>

export function applyAuto(_original: string, remedy: AutoRemedy): string {
  return remedy.to
}
