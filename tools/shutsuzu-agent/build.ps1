# 出図のお知らせ × DOVE連携 エージェント PyInstaller ビルドスクリプト
# 木場PC（Windows）で実行。Outlook COM / pywin32 が必要。
#
# 使い方:
#   1. python -m venv .venv ; .\.venv\Scripts\Activate.ps1
#   2. pip install -e ".[build]"
#   3. .\build.ps1
#
# 生成物: dist\出図お知らせDOVE.exe
# 配布時は同じフォルダに config.toml と 送付先一覧.xlsx を置く。

$ErrorActionPreference = "Stop"

$Name = "出図お知らせDOVE"
# エントリはパッケージ外のランチャー (run_app.py)。
# パッケージ内 main.py を直接エントリにすると相対インポートが __main__ 実行で失敗するため。
$Entry = "run_app.py"

Write-Host "PyInstaller でビルドします: $Name"

pyinstaller `
    --noconfirm `
    --windowed `
    --onefile `
    --name $Name `
    --collect-submodules win32com `
    --hidden-import win32timezone `
    $Entry

Write-Host ""
Write-Host "完了: dist\$Name.exe"
Write-Host "同じフォルダに config.toml と 送付先一覧.xlsx を配置してください。"
