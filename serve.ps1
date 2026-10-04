#!/usr/bin/env pwsh
# NEON FRONT 2.0 — tek komut gelistirme sunucusu
# Kullanim:  .\serve.ps1        veya        .\serve.ps1 9000
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host '  Node.js bulunamadi.' -ForegroundColor Red
    Write-Host '  Lutfen https://nodejs.org adresinden Node 18+ kurun.'
    Write-Host ''
    exit 1
}

$port = if ($args.Count -ge 1) { $args[0] } else { 8123 }
$env:PORT = "$port"

Write-Host "  Baslatiliyor: http://localhost:$port" -ForegroundColor Cyan
& node (Join-Path $root 'tools/serve.mjs') "$port"
