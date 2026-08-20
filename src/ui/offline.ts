/**
 * オフラインで動かすための登録。
 *
 * 【重要】保存するのはアプリ自身のファイルだけ。
 * 利用者のファイルは保存しない。このアプリは利用者のファイルを
 * ネットワークに乗せないので、キャッシュに載る余地がそもそもない。
 *
 * 開発中は登録しない。登録すると、直したはずのコードが
 * 古いキャッシュから返ってきて、原因の分からない挙動になる。
 */

/** いま Service Worker が働いているか。画面に出すために使う。 */
export type OfflineState = 'unsupported' | 'registering' | 'ready' | 'failed'

export function registerOffline(onChange: (state: OfflineState) => void): void {
  if (!import.meta.env.PROD) {
    onChange('unsupported')
    return
  }
  if (!('serviceWorker' in navigator)) {
    onChange('unsupported')
    return
  }

  onChange(navigator.serviceWorker.controller === null ? 'registering' : 'ready')

  const start = (): void => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(async (registration) => {
        // 取り終わるまでは「準備中」。取り終わったら「オフラインでも動く」。
        await navigator.serviceWorker.ready
        if (registration.active !== null) onChange('ready')
      })
      .catch(() => onChange('failed'))
  }

  // 【重要】load イベントを待つだけでは登録されないことがある。
  // React の効果が走る時点で、すでに読み込みが終わっていると
  // load は二度と来ない。実測でこれを踏んで、登録が0件だった。
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })

  navigator.serviceWorker.addEventListener('controllerchange', () => onChange('ready'))
}
