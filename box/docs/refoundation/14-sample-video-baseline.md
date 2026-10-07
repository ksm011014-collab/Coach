# September 23 resumed sample-video evaluation

## September 25 handoff: deferred by the user

Motion recognition and feedback improvements are excluded from the current goal at the user's request. The completed changes and evaluation results below are preserved for later work; known recognition misses and false hooks remain unresolved. No additional model comparisons, threshold tuning or physical-camera accuracy acceptance should continue under this goal. The application retains CPU/Lite; the Full comparison completed and did not change the installed model. Existing recording/session stability remains in scope. Resume future recognition work from the saved pose dumps and `TEST_Zap12.mp4`, without treating these development examples as general accuracy validation.

## Verified resumption state

The imported checkout is at `db304fc`, initially clean. It contains the coach API UI, OpenAI Edge handler, ordered `202609230001_coach_service.sql`, redesigned round coach and translated UI. These supersede the older status in `phase-one-progress.md`. On this Windows host the existing staging environment file, model assets and .NET SDK 8.0.423 are present. No secret values were printed, no remote changes were performed and staging connectivity was not re-verified during this resumption.

Current tests: `test_coach_edge.mjs`, `test_coach_api_browser.js`, and `test_round_coach_browser.js` pass. They use mock provider/API data and do not prove live OpenAI service operation. The deployment gates in `AI_COACH_DEPLOYMENT.md` remain open.

Windows smoke project built with the local SDK and existing NuGet cache (`--no-restore`): zero warnings/errors. `dotnet run --no-build` passed DPAPI storage, local origin and hosted bridge policy smoke checks. This closes the other environment's SDK availability gap, not installed-device or packaging acceptance. `git diff --check` passed.

## Original inputs

| File | Dimensions | Frames | Timing | Duration | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `test.mp4` | 680 × 470 | 299 | constant 30 FPS | 9.9667 s | `da215b53428449c373df20984368569ed04ec4f117e800d9aa0e32bd1761a561` |
| `test_2.mp4` | 956 × 530 | 328 | constant 30 FPS | 10.9333 s | `74fd44a7159e3897a95afb75d1ae2a974b77c19e30926044e47f4a577e5884b3` |

`tools/inspect_motion_video.cjs` reads MP4 sample timing and creates timestamped browser-decoded contact sheets without modifying inputs. Overview sheets were inspected. Both clips contain turning and changing viewing direction. The first has a nearby person entering the edge and people reflected in mirrors; the second has mostly back/side views initially and a person at the right edge. Clothing, occlusion and motion blur limit individual punch/hand labels. Overview frames are not sufficient ground truth. The exploratory runs use the existing orthodox default, not a verified stance annotation.

## Unmodified recognition baseline

Chrome headless, MediaPipe Lite, CPU, current production pipeline/feature extractor/recognizer, real-time file playback. No other benchmark/build ran concurrently. These are file-processing measurements, not physical camera or recording latency.

| Clip | Presentation FPS | Analysis FPS | Inference median / p95 | Valid pose frames | Events |
| --- | --- | --- | --- | --- | --- |
| test | 29.70 | 10.07 | 71.4 / 85.2 ms | 39 / 101 | 0 |
| test_2 | 29.69 | 10.08 | 71.8 / 104.1 ms | 54 / 111 | 0 |

Artifacts: `artifacts/motion-evaluation/test-baseline.json`, `test2-baseline.json`. Original inference/recognition source was not modified.

Added optional feature-frame diagnostics, invalid-reason counts, capture timing and postprocessing timing to the existing evaluator. Repeat diagnostic runs:

- test: 34 / 102 valid, 67 `occluded_or_outside`, 1 `overlapping_hands`; inference p95 76.8 ms, capture p95 0.8 ms, postprocessing p95 0.2 ms.
- test_2: 53 / 112 valid, 58 `occluded_or_outside`, 1 `overlapping_hands`; inference p95 79.7 ms, capture p95 0.8 ms, postprocessing p95 0.1 ms.
- Exploratory GPU test_2: 13.17 analysis FPS, inference median/p95 52.1/58.7 ms, 73/145 valid, still zero events. One run does not establish portable GPU superiority; the default remains CPU.

The measured bottleneck is inference rather than image capture or score rendering in this harness. The frequent confidence/visibility rejection and recognizer resets need examination against continuous source frames before changing thresholds. Zero events is a failed baseline, not evidence that no punches occurred.

