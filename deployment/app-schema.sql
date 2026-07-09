\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  avatar TEXT,
  can_manage_users BOOLEAN DEFAULT FALSE,
  can_manage_reports BOOLEAN DEFAULT FALSE,
  can_manage_projects BOOLEAN DEFAULT FALSE,
  can_manage_tasks BOOLEAN DEFAULT FALSE,
  can_manage_keys BOOLEAN DEFAULT FALSE,
  can_manage_settings BOOLEAN DEFAULT FALSE,
  can_view_analytics BOOLEAN DEFAULT FALSE,
  can_manage_backups BOOLEAN DEFAULT FALSE,
  can_manage_archives BOOLEAN DEFAULT FALSE,
  can_manage_email_accounts BOOLEAN DEFAULT FALSE,
  can_archive BOOLEAN DEFAULT TRUE,
  manager_id INTEGER REFERENCES users(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  phone TEXT DEFAULT '',
  department TEXT DEFAULT '',
  telegram_chat_id TEXT DEFAULT '',
  telegram_username TEXT DEFAULT '',
  telegram_notifications_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS folders (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  unread_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY,
  company_name TEXT NOT NULL,
  logo_url TEXT,
  display_name TEXT NOT NULL,
  email_address TEXT NOT NULL,
  account_type TEXT NOT NULL,
  incoming_server TEXT NOT NULL,
  incoming_port INTEGER NOT NULL,
  incoming_ssl BOOLEAN DEFAULT TRUE,
  outgoing_server TEXT NOT NULL,
  outgoing_port INTEGER NOT NULL,
  outgoing_encryption TEXT NOT NULL,
  smtp_auth_required BOOLEAN DEFAULT TRUE,
  smtp_same_as_incoming BOOLEAN DEFAULT TRUE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  remember_password BOOLEAN DEFAULT TRUE,
  require_spa BOOLEAN DEFAULT FALSE,
  leave_copy_on_server BOOLEAN DEFAULT TRUE,
  remove_after_days INTEGER DEFAULT 14,
  remove_when_deleted BOOLEAN DEFAULT FALSE,
  auto_send_receive_minutes INTEGER DEFAULT 9,
  inbox_folder_name TEXT DEFAULT 'Inbox',
  sent_folder_name TEXT DEFAULT 'Sent',
  sync_sent_items BOOLEAN DEFAULT TRUE,
  graph_tenant_id TEXT DEFAULT '',
  graph_client_id TEXT DEFAULT '',
  graph_client_secret TEXT DEFAULT '',
  graph_mailbox_user TEXT DEFAULT '',
  default_priority TEXT DEFAULT 'Normal',
  default_sensitivity TEXT DEFAULT 'Normal',
  default_read_receipt BOOLEAN DEFAULT FALSE,
  default_delivery_receipt BOOLEAN DEFAULT FALSE,
  signature TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  project_code TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  client_name TEXT DEFAULT '',
  location TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  start_date DATE,
  end_date DATE,
  description TEXT DEFAULT '',
  project_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  budget NUMERIC DEFAULT 0,
  completion_pct INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code);

CREATE TABLE IF NOT EXISTS email_keys (
  id SERIAL PRIMARY KEY,
  key_code TEXT NOT NULL UNIQUE,
  key_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#1a237e',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_keys_code ON email_keys(key_code);

CREATE TABLE IF NOT EXISTS email_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  smtp_host TEXT DEFAULT '',
  smtp_port INTEGER DEFAULT 587,
  smtp_ssl BOOLEAN DEFAULT TRUE,
  smtp_username TEXT DEFAULT '',
  smtp_password TEXT DEFAULT '',
  imap_host TEXT DEFAULT '',
  imap_port INTEGER DEFAULT 993,
  imap_ssl BOOLEAN DEFAULT TRUE,
  imap_username TEXT DEFAULT '',
  imap_password TEXT DEFAULT '',
  pop3_host TEXT DEFAULT '',
  pop3_port INTEGER DEFAULT 995,
  pop3_ssl BOOLEAN DEFAULT TRUE,
  pop3_username TEXT DEFAULT '',
  pop3_password TEXT DEFAULT '',
  signature_html TEXT DEFAULT '',
  signature_text TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email_address);

CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  serial TEXT NOT NULL UNIQUE,
  folder_id INTEGER NOT NULL REFERENCES folders(id),
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  recipient_name TEXT,
  recipient_email TEXT,
  cc_list TEXT,
  bcc_list TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  body_html TEXT,
  preview TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT FALSE,
  priority TEXT DEFAULT 'Normal',
  sensitivity TEXT DEFAULT 'Normal',
  status TEXT DEFAULT 'Archived',
  has_attachments BOOLEAN DEFAULT FALSE,
  recommendation TEXT,
  report_status TEXT DEFAULT 'Pending Review',
  source TEXT DEFAULT 'manual',
  external_message_id TEXT UNIQUE,
  scheduled_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  read_receipt BOOLEAN DEFAULT FALSE,
  delivery_receipt BOOLEAN DEFAULT FALSE,
  recalled BOOLEAN DEFAULT FALSE,
  recalled_at TIMESTAMPTZ,
  employee_id INTEGER REFERENCES users(id),
  serialized BOOLEAN DEFAULT FALSE,
  serialized_at TIMESTAMPTZ,
  approval_status TEXT DEFAULT 'none',
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT DEFAULT '',
  parent_id INTEGER REFERENCES emails(id),
  thread_depth INTEGER DEFAULT 0,
  approval_root_id INTEGER REFERENCES emails(id),
  version_number INTEGER DEFAULT 1,
  subject_key TEXT DEFAULT '',
  assigned_manager_id INTEGER REFERENCES users(id),
  submitted_by INTEGER REFERENCES users(id),
  manager_comments TEXT DEFAULT '',
  approval_requested_at TIMESTAMPTZ,
  approval_decision_at TIMESTAMPTZ,
  last_action_at TIMESTAMPTZ DEFAULT NOW(),
  ai_sentiment TEXT DEFAULT 'Unknown',
  ai_tone_score INTEGER DEFAULT 0,
  ai_recommendations TEXT DEFAULT '',
  ai_provider TEXT DEFAULT 'rules',
  needs_revision BOOLEAN DEFAULT FALSE,
  risk_level TEXT DEFAULT 'low',
  risk_flags TEXT DEFAULT '',
  reminder_count INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  last_reminder_slot TEXT DEFAULT '',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  email_key_id INTEGER REFERENCES email_keys(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_external_msg_id ON emails(external_message_id);
CREATE INDEX IF NOT EXISTS idx_emails_project ON emails(project_id);
CREATE INDEX IF NOT EXISTS idx_emails_key ON emails(email_key_id);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  content_id TEXT,
  is_inline BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'Scheduled'
);

CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  confidence INTEGER DEFAULT 80,
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  metric TEXT NOT NULL,
  value TEXT NOT NULL,
  trend TEXT DEFAULT 'Stable'
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  category TEXT DEFAULT 'Meeting'
);

