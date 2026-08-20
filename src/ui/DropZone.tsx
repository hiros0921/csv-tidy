import { useCallback, useRef, useState } from 'react'

type Props = {
  readonly onFile: (file: File) => void
  readonly disabled: boolean
}

export function DropZone({ onFile, disabled }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setOver(false)
      if (disabled) return
      const file = e.dataTransfer.files.item(0)
      if (file !== null) onFile(file)
    },
    [onFile, disabled],
  )

  return (
    <div
      className={`drop ${over ? 'drop--over' : ''} ${disabled ? 'drop--disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <p className="drop__main">CSV または Excel ファイルをここにドロップ</p>
      <p className="drop__sub">クリックして選ぶこともできます（.csv .tsv .txt .xlsx .xls）</p>
      <input
        ref={inputRef}
        id="file-input"
        name="file"
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
        hidden
        onChange={(e) => {
          const file = e.target.files?.item(0)
          if (file != null) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
