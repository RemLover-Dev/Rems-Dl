import os
import json
import sys


def _app_base_dir():
    # Frozen (PyInstaller) builds: keep all user data next to the exe,
    # not inside the read-only _MEIPASS bundle.
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATABASE_DIR = os.path.join(_app_base_dir(), "database")

TAG_HISTORY_FILE = os.path.join(DATABASE_DIR, "tag_history.json")
FAV_TAGS_FILE = os.path.join(DATABASE_DIR, "fav_tags.json")
IMAGE_HISTORY_FILE = os.path.join(DATABASE_DIR, "image_history.json")
UI_CONFIG_FILE = os.path.join(DATABASE_DIR, "ui_config.json")


class DatabaseManager:
    """Centralized JSON database manager for tags, history, favorites, and UI config."""

    @staticmethod
    def load_json(filepath):
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    @staticmethod
    def save_json(filepath, data):
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f)

    # --- Tag History ---
    @staticmethod
    def load_tag_history():
        return DatabaseManager.load_json(TAG_HISTORY_FILE)

    @staticmethod
    def save_tag_history(data):
        DatabaseManager.save_json(TAG_HISTORY_FILE, data)

    @staticmethod
    def add_tag_history(site, tag):
        hist = DatabaseManager.load_tag_history()
        entry = {"site": site, "tag": tag}
        if entry not in hist:
            hist.insert(0, entry)
            DatabaseManager.save_tag_history(hist)

    @staticmethod
    def remove_tag_history(site, tag):
        hist = DatabaseManager.load_tag_history()
        hist = [x for x in hist if not (x["site"] == site and x["tag"] == tag)]
        DatabaseManager.save_tag_history(hist)

    @staticmethod
    def clear_tag_history():
        DatabaseManager.save_tag_history([])

    # --- Image History ---
    @staticmethod
    def load_image_history():
        from core.shared import tags_dict_from_lists
        data = DatabaseManager.load_json(IMAGE_HISTORY_FILE)
        changed = False
        for entry in data:
            tags = entry.get("tags")
            if isinstance(tags, list):
                entry["tags"] = tags_dict_from_lists(tags, entry.get("artists", []))
                changed = True
        if changed:
            DatabaseManager.save_image_history(data)
        return data

    @staticmethod
    def save_image_history(data):
        DatabaseManager.save_json(IMAGE_HISTORY_FILE, data)

    @staticmethod
    def add_image_history(worker_name, filename, tags_list, artist_list, filepath=None, characters=None, copyrights=None, metadata_tags=None):
        from core.shared import tags_dict_from_lists
        hist = DatabaseManager.load_image_history()
        tags_dict = tags_dict_from_lists(tags_list, artist_list, characters, copyrights, metadata_tags)
        entry = {
            "site": worker_name,
            "filename": filename,
            "tags": dict(tags_dict),
            "filepath": filepath
        }
        hist.insert(0, entry)
        hist = hist[:100]
        DatabaseManager.save_image_history(hist)

    @staticmethod
    def remove_image_history(filename):
        hist = [x for x in DatabaseManager.load_image_history() if x.get("filename") != filename]
        DatabaseManager.save_image_history(hist)

    @staticmethod
    def clear_image_history():
        DatabaseManager.save_image_history([])

    # --- Favorites ---
    @staticmethod
    def load_favorites():
        return DatabaseManager.load_json(FAV_TAGS_FILE)

    @staticmethod
    def save_favorites(data):
        DatabaseManager.save_json(FAV_TAGS_FILE, data)

    @staticmethod
    def toggle_favorite(site, tag):
        favs = DatabaseManager.load_favorites()
        entry = {"site": site, "tag": tag}
        if entry in favs:
            favs.remove(entry)
        else:
            favs.append(entry)
        DatabaseManager.save_favorites(favs)
        return favs

    # --- UI Config ---
    @staticmethod
    def load_ui_config():
        config = DatabaseManager.load_json(UI_CONFIG_FILE)
        if not config or not isinstance(config, dict):
            config = DatabaseManager._default_ui_config()
            DatabaseManager.save_ui_config(config)
            return config
        # Migrate older configs: ensure new keys exist without wiping user data.
        defaults = DatabaseManager._default_ui_config()
        changed = False
        for key, val in defaults.items():
            if key not in config:
                config[key] = val
                changed = True
        if changed:
            try:
                DatabaseManager.save_ui_config(config)
            except Exception:
                pass
        return config

    @staticmethod
    def save_ui_config(data):
        DatabaseManager.save_json(UI_CONFIG_FILE, data)

    @staticmethod
    def _default_ui_config():
        return {
            "theme_mode": "dark",
            "mute_auth_warnings": False,
            "wallpapers": {
                "Main": {"dark": "Rem_main_d.png", "light": "Rem_main_l.png"},
                "Neko": {"dark": "Rem_neko_d.png", "light": "Rem_neko_l.png"},
                "NekosLife": {"dark": "Rem_nekolife_d.png", "light": "Rem_nekolife_l.png"},
                "Zero": {"dark": "Rem_zero_d.png", "light": "Rem_zero_l.png"},
                "Waifu": {"dark": "Rem_waifu_d.png", "light": "Rem_waifu_l.png"},
                "Safe": {"dark": "Rem_safe_d.png", "light": "Rem_safe_l.png"},
                "Gelbooru": {"dark": "Rem_gelbooru_d.png", "light": "Rem_gelbooru_l.png"},
                "Gsbooru": {"dark": "Rem_Gsbooru_d.jpg", "light": "Rem_Gsbooru_l.jpg"},
                "Rule34": {"dark": "Rem_rule34_d.png", "light": "Rem_rule34_l.png"},
                "Yande": {"dark": "Rem_yande_d.png", "light": "Rem_yande_l.png"},
                "Kona": {"dark": "Rem_Kona_d.jpg", "light": "Rem_Kona_l.jpg"},
                "Danbooru": {"dark": "Rem_danbooru_d.jpg", "light": "Rem_danbooru_l.jpg"},
                "Sankaku": {"dark": "Rem_Sankaku_d.jpg", "light": "Rem_Sankaku_l.jpg"},
                "AnimeDL": {"dark": "Rem_AnimeDl_d.jpg", "light": "Rem_AnimeDl_l.jpg"},
                "Pinterest": {"dark": "Rem_pintrest_d.jpg", "light": "Rem_pintrest_l.jpg"},
                "Pixiv": {"dark": "Rem_Pixiv_d.jpg", "light": "Rem_Pixiv_l.jpg"},
                "EShuushuu": {"dark": "Rem_EShuushuu_d.jpg", "light": "Rem_EShuushuu_l.jpg"},
                "NekosAPI": {"dark": "Rem_NekosAPI_d.jpg", "light": "Rem_NekosAPI_l.jpg"},
                "Nekosia": {"dark": "Rem_Nekosia_d.jpg", "light": "Rem_Nekosia_l.jpg"},
                "Gallery": {"dark": "Rem_Gallery_d.jpg", "light": "Rem_Gallery_l.jpg"},
                "History": {"dark": "Rem_history_d.png", "light": "Rem_history_l.png"},
                "Options": {"dark": "Rem_option_d.png", "light": "Rem_option_l.png"},
                "Customize": {"dark": "Rem_custom_d.png", "light": "Rem_custom_l.png"}
            },
            "colors": {
                "dark": {
                    "title": "#00d2d3", "text": "#ffffff", "accent": "#ff9ff3", "tab_text": "#ffffff",
                    "btn_start_bg": "#00d2d3", "btn_start_text": "#0a0a0a",
                    "btn_stop_bg": "#ff9ff3", "btn_stop_text": "#1a0a1a"
                },
                "light": {
                    "title": "#0097e6", "text": "#2f3640", "accent": "#8c7ae6", "tab_text": "#1a1a2e",
                    "btn_start_bg": "#0097e6", "btn_start_text": "#ffffff",
                    "btn_stop_bg": "#8c7ae6", "btn_stop_text": "#ffffff"
                }
            }
        }

    # --- Tag Databases (for autocomplete) ---
    @staticmethod
    def _load_tag_db(filename):
        db_path = os.path.join(DATABASE_DIR, filename)
        if os.path.exists(db_path):
            try:
                with open(db_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    @staticmethod
    def _normalize_tag_list(raw):
        """Accept list[str] | list[dict] and return a clean list[str].

        Dict formats seen in the wild:
          gsbooru: {"tag": name, "count": N}
          eshuushuu: {"title": name, ...}
          generic: {"name"|"value"|"label": name}
        """
        out = []
        if not isinstance(raw, list):
            return out
        for item in raw:
            name = None
            if isinstance(item, str):
                name = item
            elif isinstance(item, dict):
                for key in ("tag", "title", "name", "value", "label", "slug"):
                    val = item.get(key)
                    if isinstance(val, str) and val.strip():
                        name = val
                        break
            if name:
                name = name.strip()
                if name:
                    out.append(name)
        return out

    @staticmethod
    def load_safe_tags():
        tags = DatabaseManager._load_tag_db("safe_tag_names.json")
        if not tags:
            tags = DatabaseManager._load_tag_db("tag_names.json")
        return DatabaseManager._normalize_tag_list(tags)

    @staticmethod
    def load_yande_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("yande_tag_names.json"))

    @staticmethod
    def load_kona_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("kona_tag_names.json"))

    @staticmethod
    def load_dan_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("dan_tag_names.json"))

    @staticmethod
    def load_gelbooru_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("gelbooru_tag_names.json"))

    @staticmethod
    def load_gsbooru_tags():
        tags = DatabaseManager._load_tag_db("gsbooru_tag_names.json")
        if not tags:
            return []
        # gsbooru format: [{"count": N, "tag": "name"}, ...] — also handles plain list[str]
        return DatabaseManager._normalize_tag_list(tags)

    @staticmethod
    def load_sankaku_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("sankaku_tag_names.json"))

    @staticmethod
    def load_anime_dl_tags():
        db_path = os.path.join(DATABASE_DIR, "anime_tags.json")
        if not os.path.exists(db_path):
            return []
        # File may be JSONL (one object per line: {"tag": ...}) or a plain JSON array.
        try:
            with open(db_path, "r", encoding="utf-8") as f:
                head = f.read(2048).lstrip()
            if head.startswith("["):
                with open(db_path, "r", encoding="utf-8") as f:
                    return DatabaseManager._normalize_tag_list(json.load(f))
        except Exception:
            pass
        try:
            tags = []
            with open(db_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip().rstrip(",")
                    if not line or line in ("[", "]"):
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(obj, str) and obj.strip():
                        tags.append(obj.strip())
                    elif isinstance(obj, dict) and isinstance(obj.get("tag"), str):
                        tags.append(obj["tag"].strip())
            return [t for t in tags if t]
        except Exception:
            return []

    @staticmethod
    def _load_waifu_tags():
        tags_path = os.path.join(DATABASE_DIR, "waifu.im_tags.json")
        try:
            with open(tags_path, "r", encoding="utf-8") as f:
                tags_db = json.load(f)
            tag_map = {t["name"].lower(): t["slug"] for t in tags_db}
            return tags_db, tag_map
        except Exception:
            return [], {}
        return [], {}

    @staticmethod
    def load_eshuushuu_tags():
        tags = DatabaseManager._load_tag_db("eshuushuu_tags.json")
        return DatabaseManager._normalize_tag_list(tags)

    @staticmethod
    def load_nekosapi_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("nekosapi_tag_names.json"))

    @staticmethod
    def load_nekosia_tags():
        return DatabaseManager._normalize_tag_list(
            DatabaseManager._load_tag_db("nekosia_tag_names.json"))


