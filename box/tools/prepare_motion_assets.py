import hashlib
import argparse
import json
import shutil
from pathlib import Path
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser(description='Prepare pinned local experimental pose assets without modifying application data.')
    parser.add_argument('--download', action='store_true', help='Download missing model and upstream license from their official sources')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / 'artifacts/pose-benchmark'
    package = source / 'node_modules/@mediapipe/tasks-vision'
    model = source / 'pose_landmarker_lite.task'
    license_file = source / 'MEDIAPIPE-LICENSE.txt'
    sources = {
        model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        license_file: 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE',
    }
    if args.download:
        source.mkdir(parents=True, exist_ok=True)
        for target, url in sources.items():
            if not target.exists():
                with urlopen(url, timeout=60) as response:
                    data = response.read(32 * 1024 * 1024)
                target.write_bytes(data)
    if not model.exists() or not license_file.exists():
        raise ValueError('Missing model/license; run with --download after installing the pinned runtime described in docs/refoundation/07-motion-coaching.md')
    expected = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
    if hashlib.sha256(model.read_bytes()).hexdigest() != expected:
        raise ValueError('Pose Lite model checksum mismatch')
    package_data = json.loads((package / 'package.json').read_text())
    if package_data['version'] != '0.10.22-rc.20250304':
        raise ValueError('Unexpected runtime version')
    if package_data.get('license') != 'Apache-2.0' or 'Apache License' not in license_file.read_text(encoding='utf-8')[:200]:
        raise ValueError('Runtime license metadata mismatch')
    destination = root / 'web/vendor/motion'
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(package / 'vision_bundle.mjs', destination / 'vision_bundle.mjs')
    shutil.copy2(package / 'package.json', destination / 'runtime-package.json')
    shutil.copytree(package / 'wasm', destination / 'wasm', dirs_exist_ok=True)
    shutil.copy2(model, destination / model.name)
    shutil.copy2(license_file, destination / license_file.name)
    shutil.copy2(package / 'README.md', destination / 'RUNTIME-README.md')
    manifest = {'model': 'mediapipe', 'module': '/vendor/motion/vision_bundle.mjs', 'wasm': '/vendor/motion/wasm', 'modelPath': '/vendor/motion/pose_landmarker_lite.task', 'delegate': 'CPU', 'status': 'experimental', 'sha256': expected}
    installed = [destination / 'vision_bundle.mjs', destination / 'runtime-package.json', destination / model.name, destination / license_file.name, destination / 'RUNTIME-README.md', *sorted((destination / 'wasm').glob('*'))]
    manifest['runtime_version'] = package_data['version']
    manifest['sources'] = {target.name: url for target, url in sources.items()}
    manifest['files'] = [{'path': file.relative_to(destination).as_posix(), 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file in installed if file.is_file()]
    (destination / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    print('Local experimental pose assets prepared; model hash verified. Recognition accuracy is not validated.')


if __name__ == '__main__':
    main()
