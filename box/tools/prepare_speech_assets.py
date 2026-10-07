import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1] / 'vendor' / 'speech'
ENGINE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.7/whisper-bin-x64.zip'
ENGINE_HASH = 'd9627486e1c34a03745880485593473e047294260ce9a3cb0aa8deaf15b99af6'
MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin'
MODEL_HASH = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'


def download(url, destination, digest=None):
    with urlopen(url, timeout=60) as response, destination.open('wb') as output:
        shutil.copyfileobj(response, output)
    actual = hashlib.file_digest(destination.open('rb'), 'sha256').hexdigest()
    if digest and actual != digest:
        raise ValueError('Speech asset checksum mismatch')
    return actual


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / 'engine.zip'
        download(ENGINE_URL, archive, ENGINE_HASH)
        with zipfile.ZipFile(archive) as package:
            for entry in package.infolist():
                name = Path(entry.filename).name
                if name == 'whisper-cli.exe' or name.endswith('.dll'):
                    with package.open(entry) as source, (ROOT / name).open('wb') as target:
                        shutil.copyfileobj(source, target)
        if not (ROOT / 'whisper-cli.exe').exists():
            raise ValueError('Missing speech executable')
        model = ROOT / 'ggml-base.bin'
        if not model.exists() or hashlib.file_digest(model.open('rb'), 'sha256').hexdigest() != MODEL_HASH:
            pending = Path(temporary) / 'model.bin'
            download(MODEL_URL, pending, MODEL_HASH)
            shutil.copyfile(pending, model)
        download('https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.7/LICENSE', ROOT / 'LICENSE-whisper-cpp.txt')
        download('https://raw.githubusercontent.com/openai/whisper/main/LICENSE', ROOT / 'LICENSE-whisper-model.txt')
    manifest = {'engine': 'whisper.cpp v1.8.7', 'engine_url': ENGINE_URL, 'engine_sha256': ENGINE_HASH,
                'model_url': MODEL_URL, 'model_sha256': MODEL_HASH, 'license': 'MIT', 'languages': ['ko', 'en']}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Verified local speech engine, multilingual base model and licenses prepared.')


if __name__ == '__main__':
    main()
