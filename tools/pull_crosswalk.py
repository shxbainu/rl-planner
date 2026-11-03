"""Pulls the latest homework.json / fantasy.json that Muse saves in the brianrlsite Crosswalk files.

Runs in the deploy workflow with a read-only key in CROSSWALK_KEY. Anything missing or malformed is
skipped, so the site keeps the copy in the repo instead of breaking.
"""
import json
import os
import sys
import urllib.request

BASE = "https://mcp.crosswalk.to/files/brianrlsite/site/"


def homework_ok(d):
    return isinstance(d, dict) and isinstance(d.get("assignments"), list) and all(
        isinstance(a, dict) and a.get("class") and a.get("title") and a.get("due") for a in d["assignments"])


def fantasy_ok(d):
    return isinstance(d, dict) and isinstance(d.get("lineup", []), list) and isinstance(d.get("moves", []), list)


CHECKS = {"homework.json": homework_ok, "fantasy.json": fantasy_ok}


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
        if name == "fantasy.json":
            data = keep_claude_moves(data)
        with open(name, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print(f"{name}: pulled (updated_at {data.get('updated_at')}, {len(data.get('assignments', data.get('lineup', [])))} rows)")


if __name__ == "__main__":
    main()
