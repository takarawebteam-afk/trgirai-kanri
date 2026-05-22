# React + TypeScript + Vite

## 納品管理シートから管理ツールへ送るAPI

GoogleスプレッドシートのGASから、物件名と号室だけを管理ツールへ反映するAPIです。

- API URL: `https://trgirai-kanri.vercel.app/api/sheet-import`
- メソッド: `POST`
- 認証ヘッダー: `x-api-key`
- Vercelに設定する環境変数: `SHEET_IMPORT_API_KEY`

反映先は次の2つだけです。

- `Karilun｜西宮市`: `JR西宮店`
- `Karilun｜京阪`: `枚方店`, `守口店`, `寝屋川店`

既存一覧に「物件名」と「号室」がどちらも空の行があれば、上から最初の空欄行へ入力します。空欄行がない場合は新しい行を追加します。投稿予定日など、ほかの列は上書きしません。

curlでのテスト例:

```bash
curl -X POST "https://trgirai-kanri.vercel.app/api/sheet-import" \
  -H "Content-Type: application/json" \
  -H "x-api-key: Vercelに設定したSHEET_IMPORT_API_KEYの値" \
  -d "{\"storeName\":\"枚方店\",\"propertyName\":\"テストマンション\",\"roomNumber\":\"202\",\"destinationName\":\"Karilun｜京阪\"}"
```

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
