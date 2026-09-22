# Phase one delivery

The active objective is the September 23 stabilization and release preparation request. Existing uncommitted work predates this objective and must be preserved.

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