CREATE TABLE IF NOT EXISTS user_mail_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  logo_url TEXT,
  display_name TEXT NOT NULL,
  email_address TEXT NOT NULL,
  account_type TEXT NOT NULL,
  incoming_server TEXT NOT NULL,
  incoming_port INTEGER NOT NULL,
  incoming_ssl BOOLEAN DEFAULT TRUE,
  outgoing_server TEXT NOT NULL,
  outgoing_port INTEGER NOT NULL,
  outgoing_encryption TEXT NOT NULL,
  smtp_auth_required BOOLEAN DEFAULT TRUE,
  smtp_same_as_incoming BOOLEAN DEFAULT TRUE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  remember_password BOOLEAN DEFAULT TRUE,
  require_spa BOOLEAN DEFAULT FALSE,
  leave_copy_on_server BOOLEAN DEFAULT TRUE,
  remove_after_days INTEGER DEFAULT 14,
  remove_when_deleted BOOLEAN DEFAULT FALSE,
  auto_send_receive_minutes INTEGER DEFAULT 9,
  inbox_folder_name TEXT DEFAULT 'Inbox',
  sent_folder_name TEXT DEFAULT 'Sent',
  sync_sent_items BOOLEAN DEFAULT TRUE,
  graph_tenant_id TEXT DEFAULT '',
  graph_client_id TEXT DEFAULT '',
  graph_client_secret TEXT DEFAULT '',
  graph_mailbox_user TEXT DEFAULT '',
  default_priority TEXT DEFAULT 'Normal',
  default_sensitivity TEXT DEFAULT 'Normal',
  default_read_receipt BOOLEAN DEFAULT FALSE,
  default_delivery_receipt BOOLEAN DEFAULT FALSE,
  signature TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox_queue (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  attempts INTEGER DEFAULT 0,
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  status TEXT DEFAULT 'Queued'
);

