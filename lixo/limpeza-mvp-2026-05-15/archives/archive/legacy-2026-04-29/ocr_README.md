# OCR Capture Script for Tango Live

This script captures screenshots of specific screen regions (chat and gifts areas) and performs OCR to extract text, printing it to the console in real-time.

## Prerequisites

- Python 3.x installed
- Tesseract OCR installed (see installation steps below)
- OBS Studio (for capturing the Tango window)

## Install Tesseract OCR

Since automated installation may fail, please install manually:

1. Download the Tesseract installer from: https://github.com/UB-Mannheim/tesseract/wiki
   - Download the latest `tesseract-ocr-w64-setup-*.exe` file
2. Run the installer and follow the setup wizard
3. Note the installation directory (usually `C:\Program Files\Tesseract-OCR`)
4. If Tesseract is not added to PATH, update the `tesseract_cmd` path in `ocr_capture.py`:
   ```python
   pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
   ```

## Setup

1. Install Python dependencies:

   ```
   pip install -r requirements.txt
   ```

2. Set up OBS Studio:
   - Open OBS Studio
   - Add a "Window Capture" source for the Tango browser window
   - Position the OBS preview window so that the chat and gifts areas are visible
   - Note the screen coordinates of these areas

3. Adjust coordinates in `ocr_capture.py`:
   - Update `CHAT_REGION` and `GIFTS_REGION` with the actual (x, y, width, height) of the chat and gifts areas on your screen

## Usage

Run the script:

```
python ocr_capture.py
```

The script will:

- Continuously capture screenshots of the defined regions every 2 seconds
- Perform OCR on the images
- Print the extracted text to the console

Press Ctrl+C to stop the script.

## Notes

- Ensure the Tango live window (via OBS) is positioned correctly and visible
- The OCR accuracy depends on image quality and text size
- Adjust the sleep interval in the script if needed for performance
- For better accuracy, ensure good lighting and high contrast in the captured areas

## Troubleshooting

- If Tesseract is not found, verify the installation and update the path in the script
- If regions are incorrect, use a tool like PyAutoGUI's `pyautogui.position()` to find mouse coordinates
- For permission issues on Windows, run the script as administrator
