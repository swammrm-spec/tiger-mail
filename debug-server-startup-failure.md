[OPEN] Debug Session: server-startup-failure

## Symptom
- Backend server exits immediately when started from the agent environment, and terminal output is empty or truncated.

## Expected
- `server/index.js` should keep running and expose `http://localhost:3001`.

## Constraints
- No business logic changes before runtime evidence is collected.
- First code change in the codebase must be instrumentation only.

## Hypotheses
- H1: Startup fails before `app.listen()` because `initializeDatabase()` throws.
- H2: Startup fails while loading persisted settings and calling `applyMailSettings(settings)`.
- H3: The Node process launches, but stderr/stdout is being suppressed by the current execution wrapper, hiding the actual exception.
- H4: A required runtime dependency or environment path is missing in this shell session, causing an early process exit during module initialization.
- H5: Port binding or another OS-level startup constraint causes the process to exit before the ready log is emitted.

## Evidence Log
- Added instrumentation-only tracing to `server/index.js` that should write `.dbg/server-startup-failure-local.ndjson` as soon as Node loads the module.
- Ran `node server/index.js` from the agent environment: process exited with code `1`, produced no terminal output, and did not create the instrumentation file.
- Ran `node -e "require('fs').writeFileSync('.dbg/node-probe.txt','node-ok')"`: process exited with code `1` and did not create the file.
- Ran a direct PowerShell file-write probe using `Set-Content`: process exited with code `1` and did not create the file.
- Attempted to start the Python-based Debug Server: process exited with code `1` and did not generate `.dbg/server-startup-failure.env`.
- User verified that opening `http://localhost:3001/api/health` returns connection refused.
- User verified that the browser console on `http://localhost:5173/` shows no obvious frontend errors.

## Evidence-Based Hypothesis Status
- H1: Unconfirmed. No runtime evidence reached the application entry path.
- H2: Unconfirmed. No runtime evidence reached settings loading or mail-service application.
- H3: Partially supported. Terminal output is unavailable, but stronger evidence points to command execution failing before app code can run.
- H4: Supported. The shell/runtime execution layer in the agent environment appears unable to execute even trivial `node` and PowerShell file-write probes.
- H5: Rejected for now. A port issue would not explain failure of trivial file-write probes unrelated to socket binding.
- Additional conclusion: the frontend symptom is secondary; the confirmed user-facing failure is that the backend on port `3001` is not running.

## Next Step
- Decide between:
- collecting evidence from a user-run local terminal outside the agent sandbox, or
- pausing runtime debugging in the agent environment and continuing with static hardening only.
