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

/**
 * キャッシュの照合条件。
 *
 * 【重要】ignoreVary を付けないと引けない。実測で踏んだ。
 *
 * 配信側は資産に Vary: Origin を付けて返す（vite preview も GitHub Pages も
 * 付けうる）。一方 Vite が出す <script type="module" crossorigin> と
 * <link rel="stylesheet" crossorigin> は、CORS の要求として送られる。
 * 保存したときの要求と、画面が出す要求で Origin ヘッダの有無が違うため、
 * Vary を見る既定の照合では「別物」と判定されて外れる。
 *
 * その結果どうなるか：キャッシュに有るのに無いことにされ、
 * 取りに行って、オフラインだと失敗する。
 * 実測では index の JS と CSS だけが毎回 160kB 取り直されていた。
 */
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(install())
})

/**
 * 足りないものだけを取る。
 *
 * 【重要】毎回 addAll(ASSETS) を呼ばない。
 * DevTools の「Update on reload」が入っていると、再読み込みのたびに
 * 同じ版が入れ直される。そのときネットワークが切れていると、
 * すでに全部そろっているのに取りに行って失敗する。
 * 実測でこれを踏んだ（オフラインで 4/6 件と表示され、sw.js にエラーが出た）。
 *
 * 先に何が足りないかを数えて、足りないものが無ければ何もしない。
 * こうすると、オフラインでの入れ直しが素通りになる。
 */
async function install() {
  const cache = await caches.open(CACHE)
  const missing = []
  for (const asset of ASSETS) {
    const hit = await cache.match(asset, MATCH)
    if (!hit) missing.push(asset)
  }
  // addAll は全部そろって初めて成功する（途中で失敗したら全体が失敗）。
  // 中途半端な保存で activate させないための性質なので、そのまま使う。
  if (missing.length > 0) {
    try {
      await cache.addAll(missing)
    } catch (cause) {
      // 【重要】ここで握りつぶさない。
      // 握りつぶすと、足りないまま activate してしまい、
      // オフラインのときに一部だけ動かない状態になる。
      // 失敗させれば、この版は捨てられ、前の版が動き続ける。
      // 生の net::ERR_... だけだと読めないので、何が起きたかを添える。
      throw new Error(
        'オフラインのため ' + missing.length + ' 件を保存できませんでした（' +
          missing.join(', ') + '）。前の版がそのまま動きます。',
      )
    }
  }
  // 古い版を待たずに入れ替える。取り残しがあると、
  // 新旧のチャンクが混ざって動かなくなる。
  await self.skipWaiting()
}

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
    .then((cache) => Promise.all(ASSETS.map((a) => cache.match(a, MATCH))))
    .then((hits) => {
      // 【重要】足りないものの名前も返す。件数だけだと原因を追えない。
      const missing = ASSETS.filter((_, i) => !hits[i])
      reply.postMessage({ stored: ASSETS.length - missing.length, total: ASSETS.length, missing: missing })
    })
    .catch(() => reply.postMessage({ stored: 0, total: ASSETS.length, missing: ASSETS }))
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
    event.respondWith(caches.match(INDEX, MATCH).then((hit) => hit || fetch(request)))
    return
  }

  event.respondWith(
    caches.match(request, MATCH).then((hit) => {
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
