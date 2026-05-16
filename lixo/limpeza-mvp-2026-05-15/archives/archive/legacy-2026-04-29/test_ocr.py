import easyocr
import pyautogui
import numpy as np

# Initialize the OCR reader
reader = easyocr.Reader(['en'], gpu=False)

# Test function to capture and OCR a single region
def test_ocr_region(x, y, width, height):
    try:
        screenshot = pyautogui.screenshot(region=(x, y, width, height))
        # Convert PIL Image to numpy array
        img_array = np.array(screenshot)
        results = reader.readtext(img_array)
        text = ' '.join([result[1] for result in results])
        print(f"Extracted Text: {text.strip()}")
        return text.strip()
    except Exception as e:
        print(f"Error: {e}")
        return ""

# Example usage
if __name__ == "__main__":
    # Replace with your coordinates
    x, y, width, height = 100, 100, 400, 200  # Example region
    print("Testing OCR on region:", (x, y, width, height))
    test_ocr_region(x, y, width, height)