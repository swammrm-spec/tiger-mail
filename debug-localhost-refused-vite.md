# Debug Session: localhost-refused-vite

- Status: OPEN
- Started At: 2026-07-04
- Scope: Investigate `ERR_CONNECTION_REFUSED` on localhost where the browser cannot reach the app UI.

## Symptoms

- Browser shows `This site can't be reached`.
- `localhost refused to connect`.
- Error code is `ERR_CONNECTION_REFUSED`.

## Constraints

- Steps 1-4: no business-logic modification.
- First logical code change must be instrumentation only if code changes become necessary.

## Initial Hypotheses

1. The backend API is running, but the frontend Vite server on `5173` is not running.
2. The frontend is running on another port, while the browser is still opening the wrong localhost port.
3. A stale or crashed process previously occupied the frontend port and exited before the browser request.
4. The Vite frontend process is failing during startup before it binds to the port.
5. The app is healthy on the API port only, so opening the UI URL results in connection refused.

## Evidence Log

- Initial port probe: `3001` is listening.
- Initial port probe: `5173` is not listening.
- Initial port probe: `4173` is not listening.

## Next Actions

1. Inspect prior localhost debug notes.
2. Start the frontend process explicitly.
3. Verify which localhost URL becomes available.
4. Only add instrumentation if the frontend process fails during startup.
