$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Add-StringEntry($archive, [string]$entryName, [string]$text){
    $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try{
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
        try{ $writer.Write($text) } finally { $writer.Dispose() }
    }finally{
        $stream.Dispose()
    }
}

function Pack-Mod([string]$outName, [string]$modHjson){
    $out = Join-Path $dist $outName
    if(Test-Path -LiteralPath $out){ Remove-Item -LiteralPath $out -Force }

    # Mindustry's ZipFi expects forward-slash paths inside zips. PowerShell's
    # Compress-Archive writes backslashes on Windows, which can make scripts/main.js
    # invisible to the mod loader.
    $archive = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
    try{
        Add-StringEntry $archive "mod.hjson" $modHjson
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root "README.md"), "README.md", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root "scripts\main.js"), "scripts/main.js", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }finally{
        $archive.Dispose()
    }
    Write-Host "Packed: $out"
}

$commonDescription = 'Client-side script mod for testing Mindustry permission systems with multiple local UUID/USID identities. Non-Steam only.'

$hiddenMeta = @"
name: uuid-identity-switcher
displayName: UUID Identity Switcher
author: ChatGPT
description: "$commonDescription"
version: "0.2.3"
minGameVersion: "154"
hidden: true
"@

# Android/MindustryX compatibility package: visible metadata encourages Android
# builds that mishandle hidden script mods to load it. main.js immediately sets
# loaded.meta.hidden=true at runtime, so normal server mod-list checks should not
# see it after scripts have loaded.
$androidMeta = @"
name: uuid-identity-switcher-android
displayName: UUID Identity Switcher Android
author: ChatGPT
description: "$commonDescription Android compatibility package; visible in metadata but hides itself from server mod list at runtime."
version: "0.2.3"
minGameVersion: "154"
hidden: false
"@

# Diagnostic package: remains visible and does not hide itself. Use only to check
# whether Android imported/enabled the mod at all; servers may reject it as an
# extra visible client mod.
$androidVisibleMeta = @"
name: uuid-identity-switcher-android-visible
displayName: UUID Identity Switcher Android Visible
author: ChatGPT
description: "$commonDescription Diagnostic visible Android package; may be sent in server mod list."
version: "0.2.3"
minGameVersion: "154"
hidden: false
"@

Pack-Mod "uuid-identity-switcher.zip" $hiddenMeta
Pack-Mod "uuid-identity-switcher-android.zip" $androidMeta
Pack-Mod "uuid-identity-switcher-android-visible.zip" $androidVisibleMeta

# Keep repository mod.hjson aligned with the default hidden package.
Set-Content -LiteralPath (Join-Path $root "mod.hjson") -Value $hiddenMeta -NoNewline -Encoding UTF8