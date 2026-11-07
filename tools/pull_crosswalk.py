"""Pulls the latest homework.json / fantasy.json / links.json that Muse saves in the brianrlsite Crosswalk files.

Runs in the deploy workflow with a read-only key in CROSSWALK_KEY. Anything missing or malformed is
skipped, so the site keeps the copy in the repo instead of breaking.
"""
import json
import os
import sys
import re
import urllib.request
from datetime import date, datetime
from difflib import SequenceMatcher

BASE = "https://mcp.crosswalk.to/files/brianrlsite/site/"


def homework_ok(d):
    return isinstance(d, dict) and isinstance(d.get("assignments"), list) and all(
        isinstance(a, dict) and a.get("class") and a.get("title") and a.get("due") for a in d["assignments"])


def fantasy_ok(d):
    return isinstance(d, dict) and isinstance(d.get("lineup", []), list) and isinstance(d.get("moves", []), list)


def links_ok(d):
    return isinstance(d, dict) and isinstance(d.get("class_links"), list) and all(
        isinstance(c, dict) and c.get("class") for c in d["class_links"])


CHECKS = {"homework.json": homework_ok, "fantasy.json": fantasy_ok, "links.json": links_ok}


def older_than_repo(name, data):
    """True when the repo copy has a later updated_at, e.g. Claude loaded a newer post than Muse's saved file."""
    try:
        with open(name) as f:
            mine = datetime.fromisoformat(json.load(f)["updated_at"].replace("Z", "+00:00"))
        theirs = datetime.fromisoformat(str(data.get("updated_at")).replace("Z", "+00:00"))
    except Exception:
        return False
    return theirs < mine


def keep_claude_moves(data):
    """Claude's moves live in the repo copy; carry them over when Muse's file is for the same week."""
    try:
        with open("fantasy.json") as f:
            repo = json.load(f)
    except Exception:
        return data
    if repo.get("week") != data.get("week"):
        return data
    claude = [m for m in repo.get("moves", []) if m.get("by") == "Claude"]
    data["moves"] = claude + [m for m in data.get("moves", []) if m.get("by") != "Claude"]
    return data


def _words(t):
    return set(re.findall(r"[a-z0-9]+", t.lower())) - {"the", "a", "an", "and", "of", "on", "to", "for", "in", "p", "reading", "read"}


MAJOR = ("quiz", "test", "essay", "project")


def same_kind(a, b):
    """Same type, or one side calls it a quiz/test/etc. and the other side's title says so too."""
    ta, tb = a.get("type"), b.get("type")
    return ta == tb or (tb in MAJOR and tb in a["title"].lower()) or (ta in MAJOR and ta in b["title"].lower())


def same_item(a, b):
    """Two rewordings of one assignment: same class, due within 3 days, and the titles mostly agree."""
    if a["class"] != b["class"] or not same_kind(a, b):
        return False
    try:
        gap = abs((date.fromisoformat(a["due"]) - date.fromisoformat(b["due"])).days)
    except ValueError:
        return False
    if gap > 3:
        return False
    ta, tb = a["title"].lower(), b["title"].lower()
    wa, wb = _words(ta), _words(tb)
    overlap = len(wa & wb) / max(1, min(len(wa), len(wb)))
    return (gap == 0 and (overlap >= 0.6 or SequenceMatcher(None, ta, tb).ratio() >= 0.7)) or (gap <= 3 and overlap >= 0.8)


def keep_titles(data):
    """Check-offs are keyed by class + title + due, so a reworded title would drop Brian's tick.
    When Muse's file rewords an assignment the repo already has, keep the repo's title and due date.
    Also keep special-schedule days the repo knows about that Muse's file left out."""
    try:
        with open("homework.json") as f:
            repo = json.load(f)
    except Exception:
        return data
    old = repo.get("assignments", [])
    keys = {(a["class"], a["title"], a["due"]) for a in old}
    # exact matches claim their repo item first, so a fuzzy match can't take it
    used = {(a["class"], a["title"], a["due"]) for a in data["assignments"]} & keys
    for a in data["assignments"]:
        if (a["class"], a["title"], a["due"]) in keys:
            continue
        match = next((b for b in old if (b["class"], b["title"], b["due"]) not in used and same_item(a, b)), None)
        if match:
            used.add((match["class"], match["title"], match["due"]))
            if match["title"] != a["title"] or match["due"] != a["due"]:
                print(f"  kept title: {a['class']} {a['title']!r} {a['due']} -> {match['title']!r} {match['due']}")
            a["title"], a["due"] = match["title"], match["due"]
            if match.get("type") in MAJOR:
                a["type"] = match["type"]  # never let a quiz or test slip to plain homework
    # a reading listed by page numbers on one side and by topic on the other: the only one left that day
    key = lambda x: (x["class"], x["due"], x.get("type"))
    left_new = [a for a in data["assignments"] if (a["class"], a["title"], a["due"]) not in keys | used]
    left_old = [b for b in old if (b["class"], b["title"], b["due"]) not in used and (b["class"], b["title"], b["due"]) not in
                {(a["class"], a["title"], a["due"]) for a in data["assignments"]}]
    for a in left_new:
        mine = [b for b in left_old if key(b) == key(a)]
        if len(mine) == 1 and sum(key(x) == key(a) for x in left_new) == 1:
            print(f"  kept title: {a['class']} {a['title']!r} {a['due']} -> {mine[0]['title']!r}")
            a["title"] = mine[0]["title"]
    data["special"] = {**repo.get("special", {}), **data.get("special", {})}
    return data


def main():
    key = os.environ.get("CROSSWALK_KEY", "").strip()
    if not key:
        print("No CROSSWALK_KEY secret; using the repo's data files.")
        return
    for name, ok in CHECKS.items():
        req = urllib.request.Request(BASE + name, headers={"Authorization": f"Bearer {key}", "User-Agent": "rl-planner-deploy/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"{name}: not pulled ({type(e).__name__}: {getattr(e, 'code', '')}); keeping repo copy", file=sys.stderr)
            continue
        if not ok(data):
            print(f"{name}: wrong shape; keeping repo copy", file=sys.stderr)
            continue
        if older_than_repo(name, data):
            print(f"{name}: Crosswalk copy is older than the repo's; keeping repo copy")
            continue
        if name == "fantasy.json":
            data = keep_claude_moves(data)
        if name == "homework.json":
            data = keep_titles(data)
        with open(name, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print(f"{name}: pulled (updated_at {data.get('updated_at')}, {len(data.get('assignments', data.get('lineup', data.get('class_links', []))))} rows)")


if __name__ == "__main__":
    main()
