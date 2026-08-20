/**
 * 検証用のCSVを、3つの文字コードで書き出す。
 *
 *   node scripts/make-fixtures.mjs
 *
 * 【重要】本文はすべて架空。実在の個人・企業を含めない。
 * 小さいファイルは testdata/ に置いて git に入れる（判定の証拠として要る）。
 * 大きいファイルは testdata/large/ に置き、git には入れない（第3段階の計測用）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import Encoding from 'encoding-japanese'

const OUT = new URL('../testdata/', import.meta.url)
const LARGE = new URL('../testdata/large/', import.meta.url)
mkdirSync(OUT, { recursive: true })
mkdirSync(LARGE, { recursive: true })

// わざと汚してある。第4段階の検出はこれを材料にする。
//
// 【重要】通貨記号は全角の ￥（U+FFE5）を使う。
// 半角の ¥（U+00A5）は CP932 に無く、Shift-JIS で書いた時点で ? になる。
// 最初これに気づかず、検証データ自体が壊れていた（アプリの不具合ではなかった）。
const ROWS = [
  ['取引先名', '担当者', '電話番号', '郵便番号', '金額', '登録日', '商品コード'],
  ['株式会社ヤマト商事', '田中 一郎', '03-1234-5678', '100-0001', '12,000', '2026/1/15', '007'],
  ['(株)ヤマト商事', '佐藤 花子 ', '0312345678', '1000001', '￥8,500', '2026-01-20', '015'],
  ['㈱ヤマト商事', '鈴木　次郎', '03(1234)5678', '〒100-0001', '3000円', '令和8年1月25日', '023'],
  ['さくら物産株式会社', '', '06-9876-5432', '530-0001', '45,000', '2026/2/1', '101'],
  ['さくら物産㈱', '高橋 三郎', '０６-９８７６-５４３２', '530-0002', '45000', '2026/02/01', '102'],
  ['みどり工業', '伊藤 四郎', '045-111-2222', '220-0011', '7,800', '2026/2/10', '205'],
  ['みどり工業 ', '渡辺 五郎', '045-111-2222', '220-0011', '7,800', '2026/2/10', '205'],
  ['あおぞら商店', '山本 六郎', '011-333-4444', '060-0001', '999999999', '2026/3/3', '310'],
]

const csv = ROWS.map((r) => r.map((v) => (/[,"\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(',')).join('\r\n') + '\r\n'

// ① UTF-8（BOMなし）
writeFileSync(new URL('sample_utf8.csv', OUT), Buffer.from(csv, 'utf8'))

// ② UTF-8（BOM付き）— Excel で開いても化けない形
writeFileSync(new URL('sample_utf8_bom.csv', OUT), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]))

// ③ Shift-JIS（CP932）— Excel が既定で吐く形
const sjis = Encoding.convert(Encoding.stringToCode(csv), { to: 'SJIS', from: 'UNICODE' })
writeFileSync(new URL('sample_sjis.csv', OUT), Buffer.from(sjis))

// ④ ASCIIのみ（どの文字コードでも同じに読める）
const ascii = 'code,name,qty\r\nA001,Bolt,10\r\nA002,Nut,25\r\n'
writeFileSync(new URL('sample_ascii.csv', OUT), Buffer.from(ascii, 'ascii'))

console.log('testdata/ に4本書きました')

// ---- 計測用（git には入れない） ----
const sizes = [10_000, 50_000, 100_000]
const header = 'id,取引先名,担当者,電話番号,郵便番号,金額,登録日,商品コード,備考,区分\r\n'
for (const n of sizes) {
  const parts = [header]
  for (let i = 1; i <= n; i++) {
    const variant = i % 3 === 0 ? '(株)ヤマト商事' : i % 3 === 1 ? '株式会社ヤマト商事' : '㈱ヤマト商事'
    parts.push(
      `${i},${variant},担当${i % 97},03-1234-${String(i % 10000).padStart(4, '0')},100-000${i % 10},${(i * 137) % 100000},2026/${(i % 12) + 1}/${(i % 28) + 1},${String(i % 1000).padStart(3, '0')},備考テキスト${i % 53},${i % 2 === 0 ? '通常' : '至急'}\r\n`,
    )
  }
  const text = parts.join('')
  writeFileSync(new URL(`rows_${n}_utf8.csv`, LARGE), Buffer.from(text, 'utf8'))
  const s = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' })
  writeFileSync(new URL(`rows_${n}_sjis.csv`, LARGE), Buffer.from(s))
  console.log(`testdata/large/rows_${n}_*.csv`)
}

// ---- xlsx（読み込み確認用）----
// 【重要】書き出しは CSV のみ（仕様確定）。ここでの xlsx 生成は
// 「読める」ことを確かめるための検証用データづくりであって、製品の機能ではない。
const XLSX = await import('xlsx')
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(ROWS), '取引先')
// XLSX.writeFile は ESM 版だと fs が繋がっておらず落ちる（set_fs が要る）。
// バッファを受け取って自分で書けば、その配線は要らない。
writeFileSync(new URL('sample.xlsx', OUT), XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
console.log('testdata/sample.xlsx')

// ---- Shift-JIS で書けない文字を含むデータ ----
// 【重要】em ダッシュと絵文字は CP932 に無い。書き出しで黙って ? になる。
// 「髙」「﨑」「㈱」「①」は CP932 にあるので落ちない。区別が要る。
const HARD = [
  ['取引先名', '備考'],
  ['髙橋﨑商店', '対応済み ① ㈱経由'],
  ['あおぞら商店', '至急—明日まで'],
  ['みどり工業', '担当者が交代しました🙂'],
  ['さくら物産', '通常'],
]
const hardCsv = HARD.map((r) => r.join(',')).join('\r\n') + '\r\n'
writeFileSync(new URL('sample_hard_chars.csv', OUT), Buffer.from(hardCsv, 'utf8'))
console.log('testdata/sample_hard_chars.csv')
