/**
 * 正規化。「同じものを同じと見なす」ための道具。
 *
 * 【重要】ここでは値を書き換えない。比較用のキーを作るだけ。
 * 「株式会社ヤマト」と「(株)ヤマト」が同じキーになる、という判断はするが、
 * どちらに寄せるかは決めない（仕様書4章）。
 */

/** 全角の英数字・記号・空白を半角にする。文字そのものは変えない。 */
export function toHalfWidth(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0)
    } else if (code === 0x3000) {
      out += ' ' // 全角スペース
    } else {
      out += ch
    }
  }
  return out
}

/** 半角の英数字を全角にする（逆向き。書き出しでは使わないが、比較で要る） */
export function hasFullWidthAlnum(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // 全角の数字・英大小・よく混ざる記号
    if (code >= 0xff10 && code <= 0xff19) return true
    if (code >= 0xff21 && code <= 0xff3a) return true
    if (code >= 0xff41 && code <= 0xff5a) return true
    if (code === 0xff0d || code === 0xff08 || code === 0xff09) return true
  }
  return false
}

/**
 * 法人格の表記。
 *
 * 【重要】ここに載せたものだけを「同じ」と見なす。
 * 網を広げると、別会社を同一視してしまう。迷ったら載せない（仕様書4章）。
 */
const CORPORATE = [
  '株式会社',
  '(株)',
  '（株）',
  '㈱',
  '有限会社',
  '(有)',
  '（有）',
  '㈲',
  '合同会社',
  '(同)',
  '（同）',
  '合資会社',
  '合名会社',
  '一般社団法人',
  '公益社団法人',
  '一般財団法人',
  '公益財団法人',
  '医療法人',
  '学校法人',
  '社会福祉法人',
  '特定非営利活動法人',
  'NPO法人',
]

/** 法人格が含まれているか。表記揺れの検出を、法人名らしきものに絞るために使う。 */
export function hasCorporateForm(text: string): boolean {
  return CORPORATE.some((form) => text.includes(form))
}

/**
 * 比較用のキーを作る。
 *
 * 法人格を落とし、全角半角をそろえ、空白と中黒を落とす。
 * 「株式会社ヤマト商事」「(株)ヤマト商事」「㈱ ヤマト商事」→ すべて「ヤマト商事」。
 */
export function normalizeKey(text: string): string {
  let s = toHalfWidth(text).trim()
  for (const form of CORPORATE) {
    s = s.split(form).join('')
  }
  // 空白・中黒・長音の揺れを落とす
  s = s.replace(/[\s・･]/g, '')
  return s.toLowerCase()
}

/** 先頭・末尾の空白（全角スペースを含む）がどこにあるか。 */
export function spacePosition(text: string): 'lead' | 'trail' | 'both' | null {
  if (text === '') return null
  const lead = /^[\s　]/.test(text)
  const trail = /[\s　]$/.test(text)
  if (lead && trail) return 'both'
  if (lead) return 'lead'
  if (trail) return 'trail'
  return null
}

/** 先頭・末尾の空白を落とす（全角スペースも対象）。 */
export function trimBoth(text: string): string {
  return text.replace(/^[\s　]+|[\s　]+$/g, '')
}
