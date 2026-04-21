#!/usr/bin/env python3
"""
MXGP Results Scraper for Photo & Moto
Scrapes latest race results and standings from mxgpresults.com
Runs via GitHub Actions (Sunday + Monday) during the season.
"""

import requests
from bs4 import BeautifulSoup
import json
import re
import os
from datetime import date

BASE_URL = "https://mxgpresults.com"
SEASON = 2026
TOP_N = 10
OUTPUT_PATH = "public/data/mxgp-results.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

CALENDAR = [
    {"round": 1,  "slug": "argentina",   "name": "MXGP of Argentina",   "location": "Neuquén, Argentina",      "date": "2026-03-08"},
    {"round": 2,  "slug": "andalucia",   "name": "MXGP of Andalucia",   "location": "Cózar, Spain",            "date": "2026-03-15"},
    {"round": 3,  "slug": "switzerland", "name": "MXGP of Switzerland", "location": "Frauenfeld, Switzerland", "date": "2026-03-29"},
    {"round": 4,  "slug": "sardegna",    "name": "MXGP of Sardegna",    "location": "Riola Sardo, Italy",      "date": "2026-04-12"},
    {"round": 5,  "slug": "trentino",    "name": "MXGP of Trentino",    "location": "Pietramurata, Italy",     "date": "2026-04-19"},
    {"round": 6,  "slug": "spain",       "name": "MXGP of Spain",       "location": "Xanadú, Spain",           "date": "2026-05-03"},
    {"round": 7,  "slug": "portugal",    "name": "MXGP of Portugal",    "location": "Águeda, Portugal",        "date": "2026-05-10"},
    {"round": 8,  "slug": "france",      "name": "MXGP of France",      "location": "Ernée, France",           "date": "2026-05-17"},
    {"round": 9,  "slug": "germany",     "name": "MXGP of Germany",     "location": "Teutschenthal, Germany",  "date": "2026-05-31"},
    {"round": 10, "slug": "latvia",      "name": "MXGP of Latvia",      "location": "Kegums, Latvia",          "date": "2026-06-07"},
    {"round": 11, "slug": "indonesia",   "name": "MXGP of Indonesia",   "location": "Semarang, Indonesia",     "date": "2026-06-28"},
    {"round": 12, "slug": "czech-republic", "name": "MXGP of Czech Republic", "location": "Loket, Czech Republic", "date": "2026-07-12"},
    {"round": 13, "slug": "flanders",    "name": "MXGP of Flanders",    "location": "Lommel, Belgium",         "date": "2026-07-19"},
    {"round": 14, "slug": "sweden",      "name": "MXGP of Sweden",      "location": "Uddevalla, Sweden",       "date": "2026-08-02"},
    {"round": 15, "slug": "finland",     "name": "MXGP of Finland",     "location": "Iitti, Finland",          "date": "2026-08-09"},
    {"round": 16, "slug": "great-britain", "name": "MXGP of Great Britain", "location": "Matterley Basin, UK", "date": "2026-08-23"},
    {"round": 17, "slug": "netherlands", "name": "MXGP of The Netherlands", "location": "Arnhem, Netherlands", "date": "2026-08-30"},
    {"round": 18, "slug": "turkiye",     "name": "MXGP of Türkiye",     "location": "Afyonkarahisar, Turkey",  "date": "2026-09-06"},
    {"round": 19, "slug": "china",       "name": "MXGP of China",       "location": "Shanghai, China",         "date": "2026-09-13"},
    {"round": 20, "slug": "australia",   "name": "MXGP of Australia",   "location": "Darwin, Australia",       "date": "2026-09-20"},
]

TOTAL_ROUNDS = len(CALENDAR)


