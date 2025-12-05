# wrk-wanya.me

Cloudflare Workers で `/api/contact` エンドポイントを提供し、`hugo-wanya.me` から送信された問い合わせ内容を Resend 経由でメール転送します。Turnstile によるボット検証と最低限の入力バリデーションを行います。

## 必要環境

- Cloudflare アカウント（Pages + Workers 有効化済み）
- Resend アカウント（ドメイン認証済み）
- Node.js 20 以上（`wrangler` CLI 用）

## セットアップ

```bash
cd wrk-wanya.me
npm install
npx wrangler login
```

### 環境変数 / Secrets

| 名前 | 種別 | 用途 |
| --- | --- | --- |
| `RESEND_API_KEY` | secret | Resend API 認証用トークン |
| `FROM_EMAIL` | secret | Resend で検証済みの送信元アドレス |
| `TO_EMAIL` | secret | 受信先（転送先）アドレス |
| `TURNSTILE_SECRET` | secret | Turnstile サーバー側検証キー |
| `ALLOWED_ORIGINS` | var | CORS 許可オリジン（カンマ区切り） |
| `SITE_NAME` | var | メール本文に表示するサイト名 |
| `RESEND_DISABLED` | var | `true` でメール送信をスキップ（ローカルテスト用） |

`secret` は `wrangler secret put RESEND_API_KEY` のように登録します。`vars` は `wrangler.toml` で定義可能です。

## ローカル開発

```bash
npm run dev
```

- デフォルトで `http://127.0.0.1:8787/api/contact` が起動。
- `wrangler.toml` の `vars.ALLOWED_ORIGINS` を `http://localhost:1313` などに設定すると CORS テストが容易です。
- `RESEND_DISABLED=true` を `.dev.vars` や環境変数で指定すると、Resend API を呼ばずにレスポンスを確認できます。

## デプロイ

```bash
npm run deploy
```

Cloudflare Pages のプロジェクトと同じアカウントで実行すると、`/api/contact*` ルートをこの Worker に紐づけられます。Pages 側の Build & Deploy が完了したら、Routes もしくは Pages Functions 設定で当該 Worker を指定してください。

## API 仕様

- **Endpoint:** `POST /api/contact`
- **Content-Type:** `application/json`
- **リクエストボディ:**
  ```json
  {
    "name": "string",
    "email": "string",
    "phone": "string",
    "subject": "string",
    "budget": "string",
    "deadline": "string",
    "message": "string",
    "turnstileToken": "string"
  }
  ```
- **レスポンス:**
  ```json
  { "success": true }
  ```
  失敗時は `400/422/500` などのステータスと `{ "success": false, "error": "..." }` を返します。

## 注意事項

- Resend 送信ドメインの DNS レコード（SPF, DKIM）は必ず有効化してください。
- Turnstile secret を設定しない場合、全てのリクエストが拒否されます。
- Cloudflare Logs には個人情報を残さない方針のため、`console.log` は最小限にしています。

## テスト

```bash
npm test
```

`tests/contact.test.ts` が Worker を直接呼び出し、Turnstile と Resend への `fetch` をモックします。ENV はテスト内でスタブしているため、Secrets 未設定でも実行できます。
