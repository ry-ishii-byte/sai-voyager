import os
import discord
from anthropic import Anthropic

anthropic = Anthropic()
intents = discord.Intents.default()
intents.message_content = True
bot = discord.Client(intents=intents)

# チャンネルごとの会話履歴（コスト節約のため最大10往復）
conversations = {}
MAX_HISTORY = 10

SYSTEM_PROMPT = """あなたはSAILのDiscordアシスタントです。
日本語で簡潔に返答してください。
タスク管理、スケジュール確認、業務の質問に対応します。"""


@bot.event
async def on_ready():
    print(f"Bot起動: {bot.user} (ID: {bot.user.id})")


@bot.event
async def on_message(message):
    # 自分のメッセージは無視
    if message.author == bot.user:
        return

    # !reset コマンド
    if message.content.strip() == "!reset":
        conversations.pop(str(message.channel.id), None)
        await message.reply("会話履歴をリセットしました。")
        return

    # メンション or DM のみ反応
    is_dm = isinstance(message.channel, discord.DMChannel)
    is_mentioned = bot.user in message.mentions
    if not is_dm and not is_mentioned:
        return

    # メンション部分を除去
    content = message.content.replace(f"<@{bot.user.id}>", "").strip()
    if not content:
        await message.reply("はい、何でしょう？")
        return

    channel_id = str(message.channel.id)
    if channel_id not in conversations:
        conversations[channel_id] = []

    # 履歴に追加
    conversations[channel_id].append({
        "role": "user",
        "content": f"{message.author.display_name}: {content}"
    })

    # 履歴が長くなりすぎたらトリム（コスト節約）
    if len(conversations[channel_id]) > MAX_HISTORY * 2:
        conversations[channel_id] = conversations[channel_id][-MAX_HISTORY * 2:]

    async with message.channel.typing():
        try:
            response = anthropic.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=conversations[channel_id]
            )

            reply = response.content[0].text

            # 履歴に返答を追加
            conversations[channel_id].append({
                "role": "assistant",
                "content": reply
            })

            # Discord は2000文字制限
            if len(reply) > 2000:
                for i in range(0, len(reply), 2000):
                    await message.reply(reply[i:i+2000])
            else:
                await message.reply(reply)

        except Exception as e:
            await message.reply(f"エラーが発生しました: {e}")


bot.run(os.environ["DISCORD_BOT_TOKEN"])
