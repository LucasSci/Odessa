"""Quick test: simulate proxy rewrite on tango.me/broadcast HTML."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.api.v1.endpoints.proxy import _rewrite_html
import httpx

print("Fetching https://www.tango.me/broadcast ...")
r = httpx.get(
    "https://www.tango.me/broadcast",
    headers={
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    },
    follow_redirects=True,
    timeout=15,
)
print(f"Status: {r.status_code}, length: {len(r.text)}")

html = _rewrite_html(r.text, str(r.url), "http://localhost:8000")

# Check key patterns
import re

# 1. Base tag
base_tags = re.findall(r'<base[^>]+>', html[:3000])
print(f"\nBase tags: {base_tags}")

# 2. Check that /cached-main-*.js is now proxied
cached_scripts = re.findall(r'src=["\']([^"\']*cached-main[^"\']*)["\']', html[:5000])
print(f"\nCached-main scripts (should be proxied):")
for s in cached_scripts[:3]:
    print(f"  {s[:120]}")

# 3. Check link preloads
preloads = re.findall(r'<link[^>]+href=["\']([^"\']*)["\'][^>]*>', html[:5000])
print(f"\nFirst 5 link hrefs (should be proxied):")
for p in preloads[:5]:
    print(f"  {p[:120]}")

# 4. Check no raw /cached- or /fonts/ remain
raw_root_paths = re.findall(r'(?:src|href)=["\'](/(?:cached|fonts|favicons)[^"\']*)["\']', html[:10000])
print(f"\nRemaining UNPROXIED root paths (should be empty): {raw_root_paths[:5]}")

# 5. Write out a snippet for inspection
with open("scratch/tango_proxied_head.html", "w", encoding="utf-8") as f:
    f.write(html[:5000])
print("\nWrote first 5000 chars to scratch/tango_proxied_head.html")
print("DONE")
