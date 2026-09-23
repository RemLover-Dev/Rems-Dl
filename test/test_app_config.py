import os
import sys
from PIL import Image


def test_icons_exist_and_are_valid():
    ico_path = os.path.join("icon", "icon.ico")
    png_path = os.path.join("icon", "icon.png")

    assert os.path.isfile(ico_path), "icon/icon.ico must exist"
    assert os.path.isfile(png_path), "icon/icon.png must exist"

    with Image.open(ico_path) as img:
        assert img.format == "ICO"

    with Image.open(png_path) as img:
        assert img.format == "PNG"


def test_desktop_entry():
    desktop_file = "Rems_Dl.desktop"
    assert os.path.isfile(desktop_file)
    with open(desktop_file, "r", encoding="utf-8") as f:
        content = f.read()

    assert "[Desktop Entry]" in content
    assert "Name=Rems Dl" in content
    assert "Icon=" in content
    assert "StartupWMClass=Rems_Dl" in content or "StartupWMClass=Rems Dl" in content


def test_github_workflow_naming():
    workflow_path = os.path.join(".github", "workflows", "build.yml")
    assert os.path.isfile(workflow_path)
    with open(workflow_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "build-windows:" in content
    assert "build-linux:" in content

    # Verify proper naming ("اسم درست")
    assert "Rems-Dl-Windows-x64-Setup.exe" in content
    assert "Rems-Dl-Windows-x64-Portable.zip" in content
    assert "Rems-Dl-Linux-x86_64.tar.gz" in content


def test_inno_setup_script():
    iss_path = os.path.join("installer", "setup.iss")
    assert os.path.isfile(iss_path)
    with open(iss_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "Rems-Dl-Windows-x64-Setup" in content
    assert "VCRedistNeedsInstall" in content
    assert "RemLoverDev.RemsDl.App.1.0" in content
