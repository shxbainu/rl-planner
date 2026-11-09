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


DATE = re.compile(r"\d{4}-\d{2}-\d{2}$")


def homework_ok(d):
    """The shape the site reads. Anything else is skipped and the repo copy is served."""
    if not (isinstance(d, dict) and isinstance(d.get("assignments"), list) and isinstance(d.get("days"), dict) and d["days"]):
        return False
    try:
        datetime.fromisoformat(str(d.get("updated_at")).replace("Z", "+00:00"))
    except ValueError:
        return False
    return all(re.fullmatch("[A-H]", str(v)) for v in d["days"].values()) and all(
        isinstance(a, dict) and a.get("class") and a.get("title") and DATE.match(str(a.get("due", ""))) for a in d["assignments"])


def fantasy_ok(d):
    return isinstance(d, dict) and isinstance(d.get("lineup", []), list) and isinstance(d.get("moves", []), list)


def links_ok(d):
    return isinstance(d, dict) and isinstance(d.get("class_links"), list) and all(
        isinstance(c, dict) and c.get("class") for c in d["class_links"])


CHECKS = {"homework.json": homework_ok, "fantasy.json": fantasy_ok, "links.json": links_ok}


def older_than_repo(name, data):
    """True when the repo copy is as new or newer, e.g. it already holds this save or a newer post merged by Claude."""
    try:
        with open(name) as f:
            mine = datetime.fromisoformat(json.load(f)["updated_at"].replace("Z", "+00:00"))
        theirs = datetime.fromisoformat(str(data.get("updated_at")).replace("Z", "+00:00"))
    except Exception:
        return False
    return theirs <= mine


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


def canon_class(c):
    s = str(c).lower()
    for start, name in (("latin", "Latin"), ("english", "English"), ("math", "MSI"), ("msi", "MSI"), ("french", "French"), ("forces", "Forces"),
                        ("fgc", "Forces"), ("art", "Arts"), ("glee", "Glee"), ("health", "Health")):
        if s.startswith(start):
            return name
    return c


def _clock(h, m):
    h, m = int(h), int(m)
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def clean_item(a):
    """One assignment in the site's terms: canonical class, due as a plain date, any time moved into the details."""
    if not isinstance(a, dict) or not a.get("due"):
        return a
    a = dict(a)
    a["class"] = canon_class(a.get("class", ""))
    details = str(a.get("details") or "").strip()
    pages = str(a.get("pages") or "").strip()
    if pages and pages.lower() not in details.lower():
        details = f"{details} · {pages}" if details else pages
    m = re.match(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})", str(a["due"]))
    if m:
        a["due"] = m[1]
        details = f"{_clock(m[2], m[3])}; {details}" if details else _clock(m[2], m[3])
    a["details"] = details
    title, kind = str(a.get("title", "")), a.get("type")
    if kind == "presentation":
        a["type"] = "project"
    elif kind == "test" and "quiz" in title.lower():
        a["type"] = "quiz"
    elif kind in ("homework", "reading") and re.search(r"\bRQ ?\d", title):
        a["type"] = "quiz"
    for extra in ("pages", "materials", "link", "source"):
        a.pop(extra, None)
    if not a.get("assigned"):
        a.pop("assigned", None)
    return a


def normalize_homework(d):
    """Muse sometimes saves {generated, day_letters, coverage_gaps, ...}; turn that into the site's shape."""
    if not isinstance(d, dict) or not isinstance(d.get("assignments"), list):
        return d
    d = {**d, "assignments": [clean_item(a) for a in d["assignments"]]}
    if d.get("updated_at") or not d.get("generated"):
        return d
    try:
        with open("homework.json") as f:
            repo = json.load(f)
    except Exception:
        repo = {}
    letters = d.get("day_letters") or {}
    if isinstance(letters, list):
        letters = {x.get("date"): x.get("day") for x in letters if isinstance(x, dict)}
    days, off, special = dict(repo.get("days", {})), dict(repo.get("off", {})), {}
    for day, val in letters.items():
        val = str(val or "").strip()
        if re.fullmatch("[A-H]", val):
            days[day] = val
        elif re.search(r"no school|no classes|holiday", val, re.I):
            off.setdefault(day, val)
        elif val:
            special[day] = val  # a sentence is never a letter
            if re.match(r"[A-H]\b", val):
                days[day] = val[0]
    for day in d.get("days_off") or []:
        off.setdefault(day, "No school")
    checked = re.split(r"\s*\(|\.\s", str(d.get("verified_by") or d.get("verified_from") or "portal check"))[0]
    checked = re.sub(r"\S+@\S+", "", checked).strip()  # never publish a sign-in address
    return {"updated_at": d["generated"], "source": f"Muse, {checked}", "days": days, "off": off,
            "special": {**special, **repo.get("special", {})},  # the repo's wording has the actual times
            "notes": d.get("coverage_gaps") or repo.get("notes", []), "assignments": d["assignments"]}


