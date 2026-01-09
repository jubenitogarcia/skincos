"""
Test configuration and fixtures for SKINCOS backend test suite.
"""

import pytest
import os
import sys
from unittest.mock import Mock

# Add project root to Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)


@pytest.fixture
def mock_config():
    """Mock configuration for testing."""
    return {
        "spreadsheet_id": "test_spreadsheet_id",
        "google_service_account": {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "test-key-id",
            "private_key": "-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        },
        "whatsapp_config": {
            "api_url": "https://test-api.example.com",
            "api_key": "test-api-key",
        },
        "units": {
            "bss": {
                "name": "BarraShoppingSul",
                "cells": {"morning": "A1:B10", "evening": "C1:D10"},
                "phone": "+5551999999999",
            },
            "nh": {
                "name": "Novo Hamburgo", 
                "cells": {"morning": "E1:F10", "evening": "G1:H10"},
                "phone": "+5551888888888",
            },
        },
    }


@pytest.fixture
def mock_google_auth():
    """Mock Google authentication."""
    mock_credentials = Mock()
    mock_credentials.valid = True
    return mock_credentials


@pytest.fixture
def mock_whatsapp_response():
    """Mock WhatsApp API response."""
    return {
        "success": True,
        "message_id": "test_message_123",
        "status": "sent",
    }


@pytest.fixture
def mock_sheets_data():
    """Mock Google Sheets data."""
    return {
        "values": [
            ["Product", "Sales"],
            ["Product A", "100"],
            ["Product B", "200"],
            ["Product C", "150"],
        ]
    }


@pytest.fixture
def sample_image_path(tmp_path):
    """Create a sample image file for testing."""
    # Create a simple test image
    from PIL import Image
    
    image = Image.new('RGB', (100, 100), color='red')
    image_path = tmp_path / "test_image.png"
    image.save(str(image_path))
    return str(image_path)


@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset singleton instances between tests."""
    # Reset ConfigManager singleton
    from config.manager import ConfigManager
    ConfigManager._instance = None
    ConfigManager._config = None
    
    # Reset other singletons if they exist
    from config.constants import ConfigConstants
    ConfigConstants._instance = None
    ConfigConstants._config = None
    
    yield
    
    # Cleanup after test
    ConfigManager._instance = None
    ConfigManager._config = None
    ConfigConstants._instance = None
    ConfigConstants._config = None


@pytest.fixture
def mock_environment_variables(monkeypatch):
    """Mock environment variables for testing."""
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "test_credentials.json")
    monkeypatch.setenv("UMBLER_CREDENTIALS", "test_umbler_token")
    monkeypatch.setenv("TZ", "America/Sao_Paulo")


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )


def pytest_collection_modifyitems(config, items):
    """Automatically mark tests based on their location."""
    for item in items:
        # Mark tests in unit/ directory as unit tests
        if "unit" in str(item.fspath):
            item.add_marker(pytest.mark.unit)
        # Mark tests in integration/ directory as integration tests
        elif "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
        # Mark slow tests
        if "slow" in item.name.lower():
            item.add_marker(pytest.mark.slow)
