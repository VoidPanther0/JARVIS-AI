# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for JARVIS (Mark LVII).

Build with:  pyinstaller --noconfirm --clean JARVIS.spec
Result:      dist/JARVIS/   (onedir, so config/ stays writable at runtime)
"""

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hiddenimports = []
for _pkg in ("actions", "plugins", "core", "memory", "providers", "gui", "dashboard"):
    try:
        hiddenimports += collect_submodules(_pkg)
    except Exception:
        pass
hiddenimports += ["ui"]

datas = [
    ("agents", "agents"),
    ("actions", "actions"),
    ("plugins", "plugins"),
    ("core/face_model.obj", "core"),
    ("config/jarvis.ico", "config"),
]

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=["runtime_hook.py"],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="JARVIS",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="config/jarvis.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="JARVIS",
)