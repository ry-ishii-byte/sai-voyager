# Script to read docx files in アントレベース
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Read-Docx {
    param($path)
    try {
        Add-Type -AssemblyName WindowsBase
        $pkg = [System.IO.Packaging.Package]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
        $part = $pkg.GetPart([Uri]"/word/document.xml")
        $sr = New-Object System.IO.StreamReader($part.GetStream())
        $xml = $sr.ReadToEnd()
        $sr.Close()
        $pkg.Close()
        $text = [regex]::Replace($xml, "<[^>]+>", " ")
        $text = [regex]::Replace($text, "\s{2,}", "`n")
        return $text.Trim()
    } catch {
        return "Error: $_"
    }
}

$base = "H:\共有ドライブ\SAIL\36_アントレベース"

Write-Host "=== 規約案.docx ===" -ForegroundColor Cyan
$t = Read-Docx "$base\規約\規約案.docx"
Write-Host $t.Substring(0, [Math]::Min(2000, $t.Length))

Write-Host "`n=== SCAP補足説明_SAIL.pdf (skip - no pdf tool) ===" -ForegroundColor Yellow

Write-Host "`n=== Done ===" -ForegroundColor Green
