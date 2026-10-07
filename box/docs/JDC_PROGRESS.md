# JDC progress and acceptance — 2026-09-25

The attached JDC goal remains active. Preserve existing data, recordings, user changes and internal IDs. Do not tune motion recognition or create separate preview/SQLite/test applications.

## Current release

Latest delivery 0.4.5.0 (explicitly requested): readable text/HTML workout exports remove raw JSON and internal IDs, format duration as minutes/seconds and separate result/feedback/conversation sections; original stored data/chat text is untouched. Workspace titles now sit directly on the page background without the outer panel; embedded wrapper borders are removed while attendance and center-detail cards remain. AI hologram uses slightly larger SVG orbital paths with slowly orbiting satellites, split rear/front layers occluded by the shaded sphere; measured voice energy scales only the central sphere. Existing Python 120 tests plus export/voice/auth tests passed. Packaged six changed UI source files byte-match source; ZIP integrity verified and shortcut refreshed. No database change needed. Running 0.4.4 was left intact; live visual/hardware acceptance of 0.4.5 has not been claimed.

Latest delivery 0.4.4.0: user explicitly selected creation of an executable containing the latest edits (not hosted-mode conversion). Built/exported connected executable and ZIP and refreshed release/BoxingCoach.lnk. Re-ran auth/animation lifecycle tests; embedded login-intro.js, auth-shell.js, styles.css and service-worker.js byte-match current sources. ZIP integrity verified. Includes continuous login background and successful-login three-second tunnel transition. No remote schema change was needed for this release; physical/visual acceptance remains distinct from packaging checks.

Source-only change after 0.4.3: login tunnel now loops for the entire logged-out screen. Successful explicit login waits until account data is loaded, then fades/inerts the intro and form and accelerates/zooms the tunnel for 3 seconds before rendering the app. Failed login does not start this transition. Logout/cancellation releases the canvas and resolves pending transitions; reduced-motion uses a static background and immediate navigation. Existing auth tests verify looping beyond 5 seconds, 3000ms completion, duplicate-call coalescing, cancellation and reduced motion; syntax/diff checks passed. No new executable or ZIP was generated for this change, and native visual acceptance remains pending.

Latest delivery: user explicitly requested a file containing the latest edits. Built and exported connected 0.4.3.0 executable/folder and ZIP; refreshed release/BoxingCoach.lnk. Packaged worker archive contents were byte-compared with the source login animation, round coach, accounts, operations adapter and round styles. Staff-notes migration 24 applied to existing staging with accounts 8, centers 4 and sessions 4 unchanged across application; admin-create-user and coach-chat deployed successfully (coach version 8). Authenticated staging configuration/usage scopes and transcript permissions passed without paid calls. The prior review-limit blocker did not recur for this delivery. Physical hardware/UI acceptance is still pending; existing running 0.4.2 was not closed. The historical pending notes below describe earlier checkpoints and are superseded by this delivery entry.

### Latest user-requested source changes (not packaged)

The user now requires explicit release-generation requests: do not build executables, increment release versions or update shortcuts during routine edits. This overrides the earlier automatic packaging workflow and is recorded in AGENTS.md.

- Login shows one five-second teal perspective tunnel with fade in/out; reduced-motion skips it and login remains interactive. Canvas resources stop after five seconds or sign-in.
- Dashboard center details remain the bottom section with extra separation, including internal navigation. Staff now follows the member table in the same view; standalone staff navigation is removed. Staff registration uses an accessible modal and management buttons align right. Existing account fields remain; remarks are added.
- Member row includes Start session between registration date and management. It selects the matching profile, opens the existing exercise screen and starts through the existing authenticated session API. Existing camera settings must be available. No separate physical database per member: the shared central database associates every workout with the selected member ID and center, enforced by RLS. Owner-selected ownership and cross-center denial have dedicated existing-suite assertions.
- Round dialog is wider (up to 1320px), with a larger hologram. Native playback supplies measured audio energy for scaling/brightness. Speech preparation/transcription has a visible spinner and status. Recognized speech automatically submits once after recognition (overrides prior review-before-send requirement); text remains if the request fails. Listen/stop share one stateful button; the Windows voice-settings fieldset is removed.
- New migration 202609250004_staff_notes.sql adds protected staff remarks and atomic account-access/remark updates. Only active platform administrators or own-center owners can read/manage remarks; direct client writes are denied. Note-only edits preserve login tokens and audit metadata excludes note content. Staff account creation reports partial remark-save failure without inviting duplicate account creation.
- Deploy the migration before the updated gateway/admin-create-user function. These remote changes have NOT been applied; existing 0.4.2 release is unchanged. The earlier approval-review usage blocker still applies to elevated remote/live-app actions. No new executable, preview app or test file was generated.
- Validation: Python 120 passed; PostgreSQL role/session isolation passed with staff-note allowed/denied/read-only/size/token-preservation cases, plus existing voice, auth, conversation, session-media/finish suites. Embedded staff rendering preserves member content. Audio analyser tests cover measured levels and cleanup. Visual/native-hardware acceptance of these source changes remains pending.

- Connected 0.4.2.0 executable and ZIP built successfully; export script refreshed release/BoxingCoach.lnk.
- Last observed running app is 0.4.1.0 with loopback CDP 19223. Inspect processes before switching. User confirmed closing their earlier 0.3.3 app.
- Latest 0.4.2 changes: dashboard width, mobile signup text, concise initial feedback with expandable observations, distinct chat bubbles, recording save retry, camera disconnect cleanup and persistent local-origin port. These latest changes still need packaged acceptance.
- Existing Supabase settings retained. Never print settings, credentials or account fixtures. No public distribution/signing/production deployment performed.

