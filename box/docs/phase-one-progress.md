# Phase one delivery

Final September 25 implementation audit and verification: `PHASE_ONE_CLOSEOUT.md`. The retained scope passes the listed local checks; production release prerequisites remain separate. Do not restart deferred motion/feedback work from historical entries below.

## Current scope — September 25 user revision

The user explicitly deferred feedback and motion recognition from this goal. Finish validation and documentation of already-made changes, preserve original videos and evaluation evidence, and stop further recognition tuning, model comparisons and camera accuracy trials. Motion accuracy, latency targets and coaching/score-policy improvements are no longer completion gates for this goal; they remain unfinished follow-up work. The CPU/Lite default is retained and Full-model experiments are not promoted.

Continue app stability, UI/layout cleanup, Korean/English coverage, central server/database integration, AI chatbot connectivity/model selection/usage, round-chat layout, and release preparation. Existing camera, recording and workout persistence remain stability requirements. The real chatbot feature remains in scope; motion-derived coaching feedback improvements are deferred. Production deployment and existing SQLite migration still require separate authorization.

Earlier entries below are historical. Assess completion using this scope revision and current implementation evidence.

## Resumption after the other account's work

Latest September 24 evidence: the funded GPT-4.1 mini and GPT-5 mini Edge calls and real browser/local gateway flow pass Korean/English response, model selection, exact token aggregation and UI recovery. Duplicate blocking and populated cross-center usage isolation also pass. Manual review led to fixing fractional round durations and defining tracking gaps, guard counts and form scores explicitly. Measured test usage is 5,704 tokens including one failed GPT-5 call, estimated USD 0.0058854 against the approved USD 1 budget; this is an estimate, not an invoice. Current function version is 6. See `AI_COACH_DEPLOYMENT.md` for details. Earlier funding/key/browser blockers below are historical. Physical-camera acceptance remains in progress against an isolated local test database.

The September 23 imported checkout (`db304fc`, clean at resumption) includes further language work, the coach Edge service/model selection/usage and the round-coach redesign. The chronological checklist below predates that import and is not authoritative for those features. Current revalidation and sample-video evidence are in `refoundation/14-sample-video-baseline.md`. Coach mock-provider, API UI and round-dialog browser tests pass on this host. Local staging settings and .NET SDK exist here; do not repeat the other environment's missing-file assumptions.

Staging now has the 20th coach migration and an ACTIVE, JWT-protected `coach-chat` function. Existing account/center/session counts are unchanged. Real synthetic-account login/configuration/usage checks pass for four roles and another center, including anonymous rejection. The OpenAI key is registered, GPT-4.1 mini is the default and GPT-5 mini is selectable. Following USD 1 test approval, the first request failed with unmeasured tokens; no automatic retry occurred. OpenAI billing shows USD 0.00 credit. Its minimum USD 5 initial purchase exceeds the approved amount and awaits the user's decision. No successful real response, measured charge or production deployment is claimed. Details: `AI_COACH_DEPLOYMENT.md`.

Motion changes include torso-relative geometry, independent visible-arm tracking, a projected extension/recovery check, decoded-frame scheduling and processing the newest available frame immediately after inference. Same-observation replay improves one visually annotated two-punch combination from missed to detected, but frame skipping and real-time sampling still lose its rear punch. This is one development example, not general accuracy validation. CPU remains the default: GPU file replay is faster but concurrent generated-camera/recording startup was unstable. Latest-frame scheduling improves observed throughput without a demonstrated reduction in frame-age p95. Native fake-camera reopen failures reproduce outside the application; generated-stream integration verification is being used separately. Goal completion remains unproven.

The full generated-stream session integration now passes, including MP4 playback/persistence, save retries and PWA checks. A discovered MP4 codec configuration-change failure was fixed by preferring supported avc3 encoding. A separate CPU/latest-frame 10-second concurrent processing/recording probe completes with 298 presentation frames and 152 inference results. These checks do not establish physical-camera latency or recognition accuracy. OpenAI login is complete; the user is being guided through server-key setup, with no secret values requested in chat.

The active objective is the September 23 stabilization and release preparation request. Existing uncommitted work predates this objective and must be preserved.

Coach follow-up audit found stale usage after failed requests. The round dialog now reloads server usage in both success and failure paths. `test_coach_api_browser.js` passes with a failed request increasing the displayed unmeasured count while retry IDs remain stable. OpenAI key creation is user-completed; the authenticated staging secret form is prepared and awaits the user's paste/save. No key value has been read or logged, and no paid model request has run.

