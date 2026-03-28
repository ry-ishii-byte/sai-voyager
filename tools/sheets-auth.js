/**
 * sheets-auth.js
 * Google Sheets + Calendar の OAuth トークンを取得・保存する
 * node sheets-auth.js を実行し、表示されたURLを開いてコードを貼り付ける
 */

const https   = require('https');
const fs      = require('fs');
const readline = require('readline');

const OAUTH_FILE = 'H:/共有ドライブ/SAIL/ai-management/reference/secrets/gcp-oauth.keys.json.json';
const TOKEN_FILE = 'H:/共有ドライブ/SAIL/ai-management/reference/secrets/google-sheets-token.json';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob'; // ローカルサーバー不要

const oauth = JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8')).installed;

const authUrl = 'https://accounts.google.com/o/oauth2/auth?' +
  'client_id=' + oauth.client_id +
  '&redirect_uri=' + encodeURIComponent(REDIRECT) +
  '&response_type=code' +
  '&scope=' + encodeURIComponent(SCOPES) +
  '&access_type=offline&prompt=consent';

console.log('\n以下のURLをブラウザで開いてください:\n');
console.log(authUrl);
console.log('\nGoogleアカウントでログイン後、表示された「コード」をここに貼り付けてEnterを押してください。\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('コード: ', async (code) => {
  rl.close();
  code = code.trim();

  const body = new URLSearchParams({
    code,
    client_id:     oauth.client_id,
    client_secret: oauth.client_secret,
    redirect_uri:  REDIRECT,
    grant_type:    'authorization_code',
  }).toString();

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (result.error) {
    console.error('❌ エラー:', result.error_description);
    process.exit(1);
  }

  const token = {
    access_token:  result.access_token,
    refresh_token: result.refresh_token,
    scope:         result.scope,
    token_type:    result.token_type,
    expiry_date:   Date.now() + result.expires_in * 1000,
  };

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
  console.log('\n✅ トークンを保存しました！');
});
