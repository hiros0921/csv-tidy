/**
 * ビルド結果と Service Worker の一覧が合っているかを検査する。
 *
 *   node scripts/check-offline.mjs
 *
 * 【なぜ要るか】
 * チャンクが1つ増えて、それが sw.js の一覧から漏れると、
 * オフラインのときにその機能だけが黙って失敗する。
 * 画面には何も出ないので、気づけない。
 * 「オフラインで動く」と書く以上、機械で確かめる必要がある。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      // 検証用データは製品の一部ではない。オフラインの対象にしない。
      if (name === 'testdata') continue
      out.push(...walk(full))
    } else {
      out.push(full)
    }
  }
  return out
}

const files = walk(DIST).map((f) => '/' + relative(DIST, f))
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8')
const listed = JSON.parse(sw.match(/const ASSETS = (\[[\s\S]*?\n\])/)?.[1] ?? '[]')

// base が付いている場合を吸収して、末尾の相対パスで比べる。
const tail = (p) => p.replace(/^.*\/(assets\/)?/, (m, a) => (a ? 'assets/' : ''))
const listedTails = new Set(listed.map(tail))

const shouldCache = files.filter(
  (f) => (f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.html')) && !f.endsWith('/sw.js'),
)

const missing = shouldCache.filter((f) => !listedTails.has(tail(f)))
const indexCached = listed.some((p) => p.endsWith('/') || p.endsWith('index.html'))

let failed = false
if (missing.length > 0) {
  console.error('!! sw.js の一覧から漏れています（オフラインで壊れます）:')
  for (const m of missing) console.error('   ' + m)
  failed = true
}
if (!indexCached) {
  console.error('!! 画面そのもの（/ または index.html）が一覧にありません')
  failed = true
}

if (failed) process.exit(1)

console.log(`オフラインの一覧: ${listed.length} 件。取りこぼしなし。`)
for (const p of listed) console.log('  ' + p)
