import pytest
from core.database import SettingsManager
import os
import json
import tempfile
import shutil

class TestSettingsManager:
    @pytest.fixture
    def settings_env(self):
        # Create a temporary directory for tests
        test_dir = tempfile.mkdtemp()
        manager = SettingsManager(test_dir)
        yield manager
        # Clean up
        shutil.rmtree(test_dir)

    def test_default_config_loading(self, settings_env):
        assert settings_env.get("api_timeout") == 10
        assert settings_env.get("retry_wait") == 5
        assert settings_env.get("anti_ban_pause") == 3.0
        assert settings_env.get("download_retries") == 3

    def test_update_config(self, settings_env):
        settings_env.update({"api_timeout": 20})
        assert settings_env.get("api_timeout") == 20
        # Check it didn't update something else
        assert settings_env.get("retry_wait") == 5

    def test_save_and_load_api_settings(self, settings_env):
        api_data = {
            "rule34_api_key": "test_r34_key",
            "gelbooru_api_key": "test_gel_key",
            "pixiv_refresh_token": "test_pixiv_token"
        }
        
        # Save settings
        settings_env.save_api_settings(api_data)
        
        # Load settings and verify
        loaded = settings_env.load_api_settings()
        assert loaded.get("rule34_api_key") == "test_r34_key"
        assert loaded.get("gelbooru_api_key") == "test_gel_key"
        assert loaded.get("pixiv_refresh_token") == "test_pixiv_token"
