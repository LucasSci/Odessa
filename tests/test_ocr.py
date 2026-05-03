"""Tests for /ocr endpoint."""
import pytest
from unittest.mock import patch


@pytest.mark.unit
@patch("server.main.reader.readtext")
def test_ocr_endpoint_with_valid_image(mock_readtext, client, sample_image_base64):
    """Test OCR endpoint with valid base64 image."""
    # Setup mock
    mock_readtext.return_value = [([0, 0, 10, 10], "Detected Text", 0.95)]

    response = client.post(
        "/ocr",
        json={
            "image": sample_image_base64,
            "zone_id": "zone-test",
            "zone_name": "Test Zone",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "Detected Text"
    assert data["full_text"] == "Detected Text"
    assert data["zone_id"] == "zone-test"
    assert data["zone_name"] == "Test Zone"
    assert data["confidence"] == 0.95
    assert "latency_ms" in data


@pytest.mark.unit
def test_ocr_endpoint_with_invalid_image(client):
    """Test OCR endpoint with invalid base64 image."""
    response = client.post(
        "/ocr",
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
        "/ocr",
        json={
            "zone_id": "zone-test",
            "zone_name": "Test Zone",
        },
    )
    # Should return 400 for missing required fields according to implementation
    assert response.status_code == 400


@pytest.mark.unit
@patch("server.main.reader.readtext")
def test_ocr_endpoint_new_content_logic(mock_readtext, client, sample_image_base64):
    """Test the logic that filters out previously seen text."""
    # First call: set previous text (needs to be long enough for the overlap logic)
    long_text = "This is a very long text that should be recognized by OCR"
    mock_readtext.return_value = [([0, 0, 10, 10], long_text, 0.9)]
    client.post(
        "/ocr",
        json={"image": sample_image_base64, "zone_id": "zone-persistent"},
    )

    # Second call: partial new text
    # The overlap logic looks for a suffix of at least 10 chars
    new_text = long_text + " and here is something new"
    mock_readtext.return_value = [([0, 0, 10, 10], new_text, 0.9)]
    response = client.post(
        "/ocr",
        json={"image": sample_image_base64, "zone_id": "zone-persistent"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "and here is something new"
