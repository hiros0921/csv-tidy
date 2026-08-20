/**
 * 書き出し。仕様書7章。
 *
 * 【守ること】
 *   ・元のファイルは書き換えない。新しいファイルとして保存する
 *   ・文字コードを選べる（UTF-8 BOM付き / なし / Shift-JIS）
 *   ・変更履歴も別ファイルで出せる
 *
 * 【書き出しは CSV だけにした理由】
 * xlsx で書き出すと、文字コードを選ぶという話が消える（中身は UTF-8 の XML）。
 * このツールの主張の1つが「Excel が読める形で出す」ことなので、
 * そこを xlsx に逃がすと、5章でやったことが薄まる。
 * 読むのは CSV と xlsx、書くのは CSV だけ。SheetJS の書き出し側も要らなくなる。
 */

import Encoding from 'encoding-japanese'
import type { CharEncoding } from './encoding.ts'

export type Newline = 'crlf' | 'lf'

/**
 * 1つの値を CSV の1項目にする。
 *
 * 【重要】前後に空白がある値も囲む。
 * 規格上は囲まなくてよいが、囲まないと読み直したときに落とす実装がある。
 * このツールは「前後の空白」を直す道具なので、
 * 直さないと決めた空白が書き出しで消えるのは、いちばん困る。
 */
function field(value: string): string {
  const needsQuote =
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    /^[\s　]|[\s　]$/.test(value)
  if (!needsQuote) return value
  return `"${value.replaceAll('"', '""')}"`
}

export type CsvOptions = {
  readonly header: readonly string[]
  /** 見出しの行を書くか。1行目を見出しとして読んだときだけ true。 */
  readonly writeHeader: boolean
  readonly newline: Newline
}

export function buildCsv(
  columns: readonly (readonly string[])[],
  rowCount: number,
  options: CsvOptions,
): string {
  // 【実装メモ】Excel は LF だけの CSV も読むが、CRLF のほうが素直に開く。
  const eol = options.newline === 'crlf' ? '\r\n' : '\n'
  const colCount = columns.length
  const lines: string[] = []

  if (options.writeHeader) {
    lines.push(options.header.map(field).join(','))
  }

  const row = new Array<string>(colCount)
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) row[c] = field(columns[c]?.[r] ?? '')
    lines.push(row.join(','))
  }
  return lines.join(eol) + eol
}

export type Unmappable = { readonly char: string; readonly count: number }

/**
 * その文字コードで書けない文字を探す。
 *
 * 【重要】黙って `?` にしない。
 * encoding-japanese は表せない文字を `?` に置き換えるが、
 * それは「直したつもりが壊れていた」の典型である。
 * Shift-JIS では、たとえば `—`（emダッシュ）や絵文字が落ちる。
 * 「髙」「﨑」「㈱」「①」は CP932 にあるので落ちない。
 *
 * 数える対象は ASCII 以外だけ。ASCII はどの文字コードでも書ける。
 */
export function findUnmappable(text: string, encoding: CharEncoding): readonly Unmappable[] {
  if (encoding !== 'shift_jis') return [] // UTF-8 系はすべて書ける

  const counts = new Map<string, number>()
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) continue
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }

  const out: Unmappable[] = []
  for (const [ch, count] of counts) {
    // 1文字だけ往復させて、戻ってこなければ書けない。
    const back = Encoding.codeToString(
      Encoding.convert(Encoding.convert(Encoding.stringToCode(ch), { to: 'SJIS', from: 'UNICODE' }), {
        to: 'UNICODE',
        from: 'SJIS',
      }),
    )
    if (back !== ch) out.push({ char: ch, count })
  }
  return out.sort((a, b) => b.count - a.count)
}

const BOM = new Uint8Array([0xef, 0xbb, 0xbf])

export function encodeCsv(text: string, encoding: CharEncoding): Uint8Array<ArrayBuffer> {
  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(text)
    case 'utf-8-bom': {
      // 【重要】BOM を付ける理由。
      // BOM なしの UTF-8 を Excel で開くと、環境によっては CP932 と解釈されて
      // 文字化けする。日本の実務ではここで必ず1回はつまずく。
      const body = new TextEncoder().encode(text)
      const out = new Uint8Array(BOM.length + body.length)
      out.set(BOM, 0)
      out.set(body, BOM.length)
      return out
    }
    case 'shift_jis':
      return new Uint8Array(
        Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' }),
      )
    case 'utf-16le':
    case 'utf-16be': {
      // 本ツールは UTF-16 では書き出さない（読むだけ）。
      // 選ばせない代わりに、ここへ来たら UTF-8 で書く。
      return new TextEncoder().encode(text)
    }
  }
}

/** 書き出しで選べる文字コード。UTF-16 は入れない。 */
export const WRITE_ENCODINGS: readonly CharEncoding[] = ['utf-8-bom', 'utf-8', 'shift_jis']

export const WRITE_ENCODING_NOTE: Readonly<Partial<Record<CharEncoding, string>>> = {
  'utf-8-bom': 'Excel でそのまま開けます（迷ったらこれ）',
  'utf-8': 'Excel で開くと文字化けすることがあります',
  shift_jis: '古い業務システム向け。書けない文字があります',
}

/** 元のファイル名から、書き出す名前を作る。元は書き換えない。 */
export function outputName(original: string, suffix: string): string {
  const dot = original.lastIndexOf('.')
  const base = dot > 0 ? original.slice(0, dot) : original
  return `${base}${suffix}.csv`
}
