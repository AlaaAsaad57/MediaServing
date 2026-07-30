#!/usr/bin/env python3
"""Read-only Trello card reader for the backlog migration skill.

Mirrors the isolation pattern of `clickup_intake.py`: this is the **only** place
Trello read logic lives, so the skill stays thin and the integration is testable
and swappable without touching the skill.

Behaviour:
  - Issues GET requests only. Never writes to Trello (see `trello_move_card.py`
    for the single write path).
  - Auth: TRELLO_API_KEY / TRELLO_TOKEN from the environment or `.env.development`.
  - Resolves a column by exact (case-insensitive) name. An unknown or ambiguous
    name is an error, never a guess -- picking the wrong column would migrate the
    wrong work.
  - `--member` filters BEFORE `--count` truncates, so a batch of 5 is 5 of the
    owner's cards rather than 5 rows that mostly belong to other people.
  - On success prints a JSON array of cards to stdout, exit 0.
  - On failure prints a TRL-coded error to stderr and exits non-zero.

Usage:
    python scripts/trello_fetch.py <board_id> <column_name> [--member <id>] [--count 5]
    python scripts/trello_fetch.py <board_id> --list-columns
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

# Python puts this script's own directory on sys.path, so this resolves to
# scripts/workflow_env.py without any path manipulation.
from workflow_env import require

BASE = "https://api.trello.com"


def get(path: str, key: str, token: str, **params):
    params.update(key=key, token=token)
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"TRL-2 ERROR: Trello GET {path} failed: HTTP {exc.code}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"TRL-2 ERROR: Trello GET failed (network): {exc.reason}")


def resolve_column(board: str, name: str, key: str, token: str) -> str:
    columns = get(f"/1/boards/{board}/lists", key, token, fields="name")
    wanted = name.strip().casefold()
    matches = [c for c in columns if c["name"].strip().casefold() == wanted]

    if not matches:
        available = ", ".join(repr(c["name"]) for c in columns)
        raise SystemExit(
            f"TRL-3 ERROR: no column named {name!r} on board {board}. Available: {available}"
        )
    if len(matches) > 1:
        raise SystemExit(
            f"TRL-4 ERROR: column name {name!r} is ambiguous ({len(matches)} matches) -- "
            "refusing to guess which one to migrate from"
        )
    return matches[0]["id"]


def fetch(board: str, column: str, member: str | None, count: int) -> list[dict]:
    key = require("TRELLO_API_KEY", "TRL-1")
    token = require("TRELLO_TOKEN", "TRL-1")

    column_id = resolve_column(board, column, key, token)
    cards = get(
        f"/1/lists/{column_id}/cards",
        key,
        token,
        fields="name,desc,shortUrl,idList,idMembers",
    )

    if member:
        cards = [c for c in cards if member in (c.get("idMembers") or [])]

    return [
        {
            "id": c["id"],
            "name": c["name"],
            "desc": c.get("desc") or "",
            "url": c.get("shortUrl", ""),
            "idList": c.get("idList", ""),
        }
        for c in cards[:count]
    ]


def list_columns(board: str) -> list[dict]:
    key = require("TRELLO_API_KEY", "TRL-1")
    token = require("TRELLO_TOKEN", "TRL-1")
    columns = get(f"/1/boards/{board}/lists", key, token, fields="name")
    return [{"id": c["id"], "name": c["name"]} for c in columns]


def main(argv: list[str]) -> int:
    # Card titles contain Arabic; the Windows console defaults to cp1252 and would
    # raise UnicodeEncodeError on write.
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("board")
    parser.add_argument("column", nargs="?")
    parser.add_argument("--member", default=None)
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--list-columns", action="store_true")
    args = parser.parse_args(argv[1:])

    if args.list_columns:
        payload = list_columns(args.board)
    else:
        if not args.column:
            raise SystemExit("usage: trello_fetch.py <board_id> <column_name> [--member id] [--count n]")
        payload = fetch(args.board, args.column, args.member, args.count)

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