## Implemented

JDC branding, dashboard center details with existing permissions, split email/domain and birthday validation, phone formatting, Korean/English UI, local 24-hour dates and inline recording actions. In-app playback distinguishes skeleton recordings from historical raw footage. A failed save retains its blob for retry.

Bounded canvas recording burns the skeleton associated with each camera snapshot into the video, preserving mirror/aspect ratio and existing recognition rules. HTML and BOM UTF-8 exports include real results and persisted session conversations, missing-data notices and HTML escaping. Transcript failure does not block result export.

Migration 202609250003_coach_transcripts.sql is applied to existing staging. Service-only writes derive session/tenant from reserved request; active role and session access guard reads. Platform administration does not grant transcript access. Edge conversation and real usage persistence work. The LAST stricter prompt edit forbidding landed/successful punch claims from detection counts is NOT deployed.

Local whisper.cpp STT and native System.Speech TTS are connected. Review-before-send, selected ko/en language, saved voice controls, cancellation and navigation cleanup are implemented. Expired Supabase JWT 403 now permits refresh while actual forbidden responses stay forbidden; connected 0.4.1 restored auto-login.

## Evidence

- artifacts/jdc-voice-validation/packaged-stt.json: actual 0.4.1 WebView2 -> authenticated packaged worker -> whisper.cpp returned status 200 for Korean and English synthetic Windows speech, about 5.0/2.9 seconds. Korean: 오늘 운동은 즐거웠어요. 다음 라운드를 준비할게요. English: I enjoyed the workout today. I am ready for the next round. This is NOT physical microphone acceptance.
- windows-native-speech.json in that directory: native bridge ko-KR/en-US WAV synthesis and browser audio decoding. Audible speaker acceptance remains open.
- composited-video.webm/json and composited-frame.png: original user video input in actual app; 155 skeleton frames, 2,100,497 bytes, approximately 60 FPS display, FFmpeg decode passed. This is NOT physical-camera acceptance or a broad performance guarantee. Original unchanged.
- Same directory: Korean/English signup, dashboard and records screenshots. 390px signup had no document overflow. Latest layout improvements need rechecking.
- artifacts/jdc-coach-acceptance-20260925.jsonl: two real staging Korean/English model replies, exact transcript readback, 934 actual tokens and duplicate rejection. Response wording motivated the pending stricter prompt.
- Staging migration preserved original counts: 8 accounts, 4 centers, 5 sessions. Existing staging smoke and PGlite verify transcript role/tenant isolation, platform denial, inactive accounts, read-only access and idempotency.
- Latest full Python suite: 119 tests passed. Existing JS auth, voice, conversation/export, Edge mock, desktop, session and skeleton checks passed; full PostgreSQL role/session isolation suite passed again. Latest media test verifies save failure retains blob, retry saves identical bytes, absent session denies retry.
- 0.4.0/0.4.1/0.4.2 packaging succeeded. Existing optional NumPy PyInstaller hook warning remains. No new test executable. git diff --check passed with CRLF normalization warnings.

## Free voice conditions

TTS uses installed Windows System.Speech voices, no paid API. Korean and English voices were found here; missing languages require Windows language/speech installation. Synthesis is local after installation. Paid text chatbot usage is separate.

STT uses whisper.cpp v1.8.7 and pinned multilingual base model (about 148 MB). tools/prepare_speech_assets.py records sources/checksums; MIT engine/model license copies accompany vendor/speech and packaged worker/speech. No paid transcription API. UI records at most 20 seconds; worker bounds at 30.5 seconds, serialized CPU inference. Silence/timeouts preserve text input. Latency/accuracy depend on CPU/noise.

## Remaining work and blocker

1. Automatic approval review rejected the latest elevated deployment invocation because its usage limit was reached (reported retry after 10:11 PM), explicitly review failure rather than an unsafe-action decision. Do not bypass review. That invocation did not run; the subsequent same-call command to preserve current local-origin port also did not run.
2. Once review is available, preserve the current WebView2 port in the new local-origin-port.txt if absent, then close the verified app and launch 0.4.2 for acceptance. New code keeps future origins stable; historical random-origin recordings remain untouched but automatic recovery across historical origins is not implemented. Determine whether recordings require recovery.
3. Deploy stricter Edge prompt to already-approved existing staging. Use project .venv/Scripts/python.exe; elevated bare python resolved to a nonworking alias. Do not recreate services/credentials.
4. Verify latest light/dark/mobile UI, report/text downloads, playback/MP4 download, settings/recordings across restart and final shortcut. Actual 0.4.2 not yet launched.
5. Ask user for physical camera round and Korean/English microphone plus audible feedback. Confirm review/edit/send, cancellation, no echo/late playback and full workout -> feedback -> conversation -> exports. Do not claim unverified hardware success.
6. Recheck signup/staff/platform non-destructively in final connected release. End with normal launch without CDP. Goal completes only after every original requirement has evidence.

User input pending: an asynchronous question asks the user to close the current test app, open release/BoxingCoach.lnk, and report physical Korean/English microphone and audible feedback results. This was requested because automatic review prevents agent-driven app replacement; do not assume any user action or hardware success until a reply arrives.

After 0.4.2 packaging, report export source was improved to include readable Korean/English feedback derived from saved observations alongside raw feedback JSON. Existing conversation/export tests cover both languages and missing observations. This source change requires the next release build; it is not in the existing 0.4.2 ZIP. At 19:01 KST the last observed app remained 0.4.1, and no physical-hardware user reply had arrived. The review limit had stated recovery after 22:11, so no immediate rejected-action retry was attempted.
