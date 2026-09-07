import pytest
from core.database import DatabaseManager
import os
import json
import tempfile
import shutil
import unittest.mock as mock

class TestDatabaseManager:
    @pytest.fixture
    def db_env(self):
        # Override the database path to a temp dir for testing
        test_db_dir = tempfile.mkdtemp()
        
        # Patch the paths in DatabaseManager for testing
        with mock.patch("core.database.TAG_HISTORY_FILE", os.path.join(test_db_dir, "tag_history.json")), \
             mock.patch("core.database.FAV_TAGS_FILE", os.path.join(test_db_dir, "fav_tags.json")), \
             mock.patch("core.database.IMAGE_HISTORY_FILE", os.path.join(test_db_dir, "image_history.json")), \
             mock.patch("core.database.UI_CONFIG_FILE", os.path.join(test_db_dir, "ui_config.json")):
            yield test_db_dir
            
        # Clean up
        shutil.rmtree(test_db_dir)

    def test_ui_config_default(self, db_env):
        config = DatabaseManager.load_ui_config()
        
        assert "wallpapers" in config
        assert "Pixiv" in config["wallpapers"]
        assert "Gsbooru" in config["wallpapers"]
        
        assert config["wallpapers"]["Pixiv"]["dark"] == "Rem_Pixiv_d.jpg"
        assert config["wallpapers"]["Gsbooru"]["dark"] == "Rem_Gsbooru_d.jpg"

    def test_tag_history_operations(self, db_env):
        DatabaseManager.add_tag_history("zero", "test_tag")
        
        hist = DatabaseManager.load_tag_history()
        assert len(hist) == 1
        assert hist[0]["site"] == "zero"
        assert hist[0]["tag"] == "test_tag"
        
        DatabaseManager.remove_tag_history("zero", "test_tag")
        hist2 = DatabaseManager.load_tag_history()
        assert len(hist2) == 0

    def test_favorites_operations(self, db_env):
        # Add to favorites
        DatabaseManager.toggle_favorite("safe", "cute")
        favs = DatabaseManager.load_favorites()
        assert len(favs) == 1
        assert favs[0]["site"] == "safe"
        assert favs[0]["tag"] == "cute"
        
        # Remove from favorites (toggle again)
        DatabaseManager.toggle_favorite("safe", "cute")
        favs2 = DatabaseManager.load_favorites()
        assert len(favs2) == 0
