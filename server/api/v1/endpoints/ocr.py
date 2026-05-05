from fastapi import APIRouter, Depends, HTTPException
from server.models import RegionRequest
from server.services.ocr_service import ocr_service

router = APIRouter(tags=["OCR"])

@router.post("/process")
async def process_ocr(request: RegionRequest):
    """
    Process OCR on a specific screen region or provided image.
    """
    result = ocr_service.process_ocr(request)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@router.get("/zones")
async def get_zones():
    """
    Get history of processed zones.
    """
    return ocr_service.last_full_text_by_zone
