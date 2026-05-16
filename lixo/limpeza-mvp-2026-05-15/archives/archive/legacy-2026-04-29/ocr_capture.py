import easyocr
import pyautogui
import numpy as np
import time
import sys
import os
import json

# Initialize the OCR reader (English language)
reader = easyocr.Reader(['en'], gpu=False)  # Set gpu=True if you have CUDA

# Define default regions for chat and gifts (x, y, width, height)
# These are configured from your selected OBS chat area.
CHAT_REGION = (17, 145, 331, 405)
GIFTS_REGION = (600, 200, 200, 300)
REGION_FILE = "regions.json"


def load_regions():
    if os.path.exists(REGION_FILE):
        try:
            with open(REGION_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return (
                tuple(data.get("chat_region", CHAT_REGION)),
                tuple(data.get("gifts_region", GIFTS_REGION)),
            )
        except Exception as e:
            print(f"Warning: cannot load {REGION_FILE}: {e}")
    return CHAT_REGION, GIFTS_REGION

CHAT_REGION, GIFTS_REGION = load_regions()


def capture_and_ocr(region, label):
    try:
        # Take screenshot of the region
        screenshot = pyautogui.screenshot(region=region)
        # Convert PIL Image to numpy array
        img_array = np.array(screenshot)
        # Perform OCR
        results = reader.readtext(img_array)
        # Extract text from results
        text = ' '.join([result[1] for result in results])
        # Print the extracted text
        print(f"{label} Text: {text.strip()}")
    except Exception as e:
        print(f"Error capturing {label}: {e}")

def main():
    print("Starting OCR capture script. Press Ctrl+C to stop.")
    try:
        while True:
            # Capture and OCR chat region
            capture_and_ocr(CHAT_REGION, "Chat")
            # Capture and OCR gifts region
            capture_and_ocr(GIFTS_REGION, "Gifts")
            # Wait before next capture (adjust interval as needed)
            time.sleep(2)  # 2 seconds interval
    except KeyboardInterrupt:
        print("Script stopped by user.")
        sys.exit(0)

if __name__ == "__main__":
    if "--select-region" in sys.argv:
        import select_region
        select_region.main()
    else:
        main()