/**
 * 空白を、目に見える形にする。
 *
 * 【重要】このツールがいちばん多く直すのは、先頭・末尾の空白である。
 * それが画面で見えないと、「何が変わったのか分からない」まま
 * 直したことになってしまう。履歴も同じで、
 * 「佐藤 花子 → 佐藤 花子」と並んでいたら記録の意味がない。
 *
 * 値そのものは変えない。表示のためだけの置き換えである。
 */

const SPACE = '␣' // U+2423 OPEN BOX
const IDEOGRAPHIC = '□' // 全角スペース
const NEWLINE = '⏎'
const TAB = '⇥'

export function visible(value: string): string {
  if (value === '') return '（空欄）'
  return (
    value
      // 先頭と末尾の空白だけを置き換える。途中の空白は普通に読めるので触らない。
      .replace(/^[ \t　]+|[ \t　]+$/g, (run) =>
        [...run]
          .map((ch) => (ch === '　' ? IDEOGRAPHIC : ch === '\t' ? TAB : SPACE))
          .join(''),
      )
      .replace(/\r\n|\r|\n/g, NEWLINE)
  )
}
