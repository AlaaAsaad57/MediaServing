#!/usr/bin/env python3
"""Move one Trello card to another column. The only Trello write path.

Deliberately separate from `trello_fetch.py` so that every Trello mutation in the
repo is greppable in a single file. It does exactly one thing: change a card's
column. It never edits a card's name, description, members or labels.

The migration skill calls this **only after** ClickUp has returned a task id.
Moving first would strand cards that were never migrated, with nothing left in the
source column to find them by.

Behaviour:
  - Issues one PUT /1/cards/{card_id} setting idList.
  - Verifies the destination column exists on the card's board first; a typo would
    otherwise be accepted by Trello as an unrelated id and lose the card.
  - Auth: TRELLO_API_KEY / TRELLO_TOKEN from the environment or `.env.development`.
  - On failure prints a TRL-coded error to stderr and exits non-zero.

Usage:
    python scripts/trello_move_card.py <card_id> --to-list <column_id>
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


def call(path: str, key: str, token: str, method: str = "GET", **params):
    params.update(key=key, token=token)
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"TRL-2 ERROR: Trello {method} {path} failed: HTTP {exc.code}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"TRL-2 ERROR: Trello {method} failed (network): {exc.reason}")


def move(card_id: str, to_list: str) -> dict:
    key = require("TRELLO_API_KEY", "TRL-1")
    token = require("TRELLO_TOKEN", "TRL-1")

    card = call(f"/1/cards/{card_id}", key, token, fields="name,idList,idBoard")
    if card["idList"] == to_list:
        return {"moved": False, "reason": "already in destination", "id": card_id}

    columns = call(f"/1/boards/{card['idBoard']}/lists", key, token, fields="name")
    destination = next((c for c in columns if c["id"] == to_list), None)
    if destination is None:
        raise SystemExit(
            f"TRL-5 ERROR: column {to_list} is not on card {card_id}'s board "
            f"({card['idBoard']}) -- refusing to move the card out of sight"
        )

    call(f"/1/cards/{card_id}", key, token, method="PUT", idList=to_list)
    return {
        "moved": True,
        "id": card_id,
        "name": card["name"],
        "from": card["idList"],
        "to": to_list,
        "to_name": destination["name"],
    }


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("card_id")
    parser.add_argument("--to-list", dest="to_list", required=True)
    args = parser.parse_args(argv[1:])

    print(json.dumps(move(args.card_id, args.to_list), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
