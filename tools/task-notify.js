/**
 * task-notify.js
 * スプレッドシートの未着手タスクとGoogleカレンダーを照合し、
 * 担当者ごとにDiscordへ通知するスクリプト
 *
 * 実行方法: node task-notify.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── 設定 ───────────────────────────────────────────────
const SECRETS_DIR = 'H:/共有ドライブ/SAIL/ai-management/reference/secrets';
const TOKEN_FILE  = path.join(SECRETS_DIR, 'google-calendar-token.json');
const OAUTH_FILE  = path.join(SECRETS_DIR, 'gcp-oauth.keys.json.json');

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const SPREADSHEET_ID  = '1GjCpRj6nOHXkAwovaYlTozDzw2GZ23sQuAnZGxP3_Xc';
const SHEET_GID       = '1005158658';

const MENTIONS = {
  '石井': '<@1105463409371267092>',
  '内藤': '<@1377953149947744378>',
};
// ──────────────────────────────────────────────────────

// HTTPリクエスト（Promise）
function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// リダイレクト付きGET
function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && maxRedirects > 0) {
        fetchUrl(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// OAuthトークンのリフレッシュ
async function getAccessToken() {
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const oauth = JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8')).installed;

  // 有効期限に余裕があればそのまま使う
  if (token.expiry_date > Date.now() + 5 * 60 * 1000) {
    return token.access_token;
  }

  const body = new URLSearchParams({
    client_id:     oauth.client_id,
    client_secret: oauth.client_secret,
    refresh_token: token.refresh_token,
    grant_type:    'refresh_token',
  }).toString();

  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  const newToken = JSON.parse(res.body);
  token.access_token = newToken.access_token;
  token.expiry_date  = Date.now() + newToken.expires_in * 1000;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
  return token.access_token;
}

// Googleカレンダーイベント取得（今日から7日間）
async function getEvents(accessToken) {
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const timeMin = today.toISOString();
  const timeMax = new Date(today.getTime() + 7 * 86400000).toISOString();

  const qs = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '100',
  });

  const res = await httpRequest({
    hostname: 'www.googleapis.com',
    path:     `/calendar/v3/calendars/primary/events?${qs}`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${accessToken}` },
  });

  return JSON.parse(res.body).items || [];
}

// CSV簡易パーサー
function parseCSV(csv) {
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h.replace(/^"|"$/g, '').trim()] = (vals[i] || '').replace(/^"|"$/g, '').trim());
    return row;
  });
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// 日本語日付 → Dateオブジェクト（例: "3月23日(月)" → Date）
function parseJpDate(str) {
  if (!str) return null;
  const m = str.match(/(\d+)月(\d+)日/);
  if (!m) return null;
  const now = new Date();
  let year = now.getFullYear();
  const month = parseInt(m[1]) - 1;
  // 1〜3月で現在が10〜12月なら翌年扱い
  if (month < 3 && now.getMonth() > 8) year++;
  return new Date(year, month, parseInt(m[2]));
}

// 指定日のカレンダーの空き時間を返す（8:00〜22:00内、30分以上の隙間）
function getFreeSlots(events, date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 8, 0);
  const dayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 22, 0);

  const busy = events
    .filter(e => e.start.dateTime)
    .map(e => ({ s: new Date(e.start.dateTime), e: new Date(e.end.dateTime) }))
    .filter(b => b.s < dayEnd && b.e > dayStart)
    .sort((a, b) => a.s - b.s);

  const slots = [];
  let cursor = dayStart;

  for (const b of busy) {
    if (b.s > cursor && b.s - cursor >= 30 * 60000) {
      slots.push({ start: cursor, end: b.s });
    }
    if (b.e > cursor) cursor = b.e;
  }
  if (dayEnd > cursor && dayEnd - cursor >= 30 * 60000) {
    slots.push({ start: cursor, end: dayEnd });
  }
  return slots;
}

function fmt(date) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
function fmtDate(date) {
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// Discordに送信
async function sendDiscord(content) {
  if (!DISCORD_WEBHOOK) throw new Error('DISCORD_WEBHOOK_URL が未設定です');
  const body = JSON.stringify({ content });
  const u = new URL(DISCORD_WEBHOOK);
  const res = await httpRequest({
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  return res.status;
}

// メイン
async function main() {
  console.log('🔄 トークン取得中...');
  const accessToken = await getAccessToken();

  console.log('📅 カレンダー取得中...');
  const events = await getEvents(accessToken);

  console.log('📋 スプレッドシート取得中...');
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
  const csv = await fetchUrl(csvUrl);
  const rows = parseCSV(csv);

  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today.getTime() + 7 * 86400000);

  // 6列目（空ヘッダー）が作業状態（完了/未着手/作業中）
  // 5列目「ステータス」が担当者名
  const STATUS_COL = ''; // CSVの空ヘッダー列
  const pending = rows.filter(r =>
    r[STATUS_COL] === '未着手' || r[STATUS_COL] === '作業中'
  );

  for (const person of ['石井', '内藤']) {
    // 列名は「ステータス」（担当者名が入る列）
    const tasks = pending.filter(r => r['ステータス'] === person);
    if (tasks.length === 0) continue;

    const mention = MENTIONS[person] || person;

    // 列名が長い「項目（完了したら...）」を動的に検索
    const itemKey = Object.keys(tasks[0] || {}).find(k => k.startsWith('項目')) || '項目';

    const overdue  = tasks.filter(t => { const d = parseJpDate(t['期限']); return d && d < today; });
    const thisWeek = tasks.filter(t => { const d = parseJpDate(t['期限']); return d && d >= today && d <= nextWeek; });
    const later    = tasks.filter(t => { const d = parseJpDate(t['期限']); return !d || d > nextWeek; });

    let msg = `${mention} **${person} 担当タスク（${fmtDate(today)}〜${fmtDate(nextWeek)}）**\n`;

    if (overdue.length > 0) {
      msg += `\n⚠️ **[期限切れ ${overdue.length}件]**\n`;
      overdue.forEach(t => {
        msg += `・No.${t['No.']} ${t[itemKey]}（${t['期限']}）\n`;
      });
    }

    if (thisWeek.length > 0) {
      // 日付ごとにグループ化
      const byDate = {};
      thisWeek.forEach(t => {
        const k = t['期限'] || '期限なし';
        (byDate[k] = byDate[k] || []).push(t);
      });

      for (const [dateStr, dateTasks] of Object.entries(byDate)) {
        const d = parseJpDate(dateStr);
        const slots = d ? getFreeSlots(events, d) : [];
        const slotStr = slots.length > 0
          ? `${fmt(slots[0].start)}〜${fmt(slots[0].end)}`
          : '空き時間に';
        msg += `\n**【${dateStr}（${slotStr}）】**\n`;
        dateTasks.forEach(t => {
          msg += `・No.${t['No.']} ${t[itemKey]}\n`;
        });
      }
    }

    if (later.length > 0) {
      msg += `\n**【来週以降】**\n`;
      later.slice(0, 4).forEach(t => {
        msg += `・No.${t['No.']} ${t[itemKey]}（${t['期限'] || '期限なし'}）\n`;
      });
      if (later.length > 4) msg += `　…他${later.length - 4}件\n`;
    }

    msg += `\n✅ 対応タスク合計: ${tasks.length}件`;

    // Discord上限2000文字
    if (msg.length > 1990) msg = msg.slice(0, 1990) + '…';

    console.log(`📤 ${person} へ送信中...`);
    const status = await sendDiscord(msg);
    console.log(`  → HTTP ${status}`);

    // レート制限対策
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('✅ 完了！');
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