def fetch_page(url):
    """Fetch a page with error handling."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None


def parse_table_from_html(table_html):
    """Parse a table from raw HTML, handling unclosed <td>/<th> tags.
    
    mxgpresults.com uses unclosed tags like:
    <tr><td>1<td>#84<td><a href="...">Jeffrey Herlings</a><td>Honda<td>NED<td>47
    """
    results = []
    
    # Split into rows by <tr>
    row_chunks = re.split(r'<tr[^>]*>', table_html)
    
    for chunk in row_chunks:
        # Split cells by <td> or <th>
        cells = re.split(r'<t[dh][^>]*>', chunk)
        # Clean each cell: remove HTML tags, strip whitespace
        clean = []
        for cell in cells:
            text = re.sub(r'<[^>]+>', '', cell).strip()
            if text:
                clean.append(text)
        
        if len(clean) < 4:
            continue
        
        # Skip header rows
        if clean[0].lower().startswith('pos'):
            continue
        
        entry = {}
        try:
            entry["pos"] = int(clean[0])
        except ValueError:
            continue
        
        if len(clean) >= 6:
            entry["num"] = clean[1].replace("#", "")
            entry["rider"] = clean[2]
            entry["bike"] = clean[3]
            entry["nat"] = clean[4]
            try:
                entry["pts"] = int(clean[5])
            except ValueError:
                entry["time"] = clean[5]
        elif len(clean) >= 5:
            entry["num"] = clean[1].replace("#", "")
            entry["rider"] = clean[2]
            entry["bike"] = clean[3]
            entry["nat"] = clean[4]
        
        if entry.get("rider"):
            results.append(entry)
    
    return results


def scrape_race_results(class_name, slug):
    """Scrape all results for a specific class and race."""
    url = f"{BASE_URL}/{class_name}/2026/{slug}"
    html = fetch_page(url)
    if not html:
        return None
    
    results = {
        "qualifying": [],
        "race1": [],
        "race2": [],
        "overall": []
    }
    
    # Find each <h3> heading followed by a <table>
    pattern = r'<h3[^>]*>(.*?)</h3>.*?(<table.*?</table>)'
    matches = re.findall(pattern, html, re.DOTALL)
    
    for heading_html, table_html in matches:
        heading = re.sub(r'<[^>]+>', '', heading_html).strip().lower()
        parsed = parse_table_from_html(table_html)[:TOP_N]
        
        if not parsed:
            continue
        
        if "gp classification" in heading or "classification" in heading:
            results["overall"] = parsed
        elif "race 2" in heading:
            results["race2"] = parsed
        elif "race 1" in heading:
            results["race1"] = parsed
        elif "qualifying" in heading and "time" not in heading:
            results["qualifying"] = parsed
    
    print(f"  Found: overall={len(results['overall'])}, race1={len(results['race1'])}, race2={len(results['race2'])}, quali={len(results['qualifying'])}")
    return results


def scrape_standings(class_name):
    """Scrape current championship standings."""
    url = f"{BASE_URL}/{class_name}/standings"
    html = fetch_page(url)
    if not html:
        return []
    
    table_match = re.search(r'<table.*?</table>', html, re.DOTALL)
    if not table_match:
        return []
    
    parsed = parse_table_from_html(table_match.group())[:TOP_N]
    print(f"  Found {len(parsed)} standings entries")
    return parsed


def get_latest_completed_round():
    """Determine the most recent completed round based on today's date."""
    today = date.today().isoformat()
    latest = None
    for race in CALENDAR:
        if race["date"] <= today:
            latest = race
    return latest


def build_json():
    """Main function: determine latest round, scrape everything, output JSON."""
    latest_round = get_latest_completed_round()
    
    if not latest_round:
        print("No completed rounds yet for 2026 season.")
        data = {
            "season": SEASON,
            "lastUpdated": date.today().isoformat(),
            "seasonComplete": False,
            "totalRounds": TOTAL_ROUNDS,
            "latestRace": None,
            "standings": {"mxgp": [], "mx2": []}
        }
        write_json(data)
        return
    
    print(f"Latest completed round: R{latest_round['round']} - {latest_round['name']}")
    slug = latest_round["slug"]
    is_season_complete = latest_round["round"] == TOTAL_ROUNDS
    
    print(f"Scraping MXGP results for {slug}...")
    mxgp_results = scrape_race_results("mxgp", slug)
    
    print(f"Scraping MX2 results for {slug}...")
    mx2_results = scrape_race_results("mx2", slug)
    
    print("Scraping MXGP standings...")
    mxgp_standings = scrape_standings("mxgp")
    
    print("Scraping MX2 standings...")
    mx2_standings = scrape_standings("mx2")
    
    data = {
        "season": SEASON,
        "lastUpdated": date.today().isoformat(),
        "seasonComplete": is_season_complete,
        "totalRounds": TOTAL_ROUNDS,
        "latestRace": {
            "round": latest_round["round"],
            "name": latest_round["name"],
            "slug": latest_round["slug"],
            "location": latest_round["location"],
            "date": latest_round["date"],
            "mxgp": mxgp_results or {"qualifying": [], "race1": [], "race2": [], "overall": []},
            "mx2": mx2_results or {"qualifying": [], "race1": [], "race2": [], "overall": []}
        },
        "standings": {
            "mxgp": mxgp_standings,
            "mx2": mx2_standings
        }
    }
    
    write_json(data)
    
    if is_season_complete:
        print("Season complete! This was the final round.")
    
    print("Done!")


def write_json(data):
    """Write the results JSON file."""
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    build_json()