## Reproduction (from box/)

```powershell
node tools/inspect_motion_video.cjs ../test.mp4 artifacts/motion-evaluation/test-overview-new
node tools/predict_motion_video.cjs --video ../test.mp4 --output artifacts/motion-evaluation/test-baseline-new.json --clip-id test --stance orthodox
node tools/predict_motion_video.cjs --video ../test_2.mp4 --output artifacts/motion-evaluation/test2-diagnostics-new.json --clip-id test_2 --stance orthodox --diagnostics true
```

Output names must be new. Optional diagnostic feature coordinates stay in ignored local artifacts. Python OpenCV inspection failed because the existing NumPy binary extension is missing; that environment was left unchanged. Browser decoding provides an independent working path.

Next: inspect dense sequences, mark only unambiguous actions and uncertain intervals, collect reproducible per-frame evidence, then improve and evaluate recognition and latency under matched conditions. Do not claim accuracy improvement before labelled comparisons.

## Body coordinates and sparse-sampling correction

Diagnostic output now optionally stores pose frames, allowing `tools/replay_motion_poses.mjs` to run the production feature extractor/round logic on identical observations with a specified stride. It does not manufacture new inference latency measurements. `test2-pose-baseline.json` stores 113 frames, 58 valid. Visibility failures occur at arm joints (left/right elbows 24/30 frames; left/right wrists 38/35), not the nose/shoulder/hip joints in this sample.

Inspected a dense contact sheet for test_2 at 4–6 seconds. Straight-looking extensions are visible near 4.44 and 4.94 seconds, but exact anatomical hand/type/end boundaries remain unlabelled. The pose estimator often reports flexed arms/guard through visible extensions, so changing recognizer thresholds alone is insufficient evidence of correctness.

Two source corrections are implemented:

- Project shoulder-relative wrists into an orthonormal torso basis derived from shoulders and hips. Camera-axis depth previously treated sideways straight punches differently. Degenerate torso bases are rejected, and visibility/person-count checks are retained. Geometry tests verify translation and 45/90/180-degree yaw invariance for reliable landmarks. This does not prove invariance of MediaPipe's inferred landmarks.
- Include the last pre-extension observation when collecting a trajectory. Previously a fast movement with three post-guard observations at 10 FPS failed the four-sample requirement even though a preceding reliable guard observation existed. A 300 ms synthetic trajectory at 10 FPS now emits once; original ambiguity, tracking-loss, stance and combination tests still pass.

Feature, recognizer and round tests pass. Identical-frame replay still detects **zero** events in test_2, both stride 1 (113 observations) and stride 2 (57). These are structural fixes with synthetic regression evidence, **not** a demonstrated video-accuracy improvement. Continue with dense source-frame evaluation and model/tracking analysis; accuracy acceptance remains open.

## Subsequent changes and matched recognition evidence

The paragraphs above describe intermediate baselines. Current code additionally:

- Keeps a reliable visible arm when the other arm is occluded. Partial frames remain unreliable in round tracking totals; unknown opposite-hand guard is omitted from `guard_ratio` and coaching claims, with no unobserved guard credit added to experimental quality.
- Uses pixel-aspect-correct projected elbow extension followed by recovery as supplementary straight-punch evidence. Compact guard, extended peak and recovery have separate thresholds. Short projected segments, incomplete cycles, tracking loss and contradictory bent-arm classifications are rejected. It does not interpolate hidden joints or infer a missed peak.
- Uses torso extent to avoid rejecting a side view merely because the projected shoulders are close together. Both visible wrists overlapping still invalidates a frame, and person-count/confidence checks remain.

`--offline-fps 30` on the predictor seeks every source frame sequentially with source timestamps. This mode is deliberately slower than playback and its processing FPS is **not** live camera FPS. Optional raw pose diagnostics remain in ignored artifacts. `replay_motion_poses.mjs` accepts a baseline commit hash as its last argument and loads that commit's feature/recognizer code without changing the worktree.

Dense source-frame contact sheets were inspected for selected intervals. Tracked JSON annotations are in `docs/refoundation/evaluation/`. Test has a verified 0.5-second guard/footwork interval. Test_2 has one alternating straight-punch pair near 4.44/4.98 seconds, recovering around 5.08 seconds, plus a 0.5-second guard interval. Uncertain remaining intervals are excluded from scoring, not silently treated as negative examples. Both are **development** annotations that informed the code; stance/hand correctness outside the pair is not independently verified.

