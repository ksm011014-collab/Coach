# AI coach deployment and verification

Implementation uses the OpenAI Responses API (`POST /v1/responses`, `store:false`, no automatic provider retries). Reference: https://developers.openai.com/api/reference/python/resources/responses/methods/create . Provider output is read from assistant `output_text` items; reported `usage.input_tokens`, `output_tokens`, and `total_tokens` are recorded separately from reply success. Missing measurements remain NULL. No cost estimate is displayed.

## Existing staging and release gates

The existing `boxingcoach-staging` dashboard was verified Healthy on September 23, with `motion_tracking_evidence` shown as its latest migration. Do not create a replacement project. The current checkout does not contain the ignored `.env.staging.local` or `artifacts/staging-smoke-accounts.json`; previous integration evidence is documented in `refoundation/06-operations-integration.md`. The dashboard check does not validate the new AI implementation against the remote service.

The new migration, Edge Function and web changes have only been tested locally with synthetic identities and a mock provider. No paid provider request, remote migration, production deployment or SQLite migration was performed for this change.

## Server setup

1. Restore a local ignored staging settings file with the public URL, publishable key, auth email domain and data mode described in `.env.example`. Keep any management token in local operator settings only. Never put service keys or OpenAI keys in WPF settings, web assets or environment examples.
2. Inspect staging: `python tools/staging_migrations.py --settings .env.staging.local`. Review existing records/backups before applying anything. Then apply the new ordered migration to **staging**, using `--apply` only for that explicit staging update. Never rewrite applied migrations.
3. Deploy `supabase/functions/coach-chat` with JWT verification enabled using Supabase CLI (`supabase functions deploy coach-chat --project-ref PROJECT_REF`). Its shared summary module is `web/scripts/coach-summary.mjs`; deploy from this repository so the relative module is included. Keep existing `admin-create-user` and `register-member` functions. Use staging project references, not production.
4. Set `OPENAI_API_KEY` only in the Edge Function secret manager. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must be available there as server secrets. An absent key disables chat; it does not fabricate answers.
5. An authenticated active `PLATFORM_ADMIN` invokes `platform_set_coach_model(p_model_id,p_display_name,p_enabled,p_default)` for each allowed Responses-compatible model. Use the exact IDs available to your OpenAI project. Set one enabled default. The RPC records a configuration audit entry. There is deliberately no automatically enabled model or default paid request.
6. Start the existing hosted Python gateway behind HTTPS as in `DEPLOYMENT_RUNBOOK.md`. Verify `/api/coach/models`, `/api/coach/usage`, then one explicitly authorized synthetic completed round request to `/api/coach/reply`. Verify both selected languages, actual usage, duplicate rejection and different-center denial. This real provider test may incur OpenAI charges and has not been run here.

## Authorization and accounting

- Members can chat only about their own completed rounds. Center owners and coaches can chat about completed rounds in their center. Platform administrators can configure allowed models and read usage across the platform but cannot use platform privileges to chat about member training records.
- All model choices are checked again in the DB. Summaries are reconstructed from the saved session, never the client-supplied score or measurements. Only the summary, question and at most 20 prior messages reach OpenAI. User names, member/center/session IDs, video and raw pose coordinates are excluded from the provider input. Chat text remains in browser memory and is not stored in usage tables.
- The current UTC calendar month through the query timestamp is shown. Members see their own requests; owners/coaches see their center; platform administrators see all centers. Token totals include only reported values; unmeasured request counts are displayed alongside them. These are application request totals, not an OpenAI invoice or whole-account billing report.
- DB reservations serialize across Edge instances. Limits are 6 requests/minute and 60/rolling 24 hours per actor, and 1,000/rolling 24 hours per center. Failed and uncertain attempts count toward limits. Model output is capped at 800 tokens, questions at 2,000 characters, request bodies at 32 KB. Requests exceeding limits are refused before calling OpenAI.
- A 15-second upstream timeout sits below the 20-second gateway/client timeout. A matching request ID never sends twice, even after timeout. A changed payload with the same ID is rejected. An uncertain reservation stays pending/unknown; it is not treated as zero usage. A disconnected browser cannot cancel an already accepted upstream charge.
- Usage writes require the server-only service identity. Client accounts, including platform administrators, cannot forge reported token counts. Reply delivery can succeed while usage persistence fails; the UI explicitly warns about that case. Reconcile pending/unknown entries against provider logs before reporting complete billing coverage; do not automatically replay them.

## Recovery and compatibility

Disable a model through the guarded platform RPC to prevent new requests. Remove/revoke the OpenAI server secret to disable the provider. Keep usage records and reservations for accounting; do not delete them to retry uncertain charges. Preserve the last verified web artifact for rollback. The database migration adds tables/functions without rewriting existing training records or local SQLite. Hosted web updates do not require reinstalling the Windows shell for this feature. The existing restricted bridge and local camera pipeline are unchanged.

Local-only mode continues training, recording and saved-round summaries. Cloud AI is unavailable there until central authentication is connected; local tokens are never accepted as central credentials. Real audio services remain unconnected and their controls stay disabled.

## Local evidence

`node tests/test_coach_edge.mjs`: authoritative saved data, both languages, usage NULL vs measured, authorization errors, rate limits, duplicate suppression, timeout and usage-write failure with a mock provider.

`node tests/rls/test_policies.mjs`: migrations applied to memory PostgreSQL; allowed/denied session access, model configuration privileges, cross-center usage RLS, disabled accounts, rate limits and denied usage forgery. This does not replace GoTrue/PostgREST/Edge staging verification.

`node tests/test_coach_api_browser.js`: server-provided model options, language, unknown usage, stable retry IDs and accounting warnings. `test_round_coach_browser.js` renders both languages/themes at 390 and 1366 pixels.
