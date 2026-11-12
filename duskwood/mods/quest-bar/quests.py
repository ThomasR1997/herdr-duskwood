"""The quest bar's data, as one JSON line on stdout.

    python3 -I quests.py <folder> [--remote]

Reads a BMAD project's sprint-status.yaml from the working copy and from the
remote's main branch (furthest status wins, as the bmad-stories plugin does),
and story titles from epics.md. --remote also fetches the main branch and lists open pull
requests (cached in .cache.json beside this file for the runs in between).
"""

import datetime
import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache.json")
SPRINT = "_bmad-output/implementation-artifacts/sprint-status.yaml"
EPICS = "_bmad-output/planning-artifacts/epics.md"
RANK = {"backlog": 0, "drafted": 1, "ready-for-dev": 2, "contexted": 2,
        "in-progress": 3, "review": 4, "done": 5}
STORY = re.compile(r"^\s+(\d+)-(\d+[a-z]?)-[\w-]*:\s*([\w-]+)")
EPIC = re.compile(r"^\s+epic-(\d+):\s*([\w-]+)")


def git(root, *args, timeout=20):
    try:
        r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def parse(yaml):
    """Stories in file order as [(id, status)] and epics as {n: status}."""
    stories, epics, inside = [], {}, False
    for line in (yaml or "").splitlines():
        if line.startswith("development_status:"):
            inside = True
            continue
        if not inside:
            continue
        if line and not line[0].isspace() and not line.startswith("#"):
            break
        m = STORY.match(line)
        if m:
            stories.append((f"{m[1]}.{m[2]}", m[3]))
            continue
        m = EPIC.match(line)
        if m:
            epics[m[1]] = m[2]
    return stories, epics


STORY_REF = re.compile(r"(?:^|[/\s])(\d+)[-.](\d+[a-z]?)(?=[-\s]|$)|story\s*(\d+)[.-](\d+[a-z]?)", re.I)


def worktrees(root):
    """[(path, branch)] for every checkout of the repo; branch is None when detached."""
    found, path = [], None
    for line in (git(root, "worktree", "list", "--porcelain") or "").splitlines():
        if line.startswith("worktree "):
            path = line[9:]
            found.append((path, None))
        elif line.startswith("branch refs/heads/") and found:
            found[-1] = (path, line[18:])
    return found


def clean(text):
    """Markdown emphasis and code marks off, whitespace folded."""
    return re.sub(r"\s+", " ", re.sub(r"\*\*|`|(?<!\w)\*(?!\s)|(?<!\s)\*(?!\w)", "", text)).strip()


def parse_epics(text):
    """({n: title}, {id: {epic, story, word, note}}) from epics.md."""
    epics, stories, epic, current, lines = {}, {}, None, None, []

    def flush():
        if current is None:
            return
        body = "\n".join(lines)
        story = re.search(r"^(As an? .+?)(?=\n\s*\n|\Z)", body, re.M | re.S)
        status = re.search(r"^\*\*Status:\*\*\s*`([^`]*)`(.*)$", body, re.M)
        stories[current] = {
            "epic": epic,
            "story": clean(story[1]) if story else "",
            "word": status[1].strip() if status else "",
            "note": clean(status[2]).lstrip("—:·-( ").strip()[:600] if status else "",
        }

    for line in (text or "").splitlines():
        m = re.match(r"^## Epic (\d+):\s*(.+?)\s*$", line)
        if m:
            flush()
            current, lines = None, []
            epic = m[1]
            epics[epic] = m[2]
            continue
        m = re.match(r"^###\s+Story\s+(\d+\.\d+[a-z]?):", line)
        if m:
            flush()
            current, lines = m[1], []
            continue
        if current is not None:
            lines.append(line)
    flush()
    return epics, stories


# WoW quest colours: grey trivial, green easy, yellow fair, orange hard, red impossible.
def difficulty(sprint, word, turnin):
    if sprint == "done":
        return "grey", "Done"
    if turnin:
        return "green", f"PR #{turnin['pr']} open" if turnin.get("kind") == "pr" else "Ready for a PR"
    if sprint == "review":
        return "green", "Merged · awaiting your check"
    if sprint == "in-progress":
        return "yellow", "In progress"
    if sprint in ("ready-for-dev", "drafted", "contexted"):
        return "yellow", "Ready to build"
    w = word.lower()
    if w.startswith("blocked"):
        return "red", "Blocked"
    if w in ("deferred", "paused"):
        return "orange", w.capitalize()
    if "design" in w or "rework" in w:
        return "orange", "Design first"
    return "yellow", "Available"


def load_cache():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except Exception:
        return {}