CREATE TABLE IF NOT EXISTS email_archives (
  id SERIAL PRIMARY KEY,
  archive_serial TEXT NOT NULL UNIQUE,
  employee_id INTEGER REFERENCES users(id),
  email_ids INTEGER[] NOT NULL DEFAULT '{}',
  total_emails INTEGER DEFAULT 0,
  archived_at TIMESTAMPTZ DEFAULT NOW(),
  archived_by INTEGER REFERENCES users(id),
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS email_trail (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES users(id),
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  version_number INTEGER DEFAULT 1,
  feedback_content TEXT DEFAULT '',
  serial_snapshot TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_logs (
  id SERIAL PRIMARY KEY,
  approval_root_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  serial_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  feedback_content TEXT DEFAULT '',
  snapshot_subject TEXT NOT NULL,
  snapshot_body TEXT NOT NULL,
  snapshot_recipient_email TEXT DEFAULT '',
  metadata TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_action_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_nonce TEXT NOT NULL,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  approval_root_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  delivery_channel TEXT DEFAULT 'app',
  issued_by INTEGER REFERENCES users(id),
  telegram_chat_id TEXT DEFAULT '',
  metadata TEXT DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recent_contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  contact_email TEXT,
  contact_name TEXT DEFAULT '',
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  use_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id SERIAL PRIMARY KEY,
  email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  sender_email TEXT,
  receiver_email TEXT,
  project_id TEXT,
  email_category TEXT DEFAULT 'General',
  summary TEXT DEFAULT '',
  ai_tasks JSONB DEFAULT '[]'::jsonb,
  priority TEXT DEFAULT 'Medium',
  raw_response JSONB,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analyzed_by INTEGER,
  transaction_type TEXT DEFAULT 'general',
  has_deadline BOOLEAN DEFAULT FALSE,
  deadline_date DATE,
  needs_response BOOLEAN DEFAULT FALSE,
  urgency_level TEXT DEFAULT 'low',
  action_items JSONB DEFAULT '[]'::jsonb,
  key_entities JSONB DEFAULT '{}'::jsonb,
  response_suggestion TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_email ON ai_analysis(email_id);

CREATE TABLE IF NOT EXISTS email_threads (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  serial TEXT,
  message_ids TEXT[] DEFAULT '{}',
  root_message_id TEXT,
  subject TEXT,
  sender_email TEXT,
  participant_emails TEXT[] DEFAULT '{}',
  message_count INTEGER DEFAULT 1,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_threads_thread_id ON email_threads(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_serial ON email_threads(serial);
CREATE INDEX IF NOT EXISTS idx_email_threads_message_ids ON email_threads USING GIN(message_ids);
CREATE INDEX IF NOT EXISTS idx_email_threads_participants ON email_threads USING GIN(participant_emails);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  task_type TEXT DEFAULT 'general',
  status TEXT DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  due_date TIMESTAMPTZ,
  alerted BOOLEAN DEFAULT FALSE,
  alerted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  overdue_notified BOOLEAN DEFAULT FALSE,
  overdue_notified_at TIMESTAMPTZ,
  deadline_reminder_sent BOOLEAN DEFAULT FALSE,
  deadline_reminder_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);

CREATE TABLE IF NOT EXISTS milestones (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  milestone_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_due ON milestones(due_date);

CREATE TABLE IF NOT EXISTS email_registry (
  email_db_id BIGSERIAL PRIMARY KEY,
  email_id INTEGER UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message_id TEXT UNIQUE,
  thread_id TEXT,
  subject_key TEXT,
  serial_number TEXT,
  folder_name TEXT DEFAULT 'Inbox',
  approval_status TEXT DEFAULT 'none',
  source_provider TEXT DEFAULT 'manual',
  risk_level TEXT DEFAULT 'low',
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_registry_email_id ON email_registry(email_id);
CREATE INDEX IF NOT EXISTS idx_email_registry_project_id ON email_registry(project_id);
CREATE INDEX IF NOT EXISTS idx_email_registry_thread_id ON email_registry(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_registry_serial_number ON email_registry(serial_number);
CREATE INDEX IF NOT EXISTS idx_email_registry_subject_key ON email_registry(subject_key);

CREATE TABLE IF NOT EXISTS email_content_archive (
  email_db_id BIGINT PRIMARY KEY REFERENCES email_registry(email_db_id) ON DELETE CASCADE,
  raw_body TEXT,
  body_html TEXT,
  ai_summary TEXT,
  attachments_path TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_memory (
  id BIGSERIAL PRIMARY KEY,
  memory_key TEXT UNIQUE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  source_attachment_id INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
  source_kind TEXT DEFAULT 'email',
  memory_type TEXT DEFAULT 'general',
  title TEXT DEFAULT '',
  snippet TEXT NOT NULL,
  source_file_name TEXT DEFAULT '',
  reference_key TEXT DEFAULT '',
  confidence TEXT DEFAULT 'medium',
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_memory_project_id ON contract_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_contract_memory_employee_id ON contract_memory(employee_id);
CREATE INDEX IF NOT EXISTS idx_contract_memory_email_id ON contract_memory(source_email_id);
CREATE INDEX IF NOT EXISTS idx_contract_memory_attachment_id ON contract_memory(source_attachment_id);
CREATE INDEX IF NOT EXISTS idx_contract_memory_type ON contract_memory(memory_type);

CREATE TABLE IF NOT EXISTS contract_clause_memory (
  id BIGSERIAL PRIMARY KEY,
  clause_key TEXT UNIQUE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_memory_id BIGINT REFERENCES contract_memory(id) ON DELETE CASCADE,
  source_email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  source_attachment_id INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
  clause_type TEXT DEFAULT 'general',
  clause_title TEXT DEFAULT '',
  clause_value TEXT NOT NULL,
  normalized_value TEXT DEFAULT '',
  reference_key TEXT DEFAULT '',
  confidence TEXT DEFAULT 'medium',
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_project_id ON contract_clause_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_employee_id ON contract_clause_memory(employee_id);
CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_memory_id ON contract_clause_memory(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_type ON contract_clause_memory(clause_type);

CREATE TABLE IF NOT EXISTS tracking_tasks (
  task_id BIGSERIAL PRIMARY KEY,
  existing_task_id INTEGER UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  email_db_id BIGINT REFERENCES email_registry(email_db_id) ON DELETE SET NULL,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  task_type TEXT DEFAULT 'general',
  priority TEXT DEFAULT 'medium',
  due_date TIMESTAMPTZ,
  status TEXT DEFAULT 'PENDING',
  is_alerted BOOLEAN DEFAULT FALSE,
  alert_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_tasks_email_db_id ON tracking_tasks(email_db_id);
CREATE INDEX IF NOT EXISTS idx_tracking_tasks_status ON tracking_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tracking_tasks_due_date ON tracking_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tracking_tasks_assigned_to ON tracking_tasks(assigned_to);

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
ON CONFLICT (name) DO NOTHING;

COMMIT;
