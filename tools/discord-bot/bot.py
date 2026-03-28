import os
import asyncio
import hashlib
import time
import base64
import discord
import requests

DISCORD_BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "ry-ishii-byte/sai-voyager")
GITHUB_API = "https://api.github.com"

intents = discord.Intents.default()
intents.message_content = True
bot = discord.Client(intents=intents)


def github_headers():
    return {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
    }


def create_instruction_file(content: str, author: str) -> str:
    """instructions/ に指示ファイルを作成してファイル名を返す"""
    ts = int(time.time())
    unique = hashlib.md5(f"{ts}{content}".encode()).hexdigest()[:8]
    filename = f"instructions/{ts}_{unique}.md"
    body = f"# Discord指示\n\n**送信者:** {author}\n**時刻:** {ts}\n\n## 指示内容\n\n{content}\n"

    encoded = base64.b64encode(body.encode()).decode()
    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{filename}"
    resp = requests.put(
        url,
        headers=github_headers(),
        json={"message": f"Discord指示追加: {content[:50]}", "content": encoded},
    )
    resp.raise_for_status()
    return filename


def get_result_file(instruction_filename: str) -> str | None:
    """結果ファイルが存在すれば内容を返す、なければNone"""
    base = instruction_filename.replace("instructions/", "").replace(".md", "")
    result_path = f"output/{base}_result.md"
    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{result_path}"
    resp = requests.get(url, headers=github_headers())
    if resp.status_code == 200:
        data = resp.json()
        content = base64.b64decode(data["content"]).decode()
        return content
    return None


async def wait_for_result(instruction_filename: str, discord_message, timeout=7200):
    """結果ファイルが作成されるまで待機してDiscordに通知"""
    elapsed = 0
    interval = 30
    while elapsed < timeout:
        await asyncio.sleep(interval)
        elapsed += interval
        try:
            result = get_result_file(instruction_filename)
            if result:
                # 2000文字制限対応
                if len(result) > 1900:
                    result = result[:1900] + "\n\n...（続きはGitHubで確認）"
                await discord_message.reply(f"✅ 完了しました\n\n{result}")
                return
        except Exception:
            pass
    await discord_message.reply(
        f"⏰ タイムアウト（2時間経過）。GitHubで確認してください: "
        f"https://github.com/{GITHUB_REPO}"
    )


@bot.event
async def on_ready():
    print(f"Bot起動: {bot.user} (ID: {bot.user.id})")


@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    is_dm = isinstance(message.channel, discord.DMChannel)
    is_mentioned = bot.user in message.mentions
    if not is_dm and not is_mentioned:
        return

    content = message.content.replace(f"<@{bot.user.id}>", "").strip()
    if not content:
        await message.reply("指示を入力してください。")
        return

    async with message.channel.typing():
        try:
            filename = create_instruction_file(content, message.author.display_name)
            await message.reply(
                f"📥 指示を受け付けました。\n"
                f"Claude Codeが処理します（最大1時間）。完了後に通知します。\n"
                f"🔗 https://github.com/{GITHUB_REPO}"
            )
            asyncio.create_task(wait_for_result(filename, message))
        except Exception as e:
            await message.reply(f"❌ エラーが発生しました: {e}")


bot.run(DISCORD_BOT_TOKEN)
