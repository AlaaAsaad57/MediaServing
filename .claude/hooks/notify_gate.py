#!/usr/bin/env python3
"""PostToolUse hook — deterministic gate notification to Telegram.

Fires after every Write **or Edit**; no-ops unless the touched path is
`_specs/<slug>/comprehension.md` (the moment a review/verify gate completes its
comprehension check). Edit matters: at `/verify` the file already exists (the
review section was written first), so the second gate reaches it via Edit —
matching Write alone silently drops every /verify notification.

Message content comes from the comprehension.md front-matter written by the gate
(`result`, `score`, `decision`, `missed`) — NOT from `ticket.md`, whose state is
still pre-transition at hook time (CG-1: the comprehension record precedes the
decision write); only the ticket **title** is read from it. Records without those
fields fall back to the legacy state-based message. Every message ends with the
next legal command (the NS-1..NS-4 guidance, delivered to the phone too). Reuses
the EXISTING Alertmanager Telegram bot — configured in the shared file
`.claude/notifications.json`, with env overrides for compatibility. This hook:

  - NEVER edits any `protected_paths` runtime file (it only calls the public
    Telegram API).
  - NEVER changes workflow state — one-way, workflow -> Telegram (like PB-4).
  - Is the ONLY place the delivery HTTP lives; commands embed none (NT-1).

Enforcement (NT-3), from config `enforcement` or `WF_NOTIFY_ENFORCEMENT` (default `warn`):
  - warn : delivery failure is logged; the gate still completes (exit 0).
  - block: delivery failure blocks the gate (exit 2, message fed back to Claude).
Unconfigured or disabled (no token/chat, or `telegram.enabled: false`) is always
fail-open (exit 0) — missing/invalid config must never freeze a gate.

Config: shared file `.claude/notifications.json` (relative to this hook):
  { "telegram": { "enabled": true, "botToken": "...",
                  "chatId": "-100...", "topicId": 18 },
    "enforcement": "warn" }
Optional env overrides (higher priority than the file, for future compatibility):
  WF_TELEGRAM_BOT_TOKEN / WF_TELEGRAM_CHAT_ID / WF_TELEGRAM_TOPIC_ID
  WF_NOTIFY_ENFORCEMENT  warn | block
  WF_NOTIFY_DRYRUN       1 -> print the message + target instead of sending
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path, PurePosixPath

# Next legal command per (stage, decision) — mirrors the §2 state machine
# (presentation only, NS-5: it never owns or changes state).
NEXT_COMMAND = {
    ("review", "APPROVED"): "/implement",
    ("review", "CHANGES_REQUESTED"): "/plan (revision — address the follow-ups)",
    ("review", "REJECTED"): "none — ticket closed (terminal)",
    ("verify", "PASSED"): "/publish-pr",
    ("verify", "FAILED"): "/implement (resume — ticket blocked)",
}


def should_fire(file_path: str) -> bool:
    """True only for a Write to _specs/<slug>/comprehension.md."""
    if not file_path:
        return False
    p = PurePosixPath(file_path.replace("\\", "/"))
    parts = p.parts
    return (
        p.name == "comprehension.md"
        and "_specs" in parts
        and parts.index("_specs") == len(parts) - 3  # _specs / <slug> / comprehension.md
    )


def read_frontmatter(text: str) -> dict:
    """Minimal YAML front-matter reader: top `key: value` pairs in the --- block."""
    fm: dict = {}
    if not text.startswith("---"):
        return fm
    end = text.find("\n---", 3)
    block = text[3:end] if end != -1 else text[3:]
    for line in block.splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm


def _field(path, key, default=""):
    try:
        return read_frontmatter(path.read_text(encoding="utf-8")).get(key, default)
    except OSError:
        return default


def git_actor() -> str:
    """The person driving the workflow — git user.name, falling back to email."""
    def cfg(k):
        try:
            return subprocess.run(
                ["git", "config", k], capture_output=True, text=True, timeout=5
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return ""
    return cfg("user.name") or cfg("user.email") or "unknown"


def outcome_line(fm: dict):
    """(icon, summary, next) from the comprehension front-matter; None → legacy record."""
    stage = (fm.get("stage") or "gate").strip()
    decision = (fm.get("decision") or "").strip().upper()
    score = (fm.get("score") or "").strip()
    if (fm.get("result") or "").strip().lower() == "failed":
        return ("🚫", f"quiz FAILED {score or '?'} — no decision recorded",
                f"re-read the artifact, re-run /{stage}")
    if decision and decision != "NONE":
        icon = {"CHANGES_REQUESTED": "⚠️", "REJECTED": "❌", "FAILED": "❌"}.get(decision, "✅")
        summary = decision + (f" (quiz {score})" if score else "")
        return icon, summary, NEXT_COMMAND.get((stage, decision), "")
    return None


def build_message(comprehension_path) -> str:
    slug_dir = comprehension_path.parent
    fm = read_frontmatter(comprehension_path.read_text(encoding="utf-8"))
    ticket = fm.get("ticket") or slug_dir.name
    stage = fm.get("stage", "gate")
    outcome = outcome_line(fm)
    if outcome is None:
        # Legacy record (no result/decision fields): ticket.md state — NB it is
        # pre-transition at hook time, hence the new fields above are preferred.
        state = _field(slug_dir / "ticket.md", "state", "unknown")
        status = _field(slug_dir / "ticket.md", "status", "")
        icon = "⚠️" if status == "blocked" or state == "implementation-in-progress" else "✅"
        outcome = (icon, f"state: {state}" + (" (blocked)" if status == "blocked" else ""), "")
    icon, summary, nxt = outcome
    # ponytail: no timestamp line — Telegram stamps every message itself.
    lines = [f"{icon} /{stage} — {ticket} · {summary}"]
    for extra in (_field(slug_dir / "ticket.md", "title"),
                  f"Owner: {git_actor()}",
                  f"Missed: {fm['missed']}" if (fm.get("missed") or "").strip() else "",
                  f"Next: {nxt}" if nxt else ""):
        if extra:
            lines.append(extra)
    return "\n".join(lines)

def load_notification_config() -> dict:
    """Load shared notification settings from .claude/notifications.json."""
    config_path = Path(__file__).resolve().parents[1] / "notifications.json"

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(
            f"notify_gate: config file not found: {config_path}",
            file=sys.stderr,
        )
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        print(
            f"notify_gate: invalid notification config: {exc}",
            file=sys.stderr,
        )
        return {}

    if not isinstance(data, dict):
        print(
            "notify_gate: notification config must be a JSON object",
            file=sys.stderr,
        )
        return {}

    return data


def resolve_settings(cfg: dict, env) -> dict:
    """Merge notifications.json with env overrides. Env wins (future compat).
    Only an explicit `telegram.enabled: false` disables sending; a missing flag
    (e.g. env-only, no config file) stays enabled so overrides still work."""
    tg = cfg.get("telegram") or {}
    return {
        "enabled": tg.get("enabled") is not False,
        "token": env.get("WF_TELEGRAM_BOT_TOKEN") or tg.get("botToken"),
        "chat": env.get("WF_TELEGRAM_CHAT_ID") or tg.get("chatId"),
        "topic": env.get("WF_TELEGRAM_TOPIC_ID") or tg.get("topicId"),
        "enforcement": (env.get("WF_NOTIFY_ENFORCEMENT") or cfg.get("enforcement") or "warn").lower(),
        "dryrun": env.get("WF_NOTIFY_DRYRUN") == "1",
    }


def send_telegram(token, chat, topic, text):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat, "text": text, "disable_web_page_preview": True}
    if topic:
        payload["message_thread_id"] = int(topic)
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # ponytail: 10s, add retry/spool only if delivery proves flaky
        body = json.loads(resp.read().decode())
    if not body.get("ok"):
        raise RuntimeError(f"telegram rejected: {body}")


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # not a hook payload we understand — never block

    if event.get("tool_name") not in ("Write", "Edit"):
        return 0
    file_path = (event.get("tool_input") or {}).get("file_path", "")
    if not should_fire(file_path):
        return 0

    s = resolve_settings(load_notification_config(), os.environ)
    enforcement, token, chat, topic = s["enforcement"], s["token"], s["chat"], s["topic"]

    if not s["enabled"]:
        print("notify_gate: telegram disabled in config — skipped", file=sys.stderr)
        return 0
    if not token or not chat:
        # Unconfigured: always fail-open. Surface a hint, never freeze the gate.
        print("notify_gate: no telegram botToken/chatId (config or env) — skipped", file=sys.stderr)
        return 0

    try:
        message = build_message(Path(file_path))
        if s["dryrun"]:
            print(f"[dry-run] -> chat={chat} topic={topic or '-'}\n{message}", file=sys.stderr)
            return 0
        send_telegram(token, chat, topic, message)
        return 0
    except Exception as exc:  # noqa: BLE001 — a gate notice must never crash the gate
        if enforcement == "block":
            print(f"notify_gate: delivery FAILED (block): {exc}", file=sys.stderr)
            return 2  # PostToolUse exit 2 -> blocks and feeds stderr back to Claude
        print(f"notify_gate: delivery failed (warn, gate continues): {exc}", file=sys.stderr)
        return 0


def _selftest() -> int:
    assert should_fire("_specs/wf-006/comprehension.md")
    assert should_fire("D:/projects/opt/_specs/wf-006/comprehension.md")
    assert not should_fire("_specs/wf-006/review.md")
    assert not should_fire("_specs/comprehension.md")           # missing slug level
    assert not should_fire("notes/comprehension.md")            # not under _specs
    fm = read_frontmatter("---\nticket: wf-006\nstage: review\n---\nbody")
    assert fm["ticket"] == "wf-006" and fm["stage"] == "review", fm

    # outcome line from the new front-matter fields (decision + next-step aware)
    assert outcome_line({"stage": "review", "result": "passed", "score": "3/3",
                         "decision": "APPROVED"}) == ("✅", "APPROVED (quiz 3/3)", "/implement")
    assert outcome_line({"stage": "verify", "result": "passed", "score": "4/4",
                         "decision": "PASSED"}) == ("✅", "PASSED (quiz 4/4)", "/publish-pr")
    assert outcome_line({"stage": "verify", "result": "passed", "score": "4/4",
                         "decision": "FAILED"})[:2] == ("❌", "FAILED (quiz 4/4)")
    assert outcome_line({"stage": "review", "result": "passed",
                         "decision": "CHANGES_REQUESTED"})[:2] == ("⚠️", "CHANGES_REQUESTED")
    assert outcome_line({"stage": "review", "result": "failed", "score": "1/3",
                         "decision": "none"}) == (
        "🚫", "quiz FAILED 1/3 — no decision recorded",
        "re-read the artifact, re-run /review")
    assert outcome_line({}) is None  # legacy record falls back to state-based line
    assert git_actor()  # the acting person is always named, even unconfigured

    # config/env resolution (new)
    r = resolve_settings(
        {"telegram": {"enabled": True, "botToken": "j", "chatId": "-1", "topicId": 18}, "enforcement": "block"}, {}
    )
    assert r["enabled"] and r["token"] == "j" and r["chat"] == "-1" and r["topic"] == 18 and r["enforcement"] == "block", r
    # env overrides the file, and enforcement is lowercased
    r2 = resolve_settings(
        {"telegram": {"botToken": "j", "chatId": "-1"}},
        {"WF_TELEGRAM_BOT_TOKEN": "envtok", "WF_NOTIFY_ENFORCEMENT": "BLOCK"},
    )
    assert r2["token"] == "envtok" and r2["enforcement"] == "block", r2
    # only explicit false disables; absent telegram block stays enabled (env still usable)
    assert resolve_settings({"telegram": {"enabled": False}}, {})["enabled"] is False
    r3 = resolve_settings({}, {"WF_TELEGRAM_BOT_TOKEN": "t", "WF_TELEGRAM_CHAT_ID": "-9"})
    assert r3["enabled"] and r3["token"] == "t" and r3["chat"] == "-9", r3

    print("notify_gate selftest: OK")
    return 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else main())
