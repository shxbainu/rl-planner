"""Writes news_summary.json: the morning briefing, an AI summary of the headlines in news.json.

Runs in the deploy workflow right after fetch_news.py. It makes one Claude API call a day, the first run after
6:30am Eastern (or any run with --force); every other run just carries the current summary forward. If the
ANTHROPIC_API_KEY secret is missing or anything goes wrong, it keeps the previous summary and exits 0, so the
deploy never fails because of it.

Accuracy rules, enforced in the prompt and again here: the model may only use the items it's given, and every
story cites items by number. Numbers that aren't in the input are dropped, and so is any story left citing nothing.

    python tools/summarize_news.py news.json news_summary.json [--force]
"""
import datetime as dt
import json
import os
import sys
import urllib.request
from zoneinfo import ZoneInfo

MODEL = "claude-sonnet-5-5"
ET = ZoneInfo("America/New_York")
READY_AT = dt.time(6, 30)  # the first run at or after this time each day writes the new briefing
PREVIOUS = "https://shxbainu.github.io/rl-planner/news_summary.json"  # the live copy, carried forward
ORDER = ["top", "world", "politics", "business", "tech", "science", "health"]
MAX_ITEMS = 220
SUMMARY_CHARS = 400

SYSTEM = """You write a short, neutral morning news briefing for a high school student.

You are given numbered news items (headline, short description, outlet). Use only what those items say:
no outside facts, no numbers, names or dates that aren't in the items, no predictions, no opinions, no loaded
words. If items disagree, say so plainly. If several outlets cover the same story, merge them into one story
and cite every item you used.

Write:
- day: one sentence that sums up the day's biggest news.
- stories: the 5 to 7 most important stories, most important first, judged by how much they affect people,
  not by which outlet ran them. For each:
  - headline: a short, plain headline in your own words.
  - summary: 2 or 3 plain sentences, built only from the cited items.
  - why: one sentence on why it matters, based only on what the items say (who or what is affected). If the
    items don't say, describe what is affected without guessing.
  - items: the numbers of every item the story uses (at least one).

Keep sentences short and words simple. Do not mention that you are an AI or that you were given items."""

SCHEMA = {
    "type": "object",
    "properties": {
        "day": {"type": "string"},
        "stories": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "headline": {"type": "string"},
                    "summary": {"type": "string"},
                    "why": {"type": "string"},
                    "items": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["headline", "summary", "why", "items"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["day", "stories"],
    "additionalProperties": False,
}


def log(msg):
    print(f"summarize_news: {msg}")


def load_previous(out_path):
    """The summary already on the live site (or a local copy), or None."""
    try:
        with urllib.request.urlopen(urllib.request.Request(PREVIOUS, headers={"User-Agent": "rl-planner-deploy/1.0"}), timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        pass
    try:
        with open(out_path) as f:
            return json.load(f)
    except Exception:
        return None


def keep(prev, out_path, why):
    log(f"{why}; keeping the previous summary")
    if prev:
        with open(out_path, "w") as f:
            json.dump(prev, f, ensure_ascii=False, indent=1)


def items_from(news):
    """News items, one per link, in section order, numbered from 1."""
    seen, items = set(), []
    for sec in ORDER + [s for s in news.get("sections", {}) if s not in ORDER]:
        for it in news.get("sections", {}).get(sec, []):
            link = it.get("link")
            if not link or link in seen or not it.get("title"):
                continue
            seen.add(link)
            items.append({"n": len(items) + 1, "section": sec, "source": it.get("source", ""), "title": it["title"].strip(),
                          "summary": (it.get("summary") or "").strip()[:SUMMARY_CHARS], "link": link})
            if len(items) >= MAX_ITEMS:
                return items
    return items


def prompt_for(items, today):
    lines = [f"Today is {today:%A, %B %-d, %Y}. Here are today's news items:", ""]
    for it in items:
        lines.append(f"[{it['n']}] ({it['source']}, {it['section']}) {it['title']}" + (f" | {it['summary']}" if it["summary"] else ""))
    return "\n".join(lines)


def validated(data, items):
    """Stories whose citations all resolve to input items; uncited or unknown numbers are dropped."""
    by_n = {it["n"]: it for it in items}
    stories = []
    for s in data.get("stories", []):
        cited = [by_n[n] for n in dict.fromkeys(s.get("items", [])) if n in by_n]
        if not cited or not all(s.get(k, "").strip() for k in ("headline", "summary", "why")):
            continue
        stories.append({"headline": s["headline"].strip(), "summary": s["summary"].strip(), "why": s["why"].strip(),
                        "sources": [{"source": it["source"], "title": it["title"], "link": it["link"]} for it in cited]})
    return stories[:7]


def summarize(items, today):
    import anthropic  # installed by the workflow only when the key is set

    client = anthropic.Anthropic()
    # fallbacks="default": if a safety classifier declines, the API retries on Anthropic's recommended model.
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": prompt_for(items, today)}],
    )
    if response.stop_reason != "end_turn":
        raise RuntimeError(f"stopped early: {response.stop_reason}")
    text = next(b.text for b in response.content if b.type == "text")
    log(f"{response.usage.input_tokens} input / {response.usage.output_tokens} output tokens")
    return json.loads(text)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    news_path, out_path = (args + ["news.json", "news_summary.json"])[:2]
    prev = load_previous(out_path)
    now = dt.datetime.now(ET)

    if not force and prev and prev.get("date") == now.date().isoformat():
        return keep(prev, out_path, "today's briefing is already written")
    if not force and now.time() < READY_AT:
        return keep(prev, out_path, "too early for today's briefing")
    if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return keep(prev, out_path, "no ANTHROPIC_API_KEY secret")
    try:
        with open(news_path) as f:
            items = items_from(json.load(f))
    except Exception as e:
        return keep(prev, out_path, f"couldn't read {news_path} ({e})")
    if len(items) < 10:
        return keep(prev, out_path, f"only {len(items)} news items")

    try:
        import anthropic
    except ImportError:
        return keep(prev, out_path, "the anthropic package isn't installed")
    try:
        data = summarize(items, now.date())
    except anthropic.AuthenticationError:
        return keep(prev, out_path, "the API key was rejected")
    except anthropic.RateLimitError:
        return keep(prev, out_path, "rate limited")
    except anthropic.APIStatusError as e:
        return keep(prev, out_path, f"API error {e.status_code}")
    except anthropic.APIConnectionError:
        return keep(prev, out_path, "couldn't reach the API")
    except Exception as e:
        return keep(prev, out_path, f"{type(e).__name__}: {e}")

    stories = validated(data, items)
    if len(stories) < 3 or not data.get("day", "").strip():
        return keep(prev, out_path, f"only {len(stories)} stories had valid citations")
    out = {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "date": now.date().isoformat(),
           "model": MODEL, "day": data["day"].strip(), "stories": stories}
    with open(out_path, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    log(f"wrote {len(stories)} stories")


if __name__ == "__main__":
    main()
