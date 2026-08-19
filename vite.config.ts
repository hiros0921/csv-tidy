import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages はリポジトリ名のサブパスで配信される（第7段階）。
// base をそこに合わせる。ローカルでは '/' のまま動かす。
const base = process.env.GITHUB_PAGES === '1' ? '/csv-tidy/' : '/'

export default defineConfig({
  base,
  plugins: [react()],
  worker: {
    // 【重要】既定の 'iife' だと Worker の中の動的 import が分割できず、
    // SheetJS が Worker に丸ごと同梱される（実測 755kB）。
    // 'es' にすると別チャンクになり、xlsx を落としたときだけ読まれる。
    format: 'es',
  },
})
