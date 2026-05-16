import httpx
import re

r = httpx.get(
    "https://www.tango.me/broadcast",
    headers={
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    },
    follow_redirects=True,
    timeout=15,
)
html = r.text
print(f"STATUS: {r.status_code}")
print(f"FINAL URL: {r.url}")
print(f"HTML length: {len(html)}")
print()

# Show all link/script tags with src/href
tags = re.findall(r'<(?:link|script)[^>]+(?:href|src)=["\']([^"\']+)["\']', html[:8000])
for t in tags[:25]:
    print(f"ASSET: {t}")

print("\n--- CHECKING PATTERNS ---")
# Check for patterns that need rewriting
patterns_found = set()
for m in re.finditer(r'(?:href|src|action)=["\'](/[^"\']+)["\']', html[:10000]):
    path = m.group(1)
    if path.startswith("//"):
        continue
    patterns_found.add(path[:60])

for p in sorted(patterns_found)[:20]:
    print(f"REL PATH: {p}")

print("\n--- BASE TAG ---")
base_tags = re.findall(r'<base[^>]+>', html[:3000])
print(base_tags if base_tags else "No base tag found")

print("\n--- META TAGS ---")
metas = re.findall(r'<meta[^>]+>', html[:3000])
for m in metas[:10]:
    print(f"META: {m}")
