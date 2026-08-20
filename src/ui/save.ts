/**
 * バイト列をファイルとして保存させる。
 *
 * 【重要】ここでも通信は起きない。
 * Blob を作って、その場でリンクを踏ませているだけである。
 * サーバーへ送ってから返すやり方は、このツールでは選べない（仕様書2章）。
 *
 * 元のファイルは開いたまま触っていない。書き出しは必ず別のファイルになる。
 */

export function saveBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string): void {
  // 型は text/csv だが、中身の文字コードはこちらが決めている。
  // charset は書かない。Shift-JIS で書いたのに utf-8 と名乗ると、
  // 開く側が化ける。
  const blob = new Blob([bytes], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // すぐ消すと保存が始まらないことがあるので、少し待ってから捨てる。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
