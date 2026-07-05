# Debug Session: localhost-refused

Status: OPEN

## Symptom
- Browser shows `This site can't be reached`
- `localhost refused to connect`
- Error code: `ERR_CONNECTION_REFUSED`

## Goal
- Determine which local service is failing to bind.
- Collect runtime evidence for frontend/backend startup.
- Apply the minimal fix required to restore local access.

## Hypotheses
1. Frontend dev server is not running on the expected port.
2. Backend API is not running, and the frontend depends on it for boot.
3. Startup fails because of missing dependencies or invalid module resolution.
4. Port conflicts or stale processes are causing the services to crash or bind elsewhere.
5. The user is opening the wrong localhost port relative to the currently running service.

## Evidence Plan
- Inspect current startup scripts and config.
- Add startup instrumentation only.
- Reproduce backend/frontend startup once each.
- Compare requested ports with actual bound ports.
