$ErrorActionPreference = "Stop"

# 仮想環境作成と依存インストール
if (-not (Test-Path .venv)) {
    py -3.12 -m venv .venv
}
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install ".[build]"

# 単一 exe をビルド
pyinstaller --noconfirm --onefile `
    --name pm-outlook-agent `
    --hidden-import=win32com `
    --hidden-import=win32com.client `
    --hidden-import=pythoncom `
    agent\main.py

Write-Host "出力: dist\pm-outlook-agent.exe"
