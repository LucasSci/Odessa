from fastapi import APIRouter
from server.models import RegionRequest
from server.services.ocr_service import ocr_service

router = APIRouter(prefix="/ocr", tags=["OCR"])

@router.post("")
def perform_ocr(request: RegionRequest):
    return ocr_service.process_ocr(request)
