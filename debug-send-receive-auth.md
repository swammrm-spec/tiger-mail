# Debug Session: send-receive-auth

- Status: OPEN
- Started At: 2026-07-03
- Scope: Investigate `[AUTH] Authentication failed.` when pressing `Send/Receive` for the correct account.

## Symptoms

- User logs into the correct mailbox account.
- When pressing `Send/Receive`, the UI shows `[AUTH] Authentication failed.`

## Constraints

- Steps 1-4: no business-logic modification.
- First logical code change must be instrumentation only.

## Initial Hypotheses

1. The stored POP3 or SMTP username/password for the current user is wrong or incomplete, so the remote server rejects authentication.
2. The app is loading the wrong persisted mail settings for this user, so `Send/Receive` authenticates with another account's credentials.
3. The receive route is using the correct user but the wrong host/port/TLS combination, and the remote library normalizes that into an auth failure.
4. The `Send/Receive` button calls a route that mixes send and receive, and one sub-step fails auth while the UI surfaces only a generic `[AUTH] Authentication failed.` message.
5. The current user has stale local settings in the browser or server persistence, so the runtime payload differs from what the settings screen shows.

## Evidence Log

- 2026-07-04: Resumed session after context loss.
- Confirmed current investigation target is `POST /api/settings/run-cycle` -> `runCycle(userId)` -> `processOutboxQueue()` / `receiveEmailsOnce()`.
- Confirmed no business-logic fix is applied yet for this session.
- Next evidence step: instrument config resolution and auth boundaries inside `server/mailService.js` before reproducing.
- Pre-fix reproduction via local script confirmed `runCycle(5)` fails with `[AUTH] Authentication failed.`.
- Pre-fix runtime log proved `requestedUserId: 5` had no resolved saved config, then `ensureActiveConfig` fell back to `configUserId: 1`.
- Pre-fix runtime log proved the actual POP3 auth failure happened under `ownerUserId: 1` / `m.safad@audit.techno-grp.com`, not under the employee account that pressed `Send/Receive`.
- Persisted state inspection showed only one explicit row under `user_mail_settings`, for `user_id = 1`, while the employee account had no complete stored mailbox credentials.
- Post-fix verification changed the result from misleading POP3 auth failure to a clear message: `Mail settings are not configured for this account. Open Settings and save this user's mailbox credentials first.`

## Root Cause

- `ensureActiveConfig(userId)` allowed a user-specific `Send/Receive` request to fall back to another user's active config.
- `runCycle(userId)` used a shared in-flight promise, so one user's request could inherit another user's active cycle and error.
- Because only the admin account had a complete saved mailbox config, the employee request was effectively running against the admin mailbox and surfacing that POP3 auth failure.

## Fix Applied

1. Prevented user-specific `ensureActiveConfig(userId)` from falling back to another user's active config.
2. Added validation so incomplete per-user settings return `null` instead of being treated as runnable.
3. Split cycle tracking into per-user in-flight state for user-triggered runs, while keeping a separate global path for all-user cycles.
4. Changed the user-facing failure from misleading `[AUTH] Authentication failed.` to a precise configuration error when the current account has no saved mailbox credentials.

## Next Actions

1. Inspect the `Send/Receive` route and mail auth flow.
2. Start a dedicated Debug Server for this session.
3. Add instrumentation only around settings resolution and remote auth attempt.
4. Reproduce `Send/Receive` and read logs before deciding any fix.
5. If evidence confirms the failing sub-step, apply the minimal fix only to that path and compare pre-fix vs post-fix logs.
