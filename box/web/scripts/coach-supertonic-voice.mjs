import { createNativeVoice } from './coach-native-voice.mjs';

const root = '/vendor/supertonic';
let enginePromise;
let synthesisQueue = Promise.resolve();

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const ort = await import(`${root}/ort.wasm.min.mjs`);
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = `${root}/`;
      const helper = await import(`${root}/helper.mjs`);
      const {textToSpeech} = await helper.loadTextToSpeech(`${root}/onnx`, {executionProviders:['wasm']});
      const style = await helper.loadVoiceStyle([`${root}/voice_styles/F1.json`]);
      return {textToSpeech, style};
    })().catch(error => { enginePromise = null; throw error; });
  }
  return enginePromise;
}

function waveBase64(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const label = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
  label(8, 'WAVE'); label(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

// Reuse the existing measured audio playback, volume, rate and cancellation logic.
// Text and generated audio remain on this device; every resource is same-origin.
export async function createSupertonicVoice(settings) {
  try {
    const response = await fetch(`${root}/manifest.json`, {cache:'no-cache'});
    if (!response.ok || (await response.json()).engine !== 'supertonic-3') return null;
  } catch (_) { return null; }
  let generation = 0;
  const bridge = {
    async request(type, payload) {
      if (type === 'speech.voices') return [
        {id:'supertonic-F1-ko', language:'ko-KR', name:'Supertonic F1'},
        {id:'supertonic-F1-en', language:'en-US', name:'Supertonic F1'},
      ];
      if (type === 'speech.stop') { generation++; return {stopped:true}; }
      if (type !== 'speech.synthesize' || !['ko','en'].includes(payload?.language) ||
          typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 1000) throw new Error('speech_invalid_audio');
      const current = generation;
      const task = synthesisQueue.catch(() => {}).then(async () => {
        if (current !== generation) throw new Error('cancelled');
        const {textToSpeech, style} = await loadEngine();
        if (current !== generation) throw new Error('cancelled');
        const {wav} = await textToSpeech.call(payload.text, payload.language, style, 5, 1.05, 0.3, () => {
          if (current !== generation) throw new Error('cancelled');
        });
        if (current !== generation) throw new Error('cancelled');
        return {audio:waveBase64(wav, textToSpeech.sampleRate), contentType:'audio/wav'};
      });
      synthesisQueue = task;
      return task;
    },
  };
  const provider = await createNativeVoice(bridge, settings);
  provider.engine = 'Supertonic';
  return provider;
}
