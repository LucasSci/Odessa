import pytest
from unittest.mock import MagicMock, patch
from server.main import generate_ai_text_with_fallback

@pytest.mark.unit
@patch("server.main.gemini_client")
def test_generate_ai_text_gemini_success(mock_gemini):
    """Test Gemini success."""
    mock_response = MagicMock()
    mock_response.text = "Gemini Text"
    mock_gemini.models.generate_content.return_value = mock_response
    
    text, provider = generate_ai_text_with_fallback(
        gemini_model="gemini-test",
        system_prompt="sys",
        user_prompt="user",
        temperature=0.7
    )
    assert text == "Gemini Text"
    assert provider == "gemini"

@pytest.mark.unit
@patch("server.main.gemini_client")
@patch("server.main.openai_client")
def test_generate_ai_text_fallback_to_openai(mock_openai, mock_gemini):
    """Test fallback to OpenAI when Gemini fails."""
    # Mock Gemini to fail on call
    mock_gemini.models.generate_content.side_effect = Exception("Gemini Failed")
    
    # Mock OpenAI success via generate_openai_text
    with patch("server.main.generate_openai_text", return_value="OpenAI Text"):
        text, provider = generate_ai_text_with_fallback(
            gemini_model="gemini-test",
            system_prompt="sys",
            user_prompt="user",
            temperature=0.7
        )
        assert text == "OpenAI Text"
        assert provider == "openai"

from fastapi import HTTPException

@pytest.mark.unit
@patch("server.main.gemini_client")
@patch("server.main.openai_client")
def test_generate_ai_text_all_failed(mock_openai, mock_gemini):
    """Test all failed."""
    mock_gemini.models.generate_content.side_effect = Exception("Gemini Failed")
    
    with patch("server.main.generate_openai_text", side_effect=Exception("OpenAI Failed")):
        with pytest.raises(HTTPException):
            generate_ai_text_with_fallback(
                gemini_model="gemini-test",
                system_prompt="sys",
                user_prompt="user",
                temperature=0.7
            )
