# Approval Workflow Architecture

## Overview

This project implements an Outlook-like email management system with a versioned approval workflow on top of the existing Node.js + Express + React architecture.

The workflow separates three concerns:

1. Mailbox and compose UX
2. Approval state machine and serialization
3. Delivery and auditability

## Backend Modules

- `server/index.js`
  - Express API routes
  - Authenticated endpoints for submit, approve, reject, resubmit, history, analytics
- `server/database.js`
  - PostgreSQL / `pg-mem` schema
  - Approval workflow persistence
  - Approval logs and audit serialization
  - Permission-aware workflow functions
- `server/mailService.js`
  - SMTP/POP3 connectivity
  - Direct delivery after manager approval
  - Outbox fallback if SMTP delivery fails

## Frontend Modules

- `src/App.jsx`
  - Outlook-like shell
  - Folder pane: `Inbox`, `Sent`, `Junk`, `Spam`, `Deleted`, `Drafts`
  - Message list and reading pane
  - Calendar view
  - Compose editor with attachments
  - Pending approval and rejected mail indicators

Recommended next frontend extraction:

- `src/features/mail/`
- `src/features/approvals/`
- `src/features/admin/`
- `src/features/settings/`
- `src/features/calendar/`

## Approval State Machine

```text
Draft
  -> Submitted
Pending Approval
  -> Approved
Approved
  -> Sent
Approved
  -> Queued (SMTP retry)
Pending Approval
  -> Rejected
Rejected
  -> Resubmitted
Resubmitted
  -> Pending Approval
```

## Core Rules

- Only the original employee can revise a rejected submission.
- Only the assigned manager can approve or reject a pending submission.
- Every resubmission creates a new version.
- Every version gets a new serial ID.
- Every action writes an immutable approval log row.
- Delivery after approval updates the same workflow record instead of creating a duplicate sent record.

## Serial Strategy

Format:

```text
[SubjectKey]-YYYYMMDD-REV[VersionNumber]
```

Examples:

```text
RENEWAL-20260703-REV01
RENEWAL-20260703-REV02
OPS-NOTICE-20260703-REV03
```

`SubjectKey` can be supplied by the user or derived from the subject line.

## Database Design

### Users

Important fields:

- `id`
- `name`
- `email`
- `role`
- `manager_id`
- `department`
- `can_manage_users`
- `can_manage_reports`
- `can_archive`

### Emails

Approval-related fields:

- `id`
- `serial`
- `subject`
- `body`
- `recipient_email`
- `employee_id`
- `submitted_by`
- `assigned_manager_id`
- `approval_status`
- `approval_root_id`
- `version_number`
- `subject_key`
- `manager_comments`
- `rejection_reason`
- `approval_requested_at`
- `approval_decision_at`
- `approved_by`
- `approved_at`
- `last_action_at`
- `needs_revision`
- `ai_sentiment`
- `ai_tone_score`
- `ai_recommendations`

### Approval Logs

Each action is stored in `approval_logs`:

- `approval_root_id`
- `email_id`
- `version_number`
- `serial_id`
- `action_type`
- `actor_user_id`
- `feedback_content`
- `snapshot_subject`
- `snapshot_body`
- `snapshot_recipient_email`
- `metadata`
- `created_at`

### Attachments

- Linked to the exact submitted version by `email_id`
- Preserved across approval review and final SMTP delivery

### Folders

Standard Outlook-like folders remain the mailbox container:

- `Inbox`
- `Sent`
- `Junk`
- `Spam`
- `Deleted`
- `Drafts`
- `Outbox`

## API Design

### Submit For Approval

`POST /api/mail/send`

If the employee has a direct manager:

- Stores the email as `Pending Approval`
- Creates version `REVxx`
- Runs draft analysis
- Returns manager notification payload

If the employee has no manager:

- Sends directly using SMTP

### Pending Approvals

`GET /api/approvals/pending`

- Returns only emails assigned to the current manager

### Approval History

`GET /api/approvals/:id/history`

- Returns the full serialized history of the workflow root

### Approve

`POST /api/approvals/:id/approve`

Body:

```json
{
  "manager_comments": "Looks good. Proceed."
}
```

Behavior:

- Validates manager ownership
- Writes `Approved` log
- Sends using SMTP
- Marks the same version as `Sent`
- Falls back to `Outbox` if SMTP fails

### Reject

`POST /api/approvals/:id/reject`

Body:

```json
{
  "reason": "Please clarify pricing and add the contract number."
}
```

Behavior:

- Validates manager ownership
- Saves manager comments on the rejected version
- Writes `Rejected` log
- Leaves the rejected version visible for revision

### Resubmit Revision

`POST /api/approvals/:id/resubmit`

Behavior:

- Only the original employee can call it
- Creates a brand new pending version
- Increments `version_number`
- Generates a new serial
- Preserves manager comments for smart draft guidance

### Approval Analytics

`GET /api/admin/approval-analytics`

Provides:

- average approval time per employee
- rejection rates
- common rejection feedback trends

## Smart Drafts

Current implementation stores:

- `manager_comments`
- `rejection_reason`
- `ai_recommendations`

Recommended frontend behavior:

- render manager comments above the editor
- highlight rejected sections using inline callouts
- show AI recommendations before submit

## AI Integration Hook

Current backend includes a lightweight draft analysis step that produces:

- sentiment
- tone score
- recommendations

Recommended production adapter:

- `server/integrations/aiDraftAdvisor.js`
- input: `subject`, `body`, `recipient`, `cc`, `attachments`
- output:
  - professionalism score
  - tone label
  - rewrite suggestions
  - compliance warnings

## Telegram Hook

Recommended integration point:

- trigger on `Submitted`
- payload includes:
  - serial
  - subject
  - employee
  - preview
  - approve URL
  - reject URL

Recommended module:

- `server/integrations/telegramApprovalBot.js`

## Recommended Next Steps

1. Add frontend approval history panel and revision editor banner.
2. Add a dedicated `Pending Approval` folder/filter in the Outlook UI.
3. Add manager notification delivery adapters for Telegram and email.
4. Move the lightweight AI draft analyzer to a dedicated integration module.
5. Add automated tests for:
   - submit -> reject -> resubmit -> approve
   - manager permission enforcement
   - employee-only revision enforcement
   - serial version sequencing
