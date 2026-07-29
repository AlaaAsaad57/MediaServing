#!/usr/bin/env python3
"""Read-only ClickUp task intake helper for /start-ticket.

This is the **only** place ClickUp HTTP logic lives. `/start-ticket` orchestrates
it (passes a task id, reads back fields) and never embeds HTTP itself, keeping the
command thin and this integration isolated, testable, and swappable (e.g. for an
MCP) without touching the command.

Behaviour:
  - Performs exactly ONE read-only request: GET /api/v2/task/{task_id}.
  - Never writes to ClickUp (no POST/PUT/DELETE).
  - Auth: reads CLICKUP_API_TOKEN from the environment.
  - On success: prints {"title","description","url"} as JSON to stdout, exit 0.
  - On failure (missing token / not found / unauthorized / network): prints a
    CU-coded error to stderr and exits non-zero, emitting nothing usable.

Usage:
    python scripts/clickup_intake.py <clickup_task_id>
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.clickup.com/api/v2/task/{task_id}"


def fetch(task_id: str) -> dict:
    token = os.environ.get("CLICKUP_API_TOKEN")
    if not token:
        raise SystemExit("CU-1 ERROR: CLICKUP_API_TOKEN is not set")

    request = urllib.request.Request(
        API.format(task_id=task_id),
        headers={"Authorization": token},
        method="GET",  # read-only: GET only, never a write verb
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            f"CU-2 ERROR: ClickUp task '{task_id}' fetch failed: HTTP {exc.code}"
        )
    except urllib.error.URLError as exc:
        raise SystemExit(f"CU-2 ERROR: ClickUp fetch failed (network): {exc.reason}")

    return {
        "title": data.get("name", ""),
        # Prefer plain text; fall back to markdown description if absent.
        "description": data.get("text_content") or data.get("description") or "",
        "url": data.get("url", ""),
    }


def main(argv) -> int:
    if len(argv) != 2:
        raise SystemExit("usage: clickup_intake.py <clickup_task_id>")
    print(json.dumps(fetch(argv[1]), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
