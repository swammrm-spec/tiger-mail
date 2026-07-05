# [OPEN] Debug Session: login-not-working

## Summary
- Symptom: user reports the app is "not working" and has previously seen `Not found` and `ERR_CONNECTION_REFUSED` while trying to access the local Outlook-style web app.
- Goal: determine whether the failure is caused by frontend availability, backend availability, stale processes, proxy mismatch, or browser/runtime environment issues.

## Hypotheses
1. The frontend dev server is not staying alive, so the browser intermittently hits a closed port.
2. The browser is opening the wrong port (`5173` instead of the active Vite port), causing connection refusal.
3. A stale backend process on `3001` is serving an older API surface, causing login requests to fail.
4. The frontend is running, but Vite proxying to `/api` is failing because the backend process is restarting or unreachable.
5. A local browser/network condition is blocking `localhost` access even though the Node processes are healthy.

## Evidence Log
- `3001` is listening via `node` PID `18876`, started at `11:15:39 PM`.
- `5174` is listening via `node` PID `29200`, started at `11:15:00 PM`.
- `5173` is down.
- `GET http://localhost:3001/api/health` returned `200` with `{"status":"ok","databaseMode":"pg-mem"}`.
- `GET http://localhost:5174/` returned `200`.
- `POST http://localhost:3001/api/auth/login` with admin seed credentials returned `200` and a valid JWT payload.

## Hypothesis Status
- H1 Frontend dev server is down: rejected by `GET http://localhost:5174/ = 200`.
- H2 Browser is opening the wrong port: currently most likely, because `5173` is down and `5174` is healthy.
- H3 Stale backend on `3001`: rejected for the current moment, because login route and health route both respond correctly.
- H4 Vite proxy/backend instability: not supported by current evidence; direct frontend and backend checks are healthy.
- H5 Local browser/network issue: still possible if the user continues seeing refusal while the machine-local checks stay green.

## Operational Adjustment
- Stopped the frontend process on `5174`.
- Restarted Vite explicitly on `5173` with `--strictPort`.
- Verified `GET http://localhost:5173/ = 200`.
- Verified `POST http://localhost:3001/api/auth/login = 200`.

## Current Best Explanation
- The most likely root cause is port confusion between `5173` and `5174`, not broken application logic.

## Next Actions
- Inspect listening ports and owning processes.
- Verify direct responses from frontend and backend endpoints.
- Compare browser target URL with currently active dev server URL.
- Only after evidence is collected, apply the minimal fix.
