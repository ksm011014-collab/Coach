import array
import math
import subprocess
import tempfile
import threading
import wave
from pathlib import Path


_lock = threading.Lock()


def transcribe(audio: bytes, language: str, assets: Path, ffmpeg: str) -> str:
    if language not in ('ko', 'en') or not audio or len(audio) > 4 * 1024 * 1024:
        raise ValueError('speech_invalid_audio')
    engine, model = assets / 'whisper-cli.exe', assets / 'ggml-base.bin'
    if not engine.is_file() or not model.is_file():
        raise ValueError('speech_model_missing')
    if not _lock.acquire(blocking=False):
        raise ValueError('speech_busy')
    try:
        with tempfile.TemporaryDirectory(prefix='jdc-speech-') as directory:
            source = Path(directory) / 'input.audio'
            waveform = Path(directory) / 'input.wav'
            output = Path(directory) / 'result'
            source.write_bytes(audio)
            options = {'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL,
                       'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0), 'check': True}
            subprocess.run([ffmpeg, '-nostdin', '-y', '-i', str(source), '-t', '31', '-vn',
                            '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(waveform)], timeout=10, **options)
            with wave.open(str(waveform), 'rb') as recording:
                duration = recording.getnframes() / recording.getframerate()
                samples = array.array('h', recording.readframes(recording.getnframes()))
            if not 0.25 <= duration <= 30.5 or not samples:
                raise ValueError('speech_invalid_audio')
            if math.sqrt(sum(float(sample) ** 2 for sample in samples) / len(samples)) < 65:
                raise ValueError('speech_no_voice')
            subprocess.run([str(engine), '-m', str(model), '-f', str(waveform), '-l', language,
                            '-t', '2', '-ng', '-nt', '-np', '-otxt', '-of', str(output), '-bo', '1', '-bs', '1'],
                           timeout=60, **options)
            text = output.with_suffix('.txt').read_text(encoding='utf-8').strip()
            if not text or len(text) > 2000:
                raise ValueError('speech_no_voice')
            return text
    except subprocess.TimeoutExpired as error:
        raise ValueError('speech_timeout') from error
    except (subprocess.CalledProcessError, wave.Error) as error:
        raise ValueError('speech_failed') from error
    finally:
        _lock.release()
