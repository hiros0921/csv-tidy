import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages はリポジトリ名のサブパスで配信される（第7段階）。
// base をそこに合わせる。ローカルでは '/' のまま動かす。
const base = process.env.GITHUB_PAGES === '1' ? '/csv-tidy/' : '/'

/**
 * オフラインで動かすための Service Worker を、ビルドのたびに作る。
 *
 * 【なぜ要るか】
 * Worker と SheetJS は動的 import なので、必要になった時点で取りに行く。
 * ネットワークが切れていると、そこで失敗する。
 * 「ブラウザの中だけで処理する」と言っておきながら、
 * 途中でネットワークが要るのは、主張として通らない。
 *
 * 【何を保存するか】
 * アプリ自身のファイル（HTML / JS / CSS）だけ。
 * 利用者のファイルは、一切キャッシュしない。というより、
 * このアプリは利用者のファイルをネットワークに乗せないので、
 * キャッシュに載る余地がない。
 *
 * 【ライブラリを足していない理由】
 * Workbox を入れると依存が増え、生成物に何が入るかを自分で説明できなくなる。
 * やることは「一覧を作って、install で取り、fetch で返す」だけなので、
 * 40行ほどで足りる。
 */
function offlinePlugin(publicBase: string): Plugin {
  return {
    name: 'csv-tidy-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const names = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      // 【重要】index.html は、ここでは bundle にまだ入っていない
      // （HTML を作るのは Vite 側の後段）。実測で一覧から漏れていたので、
      // 明示的に足す。/ と /index.html の両方が引けるようにしておく。
      const assets = [publicBase + 'index.html', ...names.map((f) => publicBase + f)]
      // 一覧が変われば版が変わる。古いキャッシュは activate で捨てる。
      const version = createHash('sha256').update(assets.join('|')).digest('hex').slice(0, 12)

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(version, publicBase, assets),
      })

    },

    /**
     * 動的 import のぶんを、最初の読み込みのうちに取っておく。
     *
     * 【重要】modulepreload ではなく prefetch にしている。
     * modulepreload は取得したうえで解析まで走らせるので、
     * CSV しか使わない人にも SheetJS の解析（350kB）を払わせることになる。
     * prefetch は低い優先度で取ってくるだけで、解析は使うときに初めて走る。
     * 最初に読むものの大きさは変わらない。
     */
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const names = Object.keys(ctx.bundle ?? {})
        const deferred = names.filter(
          (f) => f.endsWith('.js') && (f.includes('analyze.worker') || f.includes('xlsx')),
        )
        return deferred.map((f) => ({
          tag: 'link',
          attrs: { rel: 'prefetch', href: publicBase + f, as: 'script' },
          injectTo: 'head' as const,
        }))
      },
    },
  }
}

function serviceWorkerSource(version: string, publicBase: string, assets: readonly string[]): string {
  return `// 自動生成（vite.config.ts の offlinePlugin）。手で編集しない。
//
// アプリ自身のファイルだけを保存する。利用者のファイルは保存しない。
// このアプリは利用者のファイルをネットワークに乗せないので、
// そもそもキャッシュに載る余地がない。
const CACHE = 'csv-tidy-${version}'
const ASSETS = ${JSON.stringify([publicBase, ...assets], null, 2)}
const INDEX = '${publicBase}'

self.addEventListener('install', (event) => {
  // 【重要】addAll は全部そろって初めて成功する（途中で失敗したら全体が失敗）。
  // その場合この Service Worker は捨てられ、前の版が動き続ける。
  // 中途半端な保存で activate させないための性質なので、そのまま使う。
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      // 古い版を待たずに入れ替える。取り残しがあると、
      // 新旧のチャンクが混ざって動かなくなる。
      .then(() => self.skipWaiting()),
  )
})

/**
 * 保存が本当に終わったかを、画面へ答える。
 *
 * 【重要】登録できたことと、保存し終わったことは別である。
 * 登録できた時点で「オフラインでも使えます」と出すと、
 * まだ保存が終わっていないのにそう名乗ることになる。
 * 実測でその状態を踏んだので、数えて答えるようにした。
 */
self.addEventListener('message', (event) => {
  if (event.data !== 'status') return
  const reply = event.ports[0]
  if (!reply) return
  caches
    .open(CACHE)
    .then((cache) => Promise.all(ASSETS.map((a) => cache.match(a))))
    .then((hits) => {
      const stored = hits.filter(Boolean).length
      reply.postMessage({ stored: stored, total: ASSETS.length })
    })
    .catch(() => reply.postMessage({ stored: 0, total: ASSETS.length }))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // 【重要】自分の配信元だけを扱う。外部は素通しにする。
  // といっても、このアプリは外部へ要求を出さない。
  if (url.origin !== self.location.origin) return

  // 画面の読み込みは、保存してある index を返す（オフラインでも開ける）。
  if (request.mode === 'navigate') {
    event.respondWith(caches.match(INDEX).then((hit) => hit || fetch(request)))
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      // 一覧に無いもの（将来の追加など）は、取ってきて保存しておく。
      return fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return res
      })
    }),
  )
})
`
}

export default defineConfig({
  base,
  plugins: [react(), offlinePlugin(base)],
  worker: {
    // 【重要】既定の 'iife' だと Worker の中の動的 import が分割できず、
    // SheetJS が Worker に丸ごと同梱される（実測 755kB）。
    // 'es' にすると別チャンクになり、xlsx を落としたときだけ読まれる。
    format: 'es',
  },
})
