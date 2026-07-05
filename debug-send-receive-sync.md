# Debug Session: send-receive-sync

- Status: OPEN
- Started At: 2026-07-04
- Scope: Investigate why `Send/Receive` runs but does not synchronize incoming emails into the mailbox UI.

## Symptoms

- User presses `Send/Receive`.
- The action appears to run.
- Inbox does not get synchronized with expected emails.

## Constraints

- Steps 1-4: no business-logic modification.
- First logical code change must be instrumentation only.

## Initial Hypotheses

1. `runCycle(userId)` completes, but `receiveEmailsOnce()` returns `received: 0` because the current account has no valid POP3 messages or authentication context.
2. POP3 retrieval succeeds, but imported emails are stored under another `employee_id`, so they do not appear in the signed-in user's Inbox.
3. POP3 retrieval is skipped because the resolved config for the current user is incomplete or not the active config used at runtime.
4. Messages are imported, but the UI bootstrap/filter path does not reload or scope them correctly after `Send/Receive`.
5. The server deletes or skips messages during UIDL duplicate handling, so sync runs without visible new Inbox items.

## Evidence Log

- Pending

## Next Actions

1. Reproduce the sync path on the current backend.
2. Inspect current `mailService` receive path and inbox ownership mapping.
3. Add instrumentation only around config resolution, POP3 UIDL/retrieve, and `createEmail` ownership.
4. Compare pre-fix logs before deciding any fix.
