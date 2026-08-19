/**
 * 値の「形」を見分ける。
 *
 * 【重要】ここが誤検出を抑える要である。
 *
 * 1つの値だけを見て「電話番号の形が違う」とは言えない。
 * `0312345678` は電話番号かもしれないし、ただの数字かもしれない。
 * だから列全体を先に見て、その列が何の列かを決めてから、
 * 個々の値をその基準で見る（column.ts）。
 *
 * 迷ったら「該当なし」に倒す。検出しない側に倒す（仕様書4章）。
 */

import { toHalfWidth } from './normalize.ts'

export type DateShape = 'slash' | 'hyphen' | 'dot' | 'kanji' | 'wareki'
export type NumericShape = 'plain' | 'leading_zero' | 'thousands_sep' | 'currency' | 'unit'

export type ParsedDate = { readonly y: number; readonly m: number; readonly d: number }

const WAREKI: readonly { readonly name: string; readonly base: number }[] = [
  { name: '令和', base: 2018 }, // 令和1年 = 2019
  { name: '平成', base: 1988 },
  { name: '昭和', base: 1925 },
]

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  if (y < 1900 || y > 2200) return false
  return true
}

/** 日付として読めるか。読めたら「どの形式か」と「中身」を返す。 */
export function readDate(raw: string): { shape: DateShape; date: ParsedDate } | null {
  const s = toHalfWidth(raw).trim()
  if (s === '') return null

  for (const era of WAREKI) {
    // 令和8年1月25日 / 令和8年1月 は受けない（日まで揃っているものだけ）
    const m = new RegExp(`^${era.name}\\s*(\\d{1,2})年\\s*(\\d{1,2})月\\s*(\\d{1,2})日$`).exec(s)
    if (m !== null) {
      const y = era.base + Number(m[1])
      const mo = Number(m[2])
      const d = Number(m[3])
      return valid(y, mo, d) ? { shape: 'wareki', date: { y, m: mo, d } } : null
    }
  }

  const kanji = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/.exec(s)
  if (kanji !== null) {
    const y = Number(kanji[1])
    const m = Number(kanji[2])
    const d = Number(kanji[3])
    return valid(y, m, d) ? { shape: 'kanji', date: { y, m, d } } : null
  }

  const sep = /^(\d{4})([/\-.])(\d{1,2})\2(\d{1,2})$/.exec(s)
  if (sep !== null) {
    const y = Number(sep[1])
    const m = Number(sep[3])
    const d = Number(sep[4])
    if (!valid(y, m, d)) return null
    const mark = sep[2]
    const shape: DateShape = mark === '/' ? 'slash' : mark === '-' ? 'hyphen' : 'dot'
    return { shape, date: { y, m, d } }
  }

  return null
}

/** 日付を、指定の形式で書き直す。 */
export function writeDate(date: ParsedDate, shape: DateShape): string {
  const mm = String(date.m).padStart(2, '0')
  const dd = String(date.d).padStart(2, '0')
  switch (shape) {
    case 'slash':
      return `${date.y}/${mm}/${dd}`
    case 'hyphen':
      return `${date.y}-${mm}-${dd}`
    case 'dot':
      return `${date.y}.${mm}.${dd}`
    case 'kanji':
      return `${date.y}年${date.m}月${date.d}日`
    case 'wareki': {
      for (const era of WAREKI) {
        const n = date.y - era.base
        if (n >= 1) return `${era.name}${n}年${date.m}月${date.d}日`
      }
      return `${date.y}年${date.m}月${date.d}日`
    }
  }
}

export const DATE_SHAPE_LABEL: Readonly<Record<DateShape, string>> = {
  slash: '2026/01/15',
  hyphen: '2026-01-15',
  dot: '2026.01.15',
  kanji: '2026年1月15日',
  wareki: '令和8年1月15日',
}

/** 数値として読めるか。読めたら「どの形か」と「数」を返す。 */
export function readNumeric(raw: string): { shape: NumericShape; value: number } | null {
  const s = toHalfWidth(raw).trim()
  if (s === '') return null

  // 前ゼロ。007 のような商品コード。数値に直すと壊れる。
  if (/^0\d+$/.test(s)) return { shape: 'leading_zero', value: Number(s) }

  if (/^-?\d+(\.\d+)?$/.test(s)) return { shape: 'plain', value: Number(s) }

  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    return { shape: 'thousands_sep', value: Number(s.replace(/,/g, '')) }
  }

  const currency = /^[¥￥$]\s*(-?[\d,]+(\.\d+)?)$/.exec(s)
  if (currency !== null) {
    const body = currency[1] ?? ''
    return { shape: 'currency', value: Number(body.replace(/,/g, '')) }
  }

  const unit = /^(-?[\d,]+(\.\d+)?)\s*(円|個|件|本|台|枚|人|kg|g|mm|cm|m|%)$/.exec(s)
  if (unit !== null) {
    const body = unit[1] ?? ''
    return { shape: 'unit', value: Number(body.replace(/,/g, '')) }
  }

  return null
}

export const NUMERIC_SHAPE_LABEL: Readonly<Record<NumericShape, string>> = {
  plain: '数字だけ',
  leading_zero: '前ゼロあり',
  thousands_sep: '桁区切りあり',
  currency: '通貨記号あり',
  unit: '単位あり',
}

/** 電話番号として読めるか。読めたらハイフン区切りの形を返す。 */
export function readPhone(raw: string): string | null {
  const s = toHalfWidth(raw).trim().replace(/[()（）]/g, '-').replace(/-+/g, '-')
  const digits = s.replace(/\D/g, '')
  if (!/^0\d{8,10}$/.test(digits)) return null

  // 市外局番の桁数は地域で違う。ここでは代表的な形だけを扱う。
  if (digits.length === 11 && /^0[789]0/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10 && /^0[36]/.test(digits)) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
  }
  return null
}

/** 郵便番号として読めるか。読めたら 123-4567 の形を返す。 */
export function readPostal(raw: string): string | null {
  const s = toHalfWidth(raw).trim().replace(/^〒\s*/, '')
  const digits = s.replace(/\D/g, '')
  if (!/^\d{7}$/.test(digits)) return null
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}