def main():
    folder = sys.argv[1]
    remote = "--remote" in sys.argv
    top = (git(folder, "rev-parse", "--show-toplevel") or "").strip()
    if not top:
        print(json.dumps({"bmad": False}))
        return
    common = (git(top, "rev-parse", "--path-format=absolute", "--git-common-dir") or "").strip()
    main_root = os.path.dirname(common) if common.endswith("/.git") else top
    out = {"bmad": False, "repo": os.path.basename(main_root)}

    local_path = os.path.join(top, SPRINT)
    if not os.path.exists(local_path):
        print(json.dumps(out))
        return
    head = (git(top, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD") or "origin/main").strip()
    branch = head.split("/", 1)[1] if "/" in head else head
    cache = load_cache()
    key = main_root
    if remote:
        git(top, "fetch", "--quiet", "--no-tags", "origin", branch, timeout=40)
        try:
            r = subprocess.run(["gh", "pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName,title,url"],
                               cwd=top, capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                cache[key] = json.loads(r.stdout)
                with open(CACHE, "w") as f:
                    json.dump(cache, f)
        except Exception:
            pass
    prs = cache.get(key, [])

    with open(local_path) as f:
        local, local_epics = parse(f.read())
    main_stories, main_epics = parse(git(top, "show", f"{head}:{SPRINT}"))
    status, order = {}, []
    for sid, st in main_stories + local:  # main first: it has the newest order
        if sid not in status:
            order.append(sid)
        if RANK.get(st, 0) >= RANK.get(status.get(sid), -1):
            status[sid] = st
    main_rank = {sid: RANK.get(st, 0) for sid, st in main_stories}

    # To turn in: a story with an open pull request, or one a worktree's branch
    # has at `review` that the main branch hasn't reached yet (ready for a PR).
    turnin = {}
    for pr in prs:
        text = f"{pr.get('headRefName', '')} {pr.get('title', '')}"
        for m in STORY_REF.finditer(text):
            sid = f"{m[1] or m[3]}.{m[2] or m[4]}"
            if sid in status and status[sid] != "done":
                turnin.setdefault(sid, {"id": sid, "kind": "pr", "pr": pr.get("number"),
                                        "url": pr.get("url"), "branch": pr.get("headRefName"), "paths": []})
    for path, wt_branch in worktrees(top):
        try:
            with open(os.path.join(path, SPRINT)) as f:
                stories, _ = parse(f.read())
        except Exception:
            continue
        for sid, st in stories:
            if st == "review" and main_rank.get(sid, 0) < RANK["review"]:
                item = turnin.setdefault(sid, {"id": sid, "kind": "ready", "branch": wt_branch, "paths": []})
                item["paths"].append(path)
    for item in turnin.values():
        # A worktree on the pull request's branch is where its session works.
        for path, wt_branch in worktrees(top):
            if item["branch"] and wt_branch == item["branch"] and path not in item["paths"]:
                item["paths"].append(path)

    epics_text = git(top, "show", f"{head}:{EPICS}")
    if epics_text is None and os.path.exists(os.path.join(top, EPICS)):
        with open(os.path.join(top, EPICS)) as f:
            epics_text = f.read()
    titles = dict(re.findall(r"^###\s+Story\s+(\d+\.\d+[a-z]?):\s*(.+?)\s*$", epics_text or "", re.M))

    quest = lambda sid: {"id": sid, "title": titles.get(sid, "")}
    by = lambda s: [quest(i) for i in order if status[i] == s]
    last_done = max((n for n, i in enumerate(order) if status[i] == "done"), default=-1)
    nxt = next((i for i in order[last_done + 1:] if status[i] != "done"), None)
    epic_status = {**local_epics, **main_epics}
    out.update({
        "bmad": True,
        "branch": branch,
        "total": len(order),
        "done": sum(1 for i in order if status[i] == "done"),
        "ready": by("ready-for-dev") + by("drafted") + by("contexted"),
        "active": by("in-progress"),
        "turnin": [{**quest(i), **turnin[i]} for i in order if i in turnin],
        "next": quest(nxt) if nxt else None,
        "level": sum(1 for s in epic_status.values() if s == "done"),
        "epics": len(epic_status),
    })
    if "--log" in sys.argv:
        epic_titles, blocks = parse_epics(epics_text)
        impl = os.path.join(top, os.path.dirname(SPRINT))
        log = []
        for i in order:
            b = blocks.get(i, {})
            color, label = difficulty(status[i], b.get("word", ""), turnin.get(i))
            a, n = i.split(".")
            files = sorted(glob.glob(os.path.join(impl, f"*{a}-{n}-*.md")), key=lambda f: not os.path.basename(f).startswith("spec-"))
            log.append({**quest(i), "epic": b.get("epic") or a, "color": color, "label": label,
                        "story": b.get("story", ""), "note": b.get("note", ""),
                        "file": files[0] if files else None, "turnin": turnin.get(i)})
        out["log"] = log
        out["epic_titles"] = epic_titles
        out["epic_status"] = epic_status
    print(json.dumps(out))


main()
