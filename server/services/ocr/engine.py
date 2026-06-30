import logging
import numpy as np

logger = logging.getLogger("odessa.ocr.engine")

try:
    import easyocr
except ImportError:
    easyocr = None

class OCREngine:
    def __init__(self, languages=["en", "pt"], gpu=False):
        self.reader = None
        if easyocr is None:
            logger.warning("EasyOCR is not installed; backend OCR /process will return a clear error.")
            return
        logger.info(f"Initializing EasyOCR with languages: {languages}")
        self.reader = easyocr.Reader(languages, gpu=gpu)
        
    def extract_text(self, image_array: np.ndarray) -> str:
        if self.reader is None:
            raise RuntimeError("EasyOCR is not installed in this local environment")
        results = self.reader.readtext(image_array)
        return " ".join(result[1] for result in results).strip()

    def extract_full_data(self, image_array: np.ndarray):
        if self.reader is None:
            raise RuntimeError("EasyOCR is not installed in this local environment")
        return self.reader.readtext(image_array)
