# -*- mode: python ; coding: utf-8 -*-
import sys
import os

block_cipher = None

# Files and directories to bundle with the application
added_files = [
    ('web', 'web'),
    ('icon', 'icon'),
    ('database', 'database'),
    ('.env.example', '.'),
]

hidden_imports = [
    'engineio.async_drivers.threading',
    'flask_socketio',
    'jinja2',
    'curl_cffi',
    'PIL',
    'PIL.Image',
    'PIL.ImageResampling',
    'urllib3',
    'requests',
    'socks',
    'gallery_dl',
    'rule34Py',
    'pinterest_dl',
    'webview',
    'core',
    'core.database',
    'core.shared',
    'core.dedup_store',
    'workers',
]

if sys.platform == 'win32':
    hidden_imports.extend([
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
        'clr',
    ])
elif sys.platform == 'linux':
    hidden_imports.extend([
        'webview.platforms.gtk',
        'gi',
    ])

a = Analysis(
    ['Rems_Dl.py'],
    pathex=['.'],
    binaries=[],
    datas=added_files,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'scipy', 'numpy', 'torch'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

icon_file = os.path.join('icon', 'icon.ico') if sys.platform == 'win32' else os.path.join('icon', 'icon.png')

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Rems_Dl',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_file if os.path.exists(icon_file) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Rems_Dl',
)
