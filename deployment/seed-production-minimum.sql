\set ON_ERROR_STOP on

-- Minimal production seed for a fresh PostgreSQL deployment.
-- Run this after:
--   1) deployment/create-database.sql
--   2) deployment/app-schema.sql
--
-- Default initial admin login after running this file:
--   Email:    m.safadi@audit.techno-grp.com
--   Password: ChangeMeAdmin!234
--
-- Important:
-- - Change the admin password immediately after first login.
-- - Update app mail settings from the UI or SQL before using real POP3/IMAP/SMTP.

BEGIN;

INSERT INTO users (
  id,
  name,
  email,
  password_hash,
  role,
  avatar,
  can_manage_users,
  can_manage_reports,
  can_manage_projects,
  can_manage_tasks,
  can_manage_keys,
  can_manage_settings,
  can_view_analytics,
  can_manage_backups,
  can_manage_archives,
  can_manage_email_accounts,
  can_archive,
  is_active,
  created_at
)
VALUES (
  1,
  'M. Safadi',
  'm.safadi@audit.techno-grp.com',
  '$2b$10$HZ/E4Na1EKRseFMm.wEPSuCR.4nzu5iibXW1psyomexmKMqMF3rA6',
  'Admin',
  'MS',
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = 'Admin',
  avatar = EXCLUDED.avatar,
  can_manage_users = TRUE,
  can_manage_reports = TRUE,
  can_manage_projects = TRUE,
  can_manage_tasks = TRUE,
  can_manage_keys = TRUE,
  can_manage_settings = TRUE,
  can_view_analytics = TRUE,
  can_manage_backups = TRUE,
  can_manage_archives = TRUE,
  can_manage_email_accounts = TRUE,
  can_archive = TRUE,
  is_active = TRUE;

UPDATE users
SET
  role = 'Admin',
  avatar = COALESCE(NULLIF(avatar, ''), 'MS'),
  can_manage_users = TRUE,
  can_manage_reports = TRUE,
  can_manage_projects = TRUE,
  can_manage_tasks = TRUE,
  can_manage_keys = TRUE,
  can_manage_settings = TRUE,
  can_view_analytics = TRUE,
  can_manage_backups = TRUE,
  can_manage_archives = TRUE,
  can_manage_email_accounts = TRUE,
  can_archive = TRUE,
  is_active = TRUE
WHERE email = 'm.safadi@audit.techno-grp.com';

SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1), TRUE);

INSERT INTO folders (name, icon, unread_count)
VALUES
  ('Inbox', 'Inbox', 0),
  ('Sent', 'Send', 0),
  ('Outbox', 'Send', 0),
  ('Drafts', 'FilePenLine', 0),
  ('Deleted', 'Trash2', 0),
  ('Junk', 'ShieldAlert', 0),
  ('Spam', 'OctagonAlert', 0),
  ('Archive', 'Archive', 0),
  ('Uncategorized', 'Mail', 0)
ON CONFLICT (name) DO UPDATE
SET
  icon = EXCLUDED.icon,
  unread_count = EXCLUDED.unread_count;

INSERT INTO app_settings (
  id,
  company_name,
  logo_url,
  display_name,
  email_address,
  account_type,
  incoming_server,
  incoming_port,
  incoming_ssl,
  outgoing_server,
  outgoing_port,
  outgoing_encryption,
  smtp_auth_required,
  smtp_same_as_incoming,
  username,
  password,
  remember_password,
  require_spa,
  leave_copy_on_server,
  remove_after_days,
  remove_when_deleted,
  auto_send_receive_minutes,
  inbox_folder_name,
  sent_folder_name,
  sync_sent_items,
  graph_tenant_id,
  graph_client_id,
  graph_client_secret,
  graph_mailbox_user,
  default_priority,
  default_sensitivity,
  default_read_receipt,
  default_delivery_receipt,
  signature
)
VALUES (
  1,
  'TECHNO GROUP',
  '/logo.gif',
  'M. Safadi',
  'm.safadi@audit.techno-grp.com',
  'IMAP',
  'mail.example.com',
  993,
  TRUE,
  'smtp.example.com',
  465,
  'SSL/TLS',
  TRUE,
  TRUE,
  'm.safadi@audit.techno-grp.com',
  'CHANGE_ME_APP_PASSWORD',
  TRUE,
  FALSE,
  TRUE,
  14,
  FALSE,
  5,
  'Inbox',
  'Sent',
  TRUE,
  '',
  '',
  '',
  '',
  'Normal',
  'Normal',
  FALSE,
  FALSE,
  ''
)
ON CONFLICT (id) DO UPDATE
SET
  company_name = EXCLUDED.company_name,
  logo_url = EXCLUDED.logo_url,
  display_name = EXCLUDED.display_name,
  email_address = EXCLUDED.email_address,
  account_type = EXCLUDED.account_type,
  incoming_server = EXCLUDED.incoming_server,
  incoming_port = EXCLUDED.incoming_port,
  incoming_ssl = EXCLUDED.incoming_ssl,
  outgoing_server = EXCLUDED.outgoing_server,
  outgoing_port = EXCLUDED.outgoing_port,
  outgoing_encryption = EXCLUDED.outgoing_encryption,
  smtp_auth_required = EXCLUDED.smtp_auth_required,
  smtp_same_as_incoming = EXCLUDED.smtp_same_as_incoming,
  username = EXCLUDED.username,
  password = EXCLUDED.password,
  remember_password = EXCLUDED.remember_password,
  require_spa = EXCLUDED.require_spa,
  leave_copy_on_server = EXCLUDED.leave_copy_on_server,
  remove_after_days = EXCLUDED.remove_after_days,
  remove_when_deleted = EXCLUDED.remove_when_deleted,
  auto_send_receive_minutes = EXCLUDED.auto_send_receive_minutes,
  inbox_folder_name = EXCLUDED.inbox_folder_name,
  sent_folder_name = EXCLUDED.sent_folder_name,
  sync_sent_items = EXCLUDED.sync_sent_items,
  graph_tenant_id = EXCLUDED.graph_tenant_id,
  graph_client_id = EXCLUDED.graph_client_id,
  graph_client_secret = EXCLUDED.graph_client_secret,
  graph_mailbox_user = EXCLUDED.graph_mailbox_user,
  default_priority = EXCLUDED.default_priority,
  default_sensitivity = EXCLUDED.default_sensitivity,
  default_read_receipt = EXCLUDED.default_read_receipt,
  default_delivery_receipt = EXCLUDED.default_delivery_receipt,
  signature = EXCLUDED.signature;

COMMIT;
