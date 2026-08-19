import type { CharEncoding, Confidence, Detection } from '../io/encoding.ts'
import { ENCODING_LABEL } from '../io/encoding.ts'

const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = {
  certain: '確実',
  high: '確度 高',
  low: '確度 低',
  fallback: '推定できず（既定値）',
}

/** low と fallback は目立たせる。自動判定は外れる前提（仕様書5章）。 */
const CONFIDENCE_CLASS: Readonly<Record<Confidence, string>> = {
  certain: 'conf conf--ok',
  high: 'conf conf--ok',
  low: 'conf conf--warn',
  fallback: 'conf conf--warn',
}

const CHOICES: readonly CharEncoding[] = [
  'shift_jis',
  'utf-8',
  'utf-8-bom',
  'utf-16le',
  'utf-16be',
]

type Props = {
  readonly detection: Detection | null
  readonly onChange: (encoding: CharEncoding) => void
  readonly busy: boolean
}

export function EncodingBar({ detection, onChange, busy }: Props) {
  if (detection === null) {
    return (
      <div className="encbar">
        <span className="encbar__label">文字コード</span>
        <span className="encbar__note">
          xlsx は中身が UTF-8 の XML です。文字コードの判定はありません。
        </span>
      </div>
    )
  }

  return (
    <div className="encbar">
      <span className="encbar__label">文字コード</span>
      <select
        value={detection.encoding}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as CharEncoding)}
      >
        {CHOICES.map((enc) => (
          <option key={enc} value={enc}>
            {ENCODING_LABEL[enc]}
          </option>
        ))}
      </select>
      <span className={CONFIDENCE_CLASS[detection.confidence]}>
        {CONFIDENCE_LABEL[detection.confidence]}
      </span>
      <span className="encbar__note">{detection.reason}</span>
      {(detection.confidence === 'low' || detection.confidence === 'fallback') && (
        <span className="encbar__warn">
          文字化けしていたら、ここを変えてください。読み直します。
        </span>
      )}
    </div>
  )
}
