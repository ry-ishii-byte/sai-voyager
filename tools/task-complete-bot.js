/**
 * task-complete-bot.js
 * Discordチャンネルを監視し、タスク番号が送信されたらスプレッドシートを完了に更新する
 *
 * 使い方:
 *   Discordに「完了 150」「150」「No.150」などと送信する
 *
 * 起動: node task-complete-bot.js
 */

const https = require('https');

// ── 設定 ──────────────────────────────────────────────
const BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID   = process.env.DISCORD_CHANNEL_ID;
const GAS_URL      = 'https://script.google.com/macros/s/AKfycbwEnuWzBLpjgfEd0EB_PnAOufr1muX2qSlkhvphUJgjvb5HsZbeUqVORL4H9NDpjT6v/exec';
const POLL_INTERVAL = 15000; // 15秒ごとにポーリング
// ──────────────────────────────────────────────────────

// HTTPリクエスト
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// HTTPリダイレクトを追いながらGETする
function getFollowRedirect(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301,302,303,307].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        getFollowRedirect(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// GAS経由でスプレッドシートを完了に更新
async function markTaskComplete(taskNo) {
  const body = `taskNo=${encodeURIComponent(taskNo)}`;

  // POSTしてLocationヘッダーを取得
  const res = await new Promise((resolve, reject) => {
    const u = new URL(GAS_URL);
    const req = https.request({
      hostname: u.hostname,
      path:     u.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // GASは302でリダイレクト先URLを返す
  const redirectUrl = res.location || res.body.match(/HREF="([^"]+)"/)?.[1];
  if (!redirectUrl) throw new Error('リダイレクト先が取得できませんでした');

  const json = await getFollowRedirect(redirectUrl);
  return JSON.parse(json);
}

// Discordチャンネルのメッセージ取得
async function fetchMessages(after) {
  const qs = after ? `?after=${after}&limit=10` : `?limit=5`;
  const res = await request({
    hostname: 'discord.com',
    path:     `/api/v10/channels/${CHANNEL_ID}/messages${qs}`,
    method:   'GET',
    headers:  { Authorization: `Bot ${BOT_TOKEN}` },
  });
  return JSON.parse(res.body);
}

// Discordにメッセージ送信
async function sendDiscord(content, replyToId) {
  const payload = { content };
  if (replyToId) payload.message_reference = { message_id: replyToId };
  const body = JSON.stringify(payload);
  await request({
    hostname: 'discord.com',
    path:     `/api/v10/channels/${CHANNEL_ID}/messages`,
    method:   'POST',
    headers:  {
      Authorization:  `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}


// メッセージからタスク番号を抽出
function extractTaskNo(content) {
  // 「完了 150」「150完了」「No.150」「#150」「150」などに対応
  const patterns = [
    /完了[^\d]*(\d+)/,
    /(\d+)[^\d]*完了/,
    /[Nn]o\.?\s*(\d+)/,
    /^(\d+)$/,
  ];
  for (const pat of patterns) {
    const m = content.trim().match(pat);
    if (m) return m[1];
  }
  return null;
}

// メイン
async function main() {
  if (!BOT_TOKEN)  { console.error('❌ DISCORD_BOT_TOKEN が未設定'); process.exit(1); }
  if (!CHANNEL_ID) { console.error('❌ DISCORD_CHANNEL_ID が未設定'); process.exit(1); }

  console.log('🤖 タスク完了Botを起動しました');
  console.log(`📡 チャンネル ${CHANNEL_ID} を監視中...`);
  console.log('使い方: Discordに「完了 150」「150」「No.150」などと送信\n');

  // 最新のメッセージIDを起点にする（起動前のメッセージは無視）
  const initial = await fetchMessages(null);
  let lastId = Array.isArray(initial) && initial.length > 0 ? initial[0].id : '0';

  setInterval(async () => {
    try {
      const messages = await fetchMessages(lastId);
      if (!Array.isArray(messages) || messages.length === 0) return;

      // 古い順に処理
      const sorted = messages.sort((a, b) => a.id.localeCompare(b.id));

      for (const msg of sorted) {
        lastId = msg.id;
        if (msg.author?.bot) continue; // Botのメッセージは無視

        const taskNo = extractTaskNo(msg.content);
        if (!taskNo) continue;

        console.log(`📨 「${msg.content}」を受信 → No.${taskNo} を完了に更新中...`);

        try {
          const title = await markTaskComplete(taskNo);
          if (title) {
            const shortTitle = title.length > 40 ? title.slice(0, 40) + '…' : title;
            await sendDiscord(`✅ No.${taskNo}「${shortTitle}」を完了にしました！`, msg.id);
            console.log(`  ✅ No.${taskNo} 完了`);
          } else {
            await sendDiscord(`⚠️ No.${taskNo} は見つかりませんでした`, msg.id);
            console.log(`  ⚠️ No.${taskNo} 見つからず`);
          }
        } catch (err) {
          console.error(`  ❌ 更新エラー:`, err.message);
          await sendDiscord(`❌ エラーが発生しました: ${err.message}`, msg.id);
        }
      }
    } catch (err) {
      console.error('ポーリングエラー:', err.message);
    }
  }, POLL_INTERVAL);
}

main();
