import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decode, detectEncoding } from './encoding.ts'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../testdata/${name}`, import.meta.url)))
}

describe('文字コードの判定', () => {
  it('BOM付きUTF-8は certain で判定できる', () => {
    const d = detectEncoding(fixture('sample_utf8_bom.csv'))
    expect(d.encoding).toBe('utf-8-bom')
    expect(d.confidence).toBe('certain')
  })

  it('BOMなしUTF-8は high で判定できる', () => {
    const d = detectEncoding(fixture('sample_utf8.csv'))
    expect(d.encoding).toBe('utf-8')
    expect(d.confidence).toBe('high')
  })

  it('Shift-JIS は high で判定できる', () => {
    const d = detectEncoding(fixture('sample_sjis.csv'))
    expect(d.encoding).toBe('shift_jis')
    expect(d.confidence).toBe('high')
  })

  it('ASCIIのみのときは、どれで読んでも同じだと分かる', () => {
    const d = detectEncoding(fixture('sample_ascii.csv'))
    expect(d.encoding).toBe('utf-8')
    expect(d.reason).toContain('ASCII')
  })

  it('UTF-8として不正なバイト列を、UTF-8と判定しない', () => {
    // 0x82 0xA0（CP932 の「あ」）は、UTF-8 としては継続バイトが先頭に来ている
    const d = detectEncoding(new Uint8Array([0x82, 0xa0, 0x82, 0xa2]))
    expect(d.encoding).not.toBe('utf-8')
  })

  it('冗長符号化（overlong）を妥当なUTF-8として通さない', () => {
    // C0 80 は U+0000 の冗長表現。規格上は不正。
    const d = detectEncoding(new Uint8Array([0x41, 0xc0, 0x80, 0x41]))
    expect(d.encoding).not.toBe('utf-8')
  })

  it('サロゲート値のUTF-8表現を通さない', () => {
    // ED A0 80 は U+D800。UTF-8 では表せない値。
    const d = detectEncoding(new Uint8Array([0xed, 0xa0, 0x80]))
    expect(d.encoding).not.toBe('utf-8')
  })

  it('多バイト文字が途中で切れているとき、妥当と誤判定しない', () => {
    // E3 81 で終わっている（3バイト文字の2バイト目まで）
    const d = detectEncoding(new Uint8Array([0x41, 0xe3, 0x81]))
    expect(d.encoding).not.toBe('utf-8')
  })
})

describe('復号', () => {
  it('3つの文字コードすべてで、同じ日本語が読める', () => {
    const expected = '取引先名'
    for (const name of ['sample_utf8.csv', 'sample_utf8_bom.csv', 'sample_sjis.csv']) {
      const bytes = fixture(name)
      const d = detectEncoding(bytes)
      const text = decode(bytes, d.encoding)
      expect(text.startsWith(expected), `${name} の先頭が「${expected}」でない`).toBe(true)
    }
  })

  it('BOM付きで読んでも、先頭にBOMが残らない', () => {
    const bytes = fixture('sample_utf8_bom.csv')
    const text = decode(bytes, 'utf-8-bom')
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('Shift-JIS を UTF-8 として読むと化ける（判定が要る理由）', () => {
    const bytes = fixture('sample_sjis.csv')
    const wrong = decode(bytes, 'utf-8')
    expect(wrong).toContain('�') // 置換文字
  })
})
