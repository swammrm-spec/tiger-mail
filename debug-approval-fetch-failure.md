# Debug Session: approval-fetch-failure

- Status: OPEN
- Started At: 2026-07-03
- Scope: Investigate `Failed to fetch` in the UI and why the approval-related email/message is not reaching employee `m.safadi@techno-grp.com`.

## Symptoms

- Frontend shows `Failed to fetch`.
- Approval flow still does not deliver the expected item/message to employee `m.safadi@techno-grp.com`.

## Constraints

- Steps 1-4: no business-logic modification.
- First logical code change must be instrumentation only.

## Initial Hypotheses

1. The frontend is pointed at a backend instance/port that is down or mismatched, causing `Failed to fetch` before the approval flow completes.
2. The backend route involved in approval/revision is throwing an exception for this user, and the frontend only surfaces it as a network failure.
3. The approval state changes in the database, but the employee mailbox/bootstrap query for `m.safadi@techno-grp.com` is filtering out the returned item.
4. The item expected by the employee is being stored in the wrong folder/status after manager action, so it never appears in the employee view even though the action succeeded.
5. The local device cache for the employee is stale or failing to refresh after manager action, making the UI look empty despite server-side data being present.

## Evidence Log

- Verified runtime environment:
  - `http://127.0.0.1:3001/api/health` returned `200`.
  - `http://127.0.0.1:5173/` and `http://127.0.0.1:5174/` were initially down, which explains the literal `Failed to fetch` symptom from the browser.
- Verified employee mailbox data on the real backend:
  - Direct `bootstrap` call for user `m.safadi@techno-grp.com` returned `emailCount=59`.
  - Returned data includes one rejected approval email in `Drafts` with `id=8`, `status=Rejected`, `approval_status=rejected`.
- Verified browser instrumentation after reopening the correct frontend:
  - `/api/bootstrap` repeatedly returned `200 OK`.
  - `loadBootstrap` succeeded for `m.safadi@techno-grp.com`.
  - The frontend was incorrectly calling `/api/admin/employees` for the employee account, receiving `403`.

## Hypothesis Status

1. Frontend/backend mismatch or stopped UI process: Confirmed.
2. Backend route failure during employee bootstrap: Rejected.
3. Employee mailbox filtering hides the returned item: Rejected for the tested rejected email; it is present in the real bootstrap payload.
4. Wrong folder/status after rejection: Rejected as primary root cause; the item is intentionally in `Drafts`, matching current workflow.
5. Stale UI / secondary frontend error obscures the correct mailbox state: Partially confirmed via the unnecessary `/api/admin/employees` 403 call.

## Fix Applied

- Frontend guard added so non-admin users no longer call `/api/admin/employees`.
- No business-logic change was made to approval storage/delivery yet.

## Next Actions

1. Verify active frontend/backend processes and ports.
2. Add runtime instrumentation only around approval action execution and bootstrap loading.
3. Reproduce the flow and collect logs.
4. Confirm or reject hypotheses with evidence before any fix.
