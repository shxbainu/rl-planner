"""Builds news.json from public RSS/Atom feeds. Runs hourly in GitHub Actions (browsers can't read these feeds directly)."""
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

# A wide spread of outlets per section (left, right, US, international). Each outlet is capped per section so the
# busiest feeds can't crowd out the rest. Dead or blocked as of Nov 2026: old WSJ feeds.a.dj.com (stale since 2024),
# CNN (stale), AP and Reuters (no public feed), Marketplace (403), Bloomberg (no pictures, and its pages block GitHub).
WSJ = "https://feeds.content.dowjones.io/public/rss/"
FEEDS = {
    "top": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"),
        ("WSJ", WSJ + "RSSUSnews"),
        ("BBC", "https://feeds.bbci.co.uk/news/rss.xml"),
        ("The Guardian", "https://www.theguardian.com/us-news/rss"),
        ("NPR", "https://feeds.npr.org/1001/rss.xml"),
        ("ABC News", "https://abcnews.go.com/abcnews/topstories"),
        ("NBC News", "https://feeds.nbcnews.com/nbcnews/public/news"),
        ("CBS News", "https://www.cbsnews.com/latest/rss/main"),
        ("Fox News", "https://moxie.foxnews.com/google-publisher/latest.xml"),
        ("Axios", "https://api.axios.com/feed/"),
        ("The Atlantic", "https://www.theatlantic.com/feed/all/"),
    ],
    "politics": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"),
        ("WSJ", WSJ + "socialpoliticsfeed"),
        ("Politico", "https://rss.politico.com/politics-news.xml"),
        ("NPR", "https://feeds.npr.org/1014/rss.xml"),
        ("The Hill", "https://thehill.com/homenews/feed/"),
        ("PBS NewsHour", "https://www.pbs.org/newshour/feeds/rss/politics"),
        ("Fox News", "https://moxie.foxnews.com/google-publisher/politics.xml"),
    ],
    "world": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"),
        ("WSJ", WSJ + "RSSWorldNews"),
        ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        ("The Guardian", "https://www.theguardian.com/world/rss"),
        ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
        ("France 24", "https://www.france24.com/en/rss"),
    ],
    "business": [
        ("WSJ", WSJ + "WSJcomUSBusiness"),
        ("WSJ", WSJ + "socialeconomyfeed"),
        ("WSJ", WSJ + "RSSMarketsMain"),
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"),
        ("The Guardian", "https://www.theguardian.com/business/rss"),
        ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
        ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"),
        ("NPR", "https://feeds.npr.org/1006/rss.xml"),
    ],
    "tech": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"),
        ("WSJ", WSJ + "RSSWSJD"),
        ("Wired", "https://www.wired.com/feed/rss"),
        ("MIT Tech Review", "https://www.technologyreview.com/feed/"),
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ],
    "science": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml"),
        ("New Scientist", "https://www.newscientist.com/feed/home/"),
        ("NASA", "https://www.nasa.gov/news-release/feed/"),
        ("BBC", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"),
        ("The Guardian", "https://www.theguardian.com/science/rss"),
        ("The Guardian", "https://www.theguardian.com/environment/rss"),
        ("ScienceDaily", "https://www.sciencedaily.com/rss/top/science.xml"),
    ],
    "health": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml"),
        ("STAT", "https://www.statnews.com/feed/"),
        ("NPR", "https://feeds.npr.org/1128/rss.xml"),
    ],
}
PER_FEED = 10
PER_SECTION = 40
ATOM = "{http://www.w3.org/2005/Atom}"
MEDIA = "{http://search.yahoo.com/mrss/}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
IMG = re.compile(r"""<img[^>]+src=["'](https://[^"']+)["'][^>]*>""", re.I)
PIXEL = re.compile(r"pixel|tracking|spacer|beacon|\b1x1\b|[?&](w|width|h|height)=1\b", re.I)


def sized(u):
    """Ask image CDNs that resize on the fly for ~800px instead of the full-size original."""
    return re.sub(r"/resize/\d+x\d+!?/", "/resize/800/", u) if "brightspotcdn.com/dims" in u else u


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


