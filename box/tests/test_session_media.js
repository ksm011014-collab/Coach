const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Recorder extends EventTarget {
  static isTypeSupported() { return true; }
  constructor(stream, options) { super(); this.state = "inactive"; this.mimeType = options.mimeType; }
  start() { this.state = "recording"; }
  chunk(value) { const event = new Event("dataavailable"); event.data = new Blob([value]); this.dispatchEvent(event); }
  stop() { this.state = "inactive"; this.chunk("final"); this.dispatchEvent(new Event("stop")); }
  interrupt() { this.state = "inactive"; this.dispatchEvent(new Event("stop")); }
}

(async () => {
  const saved = [];
  const message = { textContent: "" };
  const state = { recordingStream: {}, recordedChunks: [], recorder: null };
  const context = vm.createContext({ state, window: { MediaRecorder: Recorder }, MediaRecorder: Recorder, Blob, console, Date, setTimeout, clearTimeout, $: () => message });
  vm.runInContext(fs.readFileSync(require.resolve("../web/scripts/i18n.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../web/scripts/session.js"), "utf8"), context);
  context.saveRecording = async recording => { saved.push(recording); };
  context.startRecording();
  context.state.recorder.chunk("recorded-before-disconnect");
  context.state.recorder.interrupt();
  const interrupted = await context.stopRecording("synthetic-disconnect");
  assert.ok(interrupted?.size > 0, "An already-stopped recorder must preserve buffered data");
  assert.match(await interrupted.blob.text(), /recorded-before-disconnect/);
  assert.equal(interrupted.interrupted, true);
  assert.match(message.textContent, /중단/);
  context.startRecording();
  context.state.recorder.chunk("normal");
  const recording = await context.stopRecording("synthetic-normal");
  assert.equal(await recording.blob.text(), "normalfinal");
  assert.equal(recording.interrupted, false);
  assert.equal(saved.length, 2);
  assert.equal(await context.stopRecording("synthetic-normal"), null);
  context.startRecording();
  context.state.recorder.interrupt();
  await assert.rejects(context.stopRecording("synthetic-empty"), /녹화 데이터가 없습니다/);
  assert.match(state.recordingError, /녹화 데이터가 없습니다/);
  assert.equal(saved.length, 2, "An empty capture must not be saved as a recording");
  const elements = new Map();
  context.$ = selector => {
    if (!elements.has(selector)) elements.set(selector, { classList: { add() {}, remove() {} }, videoWidth: 640, readyState: 2, play: async () => {}, removeEventListener() {} });
    return elements.get(selector);
  };
  context.clearCameraMiniOverlay = () => {};
  context.renderCameraMiniOverlay = () => {};
  context.cameraVideoConstraints = camera => camera;
  state.sessionCameraSources = [];
  let opens = 0;
  context.navigator = { mediaDevices: { getUserMedia: async () => {
    opens++;
    const track = { readyState: "live", getSettings: () => ({ deviceId: "synthetic-camera" }), stop() { this.readyState = "ended"; } };
    return { getVideoTracks: () => [track], getTracks: () => [track] };
  } } };
  await context.startSessionCameras([{ device_id: "synthetic-camera" }]);
  const firstStream = state.recordingStream;
  await context.startSessionCameras([{ device_id: "synthetic-camera" }]);
  assert.equal(opens, 1, "Session start must reuse the unchanged live preview");
  assert.equal(state.recordingStream, firstStream);
  context.stopCamera();
  assert.equal(firstStream.getVideoTracks()[0].readyState, "ended");
  await context.startSessionCameras([{ device_id: "synthetic-camera" }]);
  assert.equal(opens, 2, "Stopped tracks must be reacquired");
  context.stopCamera();
  Object.assign(state, { recordingStream: {}, activeSessionId: "synthetic-empty-end", sessions: [{ id: "synthetic-empty-end" }], localRecordings: {}, sessionBusy: false });
  for (const name of ["stopRoundTimer", "stopSessionTimer", "updateSessionControls", "notifyUser", "playTone"]) context[name] = () => {};
  let endRequests = 0;
  context.api = async () => { endRequests++; return { session: { id: "synthetic-empty-end", ended_at: 1 } }; };
  context.startRecording();
  state.recorder.interrupt();
  await context.stopSession();
  assert.equal(endRequests, 1, "Recording failure must not block the session end write");
  assert.equal(state.activeSessionId, "");
  assert.equal(state.recordingStream, null, "An empty recording failure must release camera capture");
  await context.stopSession();
  assert.equal(endRequests, 1);
  assert.equal(state.activeSessionId, "");
  assert.match(context.$("#sessionMessage").textContent, /운동 기록만 저장했습니다.*녹화 저장 실패/);
  console.log("Recorder lifecycle: unexpected stop preserves data, normal final chunk persists, repeated stop does not duplicate.");
})().catch(error => { console.error(error); process.exitCode = 1; });
