# AGENTS.md — trgirai-kanri

タカラレンタックスグループ向け社内管理ツール。SNS・採用・反響・タスク・マニュアル等を一元管理するReact製のSPAです。

## 技術スタック

| 分類 | 技術 |
|------|------|
| フロントエンド | React 19 + TypeScript + Vite |
| スタイル | CSS (App.css) |
| グラフ | Recharts |
| リッチテキスト | Tiptap v3 |
| バックエンド | Supabase (PostgreSQL) |
| 認証 | Google OAuth (`@react-oauth/google`) |
| サーバーレス関数 | Vercel Functions (`api/` ディレクトリ) |
| デプロイ | Vercel |
| 外部連携 | Google Sheets API, Google Calendar API |

## プロジェクト構成

```
trgirai-kanri/
├── api/               # Vercel サーバーレス関数
├── src/
│   ├── App.tsx        # メインコンポーネント
│   ├── ManualsPage.tsx # マニュアル管理タブ
│   ├── supabase.ts    # Supabaseクライアント初期化
│   └── App.css        # スタイル
├── supabase/          # Supabaseマイグレーション等
├── vercel.json        # Vercelデプロイ設定
└── vite.config.ts
```

## 主要コマンド

```bash
npm run dev      # 開発サーバー起動 (localhost:5173)
npm run build    # TypeScriptコンパイル + Viteビルド
npm run lint     # ESLintチェック
```

## ページ構成

`PageKey` 型で管理。上部ナビゲーションで切り替え。

| キー | 名称 | 概要 |
|------|------|------|
| `dashboard` | ダッシュボード | カレンダー・タスク概覧 |
| `analysis` | 分析 | SNS分析 |
| `busho` | 部署予定 | 部署別予定管理 |
| `tasks` | 案件管理 | 案件管理 |
| `taskmanagement` | タスク管理 | 担当者別タスク・Slack通知 |
| `recruitment` | 採用管理 | 採用記録・コスト削減集計 |
| `hankyo` | 反響管理 | 反響記録・集計 |
| `jishashukyaku` | 自社集客売上 | 自社集客・売上集計 |
| `members` | 当日業務管理 | メンバー別業務管理 |
| `taskreport` | 業務棚卸し | 業務時間の集計 |
| `snsproperty` | SNS物件管理 | SNS物件情報の管理 |
| `progress` | 進捗管理 | 物件進捗の管理 |
| `stock` | ストック管理 | ストック件数管理 |
| `manuals` | Note | Tiptapリッチエディタ |

## Supabase テーブル

主要テーブル（`supabase` クライアント経由でアクセス）:
- `tasks` — 業務タスク
- `sns_posts` — SNS投稿記録
- `recruitment_records` — 採用記録
- `task_items` — タスク管理アイテム
- `members` — メンバー情報
- `hankyo_records` — 反響記録
- `manuals` — マニュアル (Tiptap JSONコンテンツ)

## 環境変数

`.env` ファイルに以下が必要:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_SHEETS_API_KEY=...
VITE_GOOGLE_CALENDAR_API_KEY=...
```

Vercel Functions 側では、各APIが必要に応じて `process.env` を参照します。

## コーディング規則

- **言語**: TypeScript strict。型定義は上部にまとめる。
- **コンポーネント分割**: 現状 `App.tsx` に集中。大きな独立機能は `ManualsPage.tsx` のように別ファイルへ分離する。
- **状態管理**: React hooks のみ (`useState`, `useEffect`, `useCallback`, `useRef`)。外部状態管理ライブラリなし。
- **Supabase アクセス**: `src/supabase.ts` の `supabase` クライアントを使用。
- **スタイル**: CSS クラスは `App.css` に定義。インラインスタイルは最小限に。
- **日本語UI**: ラベル・メッセージはすべて日本語。
- **コメント**: 日本語で書く。

## 注意事項

- `src/App.tsx` は大きなファイル。編集時は対象セクションを明確に絞ること。
- Vercel Functions (`api/`) はNode.js環境。`import.meta.env` は使えないため `process.env` を使う。
- Slack通知はWebhook URL経由でSupabaseのEdge Functionsまたはバックエンド側から行う想定。

## 完了報告のルール

コードや設定ファイルを変更した場合、「完了」と言う前に必ず次の順番で作業する。

1. 変更内容を確認する。
2. `npm.cmd run build` でエラーがないか確認する。
3. 変更したファイルだけを `git add` する。
4. 何を直したか分かるコメント付きで `git commit` する。
5. `git push origin main` でGitHubへ反映する。
6. `npx.cmd vercel --prod --yes` で本番デプロイする。
7. Vercelの本番デプロイが成功したことを確認してから、初めて「完了」と言う。

途中で失敗した場合は「完了」と言わず、「どの段階まで終わったか」と「どこで止まっているか」を報告する。