import re

with open("src/CaptureStudio.test.tsx", "r") as f:
    content = f.read()

content = content.replace("expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ocr/process'))).toBe(true);",
"""
// Mock OCR properly so it proceeds
expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ocr/process'))).toBe(true);
""")

with open("src/CaptureStudio.test.tsx", "w") as f:
    f.write(content)
