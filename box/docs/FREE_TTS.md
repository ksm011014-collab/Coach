# Free Korean/English device TTS

The round coach now prefers Supertonic 3 when its same-origin assets are installed, after an explicitly configured voice service. If assets are absent, the existing Windows installed-voice provider remains available. Local microphone transcription is unchanged. No database or native bridge changes are needed.

Prepare the pinned assets from the repository root:

```powershell
./box/tools/prepare_tts_assets.ps1
```

The tool downloads about 415 MB into `box/web/vendor/supertonic/`, preserves licenses, verifies model LFS SHA-256 values against the pinned model repository, and writes a readiness manifest with file hashes. These downloaded files are ignored by Git; include this directory when publishing the shared web UI. Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`. Serve the assets on the approved application origin, with caching enabled for the pinned assets and revalidation for `manifest.json`. Do not deploy a readiness manifest without its assets.

Inference uses ONNX Runtime Web 1.22.0, single-threaded WebAssembly, Supertonic 3 F1 voice, and five synthesis steps. There are no paid speech API calls, keys, or transmission of text/audio to a TTS service. The first use loads roughly 400 MB of models into the device; startup time and memory use require acceptance on customer hardware. Existing playback controls and measured audio animation remain in use. Cancellation discards pending results and stops between inference steps; it cannot interrupt an ONNX operation already running.

The implementation has been checked using real Korean and English model inference in Node with the same WebAssembly runtime, plus the existing voice contract tests. Actual playback in the connected Windows release and hosted asset delivery have not been verified. This change does not generate a Windows release or publish the hosted application. Hosted installations can receive the web change without updating the native shell. A release loading bundled web files receives it through a later explicitly requested release.

## Sources and distribution terms

- Source: https://github.com/supertone-oss-archive/supertonic (MIT; pinned revision in the preparation tool).
- Runtime: https://github.com/microsoft/onnxruntime/tree/v1.22.0 (MIT).
- Model: https://huggingface.co/supertone-oss-archive/supertonic-3 (BigScience Open RAIL-M, including use restrictions).

The model is royalty-free under its license conditions; it is not an unrestricted MIT model. Before public distribution, retain the model LICENSE and code/runtime notices, give recipients a copy of the model license, and incorporate its Section 5 / Attachment A use restrictions into the application's enforceable user agreement as required by Section 4(a). Model redistribution and hosted access are both covered. The official Supertonic repository was archived September 9, 2026 and receives no updates or support; versions are pinned for reproducibility.