On identical recorded poses, baseline `db304fc` detects no events. Current code detects the selected test_2 pair as one `one_two` (4.350–5.050 s), with no guard ratio fabricated for its partially occluded component. In this single annotated example, TP/FN change from 0/1 to 1/0; precision/recall are 1/1 only for this tiny development window. This is not a meaningful overall accuracy estimate. Test's scored idle interval has no events before or after; its current detected hook outside that interval remains unverified and excluded. The evaluator now validates explicit scoring windows and reports excluded predictions.

Stride 2 and 3 replay (15/10 FPS) retain the first jab but lose the rear component, so combination recall is still 0 in those runs. Live file replay also varies with sampling phase: some runs detect the first jab, others miss the pair. Timing rules use milliseconds, but missing the actual extension peak cannot be repaired from timestamps alone. Do not claim FPS-independent recognition or completion of live accuracy acceptance.

After the recovery-order fix, all stride offsets were checked with the same stored test_2 poses. Stride 1 produces one one-two; stride 2 offset 0 produces a jab and offset 1 no events; stride 3 offset 0 produces a jab and offsets 1/2 no events. The rear projected extension is 158.27 degrees with reach 0.982 at 4,983.33 ms, versus 107.15/0.808 at 4,950 ms and 123.73/0.886 at 5,016.67 ms. Skipping the peak therefore removes the full-extension evidence rather than merely shifting a combination timeout. Threshold relaxation or interpolation is not justified by this observation. Real-time combination recall remains an open requirement.

Reproduce exact-observation comparisons from `box/` (choose new output names):

```powershell
node tools/predict_motion_video.cjs --video ../test_2.mp4 --output artifacts/motion-evaluation/dense-new.json --clip-id test_2 --stance orthodox --diagnostics true --offline-fps 30
node tools/replay_motion_poses.mjs artifacts/motion-evaluation/test2-offline30.json artifacts/motion-evaluation/before-new.json 1 640 355 db304fc
node tools/replay_motion_poses.mjs artifacts/motion-evaluation/test2-offline30.json artifacts/motion-evaluation/after-new.json 1 640 355
python tools/evaluate_motion.py --truth docs/refoundation/evaluation/test2-development.json --predictions artifacts/motion-evaluation/after-new.json --tolerance-ms 100
```

Width/height overrides are for older diagnostics that omitted inference dimensions. New diagnostics carry the actual resized dimensions. Files `test-matched-before/after`, `test2-matched-before/after`, and `test2-matched-stride2/3` preserve local comparison output.

## Scheduling, latency and camera constraints

The session uses decoded-video callbacks where supported, retaining animation callbacks for overlay drawing. The pipeline holds at most one unprocessed source reference; new arrivals replace it. Upon inference completion it captures the freshest source immediately, without queuing old bitmaps. Tests verify newest-timestamp selection, stale rejection, stop cleanup, and one-time opt-in GPU-to-CPU fallback.

CPU remains the asset-install default. `prepare_motion_assets.py --delegate AUTO` is an explicit experiment that tries GPU and falls back to CPU on failure; it is not the default because a generated-camera + recording run had only 74 displayed frames and zero inference results in 10 seconds during GPU preparation. CPU in the same application produced 300 frames, 103 results and active recording in 10 seconds. These generated-canvas runs do not establish physical-camera performance. Individual GPU file runs were faster, but that is insufficient to enable GPU globally.

Matched CPU dispatch comparison on test_2 using the current recognizer (same model, dimensions, source and real-time replay; separate sequential runs):

| Dispatch | Analysis FPS | Inference median / p95 | Frame age p95 | Result-to-next-animation p95 |
| --- | --- | --- | --- | --- |
| Drop while busy | 8.81 | 81.8 / 137.3 ms | 126.9 ms | 16.0 ms |
| Capture latest on completion | 10.63 | 82.0 / 135.9 ms | 136.9 ms | 15.5 ms |

Artifacts: `test2-drop-profile.json`, `test2-latest-profile.json`. Throughput increases about 21%, but frame age does **not** improve in these runs. Do not equate that throughput gain with lower visible latency. Other runs vary with host load. Both preserve about 29.7 presentation FPS and 60 animation callbacks/sec.

