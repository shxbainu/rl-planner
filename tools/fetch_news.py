"""Builds news.json from public RSS/Atom feeds. Runs hourly in GitHub Actions (browsers can't read these feeds directly)."""
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEEDS = {
    "politics": [
        ("NPR", "https://feeds.npr.org/1014/rss.xml"),
        ("PBS NewsHour", "https://www.pbs.org/newshour/feeds/rss/politics"),
        ("The Hill", "https://thehill.com/homenews/feed/"),
    ],
    "world": [
        ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        ("NPR", "https://feeds.npr.org/1004/rss.xml"),
        ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "tech": [
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
        ("TechCrunch", "https://techcrunch.com/feed/"),
        ("Hacker News", "https://hnrss.org/frontpage?points=250"),
    ],
}
PER_FEED = 12
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


def read(source, url):
    req = urllib.request.Request(url, headers={"User-Agent": "rl-planner-news/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.iter("item"):  # RSS
        out.append({"title": (it.findtext("title") or "").strip(), "link": (it.findtext("link") or "").strip(),
                    "published": when(it.findtext("pubDate")), "source": source})
    for it in root.iter(ATOM + "entry"):  # Atom
        link = it.find(ATOM + "link[@rel='alternate']") or it.find(ATOM + "link")
        out.append({"title": (it.findtext(ATOM + "title") or "").strip(), "link": link.get("href", "") if link is not None else "",
                    "published": when(it.findtext(ATOM + "published") or it.findtext(ATOM + "updated")), "source": source})
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
        if items:
            sections[name] = items[:30]
    data = {"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "sections": sections}
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in sections.items()})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "news.json")