def _kind(a):
    return "work" if a.get("type") in ("homework", "reading") else a.get("type")


def same_kind(a, b):
    """Same sort of item, or one side calls it a quiz/test/etc. and the other side's title says so too."""
    ta, tb = _kind(a), _kind(b)
    return ta == tb or (tb in MAJOR and tb in a["title"].lower()) or (ta in MAJOR and ta in b["title"].lower())


def _gap(a, b):
    try:
        return abs((date.fromisoformat(a["due"]) - date.fromisoformat(b["due"])).days)
    except ValueError:
        return 99


def same_item(a, b):
    """Two rewordings of one assignment: same class, due within 3 days, and the titles mostly agree."""
    if a["class"] != b["class"] or not same_kind(a, b):
        return False
    gap = _gap(a, b)
    if gap > 3:
        return False
    ta, tb = a["title"].lower(), b["title"].lower()
    wa, wb = _words(ta), _words(tb)
    overlap = len(wa & wb) / max(1, min(len(wa), len(wb)))
    return (gap == 0 and (overlap >= 0.6 or SequenceMatcher(None, ta, tb).ratio() >= 0.7)) or overlap >= 0.8


def _key(a):
    return (a["class"], a["title"].strip().lower(), a["due"])


def pair_up(new, old):
    """Which old item each new one rewords: [(new, old), ...]. Exact matches claim theirs first; a fuzzy match can't take it."""
    exact = {_key(b): b for b in old}
    pairs = [(a, exact[_key(a)]) for a in new if _key(a) in exact]
    taken = {id(b) for _, b in pairs}
    done = {id(a) for a, _ in pairs}
    for a in new:
        if id(a) in done:
            continue
        options = sorted((b for b in old if id(b) not in taken and same_item(a, b)), key=lambda b: _gap(a, b))
        if options:
            pairs.append((a, options[0]))
            taken.add(id(options[0]))
            done.add(id(a))
    # worded completely differently (page numbers vs a topic): the only one of its kind left that day on both sides
    slot = lambda x: (x["class"], x["due"], x.get("type"))
    left_new = [a for a in new if id(a) not in done]
    left_old = [b for b in old if id(b) not in taken]
    for a in left_new:
        mine = [b for b in left_old if slot(b) == slot(a)]
        if len(mine) == 1 and sum(slot(x) == slot(a) for x in left_new) == 1:
            pairs.append((a, mine[0]))
    return pairs


def keep_titles(data):
    """Check-offs are keyed by class + title + due, so a reworded title would drop Brian's tick.
    When Muse's file rewords an assignment the repo already has, keep the repo's title and due date, and never
    let a quiz or test slip to plain homework. Also keep special days Muse left out, and anything due after
    the last date Muse's file covers (exams past the marking period)."""
    try:
        with open("homework.json") as f:
            repo = json.load(f)
    except Exception:
        return data
    old = repo.get("assignments", [])
    for a, b in pair_up(data["assignments"], old):
        if a["title"] != b["title"] or a["due"] != b["due"]:
            print(f"  kept title: {a['class']} {a['title']!r} {a['due']} -> {b['title']!r} {b['due']}")
        a["title"], a["due"] = b["title"], b["due"]
        if b.get("type") in MAJOR:
            a["type"] = b["type"]
    data["special"] = {**repo.get("special", {}), **data.get("special", {})}
    last = max((a["due"] for a in data["assignments"]), default="")
    data["assignments"] += [b for b in old if b["due"] > last]
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
        if name == "homework.json":
            data = normalize_homework(data)
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