The latest-frame run's p95 components are bitmap capture 0.7 ms, worker canvas preprocessing 0.1 ms, inference 135.9 ms, result preparation 0.1 ms, remaining message/scheduling overhead 0.6 ms, and main-thread feature/score processing 0.3 ms. Percentiles are not additive. Frame age is video media-time difference at result receipt; next-animation delay is a rendering proxy, not physical screen paint. No sensor-to-display camera latency was measured. Inference dominates this file workload.

Python 117 tests and motion feature/recognizer/round/pipeline/skeleton tests pass. Full native fake-camera browser testing encountered `NotFoundError` during reopen on Chrome and Edge. A minimal page without application code reproduces disappearance of the fake video device after its first use, including after 300 ms delays. No speculative camera retry was added to product code. Physical camera reopen remains an acceptance gap.

The complete session browser flow passes with `BOXING_COACH_TEST_CAMERA_SOURCE=canvas`: recorded-video decoding and persistence, role views, start/end, write retries, duplicate-start rejection, denied camera access and PWA cache, with no console errors. This is a deterministic generated stream and does not validate camera hardware. The run exposed an MP4 encoder configuration-change error with `avc1`; recording now prefers supported `avc3.42E01E`, preserving existing fallbacks. Chromium's [MediaRecorder implementation](https://chromium.googlesource.com/chromium/src.git/+/d148613e7097346ca962d7e03943f65ae885df04/third_party/blink/renderer/modules/mediarecorder/media_recorder_handler.cc) recommends avc3 for in-band codec configuration changes. The passing run uses the normal full integration path, not the performance probe's early return.

The subsequent 10-second generated-stream probe with current CPU/latest scheduling and avc3 completes with 298 presented frames, 152 inference results and recording active (12,511 bytes); round persistence and result popup pass. Artifact: `session-cpu-latest-avc3.json`. This checks concurrent processing/recording liveness only: the generated scene has no human pose, and the separate full integration run above supplies recorded-video playback coverage. It is not a matched speed comparison against the earlier CPU probe.

## Longer delegate startup probe

Follow-up 40-second generated-stream probes distinguish slow GPU preparation from a persistent failure. `session_performance.cjs` now records each worker's readiness and warmup timing. The AUTO run used one worker without fallback and produced results after initialization; zero results in the earlier 10-second run did not prove a permanent failure.

| Delegate | Worker ready | Warmup | Inference median / p95 | Result latency p95 | Total results |
| --- | --- | --- | --- | --- | --- |
| AUTO | 15,080.2 ms | 13,518.1 ms | 41.0 / 66.5 ms | 77.6 ms | 504 |
| CPU | 749.8 ms | 311.5 ms | 52.1 / 81.6 ms | 104.1 ms | 619 |

Artifacts: `session-auto-startup-40s.json` and `session-cpu-startup-40s.json`. Actual elapsed probe times were 43.517 and 42.252 seconds respectively. Both kept recording active without reported errors. AUTO had lower steady-state inference time but a substantial startup delay and fewer total results. CPU remains the default. These sequential generated-scene measurements do not establish human-pose accuracy or sensor-to-display latency. A separate Chrome renderer inspection reported hardware Intel UHD through ANGLE; it does not prove the exact adapter used by each benchmark.

## Input size experiment

The offline tool accepts `--input-width` (128–1920, default 640) and records the effective width. Production remains at 640. Sequential real-time test_2 runs with CPU/latest dispatch and the same model produced:

| Width | Analysis FPS | Inference median / p95 | Frame age p95 | Events |
| --- | --- | --- | --- | --- |
| 320 | 11.62 | 78.0 / 132.0 ms | 132.4 ms | 0 |
| 640 | 11.61 | 78.8 / 128.3 ms | 127.5 ms | 1 |

Artifacts: `test2-width320-cpu.json`, `test2-width640-cpu-control.json`. Both processed 128 frames; capture p95 was 0.7 ms and worker preprocessing p95 0.1 ms. The smaller input did not demonstrate a latency or throughput benefit, so it was not adopted. Raw event counts do not establish accuracy and sampling phases differ between real-time runs. This experiment supports avoiding an unproven resolution reduction, not a general model-performance conclusion.

## Physical-camera acceptance in progress

On September 24, the user was given a local camera test using a separate database at `artifacts/camera-acceptance-20260924/test.db`. A read-only database inspection confirms a completed 28,395 ms round with four jab events and two one-two events, no hook or uppercut events, and 6,453 ms of tracking gaps. The stored form-quality value is 81; this is not recognition accuracy. An earlier 1,571 ms round has no events and unavailable tracking.

