# Debug Session: connection-test-failed

Status: OPEN

## Symptom
- The UI shows `Connection test failed.`
- The failure happens while testing per-user mail settings.

## Goal
- Determine whether the failure is caused by credentials, server/encryption mismatch, network reachability, or wrong per-user settings resolution.

## Hypotheses
1. The current user's POP3 credentials are invalid.
2. The current user's SMTP host/port/encryption combination is invalid.
3. The server is not testing the saved settings for the expected user.
4. The target mail hosts are unreachable from the runtime environment.
5. Required fields are missing after merging user settings with defaults.

## Evidence Plan
- Add instrumentation around settings normalization and connection tests.
- Capture POP3 and SMTP outcomes separately.
- Record which user and which effective hosts/ports are being tested.
- Reproduce the connection test once and inspect the generated debug log.
