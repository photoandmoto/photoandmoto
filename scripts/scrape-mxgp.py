#!/usr/bin/env python3
"""
MXGP Results Scraper for Photo & Moto
Scrapes latest race results and standings from mxgpresults.com
Generates AI highlights using Gemini.
Runs via GitHub Actions (Sunday morning + evening) during the season.
"""

import requests
import json
import re
import os
import sys
import time
from datetime import date

BASE_URL = "https://mxgpresults.com"
SEASON = 2026
TOP_N = 10
OUTPUT_PATH = "public/data/mxgp-results.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"]
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"


def log(msg):
    """Print with flush to ensure GitHub Actions shows output."""
    print(msg, flush=True)


def fetch_page(url):
    """Fetch a page with error handling."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        log(f"  Error fetching {url}: {e}")
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

    log(f"  Latest race: R{latest_round} - {race_name}")
    log(f"  Location: {location or 'unknown'}")
    log(f"  Date: {race_date or 'unknown'}")

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

    log(f"  {class_name.upper()}: overall={len(results['overall'])}, race1={len(results['race1'])}, race2={len(results['race2'])}, quali={len(results['qualifying'])}")
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
    log(f"  {class_name.upper()} standings: {len(parsed)} entries")
    return parsed


def read_previous_standings():
    """Read top 3 standings from existing JSON file before overwrite, for comparison."""
    if not os.path.exists(OUTPUT_PATH):
        return {"mxgp": [], "mx2": []}
    try:
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            old = json.load(f)
        prev = old.get("standings", {}) or {}
        return {
            "mxgp": [{"rider": r.get("rider"), "pos": r.get("pos"), "pts": r.get("pts")}
                     for r in (prev.get("mxgp") or [])[:3]],
            "mx2":  [{"rider": r.get("rider"), "pos": r.get("pos"), "pts": r.get("pts")}
                     for r in (prev.get("mx2") or [])[:3]],
        }
    except Exception as e:
        log(f"  Could not read previous standings: {e}")
        return {"mxgp": [], "mx2": []}


def format_standings_diff(class_name, current, previous):
    """Format current top 3 + any position changes vs previous."""
    if not current:
        return ""
    lines = [f"\n{class_name} Championship - current top 3:"]
    for r in current[:3]:
        lines.append(f"  {r.get('pos')}. {r.get('rider')} - {r.get('pts')} pts")

    if previous:
        prev_map = {p.get("rider"): p.get("pos") for p in previous if p.get("rider")}
        moves = []
        for r in current[:3]:
            rider = r.get("rider")
            new_pos = r.get("pos")
            old_pos = prev_map.get(rider)
            if old_pos is None:
                moves.append(f"  {rider}: NEW to top 3 (now P{new_pos})")
            elif old_pos != new_pos:
                try:
                    direction = "UP" if int(old_pos) > int(new_pos) else "DOWN"
                    moves.append(f"  {rider}: {direction} from P{old_pos} to P{new_pos}")
                except (ValueError, TypeError):
                    pass
        if moves:
            lines.append(f"{class_name} position changes vs previous round:")
            lines.extend(moves)
        else:
            lines.append(f"{class_name}: no changes in top 3 order vs previous round")
    return "\n".join(lines)


def generate_highlights(race_info, mxgp_results, mx2_results, standings, previous_standings):
    """Use Gemini to generate per-tab race highlights in Finnish and English."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    log(f"  API key present: {bool(api_key)} (length: {len(api_key)})")

    empty = {
        "fi": {"mxgp_quali": [], "mxgp_race": [], "mx2_quali": [], "mx2_race": [], "standings": []},
        "en": {"mxgp_quali": [], "mxgp_race": [], "mx2_quali": [], "mx2_race": [], "standings": []},
    }

    if not api_key:
        log("  No GEMINI_API_KEY found, skipping highlights")
        return empty

    # Build data summary
    summary_lines = [
        f"Race: {race_info['name']} (Round {race_info['round']})",
        f"Location: {race_info['location']}",
        f"Date: {race_info['date']}",
    ]

    if mxgp_results:
        if mxgp_results["qualifying"]:
            summary_lines.append("\nMXGP Qualifying top 5:")
            for r in mxgp_results["qualifying"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}, {r['nat']})")

        if mxgp_results["race1"]:
            summary_lines.append("\nMXGP Race 1 top 5:")
            for r in mxgp_results["race1"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")

        if mxgp_results["race2"]:
            summary_lines.append("\nMXGP Race 2 top 5:")
            for r in mxgp_results["race2"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")

        if mxgp_results["overall"]:
            summary_lines.append("\nMXGP GP Overall top 5:")
            for r in mxgp_results["overall"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")

    if mx2_results:
        if mx2_results["qualifying"]:
            summary_lines.append("\nMX2 Qualifying top 5:")
            for r in mx2_results["qualifying"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}, {r['nat']})")

        if mx2_results["race1"]:
            summary_lines.append("\nMX2 Race 1 top 5:")
            for r in mx2_results["race1"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")

        if mx2_results["race2"]:
            summary_lines.append("\nMX2 Race 2 top 5:")
            for r in mx2_results["race2"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")

        if mx2_results["overall"]:
            summary_lines.append("\nMX2 GP Overall top 5:")
            for r in mx2_results["overall"][:5]:
                summary_lines.append(f"  {r['pos']}. {r['rider']} ({r['bike']}) - {r.get('pts', '')} pts")

    summary_lines.append(format_standings_diff("MXGP", standings.get("mxgp", []), previous_standings.get("mxgp", [])))
    summary_lines.append(format_standings_diff("MX2",  standings.get("mx2",  []), previous_standings.get("mx2",  [])))

    data_summary = "\n".join(summary_lines)

    prompt = f"""You are a motorsport journalist for a Finnish motocross website. Based on the race weekend data below, generate FIVE separate sets of highlights for both Finnish (fi) and English (en).

THE FIVE BUCKETS:
1. "mxgp_quali" — exactly 2 bullets about MXGP Saturday QUALIFYING ONLY (pole sitter, surprises, fastest in difficult conditions). Do NOT mention Sunday races, do NOT mention overall winner. Saturday only.
2. "mxgp_race" — exactly 3 bullets about MXGP Sunday races + GP overall (race 1, race 2, GP overall winner, dominant performances, comeback rides). Do NOT repeat qualifying.
3. "mx2_quali" — exactly 2 bullets about MX2 Saturday QUALIFYING ONLY. Same rules as mxgp_quali.
4. "mx2_race"  — exactly 3 bullets about MX2 Sunday races + GP overall. Same rules as mxgp_race.
5. "standings" — exactly 3 bullets focused on championship standings — top 3 leaders AND any position changes vs previous round (use "nousi", "putosi", "siirtyi", "moved up", "dropped to", "held firm" as appropriate). If no order change, say the order held firm.

GLOBAL RULES:
- Each bullet: 1 short sentence, max 15 words.
- Use exciting motorsport language (hallitsi, dominoi, taisteli, nousi / dominated, charged, battled, surged, claimed pole).
- Only state facts from the data — do NOT invent crashes, injuries, weather, or events not in the data.
- If qualifying data is empty for a class, return an empty array for that class's "_quali" bucket.
- Output ONLY valid JSON, no markdown, no backticks, no preamble.

RACE DATA:
{data_summary}

OUTPUT FORMAT (JSON only, exact shape):
{{"fi":{{"mxgp_quali":["b1","b2"],"mxgp_race":["b1","b2","b3"],"mx2_quali":["b1","b2"],"mx2_race":["b1","b2","b3"],"standings":["b1","b2","b3"]}},"en":{{"mxgp_quali":["b1","b2"],"mxgp_race":["b1","b2","b3"],"mx2_quali":["b1","b2"],"mx2_race":["b1","b2","b3"],"standings":["b1","b2","b3"]}}}}"""

    # Try each model with retries
    for model in GEMINI_MODELS:
        for attempt in range(3):
            try:
                log(f"  Trying {model} (attempt {attempt + 1}/3)...")
                url = GEMINI_URL.format(model=model, key=api_key)
                resp = requests.post(url, json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.4}
                }, timeout=30)

                if resp.status_code == 503:
                    wait = 5 * (attempt + 1)
                    log(f"  {model} unavailable (503), waiting {wait}s...")
                    time.sleep(wait)
                    continue

                if not resp.ok:
                    log(f"  {model} error: {resp.status_code} - {resp.text[:200]}")
                    break

                data = resp.json()
                answer = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")

                answer = answer.strip()
                json_match = re.search(r'\{.*\}', answer, re.DOTALL)
                if not json_match:
                    log(f"  No JSON found in response: {answer[:200]}")
                    return empty

                json_str = json_match.group()
                highlights = json.loads(json_str)

                # Validate new structured shape; coerce missing keys
                buckets = ("mxgp_quali", "mxgp_race", "mx2_quali", "mx2_race", "standings")
                for lang in ("fi", "en"):
                    if not isinstance(highlights.get(lang), dict):
                        highlights[lang] = {}
                    for b in buckets:
                        v = highlights[lang].get(b)
                        if not isinstance(v, list):
                            highlights[lang][b] = []

                def fmt(lang):
                    return " ".join(f"{b}={len(highlights[lang][b])}" for b in buckets)
                fi_total = sum(len(highlights["fi"][b]) for b in buckets)
                en_total = sum(len(highlights["en"][b]) for b in buckets)
                log(f"  Highlights generated ({model}): "
                    f"FI {fmt('fi')} (total {fi_total}), "
                    f"EN {fmt('en')} (total {en_total})")

                return highlights

            except Exception as e:
                log(f"  {model} attempt {attempt + 1} failed: {e}")
                continue

        log(f"  {model} failed all attempts, trying next model...")

    log("  All models failed to generate highlights")
    return empty


def build_json():
    """Main function: find latest round, scrape, generate highlights, output JSON."""

    log(f"Finding latest completed race for {SEASON}...")
    latest = find_latest_race()

    if not latest:
        log("No completed rounds found.")
        data = {
            "season": SEASON,
            "lastUpdated": date.today().isoformat(),
            "seasonComplete": False,
            "totalRounds": 19,
            "latestRace": None,
            "highlights": {
                "fi": {"mxgp_quali": [], "mxgp_race": [], "mx2_quali": [], "mx2_race": [], "standings": []},
                "en": {"mxgp_quali": [], "mxgp_race": [], "mx2_quali": [], "mx2_race": [], "standings": []},
            },
            "standings": {"mxgp": [], "mx2": []}
        }
        write_json(data)
        return

    slug = latest["slug"]
    total_rounds = latest["totalRounds"]
    is_season_complete = latest["round"] == total_rounds

    log(f"Scraping race results for {slug}...")
    mxgp_results = scrape_race_results("mxgp", slug)
    mx2_results = scrape_race_results("mx2", slug)

    log(f"Scraping standings...")
    mxgp_standings = scrape_standings("mxgp")
    mx2_standings = scrape_standings("mx2")

    standings = {"mxgp": mxgp_standings, "mx2": mx2_standings}

    # Capture previous top 3 BEFORE we overwrite the JSON, so we can detect order changes
    previous_standings = read_previous_standings()
    log(f"  Previous top 3 captured: MXGP={len(previous_standings['mxgp'])} riders, MX2={len(previous_standings['mx2'])} riders")

    log("Generating highlights...")
    highlights = generate_highlights(latest, mxgp_results, mx2_results, standings, previous_standings)

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
        log("Season complete! This was the final round.")

    log("Done!")


def write_json(data):
    """Write the results JSON file."""
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    log(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    build_json()