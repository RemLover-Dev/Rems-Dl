# Rem 5.2 - Rems Dl Release Notes

We are pleased to introduce **Rem 5.2 (Rems Dl v5.2.0)**! This release introduces adaptive layout scaling for high-resolution monitors, a dedicated Windows installer with automatic Visual C++ runtime detection, native taskbar identity fixes, cross-platform path sanitization, and automated GitHub Actions CI/CD workflows for Windows and Linux.

---

## 🚀 What's New in Rem 5.2

### 🖼️ Responsive Gallery for High-Resolution & Large Monitors
- **Dynamic Tile Scaling:** Replaced hardcoded dimensions with adaptive targets based on monitor resolution:
  - Standard/Laptop screens: 148px tile width.
  - 1080p Full HD: 165px tile width.
  - 1440p / 2K / QHD: 190px tile width.
  - 4K / UHD / Ultrawide: 220px tile width (prevents overcrowded 20+ columns of tiny cards).
- **Auto-Adapting Layout with ResizeObserver:** Automatically recalculates column count and pagination items when window size changes or when maximized.
- **Accurate Hidden Container Sizing:** Fixed initial width estimation when the gallery tab is hidden by properly accounting for sidebar width and glass-panel padding.
- **Responsive Media Queries:** Added CSS media queries for 1080p, 1440p, and 4K displays covering search input field widths, toolbar controls, and metadata preview capsules.

### 🎨 Windows Taskbar Branding & App Identity
- **Explicit AppUserModelID:** Process registered with `RemLoverDev.RemsDl.App.1.0` so the Windows taskbar displays the custom Rems Dl icon rather than the generic Python logo.
- **Bundle-Aware Icon Resolution:** Searches both PyInstaller frozen directory (`sys._MEIPASS`) and development paths for `icon.ico` and `icon.png`.
- **Favicon Links:** Embedded favicon links in the web UI for browser and desktop views.

### 💿 Complete Windows Setup Installer (`Rems-Dl-Windows-x64-Setup.exe`)
- **Automated VC++ Runtime Check & Install:** Detects whether Microsoft Visual C++ 2015-2022 Redistributable (x64) is installed via registry check. If missing, it automatically installs `vc_redist.x64.exe` silently to prevent missing runtime DLL errors (`VCRUNTIME140.dll`, etc.).
- **Desktop & Start Menu Shortcuts:** Creates clean shortcuts with the custom application icon and matching AppUserModelID.
- **Built-in Uninstaller:** Full integration with Windows "Add or Remove Programs".
- **Portable Zip Option:** `Rems-Dl-Windows-x64-Portable.zip` remains available for portable use without installation.

### 🐧 Enhanced Linux Desktop Experience & Fallbacks
- **Full WebKitGTK & PyGObject Support:** Native desktop window via GTK/WebKit2.
- **Automatic Web Browser Fallback:** If GUI libraries are missing or when running on headless servers, the application automatically launches in the default web browser instead of exiting.
- **Cross-Platform Path Sanitization:** Fixed directory sanitization in `core/shared.py` to ensure clean, illegal-character-free folder naming across Linux, macOS, and Windows.

### ⚙️ Automated GitHub Actions CI/CD Pipeline
- Automated builds for Windows (x64) and Linux (x86_64).
- Standardized file naming:
  - `Rems-Dl-Windows-x64-Setup.exe` (Windows Installer)
  - `Rems-Dl-Windows-x64-Portable.zip` (Windows Portable Archive)
  - `Rems-Dl-Linux-x86_64.tar.gz` (Linux Standalone Archive)

---

## 📦 Downloads & Packages

| File | Platform | Type | Description |
|------|----------|------|-------------|
| **`Rems-Dl-Windows-x64-Setup.exe`** | Windows (x64) | Installer | **Recommended for Windows.** Full setup with automatic Visual C++ runtime detection & installation. |
| **`Rems-Dl-Windows-x64-Portable.zip`** | Windows (x64) | Portable Archive | Standalone portable folder. Extract and double-click `Rems_Dl.exe`. |
| **`Rems-Dl-Linux-x86_64.tar.gz`** | Linux (x86_64) | Standalone Archive | Standalone Linux application with desktop integration files. |
