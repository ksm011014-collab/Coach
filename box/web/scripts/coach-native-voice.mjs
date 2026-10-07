export async function createNativeVoice(bridge, settings) {
  if (!bridge) return null;
  const voices = await bridge.request('speech.voices');
  let generation = 0;
  let audio = null;
  let cancelPlayback = null;
  let audioContext = null;
  let levelFrame = null;
  let resetLevel = () => {};
  const stop = () => {
    generation++;
    globalThis.cancelAnimationFrame?.(levelFrame);
    levelFrame = null;
    resetLevel();
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    cancelPlayback?.();
    cancelPlayback = null;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    bridge.request('speech.stop').catch(() => {});
  };
  return {
    voices,
    stop,
    async speak({ text, language, signal, onStart, onLevel = () => {} }) {
      stop();
      if (!settings.enabled) return;
      if (!voices.some(voice => voice.language.toLowerCase().startsWith(language + '-'))) throw new Error('speech_voice_missing');
      const current = generation;
      const abort = () => { if (current === generation) stop(); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const sentences = text.match(/[^.!?。！？\n]+[.!?。！？]*/g) || [text];
        for (const sentence of sentences) {
          for (let offset = 0; offset < sentence.length; offset += 500) {
            if (signal.aborted || current !== generation || !settings.enabled) return;
            const result = await bridge.request('speech.synthesize', { text: sentence.slice(offset, offset + 500), language });
            if (signal.aborted || current !== generation || !settings.enabled) return;
            const player = new Audio(`data:${result.contentType};base64,${result.audio}`);
            audio = player;
            player.volume = settings.volume;
            player.playbackRate = settings.rate;
            resetLevel = () => onLevel(0);
            try {
              const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
              if (Context) {
                audioContext = new Context();
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                audioContext.createMediaElementSource(player).connect(analyser);
                analyser.connect(audioContext.destination);
                await audioContext.resume();
                if (signal.aborted || current !== generation) return;
                const samples = new Uint8Array(analyser.fftSize);
                const measure = () => {
                  if (signal.aborted || current !== generation) return;
                  analyser.getByteTimeDomainData(samples);
                  const energy = samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length;
                  onLevel(Math.min(1, Math.sqrt(energy) * 4));
                  levelFrame = requestAnimationFrame(measure);
                };
                levelFrame = requestAnimationFrame(measure);
              }
            } catch (_) {}
            if (signal.aborted || current !== generation || !settings.enabled) return;
            await new Promise((resolve, reject) => {
              cancelPlayback = resolve;
              player.onended = resolve;
              player.onerror = () => reject(new Error('speech_playback_failed'));
              player.onplaying = onStart;
              player.play().catch(reject);
            });
            if (current !== generation) return;
            cancelPlayback = null;
            globalThis.cancelAnimationFrame?.(levelFrame);
            onLevel(0);
            if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
            player.pause();
            player.removeAttribute('src');
            player.load();
            if (audio === player) audio = null;
          }
        }
      } finally { signal.removeEventListener('abort', abort); if (current === generation) stop(); }
    },
  };
}

export function loadVoiceSettings(storage) {
  let saved = {};
  try { saved = JSON.parse(storage.getItem('boxing_voice_settings') || '{}') || {}; } catch (_) {}
  return { enabled: saved.enabled !== false, autoRead: saved.autoRead !== false,
    volume: Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.8,
    rate: Number.isFinite(saved.rate) ? Math.max(0.5, Math.min(2, saved.rate)) : 1 };
}
