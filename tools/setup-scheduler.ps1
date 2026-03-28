# setup-scheduler.ps1
# タスクスケジューラにSAILタスク通知ジョブを登録する

$nodePath   = (Get-Command node).Source
$scriptPath = 'H:\共有ドライブ\SAIL\ai-management\tools\task-notify.js'
$webhook    = 'https://discord.com/api/webhooks/1485531704209707020/wHntZOLb81IJKjiv-IVQ5j1B54SyvbYjXSNHHQclP6UeaS65MQ8gFW-FfiTCg3WcQeRT'

# ユーザー環境変数にWebhook URLを保存
[System.Environment]::SetEnvironmentVariable('DISCORD_WEBHOOK_URL', $webhook, 'User')
Write-Host "✅ DISCORD_WEBHOOK_URL をユーザー環境変数に設定しました"

# タスク登録（13時）
schtasks /create /tn "SAIL-TaskNotify-13" /tr "`"$nodePath`" `"$scriptPath`"" /sc daily /st 13:00 /f
# タスク登録（22時）
schtasks /create /tn "SAIL-TaskNotify-22" /tr "`"$nodePath`" `"$scriptPath`"" /sc daily /st 22:00 /f

# 確認
Write-Host ""
Write-Host "📋 登録済みタスク:"
schtasks /query /tn "SAIL-TaskNotify-13" /fo list | Select-String "タスク名|次の実行時刻|状態"
schtasks /query /tn "SAIL-TaskNotify-22" /fo list | Select-String "タスク名|次の実行時刻|状態"
