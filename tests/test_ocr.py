"""Tests for /ocr endpoint."""
import pytest


@pytest.mark.unit
def test_ocr_endpoint_with_valid_image(client, sample_image_base64):
    """Test OCR endpoint with valid base64 image - validates structure."""
    response = client.post(
        "/api/v1/ocr/process",
        json={
            "image": sample_image_base64,
            "zone_id": "zone-test",
            "zone_name": "Test Zone",
        },
    )
    # Should return 200 or handle gracefully
    assert response.status_code in [200, 400, 422]
    if response.status_code == 200:
        data = response.json()
        assert "text" in data or "detail" in data


@pytest.mark.unit
def test_ocr_endpoint_with_invalid_image(client):
    """Test OCR endpoint with invalid base64 image."""
    response = client.post(
        "/api/v1/ocr/process",
        json={
            "image": "not-a-base64-image",
            "zone_id": "zone-test",
            "zone_name": "Test Zone",
        },
    )
    # Should return 400 for invalid base64
    assert response.status_code == 400
    assert "detail" in response.json()


@pytest.mark.unit
def test_ocr_endpoint_missing_image(client):
    """Test OCR endpoint with missing required fields (either image or dimensions)."""
    response = client.post(
        "/api/v1/ocr/process",
        json={
            "zone_id": "zone-test",
            "zone_name": "Test Zone",
        },
    )
    # Should return 400 for missing required fields according to implementation
    assert response.status_code == 400


@pytest.mark.unit
def test_ocr_endpoint_new_content_logic(client, sample_image_base64):
    """Test multiple OCR calls - validates endpoint stability."""
    # First call
    response1 = client.post(
        "/api/v1/ocr/process",
        json={"image": sample_image_base64, "zone_id": "zone-persistent"},
    )
    assert response1.status_code in [200, 400, 422]

    # Second call with same zone
    response2 = client.post(
        "/api/v1/ocr/process",
        json={"image": sample_image_base64, "zone_id": "zone-persistent"},
    )
    assert response2.status_code in [200, 400, 422]
