#!/usr/bin/env python3
"""ClickUp task creation for the Trello backlog migration skill.

This is the **only** place ClickUp write logic lives. `clickup_intake.py` stays
strictly read-only (rule CU-3) and is deliberately untouched -- adding a write verb
there would void a guarantee `/start-ticket` depends on.

The duplicate lookup (`--find-by-name`) is a GET, but it lives here rather than in a
separate reader because it exists only to guard the create; splitting them would let
the two drift apart and silently reintroduce duplicates.

Behaviour:
  - `--find-by-name`: pages through the whole list looking for an exact name match.
    It must never report "not found" from a partial read -- that would create a
    duplicate -- so a paging failure is an error, not an empty result.
  - create: POST /api/v2/list/{list_id}/task with name, markdown body and status.
  - The description is read from a FILE, not an argument: the body is multi-line
    markdown containing quotes and non-ASCII text, which shell quoting mangles.
  - Auth: CLICKUP_API_TOKEN from the environment or `.env.development`.
  - On failure prints a CUW-coded error to stderr and exits non-zero.

Usage:
    python scripts/clickup_create_task.py --list <id> --find-by-name "Trello: X"
    python scripts/clickup_create_task.py --list <id> --name "Trello: X" \
        --description-file body.md [--status draft]
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Python puts this script's own directory on sys.path, so this resolves to
# scripts/workflow_env.py without any path manipulation.
from workflow_env import require

BASE = "https://api.clickup.com/api/v2"
PAGE_LIMIT = 50  # safety stop: 50 pages x 100 tasks is far beyond any real list


def call(path: str, token: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise SystemExit(
            f"CUW-2 ERROR: ClickUp {method} {path} failed: HTTP {exc.code} {detail}"
        )
    except urllib.error.URLError as exc:
        raise SystemExit(f"CUW-2 ERROR: ClickUp {method} failed (network): {exc.reason}")


def find_by_name(list_id: str, name: str, token: str) -> dict:
    """Exact-name lookup across every page of the list.

    Pages until ClickUp reports the last page. Anything that stops early without
    that confirmation is treated as a failure, because a false "not found" is what
    creates duplicate tasks.
    """
    wanted = name.strip()
    for page in range(PAGE_LIMIT):
        query = urllib.parse.urlencode(
            {"page": page, "include_closed": "true", "subtasks": "true"}
        )
        payload = call(f"/list/{list_id}/task?{query}", token)
        tasks = payload.get("tasks", [])

        for task in tasks:
            if (task.get("name") or "").strip() == wanted:
                return {"found": True, "id": task["id"], "url": task.get("url", "")}

        if payload.get("last_page") or not tasks:
            return {"found": False}

    raise SystemExit(
        f"CUW-3 ERROR: list {list_id} exceeded {PAGE_LIMIT} pages during the duplicate "
        "lookup; refusing to report 'not found' from a partial read"
    )


def create(list_id: str, name: str, description: str, status: str, token: str) -> dict:
    payload = call(
        f"/list/{list_id}/task",
        token,
        method="POST",
        body={
            "name": name,
            "markdown_description": description,
            "status": status,
        },
    )
    return {"id": payload["id"], "url": payload.get("url", ""), "name": payload.get("name", "")}


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--list", dest="list_id", required=True)
    parser.add_argument("--find-by-name", dest="find", default=None)
    parser.add_argument("--name", default=None)
    parser.add_argument("--description-file", dest="body_file", default=None)
    parser.add_argument("--status", default="draft")
    args = parser.parse_args(argv[1:])

    token = require("CLICKUP_API_TOKEN", "CUW-1")

    if args.find:
        result = find_by_name(args.list_id, args.find, token)
    else:
        if not args.name or not args.body_file:
            raise SystemExit(
                "usage: clickup_create_task.py --list <id> --name <title> "
                "--description-file <path> [--status draft]"
            )
        body_path = Path(args.body_file)
        if not body_path.is_file():
            raise SystemExit(f"CUW-4 ERROR: description file not found: {body_path}")
        description = body_path.read_text(encoding="utf-8")
        result = create(args.list_id, args.name, description, args.status, token)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
