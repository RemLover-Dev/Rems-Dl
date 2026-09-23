---
applyTo: '**'
---

# Persistent Agent Memory & Best Practices

## GitHub Actions & Cross-Platform Packaging Lessons

1. **Release Asset Naming ("با اسم درست"):**
   - Standardized release artifacts must always be descriptive and explicitly state the OS and architecture:
     - Windows Installer: `<App>-Windows-x64-Setup.exe`
     - Windows Portable: `<App>-Windows-x64-Portable.zip`
     - Linux Standalone: `<App>-Linux-x86_64.tar.gz`

2. **Ubuntu 24.04 (`ubuntu-latest`) PyGObject & WebKitGTK Rule:**
   - Ubuntu 24.04 uses GLib 2.80+ and requires `libgirepository-2.0-dev` (not `1.0`).
   - Meson requires: `pkg-config`, `libcairo2-dev`, `python3-dev`, `meson`, `ninja-build`, `gobject-introspection`, and `libgirepository-2.0-dev` (with fallback to `libgirepository1.0-dev`).
   - In pip, install with fallback: `pip install PyGObject || echo "using system packages"`.

3. **`actions/download-artifact@v4` Dockerbuild Cache Trap:**
   - Never run `actions/download-artifact@v4` without filtering (`pattern:` or `name:`).
   - If Docker Buildx runs in the workflow, it automatically creates internal cache artifacts like `*.dockerbuild`. Unfiltered `download-artifact` attempts to extract them as zip files and repeatedly fails after 5 retries.
   - Prefer uploading assets directly to the GitHub Release from each build job using `softprops/action-gh-release@v2`.
   - Never leave obsolete or duplicate release workflow files in `.github/workflows/`.

4. **Windows Packaging & C++ Runtime (Inno Setup + PyInstaller):**
   - Inno Setup ISCC compiler is pre-installed at `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"`.
   - Always ensure destination folders exist (`New-Item -ItemType Directory -Force -Path dist_installer`).
   - Check Windows registry for Visual C++ 2015-2022 runtime: `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64` (`Installed` DWORD == 1). Install `vc_redist.x64.exe /install /passive /norestart` if absent.
   - Set `ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(...)` in Python to prevent the taskbar from showing the generic Python icon.

5. **Cross-Platform Path Sanitization (POSIX vs Windows):**
   - Windows rejects `:` in directory names, but Linux allows it.
   - Never rely on `try ... os.makedirs() except OSError:` to sanitize paths, as POSIX filesystems will not raise an `OSError` on colons or special characters.
   - Always sanitize all path components eagerly across all platforms.

6. **Test Isolation in CI:**
   - Tests run in clean virtual environments. Never import undeclared packages (e.g., `import yaml`) inside test files unless explicitly present in `requirements.txt`.
