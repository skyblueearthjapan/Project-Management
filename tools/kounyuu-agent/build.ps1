# 購入部品追加依頼 エージェント PyInstaller ビルドスクリプト
# Windows で実行。Outlook COM / pywin32 が必要。
#
# 使い方:
#   1. python -m venv .venv ; .\.venv\Scripts\Activate.ps1
#   2. pip install -e ".[build]"
#   3. .\build.ps1
#
# 生成物: dist\購入部品追加依頼.exe
# 配布フォルダには EXE と config.toml を置く（送付先マスタはファイルサーバ参照）。

$ErrorActionPreference = "Stop"

$Name = "購入部品追加依頼"
# エントリはパッケージ外のランチャー (run_app.py)。
# パッケージ内 main.py を直接エントリにすると相対インポートが __main__ 実行で失敗する
# (出図EXE で実際に発生した問題。be5b543 参照)。
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
Write-Host "配布フォルダに config.toml を一緒に置いてください。"
Write-Host "※ 変更をリリースするときは必ず「リビルド → 配布先へ差し替え」までを1セットで行うこと。"