The user reports performing two jabs and four one-twos, with no visible stuttering. The stored four jabs and two one-twos therefore indicate two missed combinations in this trial. Event-by-event alignment and rear-hand observations were not captured, so the report alone cannot distinguish missed rear tracking from combination logic. Recorded-video playback and camera reopen still need confirmation. Existing member databases and original sample videos remain untouched.

A subsequent completed 27,903 ms record contains six jabs, two one-twos and three right hooks, with 3,998 ms of tracking gaps. The user confirms applying the update and performing two jabs and seven one-twos, without hooks. Thus five performed combinations were not recorded as one-twos and three hooks were falsely reported; event alignment still requires the recording. The earlier recovery-order fix is insufficient for live accuracy acceptance. The user was asked to download this local recording for reproducible diagnosis rather than repeatedly perform additional camera trials. No threshold changes based solely on aggregate counts are justified.

The downloaded `TEST_Zap12.mp4` is now available locally: 640 x 360, 27.920667 seconds, SHA-256 `90c056dbac0dd00c04b2b47efdb759a7baa976bfa19fed87643631f4bb64bc25`. Its fragmented MP4 has empty `stts` entries; the inspector now reports those timing fields as unknown rather than zero. A separate fragment inspection counted 830 samples across nine fragments in its sole track. Neither the inspector's missing FPS nor the chosen 30 Hz evaluation grid is evidence of exact constant source FPS.

Local sequential sampling at 30 Hz produces five jabs and four one-twos with no hooks (`live-zap12-offline30.json`, 838 samples, 766 valid poses). This differs from live capture and is not a matched before/after performance comparison. The 19.3–20.7 second contact sheet visibly confirms two straight extensions and recovery. Its rear world elbow estimate stays below 150 degrees while the projected angle briefly reaches 161.44 degrees at 20,116.67 ms, enabling the projected straight detector. At 7,250 ms the overlapping-hands rejection resets tracking; near 9.2 and 11.5 seconds projected elbow estimates also remain insufficient for the current straight rule. Sampling and pose geometry both need further investigation; the completed recovery-order fix alone is not a solution to the reported trial.

`predict_motion_video.cjs --model-file path` can serve a local comparison model without replacing installed assets or changing application configuration. The result records that file's SHA-256. A Full-model comparison was started on the same recording after downloading the versioned official [Google model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task), SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`. Model variants are documented in the [official Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker). No application model change or Full-model accuracy/performance improvement is claimed before comparison completes.

The Full comparison completed: three jabs, five one-twos and two hooks (`live-zap12-full-offline30.json`). Both runs use 838 samples and have 766 valid poses. Full detects the approximately 6.7–7.4 second pair missed by Lite, but introduces hook classifications around 8.65 and 10.88 seconds despite the user's no-hook report. CPU inference median/p95 was 124.1/135.5 ms for Lite and 111.5/144.1 ms for Full in these sequential runs; host load was not controlled and the slower-than-playback offline workflow does not establish real-time throughput. Full is not adopted merely for its larger raw combination count. Both pose dumps are available for further rule diagnosis without additional camera recordings.

Code inspection subsequently exposed a reproducible combination defect: a fully observed rear straight was discarded when its recovery completed before the lead straight's recovery. The recognizer now retains the completed rear candidate briefly and combines only when the lead began first and the existing combination interval is satisfied. The result spans both recoveries. Tracking invalidation, gaps and forced round finish clear the candidate; rear-first punches remain excluded. Frame-sequence tests reproduce the previous jab-only result and pass after the fix in both stances. Recognizer and round tests pass. Same-pose replay of both sample videos retains their prior event counts (`test-recovery-order.json`, `test2-recovery-order.json`). A fresh physical-camera trial is required before attributing the user's two misses to this defect or claiming improved live accuracy. Cache revision `2026-09-24-3` includes the fix.

## Staging resumption

Local staging credentials worked after the sandbox network boundary was explicitly escalated. Existing 19 migration hashes matched. The additive coach migration and `coach-chat` function are now deployed to the existing staging project, with counts unchanged and JWT protection enabled. Actual four-role login/config/usage checks pass. The user subsequently configured the server key and funded the account; real GPT-4.1 mini/GPT-5 mini Korean/English calls and the browser/local gateway flow pass. See `AI_COACH_DEPLOYMENT.md` for usage evidence and remaining deployment gates. This supersedes the initial no-remote-change status above.