class SettingsManager:
    """Manages application settings loaded from .env and runtime config."""

    def __init__(self, base_dir):
        self.base_dir = base_dir
        self.config = {
            "use_proxy": os.getenv("USE_PROXY", "false").lower() == "true",
            "proxy_url": os.getenv("PROXY_URL", "http://127.0.0.1:10808"),
            "verify_tls": os.getenv("VERIFY_TLS", "false").lower() == "true",
            "api_timeout": int(os.getenv("API_TIMEOUT", "10")),
            "retry_wait": int(os.getenv("RETRY_WAIT", "5")),
            "anti_ban_pause": float(os.getenv("ANTI_BAN_PAUSE", "3.0")),
            "download_retries": int(os.getenv("DOWNLOAD_RETRIES", "3"))
        }

    def get(self, key, default=None):
        return self.config.get(key, default)

    def update(self, data):
        for key in data:
            if key in self.config:
                self.config[key] = data[key]

    def _env_path(self):
        return os.path.join(self.base_dir, ".env")

    def _read_env_lines(self):
        env_path = self._env_path()
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        else:
            lines = []
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        return lines

    def _write_env_lines(self, lines):
        with open(self._env_path(), "w", encoding="utf-8") as f:
            f.writelines(lines)

    def _upsert_env_keys(self, env_keys):
        lines = self._read_env_lines()
        new_lines = []
        found = {k: False for k in env_keys}
        for line in lines:
            stripped = line.strip()
            matched = False
            for key, val in env_keys.items():
                if stripped.startswith(f"{key}="):
                    new_lines.append(f"{key}={val}\n")
                    found[key] = True
                    matched = True
                    break
            if not matched:
                new_lines.append(line)
        for key, val in env_keys.items():
            if not found[key]:
                new_lines.append(f"{key}={val}\n")
        self._write_env_lines(new_lines)

    def save_config(self):
        env_keys = {
            "USE_PROXY": str(self.config['use_proxy']).lower(),
            "PROXY_URL": self.config['proxy_url'],
            "VERIFY_TLS": str(self.config['verify_tls']).lower(),
            "API_TIMEOUT": str(self.config['api_timeout']),
            "RETRY_WAIT": str(self.config['retry_wait']),
            "ANTI_BAN_PAUSE": str(self.config['anti_ban_pause']),
            "DOWNLOAD_RETRIES": str(self.config['download_retries'])
        }
        self._upsert_env_keys(env_keys)

    def save_api_settings(self, data):
        keys_to_save = {
            "RULE34_API_KEY": data.get("rule34_api_key", ""),
            "RULE34_USER_ID": data.get("rule34_user_id", ""),
            "GELBOORU_API_KEY": data.get("gelbooru_api_key", ""),
            "GELBOORU_USER_ID": data.get("gelbooru_user_id", ""),
            "KONACHAN_USERNAME": data.get("konachan_login", ""),
            "KONACHAN_PASSWORD": data.get("konachan_password", ""),
            "SANKA_LOGIN": data.get("sanka_login", ""),
            "SANKA_PASSWORD": data.get("sanka_password", ""),
            "ZEROCHAN_LOGIN": data.get("zerochan_login", ""),
            "ZEROCHAN_PASSWORD": data.get("zerochan_password", ""),
            "PINTEREST_COOKIES": data.get("pinterest_cookies", ""),
            "PINTEREST_EMAIL": data.get("pinterest_email", ""),
            "PINTEREST_PASSWORD": data.get("pinterest_password", ""),
            "PIXIV_REFRESH_TOKEN": data.get("pixiv_refresh_token", "")
        }
        self._upsert_env_keys(keys_to_save)
        for k, v in keys_to_save.items():
            os.environ[k] = v

    def load_api_settings(self):
        config = {}
        env_path = self._env_path()
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        config[k.strip()] = v.strip()
        return {
            "rule34_api_key": config.get("RULE34_API_KEY", ""),
            "rule34_user_id": config.get("RULE34_USER_ID", ""),
            "gelbooru_api_key": config.get("GELBOORU_API_KEY", ""),
            "gelbooru_user_id": config.get("GELBOORU_USER_ID", ""),
            "konachan_login": config.get("KONACHAN_USERNAME", ""),
            "konachan_password": config.get("KONACHAN_PASSWORD", ""),
            "sanka_login": config.get("SANKA_LOGIN", ""),
            "sanka_password": config.get("SANKA_PASSWORD", ""),
            "zerochan_login": config.get("ZEROCHAN_LOGIN", config.get("ZEROCHAN_USERNAME", "")),
            "zerochan_password": config.get("ZEROCHAN_PASSWORD", ""),
            "pinterest_cookies": config.get("PINTEREST_COOKIES", ""),
            "pinterest_email": config.get("PINTEREST_EMAIL", ""),
            "pinterest_password": config.get("PINTEREST_PASSWORD", ""),
            "pixiv_refresh_token": config.get("PIXIV_REFRESH_TOKEN", "")
        }