Subsequent visual verification covers the connected mock-API dialog in English, both themes and 390/1366-pixel widths, including model selection, usage and accounting warnings. It exposed the dark question textarea's native gray styling; explicit theme colors and a visible focus outline now match the dialog. Inspected the corrected desktop dark screenshot and mobile light layout. The round-coach browser suite also passes both languages/themes/widths. This verifies rendering and mock behavior, not real provider connectivity. The key save mentioned in the earlier chronological note is now verified complete.

## Sequence and evidence

1. UI cleanup: implemented. Removed duplicate session shortcut and capture guidance, normal refresh controls and settings camera UI. Account filters now fetch the server so failed post-save reads remain recoverable. Member registration is at the right of the filter row. History icons and light surface borders updated. Full embedded visual review remains part of final UI verification.
2. Korean/English: in progress. Central `i18n.js`, persisted preference, document language, settings/navigation/roles, marked shell controls, member/dashboard/membership/payment/attendance/workout views, shared dialogs/pagination/status labels are connected. Added authentication, center/staff/account/platform screens and operation-shell action dialogs. Platform label maps translate at render time, preserving persisted codes and user data. Text/voice requests carry the selected language. Remaining: backend error dictionary coverage, runtime session/motion/PWA/bridge messages, coach result content, static login hero and final application-wide localization audit. Full-language coverage is not yet achieved.
3. Hosting/database: pending current-state audit. Verify central/local contracts, tenant authorization, origins, compatibility and deployment instructions. No production deployment or existing SQLite migration without approval.
4. AI service: pending. Real provider, server-managed models, usage accounting, authorization, timeouts and deduplication. Prior notes describe an unconnected coach interface; do not count it as a connected service.
5. Round coach design: pending. Render both themes/languages and responsive sizes.
6. Motion performance/accuracy: last. Root test.mp4 and test_2.mp4 exist. Inspect and annotate unambiguous actions, measure baseline using the production pipeline, improve and compare under identical conditions. Camera latency and file processing are distinct measurements.

## Completion gates

Preserve original videos and local databases. Do not infer completion from previous goal notes. Record commands/results and outstanding credentials or deployment approvals here. No commit, push or production changes are authorized.

## September 23 verification

- `node tests/test_operations_browser.js`: passed, including editing, save failure/retry, storage isolation, three roles, three widths and both themes. Inspected the generated owner member-list light screenshot. Subsequently aligned the register action to the bottom of the toolbar.
- `node tests/test_operations_live_browser.js`: passed against a disposable SQLite test server, including account reload through the existing query action.
- `git diff --check`: passed (existing CRLF conversion warnings only).
- Runtime: root `.tools/node-v22.20.0-win-x64/node.exe`, `BOXING_COACH_PYTHON` set to `box/.venv/Scripts/python.exe`; commands run from `box/`.
- Asked the user to select Gemini or OpenAI; do not ask for secret values in chat. No provider choice has been received yet.
- `node tests/test_language_browser.js`: passed twice, including preference persistence across reload, English/Korean navigation and settings, preservation of Korean user names, two widths and two themes. Inspected the English light settings screenshot. Static translation markers do not traverse or modify member data.
- `node tests/test_coach_conversation.mjs` and `node tests/test_coach_voice.mjs`: passed; conversation test now also checks English provider requests. Actual provider remains unconnected.
- Expanded `test_language_browser.js` passed: real disposable-DB member registration in English, member name `회원` preserved verbatim, English gender options, weekday labels and empty workout state. `test_operations_live_browser.js` passed after source-label conversion. Operation view strings are translated explicitly at source; user-entered names/notes/options are not passed through translation.
- Added `tools/audit_ui_language.cjs` using the pinned Playwright parser to inventory untranslated string literals/template fragments. Current operations views have none; commerce only retains the seven Korean weekday source labels, displayed through the central weekday formatter. This inventory alone is not proof of application-wide coverage.
- Expanded language browser test passed: English center-save via real disposable local API (Korean address preserved), account-create labels and platform status/feature labels with synthetic roles, English login/register after logout. Synthetic role checks validate display only, not authorization. Initial test assumed legacy OWNER had an accounts navigation item; corrected the test to explicitly use synthetic CENTER_OWNER for that UI check.
- Auth refresh concurrency/logout unit tests and live operations browser regression passed. API errors now pass through the translation catalog; unknown messages remain verbatim pending the backend error catalog audit.
- Next: finish Korean/English localization across remaining surfaces; then server/DB audit, real coach service, coach visual redesign, and only then sample-video motion baseline/improvements. Both test videos remain untouched.
