<div align="center">

# Rems Dl 5.1

**A massive multi-threaded image & media scraping application with a beautiful glass-morphism UI.**

Rems Dl is a **native desktop application** (powered by `pywebview`): it opens as a real app window, not a hosted website. The Python backend only listens on the `127.0.0.1` loopback with an ephemeral port -- nothing is exposed to your network and no browser setup is needed.

Supports Rule34, Safebooru, Gelbooru, Gsbooru, Zerochan, Waifu.im, Nekos.best, Nekos.life, Yande.re, Konachan, Danbooru, Sankaku, e-shuushuu, NekosAPI, Nekosia, AnimePictures, Pixiv, and Pinterest.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-yellow.svg)](https://python.org)
[![Version](https://img.shields.io/badge/Version-5.1.0-ff9ff3.svg)](CHANGELOG.md)

[English](README.md) | [فارسی](README_fa.md) | [Linux & Docker](#-run-on-linux--docker)

</div>

---

## ✨ New in Version 5.1 (Rem 5.1)
- **Pixiv Support:** Brand-new worker (gallery-dl based) with ugoira-to-GIF conversion.
- **Gsbooru Rewrite:** Tag caching + categorized tag extraction for lightning-fast autocomplete.
- **Unified Rating System:** Every worker appends `rating:g/s/q/e` tags; rating-aware folders and gallery filters everywhere.
- **Zerochan Tag Engine:** Page-by-page enumeration with a full HTML tag parser (artist/character/copyright/metadata/tag).
- **Project Renamed to Rems Dl:** Entry point is now `Rems_Dl.py`; your old `Rem God` download folder auto-migrates on first run.
- **Standalone Desktop Window:** `pywebview` runtime -- no manual browser needed on Windows or Linux.

## ✨ New in Version 5.0
- **Beautiful Auto-Suggest:** Fully restyled interactive tag suggestions for ALL workers with keyboard support.
- **Immersive Gallery:** "Focus Mode" for pure image viewing, instant next-image on delete.
- **New Platforms:** Nekosia, NekosAPI, and e-shuushuu added to the fleet.
- **Anti-Ban Magic:** AnimePictures.net completely bypassed using `curl_cffi` TLS impersonation.

---

## Quick Start

### 0. No-setup option: download a prebuilt release

Grab the latest `Rems_Dl-Windows.zip` (`.exe`, WebView2 is preinstalled on Windows 10/11) or `Rems_Dl-Linux.tar.gz` from [GitHub Releases](../../releases). Unzip, run, done -- no Python needed. A Docker image (`ghcr.io/remlover-dev/rems-dl:latest`) is published there too for hosts where you want zero system dependencies (see [Run on Linux / Docker](#-run-on-linux--docker)).

### 1. Clone the Repository

```bash
git clone https://github.com/RemLover-Dev/Rems-Dl
cd Rems-Dl
```

### 2. Install Dependencies

You can install all necessary packages easily from the provided `requirements.txt` file.

```bash
pip install -r requirements.txt
```

### 3. Configure (Optional)

Copy `.env.example` to `.env`, or use the **Options** tab in the app UI:

```env
RULE34_API_KEY=your_api_key_here
RULE34_USER_ID=your_user_id_here
USE_PROXY=false
PROXY_URL=http://127.0.0.1:10808
VERIFY_TLS=false
API_TIMEOUT=10
RETRY_WAIT=5
ANTI_BAN_PAUSE=3.0
```

### 4. Run

```bash
python Rems_Dl.py
```

The native desktop window opens automatically (or the UI opens in your browser at a `http://127.0.0.1:<port>` loopback address if `pywebview` is not installed). Headless/server usage: `REMS_HEADLESS=1 python Rems_Dl.py [--headless]` (also used by the Docker image).

> **Upgrading from 5.0?** Your old `Rem God` download folder is auto-renamed to `Rems Dl` on first launch. Nothing to do manually.

---


## 🔑 How to get API Keys / Credentials (Step-by-Step)

Entering credentials in the **Settings** tab unlocks higher API limits and restricted content.

**1. Rule34.xxx**
* Go to [Rule34.xxx](https://rule34.xxx) and Log in.
* Click **My Account** -> **Settings**.
* Scroll down to **API Key** and click **Generate**. Copy this key.
* Click on your username to go to your profile. Check the URL for `id=XXXXXX`. That number is your **User ID**.

**2. Gelbooru**
* Go to [Gelbooru.com](https://gelbooru.com) and Log in.
* Click **My Account** -> **Options**.
* Under **Miscellaneous Options**, find **API Key** and click **Generate API Key**.
* Go back to your account page, find the URL (e.g. `&uid=123456`). That number is your **User ID**.

**3. Sankaku Complex**
* Simply use your standard Sankaku **Username/Email** and **Password** in the UI.

**4. Zerochan**
* Some images are restricted to guests. Use your standard Zerochan **Username** and **Password** in the UI to let the `gallery-dl` engine fetch everything.

**5. Pinterest**
* Standard method: Enter your Pinterest **Email** and **Password**.
* Alternative (If blocked): Use a browser extension (like *EditThisCookie*) to export your Pinterest cookies as a `.json` file. Provide the absolute file path in the `Cookies` field.

---

## Features

- **Multi-Platform** -- Built-in modules for 18 imageboard/API sources (including Danbooru, Sankaku, Pixiv, and Gsbooru)
- **Modern UI** -- Glass-morphism dark & light themes in a native desktop window
- **Discovery Engine & Archives** -- Live extraction of tags and artists from downloaded media, displayed in a dedicated Image Archive tab.
- **Favorites & Search History** -- Add tags to your favorites list for one-click search automation, and maintain a log of your search history.
- **Video & GIF Support** -- Exclusively target `.mp4`, `.webm`, or GIF files via format filtering.
- **GIFs Only Filter** -- Rule34 supports a dedicated GIFs Only mode alongside Images/Videos/All.
- **Real-Time Logs** -- Live console output via WebSocket (Socket.IO) with per-tab clear button
- **Full UI Customization** -- Custom colors for text, accents, buttons, and tab backgrounds; per-tab wallpapers with dark/light mode
- **Advanced Search** -- AND/OR tag queries, exclusions (`-video`, `-image`), custom sorting, category-based browsing
- **Anti-Ban Engine** -- Tactical delays, retry loops, rate-limit handling
- **Proxy Support** -- Full proxy configuration from the UI (v2rayN, Clash, etc.)
- **API Key Management** -- Manage Rule34 credentials directly from the Web UI
- **Tag Auto-Suggest** -- Live autocomplete for all platforms including offline Konachan tag DB
- **Hydrus Sidecar Files** -- Auto-generates `.filename.txt` sidecar files with tags, artists, and source for Hydrus Network import
- **Persistent Settings** -- Proxy, API keys, and download settings saved in `.env`


## Project Structure

Source code only (docs, build output, downloads, and per-user data are not listed):

```
Rems Dl/
├── Rems_Dl.py              # App entry point: native desktop window + internal backend
├── Rems_Dl.spec            # PyInstaller build spec (Windows .exe / Linux binary)
├── Rems_Dl.desktop         # Linux desktop launcher (uses icon/icon.png)
├── Dockerfile              # Headless server image (REMS_HEADLESS=1)
├── requirements.txt        # Desktop dependencies
├── requirements.docker.txt # Server-only dependencies (no pywebview)
├── .env.example            # Example config (copy to .env)
├── .github/workflows/release.yml # Release automation (exe + binary + Docker)
├── core/
│   ├── shared.py           # Tag engine, gallery store, BaseDownloader async pipeline
│   ├── database.py         # JSON database manager (history, favorites, UI config)
│   ├── gallery_dl_interop.py # Runtime gallery-dl page-html enablement (source runs)
│   └── check_imports.py    # Import sanity checker
├── workers/                # Source-specific download modules
├── web/
│   ├── index.html          # Main UI (tabs, forms, archives, settings)
│   ├── script.js           # Frontend logic (Socket.IO + fetch API)
│   ├── style.css           # Glass-morphism dark/light themes
│   ├── icon.png            # Favicon
│   ├── Fonts/              # Offline fonts
│   └── wallpaper/          # Per-tab dark/light backgrounds
├── icon/
│   ├── icon.ico            # Windows executable icon
│   └── icon.png            # Linux launcher icon (512×512)
└── database/               # Offline tag databases for autocomplete (*_tag_names.json, ...)
```

## Supported Platforms

| Platform | Tags | NSFW | Notes |
|----------|------|------|-------|
| **Rule34** | Full search with AND/OR, exclusions, sorting, video format support | Yes | Requires API key for best results |
| **Safebooru** | Standard tag search, video format support, artist extraction | No | May require proxy (Cloudflare) |
| **Gelbooru** | Full search, format exclusions, video/GIF support, artist extraction | Yes | Danbooru-style rating system (Safe/Sensitive/Questionable/NSFW) |
| **Danbooru** | Full tag search, rating filter, artist extraction, offline tag DB, video/image separation | Yes | Sorts into Safe/Sensitive/Questionable/NSFW folders, separates videos |
| **Zerochan** | Tag search with live suggestions | No | Built-in retry & rate limiting |
| **Waifu.im** | Name-to-slug conversion, NSFW toggle | Yes | Uses local `tags.json` for suggestions |
| **Nekos.best** | Category-based (PNG / GIF) | No | Multiple format support |
| **Nekos.life** | Category-based with type indicators (GIF/Static/Mixed) | Yes | Animated neko, hug, pat, cuddle, and more |
| **Yande.re** | Full tag search, rating filter, artist extraction, local tag DB | Yes | Moebooru API, images only, sorts into Safe/Moderate/NSFW folders |
| **Konachan** | Full tag search, rating filter, artist extraction, local tag DB, video/GIF format filtering | Yes | Moebooru API, sorts into Safe/Moderate/Explicit folders |
| **Sankaku** | Full tag search, rating filter, artist extraction, offline tag DB | Yes | Login via Settings unlocks higher limits |
| **Gsbooru** | Full search, rating filter, tag caching, categorized tags | Yes | Gelbooru-compatible API, fast offline autocomplete |
| **AnimePictures** | Tag search with TLS impersonation (`curl_cffi`) | Mixed | Bypasses Cloudflare 403 blocks |
| **e-shuushuu** | Tag search with local tag DB | Mixed | Fast offline autocomplete |
| **NekosAPI** | Tag search with rating filter, local tag DB | Mixed | Sorts into Safe/Sensitive/Questionable/NSFW folders |
| **Nekosia** | Tag search with rating filter, local tag DB | Mixed | Sorts into rating subdirectories |
| **Pixiv** | Tag search, ugoira-to-GIF conversion | Mixed | Requires Pixiv refresh token in Settings |
| **Pinterest** | Search + board download, resolution filter | No | Email/password or cookies file |

---

## 📦 Pre-Built Downloads & Releases

Automated GitHub Actions workflows build and test every release for Windows and Linux with standardized filenames:

| Platform | Format | File Name | Description |
|----------|--------|-----------|-------------|
| **Windows (x64)** | **Installer** | `Rems-Dl-Windows-x64-Setup.exe` | **Recommended:** Complete installer with Desktop/Start Menu shortcuts, custom icon, and **automatic Microsoft Visual C++ Redistributable detection & installation**. |
| **Windows (x64)** | **Portable** | `Rems-Dl-Windows-x64-Portable.zip` | Standalone portable folder. Extract and double-click `Rems_Dl.exe`. |
| **Linux (x86_64)** | **Tarball** | `Rems-Dl-Linux-x86_64.tar.gz` | Standalone Linux application with desktop integration files. |

---

## 🪟 Windows Setup & Installation

### Option 1: Windows Installer (Recommended)
1. Download **`Rems-Dl-Windows-x64-Setup.exe`** from [Releases](../../releases).
2. Run the installer.
3. The installer automatically detects if your system has the required **Microsoft Visual C++ 2015-2022 Redistributable (x64)** installed. If missing, it will install it for you silently to prevent any missing C++ runtime DLL errors.
4. Shortcuts with the custom Rems Dl icon will be created on your Desktop and Start Menu.
5. The application will use its custom icon in the Windows taskbar rather than the default Python icon.

### Option 2: Portable Zip
1. Download **`Rems-Dl-Windows-x64-Portable.zip`**.
2. Extract the archive anywhere on your PC.
3. Run `Rems_Dl.exe`.

---

## 🐧 Run and Configure on Linux

Rems Dl runs on Linux as either a **native desktop application** (via WebKitGTK), a **headless web server** in your favorite browser, or inside **Docker**.

### 1. System Requirements for Native Linux Desktop GUI
If you want to run the native desktop window rather than the browser UI, ensure WebKitGTK and PyGObject are installed on your distribution:

- **Debian / Ubuntu / Linux Mint / Pop!_OS:**
  ```bash
  sudo apt update
  sudo apt install -y python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1
  ```
  *(On older Ubuntu 20.04/Debian 11 releases, use `gir1.2-webkit2-4.0` instead).*

- **Arch Linux / Manjaro:**
  ```bash
  sudo pacman -S python-gobject webkit2gtk-4.1 gtk3
  ```

- **Fedora / RHEL:**
  ```bash
  sudo dnf install -y python3-gobject webkit2gtk4.1 gtk3
  ```

### 2. Running the Pre-Built Linux Standalone Package
1. Download **`Rems-Dl-Linux-x86_64.tar.gz`** from [Releases](../../releases).
2. Extract and launch:
   ```bash
   tar -xzf Rems-Dl-Linux-x86_64.tar.gz
   cd Rems_Dl
   ./Rems_Dl
   ```

### 3. Integrating with Linux Desktop Menu
To add Rems Dl to your application launcher with its custom icon:
```bash
# Copy desktop entry and update database
cp Rems_Dl.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications/
```

### 4. Running from Source on Linux
```bash
git clone https://github.com/RemLover-Dev/Rems-Dl.git
cd Rems-Dl
pip install -r requirements.txt
python Rems_Dl.py
```

### 5. Automatic Fallback & Headless / Server Mode
- **Missing WebKitGTK?** No problem! If `pywebview` or WebKitGTK is not installed on your system, Rems Dl will automatically notify you and launch smoothly in your default web browser at `http://127.0.0.1:<port>`.
- **Headless Server / Remote VPS / SSH:** Run without opening a window:
  ```bash
  REMS_HEADLESS=1 python Rems_Dl.py
  # or
  python Rems_Dl.py --headless
  ```
  The app will bind to `0.0.0.0:$PORT` (default: 5000) and allow external access from any device on your network.

### 6. Running with Docker (Zero Host Dependencies)
Pull and run the official image:
```bash
docker pull ghcr.io/remlover-dev/rems-dl:latest
docker run -d -p 5000:5000 \
  -v "$(pwd)/Rems Dl:/app/Rems Dl" \
  -v "$(pwd)/database:/app/database" \
  --name rems-dl-app ghcr.io/remlover-dev/rems-dl:latest
```
Then open `http://localhost:5000` in your browser.

---

## 🪟 Build from Source (EXE / Binary)

### Windows `.exe` (one command)
```bash
pip install -r requirements.txt
pip install pyinstaller
pyinstaller Rems_Dl.spec
xcopy database dist\Rems_Dl\database\*.json
```
The ready-to-run build lands in `dist/Rems_Dl/Rems_Dl.exe` (onedir), with `icon/icon.ico` baked in as the executable icon. Zip the `dist/Rems_Dl` folder and share it -- no Python needed on the target PC.

> The spec bundles `web/` (UI + favicon) and `icon/`. The `database/*.json` tag DBs (~170 MB) are copied next to the exe by the `xcopy` step so offline autocomplete works. Your `Rems Dl/` downloads and `.env` are created next to the exe on first run. Zerochan's gallery-dl integration needs no manual patching: source runs enable `page-html` on your own installed gallery-dl copy automatically (`core/gallery_dl_interop.py`), and frozen builds use the built-in API engine.

### Linux binary (via WSL)
PyInstaller is not cross-platform -- a Linux binary must be built **on Linux**. From Windows, use WSL:
```bash
wsl -d Ubuntu
cd /mnt/e/Rems\ Dl            # mount of this project folder (adjust the path)
pip install -r requirements.txt
pip install pyinstaller
sudo apt install python3-gi gir1.2-webkit2-4.1   # for the pywebview desktop window (optional)
pyinstaller Rems_Dl.spec --noconfirm
cp database/*.json dist/Rems_Dl/database/
```
The Linux build lands in `dist/Rems_Dl/Rems_Dl` (no `.exe` extension). Notes:
- Build **inside WSL**, never on Windows, when the target is Linux.
- On a headless server, skip `pywebview` -- run with `REMS_HEADLESS=1` (or `--headless`) so the app serves on `0.0.0.0:$PORT` instead of opening a window.
- For servers/containers, the Docker image (see above) is usually simpler than a binary.

> You don't need to build by hand for every release: pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the Windows `.exe`, the Linux binary, and the Docker image, then attaches the archives to the GitHub Release and pushes the image to GHCR.

---

## Disclaimer

This software is provided for **educational and archiving purposes only**. Some supported APIs index NSFW content -- users must be of legal age in their jurisdiction. Please respect API rate limits and do not aggressively spam requests.

---

## License

[MIT License](LICENSE) for our own code, with third-party notices in the same file: `workers/pixiv.py` is GPL-2.0-only (adapted from gallery-dl, which itself stays an external, never-bundled tool), and the `rule34Py` dependency is GPL-3.0-only. See [LICENSE](LICENSE) for details.
