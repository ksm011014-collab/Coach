# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

project_root = Path(SPECPATH).resolve()
binaries = collect_dynamic_libs("imageio_ffmpeg")
datas = [(str(project_root / "web"), "web")]
datas += collect_data_files("imageio_ffmpeg", includes=["binaries/*"])

analysis = Analysis(
    ["backend\\server.py"],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=["imageio_ffmpeg", "backend.central_gateway"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=1,
)
python_archive = PYZ(analysis.pure)

exe = EXE(
    python_archive,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="BoxingCoach.Worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
