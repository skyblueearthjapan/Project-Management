# PM Outlook Agent をログオン時に自動起動するように設定する。
# 管理者権限不要。HKCU\Run に登録する。

$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "dist\pm-outlook-agent.exe"
if (-not (Test-Path $exe)) {
    Write-Error "exe が見つかりません: $exe (build.ps1 を先に実行してください)"
}

$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $reg -Name "PMOutlookAgent" -Value "`"$exe`"" -PropertyType String -Force | Out-Null
Write-Host "登録しました: $reg\PMOutlookAgent = $exe"
Write-Host "次回ログオン時から自動起動します。今すぐ起動する場合は exe をダブルクリックしてください。"
