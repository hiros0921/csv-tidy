import { describe, expect, it } from 'vitest'
import { decode, detectEncoding } from './encoding.ts'
import { parseCsv } from './parse.ts'
import { buildCsv, encodeCsv, findUnmappable, outputName } from './write.ts'

const OPT = { header: ['a', 'b'], writeHeader: true, newline: 'crlf' as const }

describe('CSV の組み立て', () => {
  it('見出しと本文が CRLF で並ぶ', () => {
    const csv = buildCsv([['1', '3'], ['2', '4']], 2, OPT)
    expect(csv).toBe('a,b\r\n1,2\r\n3,4\r\n')
  })

  it('見出しを書かない指定ができる（1行目が見出しでなかった場合）', () => {
    const csv = buildCsv([['1']], 1, { ...OPT, writeHeader: false })
    expect(csv).toBe('1\r\n')
  })

  it('カンマ・引用符・改行を含む値を囲む', () => {
    const csv = buildCsv([['a,b', 'c"d', 'e\nf']], 3, { ...OPT, header: ['x'], writeHeader: false })
    expect(csv).toBe('"a,b"\r\n"c""d"\r\n"e\nf"\r\n')
  })

  it('前後に空白のある値も囲む（読み直したときに落とさないため）', () => {
    // このツールは空白を直す道具なので、残すと決めた空白が
    // 書き出しで消えるのがいちばん困る。
    const csv = buildCsv([[' a', 'b ', '　c　']], 3, { ...OPT, header: ['x'], writeHeader: false })
    expect(csv).toBe('" a"\r\n"b "\r\n"　c　"\r\n')
  })

  it('途中の空白は囲まない（普通の値を無駄に囲まない）', () => {
    const csv = buildCsv([['佐藤 花子']], 1, { ...OPT, header: ['x'], writeHeader: false })
    expect(csv).toBe('佐藤 花子\r\n')
  })
})

describe('書いたものを読み直せる（往復）', () => {
  const messy = [
    ['株式会社ヤマト商事', '(株)ヤマト商事'],
    [' 前後に空白 ', '改行\nあり'],
    ['カンマ,あり', '引用"符'],
    ['007', '０６'],
  ]

  it('UTF-8（BOM付き）で往復しても、値が変わらない', () => {
    const csv = buildCsv(messy, 2, { header: ['a', 'b', 'c', 'd'], writeHeader: true, newline: 'crlf' })
    const bytes = encodeCsv(csv, 'utf-8-bom')
    const detected = detectEncoding(bytes)
    expect(detected.encoding).toBe('utf-8-bom')
    const parsed = parseCsv(decode(bytes, detected.encoding), 'first-row')
    expect(parsed.rows).toEqual([
      ['株式会社ヤマト商事', ' 前後に空白 ', 'カンマ,あり', '007'],
      ['(株)ヤマト商事', '改行\nあり', '引用"符', '０６'],
    ])
  })

  it('Shift-JIS で往復しても、値が変わらない', () => {
    const csv = buildCsv(messy, 2, { header: ['a', 'b', 'c', 'd'], writeHeader: true, newline: 'crlf' })
    const bytes = encodeCsv(csv, 'shift_jis')
    const detected = detectEncoding(bytes)
    expect(detected.encoding).toBe('shift_jis')
    const parsed = parseCsv(decode(bytes, detected.encoding), 'first-row')
    expect(parsed.rows[0]?.[3]).toBe('007') // 前ゼロが残る
    expect(parsed.rows[0]?.[1]).toBe(' 前後に空白 ') // 空白が残る
  })

  it('BOM 付きで書くと、先頭に EF BB BF が付く', () => {
    const bytes = encodeCsv('a\r\n', 'utf-8-bom')
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('BOM なしで書くと、付かない', () => {
    const bytes = encodeCsv('a\r\n', 'utf-8')
    expect(bytes[0]).toBe(0x61)
  })
})

describe('Shift-JIS で書けない文字', () => {
  it('絵文字と em ダッシュを見つける', () => {
    // 黙って ? にすると「直したつもりが壊れていた」になる。
    const found = findUnmappable('よい—です🙂🙂', 'shift_jis')
    expect(found.map((f) => f.char).sort()).toEqual(['—', '🙂'])
    expect(found.find((f) => f.char === '🙂')?.count).toBe(2)
  })

  it('CP932 にある文字は、書けないと言わない', () => {
    // ここを誤検出すると、直す必要のないものを直させることになる。
    expect(findUnmappable('㈱髙﨑①②③ヱヴ', 'shift_jis')).toEqual([])
  })

  it('UTF-8 なら、何も報告しない', () => {
    expect(findUnmappable('🙂—', 'utf-8')).toEqual([])
    expect(findUnmappable('🙂—', 'utf-8-bom')).toEqual([])
  })

  it('多い順に並ぶ', () => {
    const found = findUnmappable('—🙂—', 'shift_jis')
    expect(found[0]?.char).toBe('—')
  })
})

describe('書き出すファイル名', () => {
  it('元のファイルは書き換えない。別の名前になる', () => {
    expect(outputName('取引先一覧.csv', '_tidy')).toBe('取引先一覧_tidy.csv')
    expect(outputName('data.xlsx', '_tidy')).toBe('data_tidy.csv')
    expect(outputName('拡張子なし', '_changes')).toBe('拡張子なし_changes.csv')
  })
})

describe('通貨記号の落とし穴（実測で踏んだ）', () => {
  it('半角の ¥（U+00A5）は CP932 に無い', () => {
    // 最初、検証データを Shift-JIS で作った時点で ? になっていた。
    // アプリの不具合ではなく、この文字が CP932 に無いことが原因だった。
    expect(findUnmappable('¥8,500', 'shift_jis').map((f) => f.char)).toEqual(['¥'])
  })

  it('全角の ￥（U+FFE5）は CP932 にある', () => {
    expect(findUnmappable('￥8,500', 'shift_jis')).toEqual([])
  })

  it('バックスラッシュは通る（0x5C の扱いで混同しやすい）', () => {
    expect(findUnmappable('C:\\temp', 'shift_jis')).toEqual([])
  })
})
