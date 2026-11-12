"""Claude Code tokens used on this machine, per day, as one JSON line on stdout.

    python3 -I tokens.py <utc offset in minutes>

Counts every turn in ~/.claude/projects, subagents included: input + cache
writes + output. Cache reads are left out: they re-count the same context on
every turn. Days are the viewer's local days (the offset is the Mac's, so a
cloud machine on UTC counts the same days). Files already counted are kept in
~/.claude/herdr/token-cache.json and only read again when they change.
"""

import datetime
import glob
import json
import os
import socket
import sys

offset = int(sys.argv[1]) if len(sys.argv) > 1 else 0
zone = datetime.timezone(datetime.timedelta(minutes=offset))
root = os.path.expanduser("~/.claude/projects")
cache_path = os.path.expanduser("~/.claude/herdr/token-cache.json")

try:
    with open(cache_path) as f:
        cache = json.load(f)
    if cache.get("offset") != offset:
        cache = {}
except Exception:
    cache = {}
files = cache.get("files", {})


def count(path):
    """{day: tokens} for one transcript. A turn's usage repeats on each of its
    content blocks with the same message id, so each id counts once."""
    days, seen = {}, set()
    with open(path, errors="replace") as fh:
        for line in fh:
            if '"usage"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            m = e.get("message")
            if not isinstance(m, dict) or not m.get("usage") or m.get("id") in seen:
                continue
            seen.add(m.get("id"))
            try:
                when = datetime.datetime.fromisoformat(e.get("timestamp", "").replace("Z", "+00:00"))
            except Exception:
                continue
            u = m["usage"]
            n = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("output_tokens", 0)
            day = when.astimezone(zone).date().isoformat()
            days[day] = days.get(day, 0) + n
    return days


now = {}
for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
    try:
        st = os.stat(path)
    except OSError:
        continue
    known = files.get(path)
    if known and known["size"] == st.st_size and known["mtime"] == st.st_mtime:
        now[path] = known
    else:
        now[path] = {"size": st.st_size, "mtime": st.st_mtime, "days": count(path)}

total = {}
for entry in now.values():
    for day, n in entry["days"].items():
        total[day] = total.get(day, 0) + n

os.makedirs(os.path.dirname(cache_path), exist_ok=True)
tmp = f"{cache_path}.{os.getpid()}"
with open(tmp, "w") as f:
    json.dump({"offset": offset, "files": now}, f)
os.replace(tmp, cache_path)

print(json.dumps({"host": socket.gethostname(), "days": total}))
