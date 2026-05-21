import logging
import easyocr
import numpy as np

logger = logging.getLogger("odessa.ocr.engine")

class OCREngine:
    def __init__(self, languages=["en", "pt"], gpu=False):
        logger.info(f"Initializing EasyOCR with languages: {languages}")
        self.reader = easyocr.Reader(languages, gpu=gpu)
        
    def extract_text(self, image_array: np.ndarray) -> str:
        results = self.reader.readtext(image_array)
        return " ".join(result[1] for result in results).strip()

    def extract_full_data(self, image_array: np.ndarray):
        return self.reader.readtext(image_array)
