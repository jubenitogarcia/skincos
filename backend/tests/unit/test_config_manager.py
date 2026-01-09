"""
Unit tests for configuration management.
"""

import pytest
import json
import tempfile
import os
from unittest.mock import patch, mock_open
from config.manager import ConfigManager


@pytest.mark.unit
class TestConfigManager:
    """Test the ConfigManager singleton class."""

    def test_singleton_pattern(self):
        """Test that ConfigManager follows singleton pattern."""
        instance1 = ConfigManager.get_instance()
        instance2 = ConfigManager.get_instance()
        assert instance1 is instance2

    def test_config_validation_success(self, mock_config):
        """Test successful configuration validation."""
        with patch('builtins.open', mock_open(read_data=json.dumps(mock_config))):
            with patch('os.path.exists', return_value=True):
                config_manager = ConfigManager.get_instance()
                # Should not raise any exceptions
                assert config_manager is not None

    def test_config_validation_missing_required_field(self):
        """Test configuration validation with missing required field."""
        invalid_config = {
            "google_service_account": {},
            "whatsapp_config": {},
            "units": {},
        }
        # Missing spreadsheet_id
        
        with patch('builtins.open', mock_open(read_data=json.dumps(invalid_config))):
            with patch('os.path.exists', return_value=True):
                with pytest.raises(SystemExit):
                    ConfigManager.get_instance()

    def test_config_validation_invalid_type(self):
        """Test configuration validation with invalid field type."""
        invalid_config = {
            "spreadsheet_id": 123,  # Should be string
            "google_service_account": {},
            "whatsapp_config": {},
            "units": {},
        }
        
        with patch('builtins.open', mock_open(read_data=json.dumps(invalid_config))):
            with patch('os.path.exists', return_value=True):
                with pytest.raises(SystemExit):
                    ConfigManager.get_instance()

    def test_whatsapp_config_validation(self, mock_config):
        """Test WhatsApp configuration validation."""
        # Remove required WhatsApp fields
        mock_config["whatsapp_config"] = {}
        
        with patch('builtins.open', mock_open(read_data=json.dumps(mock_config))):
            with patch('os.path.exists', return_value=True):
                with pytest.raises(SystemExit):
                    ConfigManager.get_instance()

    def test_config_file_not_found(self):
        """Test behavior when config file doesn't exist."""
        with patch('os.path.exists', return_value=False):
            with pytest.raises(SystemExit):
                ConfigManager.get_instance()

    def test_config_reload(self, mock_config):
        """Test configuration reloading."""
        with patch('builtins.open', mock_open(read_data=json.dumps(mock_config))):
            with patch('os.path.exists', return_value=True):
                config_manager1 = ConfigManager.get_instance()
                reloaded_manager = ConfigManager.reload_config()
                # Should be a fresh instance
                assert reloaded_manager is not None
                # But singleton should still work
                config_manager2 = ConfigManager.get_instance()
                assert reloaded_manager is config_manager2

    def test_get_config_value(self, mock_config):
        """Test getting configuration values."""
        with patch('builtins.open', mock_open(read_data=json.dumps(mock_config))):
            with patch('os.path.exists', return_value=True):
                config_manager = ConfigManager.get_instance()
                spreadsheet_id = config_manager.get_config_value('spreadsheet_id')
                assert spreadsheet_id == mock_config['spreadsheet_id']

    def test_get_config_value_with_default(self, mock_config):
        """Test getting configuration values with default."""
        with patch('builtins.open', mock_open(read_data=json.dumps(mock_config))):
            with patch('os.path.exists', return_value=True):
                config_manager = ConfigManager.get_instance()
                
                # Existing value
                spreadsheet_id = config_manager.get_config_value('spreadsheet_id', 'default')
                assert spreadsheet_id == mock_config['spreadsheet_id']
                
                # Non-existing value with default
                non_existing = config_manager.get_config_value('non_existing_key', 'default_value')
                assert non_existing == 'default_value'

    @patch('json.load')
    def test_invalid_json_format(self, mock_json_load):
        """Test handling of invalid JSON format."""
        mock_json_load.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)
        
        with patch('os.path.exists', return_value=True):
            with patch('builtins.open', mock_open(read_data='invalid json')):
                with pytest.raises(SystemExit):
                    ConfigManager.get_instance()