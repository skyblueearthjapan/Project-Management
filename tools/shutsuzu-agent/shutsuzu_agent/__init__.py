"""出図のお知らせ × DOVE連携 メール送信エージェント。

木場PC で都度起動する Windows EXE。Outlook COM でメールを送信し、
送信成功時のみ DOVE バックエンドへ パス参照のみ で登録する。
ファイルの copy/move/delete/overwrite/rename は一切行わない（CLAUDE.md §2.1/§2.2）。
"""

__version__ = "0.1.0"
