import { describe, expect, it } from 'vitest'
import { visible } from './visible.ts'

describe('空白を見える形にする', () => {
  it('末尾の空白が見える', () => {
    expect(visible('佐藤 花子 ')).toBe('佐藤 花子␣')
  })

  it('先頭の空白も見える', () => {
    expect(visible(' 佐藤')).toBe('␣佐藤')
  })

  it('全角スペースは別の印になる（半角と区別が要る）', () => {
    expect(visible('鈴木　')).toBe('鈴木□')
  })

  it('途中の空白は触らない。読めるものを読みにくくしない', () => {
    expect(visible('佐藤 花子')).toBe('佐藤 花子')
  })

  it('改行が見える', () => {
    expect(visible('a\nb')).toBe('a⏎b')
  })

  it('空欄はそう分かる', () => {
    expect(visible('')).toBe('（空欄）')
  })
})
