/**
 * Google Calendar OAuth認証スクリプト
 * 実行: node auth.js
 */

const { google } = require("googleapis");
const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const KEYS_FILE = path.join(
  __dirname,
  "../../reference/secrets/gcp-oauth.keys.json.json"
);
const TOKEN_FILE = path.join(
  __dirname,
  "../../reference/secrets/google-calendar-token.json"
);

const keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
const { client_id, client_secret } = keys.installed;
const REDIRECT_URI = "http://localhost:3000/callback";

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\nブラウザで以下のURLを開いて認証してください:\n");
console.log(authUrl);
console.log("\n（自動でブラウザが開かない場合は手動でURLをコピーしてください）\n");

// ブラウザを自動で開く
const openCmd =
  process.platform === "win32"
    ? `start "" "${authUrl}"`
    : process.platform === "darwin"
    ? `open "${authUrl}"`
    : `xdg-open "${authUrl}"`;
exec(openCmd);

// ローカルサーバーでコールバックを受け取る
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== "/callback") return;

  const code = parsed.query.code;
  if (!code) {
    res.end("認証コードが見つかりません。");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

    res.end(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h2>✅ 認証成功！</h2>
        <p>Google Calendarへのアクセスが許可されました。</p>
        <p>このウィンドウを閉じてください。</p>
      </body></html>
    `);

    console.log(`\n✅ 認証成功！トークンを保存しました: ${TOKEN_FILE}\n`);
    server.close();
    process.exit(0);
  } catch (err) {
    console.error("トークン取得エラー:", err.message);
    res.end("エラーが発生しました: " + err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(3000, () => {
  console.log("認証待機中... (http://localhost:3000)\n");
});
