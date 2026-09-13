# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

project_root = Path(SPECPATH).resolve()
binaries = []
binaries += collect_dynamic_libs('imageio_ffmpeg')
binaries += collect_dynamic_libs('cv2')
datas = [(str(project_root / 'web'), 'web')]
datas += collect_data_files('imageio_ffmpeg', includes=['binaries/*'])


a = Analysis(
    ['backend\\server.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=['cv2', 'imageio_ffmpeg', 'numpy'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='BoxingCoach',
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
