import requests, os, json

key = os.environ.get("GEMINI_API_KEY", "")
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"

resp = requests.post(url, json={
    "contents": [{"parts": [{"text": "Return ONLY this JSON: {\"fi\":[\"testi\"],\"en\":[\"test\"]}"}]}],
    "generationConfig": {"maxOutputTokens": 100, "temperature": 0}
}, timeout=30)

data = resp.json()
raw = data["candidates"][0]["content"]["parts"][0]["text"]
print("RAW RESPONSE:")
print(repr(raw))