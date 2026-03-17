"""Unit tests for environment and credential helpers."""

from config.environment import CredentialManager, EnvironmentDetector


def test_environment_detector_identifies_github_actions(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    assert EnvironmentDetector.is_github_actions() is True
    assert EnvironmentDetector.is_local_development() is False
    assert EnvironmentDetector.get_execution_mode() == "github_actions"


def test_environment_detector_identifies_local_mode(monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)

    assert EnvironmentDetector.is_github_actions() is False
    assert EnvironmentDetector.is_local_development() is True
    assert EnvironmentDetector.get_execution_mode() == "local_development"


def test_google_credentials_are_loaded_from_github_actions_secret(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv(
        "GOOGLE_SERVICE_ACCOUNT_KEY",
        '{"client_email":"ci@example.com","private_key":"secret"}',
    )

    config = CredentialManager.get_google_credentials({})

    assert config["google_service_account"]["client_email"] == "ci@example.com"


def test_google_credentials_keep_local_payload_when_not_running_in_ci(monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    base = {"google_service_account": {"client_email": "local@example.com"}}

    config = CredentialManager.get_google_credentials(base)

    assert config["google_service_account"]["client_email"] == "local@example.com"


def test_umbler_credentials_are_merged_from_ci_secrets(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("UMBLER_TOKEN", "token")
    monkeypatch.setenv("UMBLER_ORGANIZATION_ID", "org")
    monkeypatch.setenv("UMBLER_CHANNEL_ID", "channel")
    monkeypatch.setenv("UMBLER_CHAT_ID", "chat")

    config = CredentialManager.get_umbler_credentials({})

    assert config["umbler_config"] == {
        "token": "token",
        "organization_id": "org",
        "channel_id": "channel",
        "chat_id": "chat",
    }


def test_umbler_credentials_keep_existing_local_values(monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    base = {"umbler_config": {"token": "local-token"}}

    config = CredentialManager.get_umbler_credentials(base)

    assert config["umbler_config"]["token"] == "local-token"
