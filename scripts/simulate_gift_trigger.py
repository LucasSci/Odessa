#!/usr/bin/env python3
"""
Simple script to simulate a gift trigger against the API.
Usage:
  python scripts/simulate_gift_trigger.py [GIFT_NAME] [BASE_URL]
Defaults:
  GIFT_NAME = "Rosa"
  BASE_URL = "http://localhost:8000"

This hits: /api/video/next?trigger=gift&giftName=... and prints the response.
"""

import sys
import urllib.parse
import urllib.request
import json


def call_next(base_url, gift_name):
    params = {"trigger": "gift", "giftName": gift_name}
    url = f"{base_url.rstrip('/')}/api/video/next?{urllib.parse.urlencode(params)}"
    print("Requesting:", url)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            body = res.read().decode()
            data = json.loads(body)
            print("Response:")
            print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        print("Error calling API:", e)


if __name__ == '__main__':
    gift = sys.argv[1] if len(sys.argv) > 1 else 'Rosa'
    base = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8000'
    call_next(base, gift)