def image(it, *html_bits):
    """Best picture for an item: the widest media:content/thumbnail, an image enclosure, or the first <img> in its HTML."""
    best, best_w = None, -1
    for el in list(it.iter(MEDIA + "content")) + list(it.iter(MEDIA + "thumbnail")):
        u, kind = el.get("url", ""), (el.get("medium") or el.get("type") or "image")
        if not u.startswith("https://") or not kind.startswith("image"):
            continue
        w = int(el.get("width") or 0)
        if w > best_w:
            best, best_w = u, w
    if best:
        return sized(best)
    for el in it.iter("enclosure"):
        if (el.get("type") or "").startswith("image") and el.get("url", "").startswith("https://"):
            return sized(el.get("url"))
    for bit in html_bits:  # skip tracking pixels, which some feeds put before the real picture
        for m in IMG.finditer(html.unescape(bit or "")):
            if not PIXEL.search(m.group(0)):
                return sized(m.group(1))
    return None


OG = re.compile(r"""<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>""", re.I)
CONTENT_ATTR = re.compile(r"""content=["'](https://[^"']+)["']""", re.I)


def page_image(link):
    """Fallback for items whose feed has no picture (NPR audio stories, WSJ): the article's own preview image."""
    try:
        req = urllib.request.Request(link, headers={"User-Agent": "Mozilla/5.0 (rl-planner-news/1.0)"})
        with urllib.request.urlopen(req, timeout=10) as r:
            head = r.read(300_000).decode("utf-8", "replace")
    except Exception:
        return None
    for tag in OG.findall(head):
        m = CONTENT_ATTR.search(tag)
        if m and not PIXEL.search(m.group(1)):
            return sized(html.unescape(m.group(1)))
    return None


def read(source, url):
    req = urllib.request.Request(url, headers={"User-Agent": "rl-planner-news/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.iter("item"):  # RSS
        out.append({"title": (it.findtext("title") or "").strip(), "link": (it.findtext("link") or "").strip(),
                    "published": when(it.findtext("pubDate")), "source": source, "summary": clean(it.findtext("description")),
                    "image": image(it, it.findtext(CONTENT), it.findtext("description"))})
    for it in root.iter(ATOM + "entry"):  # Atom
        link = it.find(ATOM + "link[@rel='alternate']") or it.find(ATOM + "link")
        out.append({"title": (it.findtext(ATOM + "title") or "").strip(), "link": link.get("href", "") if link is not None else "",
                    "published": when(it.findtext(ATOM + "published") or it.findtext(ATOM + "updated")), "source": source,
                    "summary": clean(it.findtext(ATOM + "summary") or it.findtext(ATOM + "content")),
                    "image": image(it, it.findtext(ATOM + "content"), it.findtext(ATOM + "summary"))})
    return [x for x in out if x["title"] and x["link"].startswith("http")][:PER_FEED]


def main(path):
    jobs = [(name, source, url) for name, feeds in FEEDS.items() for source, url in feeds]
    with ThreadPoolExecutor(12) as pool:
        got = dict(zip(jobs, pool.map(lambda j: safe_read(*j[1:]), jobs)))
    sections = {}
    for name, feeds in FEEDS.items():
        items, seen = [], set()
        for source, url in feeds:
            for x in got[(name, source, url)]:
                key = x["title"].lower()
                if key not in seen:
                    seen.add(key)
                    items.append(x)
        items.sort(key=lambda x: x["published"] or "", reverse=True)
        # no outlet takes more than its share of the section
        outlets = len({source for source, _ in feeds})
        cap, count, kept = max(4, PER_SECTION // outlets + 2), {}, []
        for x in items:
            count[x["source"]] = count.get(x["source"], 0) + 1
            if count[x["source"]] <= cap:
                kept.append(x)
        # newest first, but no more than 2 in a row from the same outlet
        mixed, rest = [], kept
        while rest:
            for i, x in enumerate(rest):
                if len(mixed) < 2 or not (mixed[-1]["source"] == mixed[-2]["source"] == x["source"]):
                    mixed.append(rest.pop(i))
                    break
            else:
                mixed.append(rest.pop(0))
        if mixed:
            sections[name] = mixed[:PER_SECTION]
    # feeds without pictures (CBS, Al Jazeera, CNBC, Bloomberg...): read each article's preview image, in parallel
    bare = [x for items in sections.values() for x in items if not x["image"]]
    with ThreadPoolExecutor(12) as pool:
        for x, img in zip(bare, pool.map(lambda x: page_image(x["link"]), bare)):
            x["image"] = img
    data = {"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "sections": sections}
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in sections.items()})


def safe_read(source, url):
    try:
        return read(source, url)
    except Exception as e:  # one dead feed shouldn't sink the rest
        print(f"skip {source} {url}: {e}", file=sys.stderr)
        return []


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "news.json")
