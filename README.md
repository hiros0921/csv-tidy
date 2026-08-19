# csv-tidy

CSV / Excel の汚れを見つけて、直して、書き出すツール。

**ファイルはサーバーへ送信しません。** すべてブラウザの中だけで処理します。
ブラウザにも保存しません（localStorage / IndexedDB / Cookie を使いません）。
タブを閉じれば消えます。

> このREADMEは第7段階で仕上げます。いまは第2段階（読み込みと文字コード）まで。

## 動かし方

```bash
npm install        # SheetJS を公式配布から取るため、初回はネットワークが要ります
npm run fixtures   # 検証用データを testdata/ に作る
npm run dev
npm test           # 22件。ブラウザもDOMも立てずに通る
npm run typecheck
```

## 進捗

- [x] 第2段階：読み込みと文字コード
- [ ] 第3段階：表示（仮想スクロール）
- [ ] 第4段階：検出（Web Worker）
- [ ] 第5段階：修正
- [ ] 第6段階：書き出し
- [ ] 第7段階：公開とREADME
