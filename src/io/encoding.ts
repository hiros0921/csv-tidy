/**
 * 文字コードの判定と復号。仕様書5章。
 *
 * 【方針】判定は当たり外れがあるので、結果に「確信度」を付ける。
 * 「判定した」と「たぶんこれだろう」を、型で区別する。
 *
 *   certain  … バイト列に書いてある（BOM）。外れようがない
 *   high     … 強い根拠がある（UTF-8として妥当／UTF-8としては不正でSJISと一致）
 *   low      … 統計的な推定だけ
 *   fallback … 決め手がない。日本のExcel由来を想定した既定値
 *
 * 画面には確信度も出す。low と fallback のときは目立たせる。
 * 自動判定は外れる前提で作る（5章）。
 */

import Encoding from 'encoding-japanese'

export type CharEncoding = 'utf-8' | 'utf-8-bom' | 'shift_jis' | 'utf-16le' | 'utf-16be'

export type Confidence = 'certain' | 'high' | 'low' | 'fallback'

export type Detection = {
  readonly encoding: CharEncoding
  readonly confidence: Confidence
  /** なぜそう判定したか。画面に出す。 */
  readonly reason: string
}

export const ENCODING_LABEL: Readonly<Record<CharEncoding, string>> = {
  'utf-8': 'UTF-8（BOMなし）',
  'utf-8-bom': 'UTF-8（BOM付き）',
  shift_jis: 'Shift-JIS（CP932）',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
}

type Utf8Scan = { readonly valid: boolean; readonly hasMultibyte: boolean }

/**
 * UTF-8として妥当なバイト列かを検査する。
 *
 * 【重要】ここは統計ではなく、規格に照らした可否の判定である。
 * 「妥当でない」と分かれば UTF-8 の可能性を消せるので、判定の骨になる。
 *
 * 冗長符号化（同じ文字をより長いバイト列で表す）とサロゲート値も弾く。
 * これらは規格上は不正だが、通ってしまう実装があるため明示的に見る。
 */
function scanUtf8(bytes: Uint8Array): Utf8Scan {
  const n = bytes.length
  let hasMultibyte = false
  let i = 0

  while (i < n) {
    const head = bytes[i] ?? 0

    if (head < 0x80) {
      i++
      continue
    }

    hasMultibyte = true

    let follow: number
    let min: number
    let cp: number

    if (head >= 0xc2 && head <= 0xdf) {
      follow = 1
      min = 0x80
      cp = head & 0x1f
    } else if (head >= 0xe0 && head <= 0xef) {
      follow = 2
      min = 0x800
      cp = head & 0x0f
    } else if (head >= 0xf0 && head <= 0xf4) {
      follow = 3
      min = 0x10000
      cp = head & 0x07
    } else {
      // 0x80-0xC1（継続バイトが先頭に来た／冗長な2バイト）と 0xF5 以降
      return { valid: false, hasMultibyte }
    }

    if (i + follow >= n) return { valid: false, hasMultibyte }

    for (let k = 1; k <= follow; k++) {
      const cont = bytes[i + k] ?? 0
      if ((cont & 0xc0) !== 0x80) return { valid: false, hasMultibyte }
      cp = (cp << 6) | (cont & 0x3f)
    }

    if (cp < min) return { valid: false, hasMultibyte } // 冗長符号化
    if (cp >= 0xd800 && cp <= 0xdfff) return { valid: false, hasMultibyte } // サロゲート
    if (cp > 0x10ffff) return { valid: false, hasMultibyte }

    i += follow + 1
  }

  return { valid: true, hasMultibyte }
}

export function detectEncoding(bytes: Uint8Array): Detection {
  const b0 = bytes[0]
  const b1 = bytes[1]
  const b2 = bytes[2]

  // ① BOM。バイト列に書いてあるので、外れようがない。
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return { encoding: 'utf-8-bom', confidence: 'certain', reason: 'BOM（EF BB BF）があります' }
  }
  if (b0 === 0xff && b1 === 0xfe) {
    return { encoding: 'utf-16le', confidence: 'certain', reason: 'BOM（FF FE）があります' }
  }
  if (b0 === 0xfe && b1 === 0xff) {
    return { encoding: 'utf-16be', confidence: 'certain', reason: 'BOM（FE FF）があります' }
  }

  // ② UTF-8 として妥当か。規格に照らした可否なので、統計より強い。
  const scan = scanUtf8(bytes)
  if (scan.valid && scan.hasMultibyte) {
    return {
      encoding: 'utf-8',
      confidence: 'high',
      reason: 'UTF-8として妥当な多バイト列を含んでいます',
    }
  }
  if (scan.valid && !scan.hasMultibyte) {
    return {
      encoding: 'utf-8',
      confidence: 'high',
      reason: 'ASCIIのみです。どの文字コードで読んでも同じ結果になります',
    }
  }

  // ③ UTF-8 ではないと分かった。何であるかは統計で推定する。
  const guess = Encoding.detect(bytes)
  if (guess === 'SJIS') {
    return {
      encoding: 'shift_jis',
      confidence: 'high',
      reason: 'UTF-8としては不正なバイト列があり、Shift-JISと一致します',
    }
  }
  if (guess === 'EUCJP' || guess === 'JIS' || guess === 'UTF16' || guess === 'UNICODE') {
    return {
      encoding: 'shift_jis',
      confidence: 'low',
      reason: `統計判定は ${guess} ですが、本ツールは Shift-JIS / UTF-8 のみを扱います`,
    }
  }

  // ④ 決め手がない。日本のExcelが吐くCSVはCP932が最も多いので、そこへ倒す。
  return {
    encoding: 'shift_jis',
    confidence: 'fallback',
    reason: '決め手がありません。ExcelのCSVで最も多いCP932を既定にしています',
  }
}

/**
 * 復号する。
 *
 * 【実装メモ】復号はブラウザ標準の TextDecoder で足りる。shift_jis も
 * WHATWG Encoding Standard に含まれていて、中身は CP932（Windows-31J）である。
 * encoding-japanese を使うのは判定の補助と、第6段階の「書き出し」だけ。
 * TextEncoder は UTF-8 しか作れないので、CP932 で書き出すときには要る。
 */
export function decode(bytes: Uint8Array, encoding: CharEncoding): string {
  switch (encoding) {
    // BOM付き / なしは、読むときは同じ。TextDecoder が BOM を落とす。
    // 区別が要るのは書き出すときだけ。
    case 'utf-8':
    case 'utf-8-bom':
      return new TextDecoder('utf-8').decode(bytes)
    case 'shift_jis':
      return new TextDecoder('shift_jis').decode(bytes)
    case 'utf-16le':
      return new TextDecoder('utf-16le').decode(bytes)
    case 'utf-16be':
      return new TextDecoder('utf-16be').decode(bytes)
  }
}
