[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Copy files to temp with simple names, then read
$base = "H:\共有ドライブ\SAIL\36_アントレベース"
$tmp = "C:\Temp\sail_docs"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$files = @(
    @{ src = "$base\規約\規約案.docx"; dst = "$tmp\kitei.docx" }
    @{ src = "$base\251213_渋沢MIXコラボ\20251213アントレイベント_マニュアル.pdf"; dst = "$tmp\manual1213.pdf" }
    @{ src = "$base\251114_県民の日 渋沢MIX\20251114アントレイベント_マニュアル.pdf"; dst = "$tmp\manual1114.pdf" }
)

foreach ($f in $files) {
    if (Test-Path $f.src) {
        Copy-Item $f.src $f.dst -Force
        Write-Host "Copied: $($f.dst)"
    } else {
        Write-Host "Not found: $($f.src)"
    }
}

# Also list all files in base dir with proper encoding
Write-Host "`n=== Files in アントレベース ==="
Get-ChildItem $base -Recurse -Include "*.docx","*.pdf","*.xlsx" | ForEach-Object {
    Write-Host $_.FullName
}
