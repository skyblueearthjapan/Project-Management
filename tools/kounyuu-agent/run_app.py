"""PyInstaller エントリ用ランチャー (パッケージ外)。

PyInstaller はエントリ .py を `__main__` として直接実行するため、パッケージ内の
`kounyuu_agent/main.py` を直接エントリにすると、その相対インポート
(`from .gui_request import ...` 等) が親パッケージを持たず
``ImportError: attempted relative import with no known parent package`` で失敗する。

本ファイルを **パッケージ外** のエントリとし、**絶対インポート**で
`kounyuu_agent` パッケージを起動する。
出図EXE で実際に踏んだ問題 (be5b543 で修正) のため、同じ方式を最初から採る。
"""

from __future__ import annotations

from kounyuu_agent.main import main

if __name__ == "__main__":
    main()
