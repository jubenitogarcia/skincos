"""Unit tests for configuration constants."""

from config.constants import ConfigConstants, SystemConstants


def test_system_constants_populates_default_allowed_file_types():
    constants = SystemConstants()

    assert constants.ALLOWED_FILE_TYPES == [
        "image/png",
        "image/jpeg",
        "image/jpg",
    ]


def test_config_constants_is_singleton():
    first = ConfigConstants.get_instance()
    second = ConfigConstants.get_instance()

    assert first is second


def test_config_constants_reads_fallback_scopes(monkeypatch):
    monkeypatch.setattr(ConfigConstants, "load_config", classmethod(lambda cls: {}))

    scopes = ConfigConstants.get_instance().SCOPES

    assert scopes == [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]


def test_config_constants_builds_cell_references_from_global_and_unit_values(monkeypatch):
    payload = {
        "global": {"common_cells": {"goal": "A1"}},
        "units": {
            "bss": {"specific_cells": {"sales": "B2"}},
            "nh": {"specific_cells": {"sales": "C3"}},
        },
    }
    monkeypatch.setattr(ConfigConstants, "load_config", classmethod(lambda cls: payload))

    refs = ConfigConstants.get_instance().CELL_REFERENCES

    assert refs == {
        "bss": {"goal": "A1", "sales": "B2"},
        "nh": {"goal": "A1", "sales": "C3"},
    }


def test_config_constants_uses_default_motivational_phrases(monkeypatch):
    monkeypatch.setattr(ConfigConstants, "load_config", classmethod(lambda cls: {}))

    phrases = ConfigConstants.get_instance().MOTIVATIONAL_PHRASES

    assert phrases["morning"]["primeira_meta"] == ["Excelente início! Vamos manter o ritmo!"]
    assert phrases["evening"]["meta_super"] == ["DIA PERFEITO! SUPER META ALCANÇADA!"]
