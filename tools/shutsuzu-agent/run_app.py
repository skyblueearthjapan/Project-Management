"""PyInstaller エントリ用ランチャー(パッケージ外)。

PyInstaller はエントリ .py を `__main__` として直接実行するため、パッケージ内の
`shutsuzu_agent/main.py` を直接エントリにすると、その相対インポート
(`from .gui import ...` 等)が親パッケージを持たず
``ImportError: attempted relative import with no known parent package`` で失敗する。

本ファイルを **パッケージ外** のエントリとし、**絶対インポート** で
`shutsuzu_agent` パッケージを起動することで、`main.py` 以下の相対インポートが
正しく解決される(main は `shutsuzu_agent.main` として読み込まれる)。
"""

from __future__ import annotations

from shutsuzu_agent.main import main

if __name__ == "__main__":
    main()
