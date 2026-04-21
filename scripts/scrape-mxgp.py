#!/usr/bin/env python3
"""
MXGP Results Scraper for Photo & Moto
Scrapes latest race results and standings from mxgpresults.com
Generates AI highlights using Gemini 2.5 Flash.
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

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"


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
    """Dynamically find the latest completed race from mxgpresults.com."""
    url = f"{BASE_URL}/mxgp/{SEASON}/"
    html = fetch_page(url)
    if not html:
        return None
    
    race_links = re.findall(rf'/mxgp/{SEASON}/([a-z0-9-]+)', html)
    
    seen = set()
    slugs = []
    skip = {'standings', 'calendar', 'teams', 'entry-list'}
    for slug in race_links:
        if slug not in seen and slug not in skip:
            seen.add(slug)
            slugs.append(slug)
    
    if not slugs:
        return None
    
    latest_slug = slugs[-1]
    latest_round = len(slugs)
    
    race_url = f"{BASE_URL}/mxgp/{SEASON}/{latest_slug}"
    race_html = fetch_page(race_url)
    
    race_name = f"MXGP of {latest_slug.replace('-', ' ').title()}"
    location = ""
    race_date = ""
    
    if race_html:
        h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', race_html, re.DOTALL)
        if h1_match:
            name_text = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip()
            if name_text:
                race_name = name_text
        
        loc_match = re.search(r'taking place at\s+(.+?)\s+in\s+(.+?)\s+on', race_html, re.IGNORECASE)
        if loc_match:
            location = f"{loc_match.group(1)}, {loc_match.group(2)}"
        
        date_match = re.search(r'(?:Sunday|Saturday),?\s+(\w+)\s+(\d+)\w*\s+(\d{4})', race_html, re.IGNORECASE)
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


def generate_highlights(race_info, mxgp_results, mx2_results, standings):
    """Use Gemini to generate race highlights in Finnish and English."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("  No GEMINI_API_KEY found, skipping highlights")
        return {"fi": [], "en": []}
    
    # Build a data summary for Gemini
    summary_lines = [
        f"Race: {race_info['name']} (Round {race_info['round']})",
        f"Location: {race_info['location']}",
        f"Date: {race_info['date']}",
    ]
    
    if mxgp_results:
        if mxgp_results["qualifying"]:
            summary_lines.append(f"\nMXGP Qualifying top 5:")
            for r in mxgp_results["qualifying"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}, {r['nat']})")
        
        if mxgp_results["race1"]:
            summary_lines.append(f"\nMXGP Race 1 top 5:")
            for r in mxgp_results["race1"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")
        
        if mxgp_results["race2"]:
            summary_lines.append(f"\nMXGP Race 2 top 5:")
            for r in mxgp_results["race2"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")
        
        if mxgp_results["overall"]:
            summary_lines.append(f"\nMXGP GP Overall top 5:")
            for r in mxgp_results["overall"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")
    
    if mx2_results:
        if mx2_results["overall"]:
            summary_lines.append(f"\nMX2 GP Overall top 5:")
            for r in mx2_results["overall"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")
    
    if standings.get("mxgp"):
        top2 = standings["mxgp"][:2]
        if len(top2) == 2:
            gap = top2[0].get("pts", 0) - top2[1].get("pts", 0)
            summary_lines.append(f"\nMXGP Championship: {top2[0]['rider']} leads with {top2[0]['pts']} pts, {gap} pts ahead of {top2[1]['rider']}")
    
    if standings.get("mx2"):
        top2 = standings["mx2"][:2]
        if len(top2) == 2:
            gap = top2[0].get("pts", 0) - top2[1].get("pts", 0)
            summary_lines.append(f"\nMX2 Championship: {top2[0]['rider']} leads with {top2[0]['pts']} pts, {gap} pts ahead of {top2[1]['rider']}")
    
    data_summary = "\n".join(summary_lines)
    
    prompt = f"""You are a motorsport journalist for a Finnish motocross website. Based on the race results data below, generate highlights for the weekend.

RULES:
- Generate exactly 4 bullet points in FINNISH and 4 in ENGLISH
- Each bullet should be 1 short sentence, max 15 words
- Focus on: GP winners, dominant performances, championship implications, surprises
- Use exciting motorsport language (hallitsi, dominoi, taisteli, nousi)
- Only state facts from the data — do NOT invent crashes, injuries, or events not in the data
- Output as JSON only, no markdown, no backticks

RACE DATA:
{data_summary}

OUTPUT FORMAT (JSON only):
{{"fi": ["bullet1", "bullet2", "bullet3", "bullet4"], "en": ["bullet1", "bullet2", "bullet3", "bullet4"]}}"""

    try:
        url = GEMINI_URL.format(model=GEMINI_MODEL, key=api_key)
        resp = requests.post(url, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.4}
        }, timeout=30)
        
        if not resp.ok:
            print(f"  Gemini error: {resp.status_code} - {resp.text[:200]}")
            return {"fi": [], "en": []}
        
        data = resp.json()
        answer = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        
        # Extract JSON from response (handles ```json blocks, extra text, etc.)
        answer = answer.strip()
        # Find the JSON object between first { and last }
        json_match = re.search(r'\{.*\}', answer, re.DOTALL)
        if not json_match:
            print(f"  No JSON found in response: {answer[:200]}")
            return {"fi": [], "en": []}
        
        json_str = json_match.group()
        highlights = json.loads(json_str)
        
        fi_count = len(highlights.get("fi", []))
        en_count = len(highlights.get("en", []))
        print(f"  Highlights generated: {fi_count} FI, {en_count} EN")
        
        return highlights
    
    except Exception as e:
        print(f"  Highlights generation failed: {e}")
        return {"fi": [], "en": []}


def build_json():
    """Main function: find latest round, scrape, generate highlights, output JSON."""
    
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
            "highlights": {"fi": [], "en": []},
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
    
    standings = {"mxgp": mxgp_standings, "mx2": mx2_standings}
    
    print(f"\nGenerating highlights...")
    highlights = generate_highlights(latest, mxgp_results, mx2_results, standings)
    
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
        "highlights": highlights,
        "standings": standings
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