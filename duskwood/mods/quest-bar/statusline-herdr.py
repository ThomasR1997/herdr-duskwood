"""Claude Code status line: model, effort and the 5-hour limit, saved for Herdr.

Claude Code pipes its session JSON in on every update. This saves:
- `rate_limits` to ~/.claude/herdr/rate-limits.json (the quest bar's 5-hour bar);
- the session's model, effort and context use to ~/.claude/herdr/sessions/<terminal>.json,
  keyed by Herdr's HC_TERMINAL_ID (the status bar's model and effort switcher).
Prints one short line for Claude's footer.
"""

import datetime
import json
import os
import sys
import time

FOLDER = os.path.expanduser("~/.claude/herdr")

try:
    data = json.load(sys.stdin)
except Exception:
    data = {}


def save(name, value):
    path = os.path.join(FOLDER, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(value, f)
    os.replace(tmp, path)


limits = data.get("rate_limits") or {}
if limits:
    save("rate-limits.json", {**limits, "saved_at": time.time()})

model = (data.get("model") or {}).get("display_name")
effort = (data.get("effort") or {}).get("level")
window = data.get("context_window") or {}
context = window.get("used_percentage")
usage = window.get("current_usage") or {}
context_tokens = sum(usage.get(k, 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
terminal = os.environ.get("HC_TERMINAL_ID")
if terminal and model:
    save(f"sessions/{terminal}.json", {
        "model": model,
        "model_id": (data.get("model") or {}).get("id"),
        "effort": effort,
        "context": context,
        "context_tokens": context_tokens,
        "context_size": window.get("context_window_size"),
        "session_name": data.get("session_name"),
        "session_id": data.get("session_id"),
        "saved_at": time.time(),
    })

parts = []
if model:
    parts.append(f"\033[33m{model}\033[0m" + (f" · {effort}" if effort else ""))
five = limits.get("five_hour") or {}
pct = five.get("used_percentage", five.get("utilization"))
if pct is not None:
    resets = five.get("resets_at")
    when = ""
    try:
        at = resets if isinstance(resets, (int, float)) else datetime.datetime.fromisoformat(str(resets).replace("Z", "+00:00")).timestamp()
        when = " · resets " + datetime.datetime.fromtimestamp(at).strftime("%H:%M")
    except Exception:
        pass
    filled = round(float(pct) / 10)
    parts.append(f"5h \033[35m{'▰' * filled}{'▱' * (10 - filled)}\033[0m {float(pct):.0f}%{when}")
print("  ·  ".join(parts))
