/**
 * オフラインで動かすための登録と、その状態の確認。
 *
 * 【重要】保存するのはアプリ自身のファイルだけ。
 * 利用者のファイルは保存しない。このアプリは利用者のファイルを
 * ネットワークに乗せないので、キャッシュに載る余地がそもそもない。
 *
 * 【もう1つ重要】登録できたことと、保存し終わったことは別である。
 * 登録できた時点で「オフラインでも使えます」と出すと、
 * まだ取り終わっていないのにそう名乗ることになる。実測でその状態を踏んだ
 * （Offline のまま再インストールが走り、保存が失敗しているのに準備完了と出ていた）。
 * だから Service Worker に数えさせて、答えを待ってから出す。
 *
 * 開発中は登録しない。登録すると、直したはずのコードが
 * 古いキャッシュから返ってきて、原因の分からない挙動になる。
 */

export type OfflineState =
  /** この環境では使えない（開発中、または対応していないブラウザ） */
  | { readonly kind: 'unsupported' }
  /** 登録はできた。取得の途中。 */
  | { readonly kind: 'preparing'; readonly stored: number; readonly total: number }
  /** 全部そろった。ネットワークを切っても動く。 */
  | { readonly kind: 'ready'; readonly total: number }
  /** 登録できなかった。オフラインでは動かない（オンラインでは普通に動く）。 */
  | { readonly kind: 'failed' }

type Status = { readonly stored: number; readonly total: number }

/** Service Worker に「いくつ保存できたか」を聞く。 */
function askStatus(worker: ServiceWorker): Promise<Status | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 3000)
    channel.port1.onmessage = (event: MessageEvent<Status>) => {
      clearTimeout(timer)
      resolve(event.data)
    }
    worker.postMessage('status', [channel.port2])
  })
}

export function registerOffline(onChange: (state: OfflineState) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    onChange({ kind: 'unsupported' })
    return
  }

  /** 全部そろうまで、少し待ってから数え直す。 */
  const poll = async (worker: ServiceWorker, tries: number): Promise<void> => {
    const status = await askStatus(worker)
    if (status === null) {
      onChange({ kind: 'failed' })
      return
    }
    if (status.stored >= status.total) {
      onChange({ kind: 'ready', total: status.total })
      return
    }
    onChange({ kind: 'preparing', stored: status.stored, total: status.total })
    if (tries <= 0) return
    setTimeout(() => void poll(worker, tries - 1), 1000)
  }

  const start = (): void => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(async () => {
        const registration = await navigator.serviceWorker.ready
        const worker = registration.active
        if (worker === null) {
          onChange({ kind: 'failed' })
          return
        }
        await poll(worker, 20)
      })
      .catch(() => onChange({ kind: 'failed' }))
  }

  // 【重要】load イベントを待つだけでは登録されないことがある。
  // React の効果が走る時点で、すでに読み込みが終わっていると
  // load は二度と来ない。実測でこれを踏んで、登録が0件だった。
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
