"""Writes menu.json: Roxbury Latin's SAGE Dining lunch menu from today through the next week or so.

The SAGE menu page (sagedining.com/sites/roxburylatin/menu) is drawn by JavaScript from a small JSON API; this
reads the same API. Runs on every deploy. On any failure it keeps the menu that's already live, so the deploy
never fails because of it.

    python tools/fetch_menu.py menu.json
"""
import datetime as dt
import json
import re
import sys
import urllib.request
from zoneinfo import ZoneInfo

SITE = "roxburylatin"
API = "https://www.sagedining.com/microsites"
PAGE = f"https://www.sagedining.com/sites/{SITE}/menu"
PREVIOUS = "https://shxbainu.github.io/rl-planner/menu.json"
ET = ZoneInfo("America/New_York")
UA = {"User-Agent": "Mozilla/5.0 (rl-planner menu fetch; +https://shxbainu.github.io/rl-planner/)"}
DAYS = 8  # school days of lunch to keep, starting today

# SAGE's categories, in the order the card shows them, with the label it uses
STATIONS = [("Today's Menu Features", "Featured"), ("Entrées", "Entrées"), ("Specials", "Specials"), ("Soups", "Soup"),
            ("Deli", "Deli"), ("Salads", "Salads"), ("Sides and Vegetables", "Sides"), ("Desserts", "Dessert")]
DIET = {"V": "V", "V+": "VG"}  # SAGE lifestyle codes: Vegetarian, Vegan


def log(msg):
    print(f"fetch_menu: {msg}")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def keep_previous(out_path, why):
    log(f"{why}; keeping the previous menu")
    try:
        prev = get(PREVIOUS)
    except Exception:
        return
    with open(out_path, "w") as f:
        json.dump(prev, f, ensure_ascii=False, indent=1)


def clean(name):
    return re.sub(r"\s+", " ", re.sub(r"[®™]", "", name or "")).strip()


def menu_for(menus, day):
    """The menu in force on a day: the one that started most recently on or before it."""
    started = [(dt.datetime.strptime(m["menuFirstDate"], "%m/%d/%Y").date(), m) for m in menus if m.get("menuFirstDate")]
    started = [x for x in started if x[0] <= day] or started
    return max(started, key=lambda x: x[0])[1] if started else None


def lunch(day_data):
    stations = []
    for key, label in STATIONS:
        items, seen = [], set()
        for it in day_data.get(key, []):
            name = clean(it.get("name"))
            if it.get("meal") != "Lunch" or not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            al = it.get("allergens") or {}
            diet = [DIET[c] for c in al.get("lifestyleCodes", []) if c in DIET]
            if "GF Zone" in (it.get("displayStation") or ""):
                diet.append("GF")
            items.append({"name": name, "diet": diet, "allergens": al.get("allergenNames", [])})
        if items:
            stations.append({"name": label, "items": items})
    return stations


def main():
    out_path = (sys.argv[1:] or ["menu.json"])[0]
    today = dt.datetime.now(ET).date()
    try:
        menus = get(f"{API}/getVenueInformation?name={SITE}").get("menus") or []
        if not menus:
            return keep_previous(out_path, "SAGE lists no menus")
        days, start = {}, today
        for week in range(3):  # this week and the next two cover the next 8 school days, holidays included
            ref = start + dt.timedelta(days=7 * week)
            menu = menu_for(menus, ref)
            if not menu:
                continue
            data = get(f"{API}/getWeeklyMenuItems?menuId={menu['id']}&date={ref:%m/%d/%Y}")
            for key, day_data in data.items():
                try:
                    day = dt.datetime.strptime(key, "%m/%d/%Y").date()
                except ValueError:
                    continue  # the "daily" list of always-available items
                if day >= today and isinstance(day_data, dict):
                    stations = lunch(day_data)
                    if stations:
                        days[day.isoformat()] = {"stations": stations}
            if len(days) >= DAYS:
                break
    except Exception as e:
        return keep_previous(out_path, f"{type(e).__name__}: {e}")
    if not days:
        return keep_previous(out_path, "no lunch menus posted from today on")
    keep = dict(sorted(days.items())[:DAYS])
    with open(out_path, "w") as f:
        json.dump({"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "source": PAGE, "days": keep},
                  f, ensure_ascii=False, indent=1)
    log(f"wrote {len(keep)} days of lunch ({min(keep)} to {max(keep)})")


if __name__ == "__main__":
    main()
