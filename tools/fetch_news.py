"""Builds news.json from public RSS/Atom feeds. Runs hourly in GitHub Actions (browsers can't read these feeds directly)."""
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEEDS = {
    "top": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"),
        ("The Guardian", "https://www.theguardian.com/us-news/rss"),
        ("NPR", "https://feeds.npr.org/1001/rss.xml"),
        ("The Atlantic", "https://www.theatlantic.com/feed/all/"),
    ],
    "politics": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"),
        ("NPR", "https://feeds.npr.org/1014/rss.xml"),
        ("The Hill", "https://thehill.com/homenews/feed/"),
        ("PBS NewsHour", "https://www.pbs.org/newshour/feeds/rss/politics"),
    ],
    "world": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"),
        ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        ("The Guardian", "https://www.theguardian.com/world/rss"),
        ("WSJ", "https://feeds.a.dj.com/rss/RSSWorldNews.xml"),
    ],
    "tech": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"),
        ("Wired", "https://www.wired.com/feed/rss"),
        ("MIT Tech Review", "https://www.technologyreview.com/feed/"),
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ],
}
PER_FEED = 10
ATOM = "{http://www.w3.org/2005/Atom}"


def when(text):
    if not text:
        return None
    try:
        d = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def clean(text, n=220):
    """RSS summaries are often HTML; keep a short plain-text gist."""
    t = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"


def read(source, url):
    req = urllib.request.Request(url, headers={"User-Agent": "rl-planner-news/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.iter("item"):  # RSS
        out.append({"title": (it.findtext("title") or "").strip(), "link": (it.findtext("link") or "").strip(),
                    "published": when(it.findtext("pubDate")), "source": source, "summary": clean(it.findtext("description"))})
    for it in root.iter(ATOM + "entry"):  # Atom
        link = it.find(ATOM + "link[@rel='alternate']") or it.find(ATOM + "link")
        out.append({"title": (it.findtext(ATOM + "title") or "").strip(), "link": link.get("href", "") if link is not None else "",
                    "published": when(it.findtext(ATOM + "published") or it.findtext(ATOM + "updated")), "source": source,
                    "summary": clean(it.findtext(ATOM + "summary") or it.findtext(ATOM + "content"))})
    return [x for x in out if x["title"] and x["link"].startswith("http")][:PER_FEED]


def main(path):
    sections = {}
    for name, feeds in FEEDS.items():
        items, seen = [], set()
        for source, url in feeds:
            try:
                for x in read(source, url):
                    key = x["title"].lower()
                    if key not in seen:
                        seen.add(key)
                        items.append(x)
            except Exception as e:  # one dead feed shouldn't sink the rest
                print(f"skip {source} {url}: {e}", file=sys.stderr)
        items.sort(key=lambda x: x["published"] or "", reverse=True)
        # newest first, but no more than 2 in a row from the same outlet
        mixed, rest = [], items[:]
        while rest:
            for i, x in enumerate(rest):
                if len(mixed) < 2 or not (mixed[-1]["source"] == mixed[-2]["source"] == x["source"]):
                    mixed.append(rest.pop(i))
                    break
            else:
                mixed.append(rest.pop(0))
        items = mixed
        if items:
            sections[name] = items[:30]
    data = {"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "sections": sections}
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in sections.items()})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "news.json")
