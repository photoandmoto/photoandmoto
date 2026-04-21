#!/usr/bin/env python3
"""
MXGP Results Scraper for Photo & Moto
Scrapes latest race results and standings from mxgpresults.com
Fully dynamic — no hardcoded calendar, finds latest race automatically.
Runs via GitHub Actions (Sunday + Monday) during the season.
"""

import requests
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


def fetch_page(url):
    """Fetch a page with error handling."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None


def find_latest_race():
    """Dynamically find the latest completed race from mxgpresults.com.
    
    Fetches the season results page and finds the last race listed.
    Returns dict with slug, round, name, or None if no races found.
    """
    url = f"{BASE_URL}/mxgp/{SEASON}/"
    html = fetch_page(url)
    if not html:
        return None
    
    # Find all race links: /mxgp/2026/trentino
    # Pattern: links within the results table that point to individual races
    race_links = re.findall(
        rf'/mxgp/{SEASON}/([a-z0-9-]+)',
        html
    )
    
    # Remove duplicates while preserving order, skip 'standings'
    seen = set()
    slugs = []
    skip = {'standings', 'calendar', 'teams', 'entry-list'}
    for slug in race_links:
        if slug not in seen and slug not in skip:
            seen.add(slug)
            slugs.append(slug)
    
    if not slugs:
        print("No completed races found on results page.")
        return None
    
    latest_slug = slugs[-1]
    latest_round = len(slugs)
    
    # Get race details from the individual race page
    race_url = f"{BASE_URL}/mxgp/{SEASON}/{latest_slug}"
    race_html = fetch_page(race_url)
    
    race_name = f"MXGP of {latest_slug.replace('-', ' ').title()}"
    location = ""
    race_date = ""
    
    if race_html:
        # Extract race name from h1
        h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', race_html, re.DOTALL)
        if h1_match:
            name_text = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip()
            if name_text:
                race_name = name_text
        
        # Extract location from meta description or page content
        # The page typically has "taking place at X in Y"
        loc_match = re.search(r'taking place at\s+(.+?)\s+in\s+(.+?)\s+on', race_html, re.IGNORECASE)
        if loc_match:
            location = f"{loc_match.group(1)}, {loc_match.group(2)}"
        
        # Extract date from page content
        # Pattern: "Sunday, April 19th 2026" or similar
        date_match = re.search(
            r'(?:Sunday|Saturday),?\s+(\w+)\s+(\d+)\w*\s+(\d{4})',
            race_html, re.IGNORECASE
        )
        if date_match:
            months = {
                'january': '01', 'february': '02', 'march': '03', 'april': '04',
                'may': '05', 'june': '06', 'july': '07', 'august': '08',
                'september': '09', 'october': '10', 'november': '11', 'december': '12'
            }
            month = months.get(date_match.group(1).lower(), '01')
            day = date_match.group(2).zfill(2)
            year = date_match.group(3)
            race_date = f"{year}-{month}-{day}"
    
    # Count total rounds from the standings page info
    total_match = re.search(r'after\s+(\d+)\s+of\s+(\d+)\s+rounds', race_html or '', re.IGNORECASE)
    total_rounds = int(total_match.group(2)) if total_match else 19
    
    print(f"  Latest race: R{latest_round} - {race_name}")
    print(f"  Location: {location or 'unknown'}")
    print(f"  Date: {race_date or 'unknown'}")
    
    return {
        "round": latest_round,
        "slug": latest_slug,
        "name": race_name,
        "location": location,
        "date": race_date,
        "totalRounds": total_rounds
    }


def parse_table_from_html(table_html):
    """Parse a table from raw HTML, handling unclosed <td>/<th> tags."""
    results = []
    
    row_chunks = re.split(r'<tr[^>]*>', table_html)
    
    for chunk in row_chunks:
        cells = re.split(r'<t[dh][^>]*>', chunk)
        clean = []
        for cell in cells:
            text = re.sub(r'<[^>]+>', '', cell).strip()
            if text:
                clean.append(text)
        
        if len(clean) < 4:
            continue
        
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
    url = f"{BASE_URL}/{class_name}/{SEASON}/{slug}"
    html = fetch_page(url)
    if not html:
        return None
    
    results = {
        "qualifying": [],
        "race1": [],
        "race2": [],
        "overall": []
    }
    
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
    
    print(f"  {class_name.upper()}: overall={len(results['overall'])}, race1={len(results['race1'])}, race2={len(results['race2'])}, quali={len(results['qualifying'])}")
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
    print(f"  {class_name.upper()} standings: {len(parsed)} entries")
    return parsed


def build_json():
    """Main function: find latest round dynamically, scrape everything, output JSON."""
    
    print(f"Finding latest completed race for {SEASON}...")
    latest = find_latest_race()
    
    if not latest:
        print("No completed rounds found.")
        data = {
            "season": SEASON,
            "lastUpdated": date.today().isoformat(),
            "seasonComplete": False,
            "totalRounds": 19,
            "latestRace": None,
            "standings": {"mxgp": [], "mx2": []}
        }
        write_json(data)
        return
    
    slug = latest["slug"]
    total_rounds = latest["totalRounds"]
    is_season_complete = latest["round"] == total_rounds
    
    print(f"\nScraping race results for {slug}...")
    mxgp_results = scrape_race_results("mxgp", slug)
    mx2_results = scrape_race_results("mx2", slug)
    
    print(f"\nScraping standings...")
    mxgp_standings = scrape_standings("mxgp")
    mx2_standings = scrape_standings("mx2")
    
    data = {
        "season": SEASON,
        "lastUpdated": date.today().isoformat(),
        "seasonComplete": is_season_complete,
        "totalRounds": total_rounds,
        "latestRace": {
            "round": latest["round"],
            "name": latest["name"],
            "slug": slug,
            "location": latest["location"],
            "date": latest["date"],
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
        print("\nSeason complete! This was the final round.")
    
    print("\nDone!")


def write_json(data):
    """Write the results JSON file."""
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    build_json()