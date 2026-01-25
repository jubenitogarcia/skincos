"""
Unit tests for configuration management.
"""

import pytest
import json
from pathlib import Path
from unittest.mock import patch, mock_open
from config.manager import ConfigManager


@pytest.mark.unit
class TestConfigManager:
    """Test the ConfigManager singleton class."""

    def _write_config(self, tmp_path: Path, payload) -> str:
        path = tmp_path / "config.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        ConfigManager.CONFIG_FILE = str(path)
        return str(path)

    def test_singleton_pattern(self, tmp_path, mock_config):
        """Test that ConfigManager follows singleton pattern."""
        self._write_config(tmp_path, mock_config)
        instance1 = ConfigManager.get_instance()
        instance2 = ConfigManager.get_instance()
        assert instance1 is instance2

    def test_config_validation_success(self, tmp_path, mock_config):
        """Test successful configuration validation."""
        self._write_config(tmp_path, mock_config)
        config_manager = ConfigManager.get_instance()
        assert config_manager is not None

    def test_config_validation_missing_required_field(self, tmp_path):
        """Test configuration validation with missing required field."""
        invalid_config = {
            "google_service_account": {},
            "whatsapp_config": {},
            "units": {},
        }
        # Missing spreadsheet_id
        self._write_config(tmp_path, invalid_config)
        with pytest.raises(ValueError):
            ConfigManager.get_instance()

    def test_config_validation_invalid_type(self, tmp_path):
        """Test configuration validation with invalid field type."""
        invalid_config = {
            "spreadsheet_id": 123,  # Should be string
            "google_service_account": {},
            "whatsapp_config": {},
            "units": {},
        }
        self._write_config(tmp_path, invalid_config)
        with pytest.raises(ValueError):
            ConfigManager.get_instance()

    def test_whatsapp_config_validation(self, tmp_path, mock_config):
        """Test WhatsApp configuration validation."""
        # Remove required WhatsApp fields
        mock_config["whatsapp_config"] = {}
        self._write_config(tmp_path, mock_config)
        with pytest.raises(ValueError):
            ConfigManager.get_instance()

    def test_config_file_not_found(self):
        """Test behavior when config file doesn't exist."""
        ConfigManager.CONFIG_FILE = "/tmp/does-not-exist-skincos-config.json"
        with pytest.raises(FileNotFoundError):
            ConfigManager.get_instance()

    def test_config_reload(self, tmp_path, mock_config):
        """Test configuration reloading."""
        self._write_config(tmp_path, mock_config)
        config_manager1 = ConfigManager.get_instance()
        reloaded_manager = ConfigManager.reload_config()
        assert reloaded_manager is not None
        assert reloaded_manager is not config_manager1
        config_manager2 = ConfigManager.get_instance()
        assert reloaded_manager is config_manager2

    def test_get_config(self, tmp_path, mock_config):
        """Test reading config values via get_config()."""
        self._write_config(tmp_path, mock_config)
        cfg = ConfigManager.get_config()
        assert cfg["spreadsheet_id"] == mock_config["spreadsheet_id"]

    @patch('json.load')
    def test_invalid_json_format(self, mock_json_load):
        """Test handling of invalid JSON format."""
        mock_json_load.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)

        with patch('builtins.open', mock_open(read_data='invalid json')):
            with pytest.raises(json.JSONDecodeError):
                ConfigManager.get_instance()
