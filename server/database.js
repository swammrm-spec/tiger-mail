import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";
import { Pool } from "pg";
import { newDb } from "pg-mem";
import { analyzeDraftWithLlm, extractStructuredContractClauses, extractTextWithVisionOcr } from "./aiAnalysisService.js";

const legacyRuntimeDir = path.resolve("runtime");
const legacyUploadsDir = path.join(legacyRuntimeDir, "uploads");
const legacyDbBackupPath = path.join(legacyRuntimeDir, "db-backup.json");
const legacySettingsPath = path.join(legacyRuntimeDir, "settings.json");
const legacyPersistentStatePath = path.join(legacyRuntimeDir, "persistent-state.json");
const legacyEmailArchivePath = path.join(legacyRuntimeDir, "email_archive.json");
const legacyBackupDataPath = path.join(legacyRuntimeDir, "backup-data.json");

const defaultDataRoot =
  process.env.EMAILARRAY_DATA_DIR ||
  process.env.TIGERMAIL_DATA_DIR ||
  (
    process.platform === "win32" && (process.env.LOCALAPPDATA || process.env.APPDATA)
      ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA, "Tiger.mail")
      : legacyRuntimeDir
  );

function resolveWritableDataRoot(targetDir) {
  const resolvedTarget = path.resolve(targetDir);
  try {
    fs.mkdirSync(resolvedTarget, { recursive: true });
    const probePath = path.join(resolvedTarget, `.probe-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probePath, "ok", "utf8");
    fs.unlinkSync(probePath);
    return resolvedTarget;
  } catch {
    return legacyRuntimeDir;
  }
}

const dataRootDir = resolveWritableDataRoot(defaultDataRoot);
const uploadsDir = path.join(dataRootDir, "uploads");
const dbBackupPath = path.join(dataRootDir, "db-backup.json");
const settingsPath = path.join(dataRootDir, "settings.json");
const persistentStatePath = path.join(dataRootDir, "persistent-state.json");
const backupsRootDir = path.join(dataRootDir, "backups");
const snapshotsDir = path.join(backupsRootDir, "snapshots");
const dailyExportsDir = path.join(backupsRootDir, "daily");
const legacyDefaultAdminEmail = "m.safad@audit.techno-grp.com";
const defaultAdminEmail = "m.safadi@audit.techno-grp.com";

let pool;
let memDb;
let databaseMode = "unknown";
let isRestoringPersistentState = false;
let persistenceWriteTimer = null;
let persistenceReady = false;
let persistenceIntervalHandle = null;
let persistenceHooksRegistered = false;
let backupIntervalHandle = null;

const persistedTableQueries = {
  users: "SELECT * FROM users ORDER BY id ASC",
  folders: "SELECT * FROM folders ORDER BY id ASC",
  emails: "SELECT * FROM emails ORDER BY id ASC",
  attachments: "SELECT * FROM attachments ORDER BY id ASC",
  reminders: "SELECT * FROM reminders ORDER BY id ASC",
  recommendations: "SELECT * FROM recommendations ORDER BY id ASC",
  reports: "SELECT * FROM reports ORDER BY id ASC",
  calendar_events: "SELECT * FROM calendar_events ORDER BY id ASC",
  app_settings: "SELECT * FROM app_settings ORDER BY id ASC",
  user_mail_settings: "SELECT * FROM user_mail_settings ORDER BY id ASC",
  outbox_queue: "SELECT * FROM outbox_queue ORDER BY id ASC",
  tasks: "SELECT * FROM tasks ORDER BY id ASC",
  milestones: "SELECT * FROM milestones ORDER BY id ASC",
  email_registry: "SELECT * FROM email_registry ORDER BY email_db_id ASC",
  email_content_archive: "SELECT * FROM email_content_archive ORDER BY email_db_id ASC",
  tracking_tasks: "SELECT * FROM tracking_tasks ORDER BY task_id ASC",
  email_archives: "SELECT * FROM email_archives ORDER BY id ASC",
  email_trail: "SELECT * FROM email_trail ORDER BY id ASC",
  approval_logs: "SELECT * FROM approval_logs ORDER BY id ASC",
  approval_action_tokens: "SELECT * FROM approval_action_tokens ORDER BY id ASC",
  recent_contacts: "SELECT * FROM recent_contacts ORDER BY id ASC",
  contract_memory: "SELECT * FROM contract_memory ORDER BY id ASC",
  contract_clause_memory: "SELECT * FROM contract_clause_memory ORDER BY id ASC"
};

const serialSequences = [
  { tableName: "users", sequenceName: "users_id_seq", pkColumn: "id" },
  { tableName: "folders", sequenceName: "folders_id_seq", pkColumn: "id" },
  { tableName: "emails", sequenceName: "emails_id_seq", pkColumn: "id" },
  { tableName: "attachments", sequenceName: "attachments_id_seq", pkColumn: "id" },
  { tableName: "reminders", sequenceName: "reminders_id_seq", pkColumn: "id" },
  { tableName: "recommendations", sequenceName: "recommendations_id_seq", pkColumn: "id" },
  { tableName: "reports", sequenceName: "reports_id_seq", pkColumn: "id" },
  { tableName: "calendar_events", sequenceName: "calendar_events_id_seq", pkColumn: "id" },
  { tableName: "user_mail_settings", sequenceName: "user_mail_settings_id_seq", pkColumn: "id" },
  { tableName: "outbox_queue", sequenceName: "outbox_queue_id_seq", pkColumn: "id" },
  { tableName: "tasks", sequenceName: "tasks_id_seq", pkColumn: "id" },
  { tableName: "milestones", sequenceName: "milestones_id_seq", pkColumn: "id" },
  { tableName: "email_registry", sequenceName: "email_registry_email_db_id_seq", pkColumn: "email_db_id" },
  { tableName: "tracking_tasks", sequenceName: "tracking_tasks_task_id_seq", pkColumn: "task_id" },
  { tableName: "email_archives", sequenceName: "email_archives_id_seq", pkColumn: "id" },
  { tableName: "email_trail", sequenceName: "email_trail_id_seq", pkColumn: "id" },
  { tableName: "approval_logs", sequenceName: "approval_logs_id_seq", pkColumn: "id" },
  { tableName: "approval_action_tokens", sequenceName: "approval_action_tokens_id_seq", pkColumn: "id" },
  { tableName: "recent_contacts", sequenceName: "recent_contacts_id_seq", pkColumn: "id" },
  { tableName: "contract_memory", sequenceName: "contract_memory_id_seq", pkColumn: "id" },
  { tableName: "contract_clause_memory", sequenceName: "contract_clause_memory_id_seq", pkColumn: "id" }
];

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getDataRootDir() {
  return dataRootDir;
}

function getBackupsRootDir() {
  return backupsRootDir;
}

function formatBackupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function formatBackupDay(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function writeJsonAtomic(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function migrateLegacyFileIfNeeded(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return;
  }

  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function migrateLegacyRuntimeData() {
  ensureDirectory(dataRootDir);
  ensureDirectory(uploadsDir);
  ensureDirectory(backupsRootDir);
  ensureDirectory(snapshotsDir);
  ensureDirectory(dailyExportsDir);

  if (path.resolve(dataRootDir) === path.resolve(legacyRuntimeDir)) {
    return;
  }

  migrateLegacyFileIfNeeded(legacyPersistentStatePath, persistentStatePath);
  migrateLegacyFileIfNeeded(legacySettingsPath, settingsPath);
  migrateLegacyFileIfNeeded(legacyDbBackupPath, dbBackupPath);
  migrateLegacyFileIfNeeded(legacyEmailArchivePath, path.join(dataRootDir, "email_archive.json"));
  migrateLegacyFileIfNeeded(legacyBackupDataPath, path.join(dataRootDir, "backup-data.json"));

  if (fs.existsSync(legacyUploadsDir)) {
    fs.cpSync(legacyUploadsDir, uploadsDir, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
  }
}

function registerPersistenceHandlers() {
  if (persistenceHooksRegistered) {
    return;
  }

  const flushState = () => {
    try {
      savePersistentStateSync();
    } catch {}
  };

  persistenceHooksRegistered = true;
  process.once("SIGTERM", flushState);
  process.once("SIGINT", flushState);
  process.once("beforeExit", flushState);
  process.once("exit", flushState);
  process.once("uncaughtExceptionMonitor", flushState);
}

async function clearPersistedTables() {
  try {
    await pool.query("UPDATE users SET created_by = NULL, manager_id = NULL");
  } catch {}

  const deletionOrder = [
    "outbox_queue",
    "approval_action_tokens",
    "approval_logs",
    "email_trail",
    "recommendations",
    "reminders",
    "attachments",
    "email_archives",
    "emails",
    "calendar_events",
    "reports",
    "user_mail_settings",
    "app_settings",
    "folders",
    "users"
  ];

  for (const tableName of deletionOrder) {
    await pool.query(`DELETE FROM ${tableName}`);
  }
}

async function restoreCollectedState(savedState) {
  const tables = savedState?.tables || {};
  isRestoringPersistentState = true;
  try {
    await clearPersistedTables();
    for (const tableName of Object.keys(persistedTableQueries)) {
      const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
      if (tableName === "emails") {
        const selfRefFixes = [];
        for (const row of rows) {
          const fixes = {};
          if (row.approval_root_id && Number(row.approval_root_id) === Number(row.id)) {
            fixes.approval_root_id = row.approval_root_id;
            row.approval_root_id = null;
          }
          if (row.parent_id && Number(row.parent_id) === Number(row.id)) {
            fixes.parent_id = row.parent_id;
            row.parent_id = null;
          }
          if (Object.keys(fixes).length) {
            fixes.id = row.id;
            selfRefFixes.push(fixes);
          }
          await insertPersistedRow(tableName, row);
        }
        for (const fix of selfRefFixes) {
          const setClauses = Object.keys(fix).filter(k => k !== "id").map(k => `${k} = $1`).join(", ");
          const val = Object.entries(fix).filter(([k]) => k !== "id").map(([,v]) => v);
          if (val.length) await pool.query(`UPDATE emails SET ${setClauses} WHERE id = $2`, [...val, fix.id]);
        }
      } else {
        for (const row of rows) {
          await insertPersistedRow(tableName, row);
        }
      }
    }
    await resetPersistedSequences();
  } finally {
    isRestoringPersistentState = false;
  }
}

function listBackupFilesFromDir(dirPath, type) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const filePath = path.join(dirPath, name);
      const stats = fs.statSync(filePath);
      return {
        name,
        type,
        size: stats.size,
        created_at: stats.birthtime.toISOString(),
        updated_at: stats.mtime.toISOString(),
        path: filePath
      };
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function trimBackupFiles(dirPath, maxFiles) {
  const files = listBackupFilesFromDir(dirPath, "rotation");
  for (const file of files.slice(maxFiles)) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
}

async function createBackupSnapshot(kind = "manual", metadata = {}) {
  ensureDirectory(snapshotsDir);
  ensureDirectory(dailyExportsDir);

  const state = await collectPersistentState();
  const stampedAt = new Date();
  const timestamp = formatBackupTimestamp(stampedAt);
  const snapshotPayload = {
    version: 1,
    kind,
    created_at: stampedAt.toISOString(),
    data_root: dataRootDir,
    metadata,
    state
  };

  const snapshotName = `snapshot-${timestamp}-${kind}.json`;
  const snapshotPath = path.join(snapshotsDir, snapshotName);
  writeJsonAtomic(snapshotPath, snapshotPayload);
  trimBackupFiles(snapshotsDir, 30);

  const dayKey = formatBackupDay(stampedAt);
  const dailyPath = path.join(dailyExportsDir, `daily-${dayKey}.json`);
  writeJsonAtomic(dailyPath, snapshotPayload);

  return {
    name: snapshotName,
    kind,
    path: snapshotPath,
    created_at: stampedAt.toISOString()
  };
}

async function createDailyArchiveExport() {
  return createBackupSnapshot("daily-export", { trigger: "manual-daily-export" });
}

function listBackups() {
  return [
    ...listBackupFilesFromDir(snapshotsDir, "snapshot"),
    ...listBackupFilesFromDir(dailyExportsDir, "daily")
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

async function restoreBackupByName(fileName) {
  const allBackups = listBackups();
  const selected = allBackups.find((file) => file.name === fileName);
  if (!selected) {
    throw new Error("Backup file not found.");
  }

  const parsed = JSON.parse(fs.readFileSync(selected.path, "utf8"));
  const state = parsed?.state || parsed;
  if (!state?.tables) {
    throw new Error("Backup file is invalid.");
  }

  await createBackupSnapshot("pre-restore", { restore_source: selected.name });
  await restoreCollectedState(state);
  await savePersistentState();

  return {
    restored_from: selected.name,
    restored_at: new Date().toISOString(),
    tables: Object.fromEntries(
      Object.entries(state.tables).map(([tableName, rows]) => [tableName, Array.isArray(rows) ? rows.length : 0])
    )
  };
}

function scheduleAutomaticBackups() {
  if (backupIntervalHandle) {
    return;
  }

  backupIntervalHandle = setInterval(() => {
    createBackupSnapshot("auto", { trigger: "interval" }).catch(() => {});
  }, 60 * 60 * 1000);
}

function createPool() {
  if (process.env.DATABASE_URL) {
    databaseMode = "postgres";
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
    });
  }

  const mem = newDb({
    autoCreateForeignKeyIndices: true
  });
  memDb = mem;

  // Legacy backup restore is optional; persistent-state.json is the active durable path.
  try {
    if (fs.existsSync(dbBackupPath) && typeof mem.loadBackup === "function") {
      const saved = JSON.parse(fs.readFileSync(dbBackupPath, "utf8"));
      if (saved.data && saved.schemaVersion) {
        mem.loadBackup({ ...saved, db: mem });
        console.log("Database restored from backup.");
      }
    }
  } catch (e) {
    console.warn("Could not restore database backup:", e.message);
  }

  const adapter = mem.adapters.createPg();
  databaseMode = "pg-mem";
  return new adapter.Pool();
}

function placeholderAttachmentPath(fileName) {
  return path.join(uploadsDir, fileName);
}

function resolveStoredAttachmentDiskPath(filePath = "") {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    return "";
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.join(uploadsDir, path.basename(normalized));
}

async function query(text, params = []) {
  const result = await pool.query(text, params);
  if (
    databaseMode === "pg-mem" &&
    persistenceReady &&
    !isRestoringPersistentState &&
    /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)
  ) {
    schedulePersistentStateSave();
  }
  return result;
}

async function ensureDeferredTable(tableName, createStatement, indexStatements = [], orphanIndexName = "") {
  try {
    await query(`SELECT 1 FROM ${tableName} LIMIT 1`);
  } catch {
    try {
      await query(createStatement);
    } catch (error) {
      const message = String(error?.message || "");
      if (databaseMode === "pg-mem" && orphanIndexName && message.includes(`relation "${orphanIndexName}" already exists`)) {
        await query(`DROP INDEX IF EXISTS ${orphanIndexName}`);
        await query(createStatement);
      } else {
        throw error;
      }
    }
  }

  for (const statement of indexStatements) {
    await query(statement);
  }
}

async function createSerial(subject) {
  const slug =
    (subject || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "untitled";

  const year = new Date().getFullYear();
  const pattern = `${slug}-${year}-%`;
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM emails WHERE serial LIKE $1", [pattern]);
  const nextSequence = String(rows[0].count + 1).padStart(4, "0");
  return `${slug}-${year}-${nextSequence}`;
}

function buildApprovalSubjectKey(subject, providedKey = "") {
  const normalized =
    (providedKey || subject || "mail")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 18) || "MAIL";
  return normalized;
}

function buildApprovalSerial(subject, providedKey = "", versionNumber = 1, timestamp = new Date()) {
  const key = buildApprovalSubjectKey(subject, providedKey);
  const yyyy = String(timestamp.getFullYear());
  const mm = String(timestamp.getMonth() + 1).padStart(2, "0");
  const dd = String(timestamp.getDate()).padStart(2, "0");
  return `${key}-${yyyy}${mm}${dd}-REV${String(versionNumber).padStart(2, "0")}`;
}

async function createSerialFromSubjectKey(subject, providedKey = "", timestamp = new Date()) {
  const key = buildApprovalSubjectKey(subject, providedKey);
  const yyyy = String(timestamp.getFullYear());
  const mm = String(timestamp.getMonth() + 1).padStart(2, "0");
  const dd = String(timestamp.getDate()).padStart(2, "0");
  const prefix = `${key}-${yyyy}${mm}${dd}-`;
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM emails WHERE serial LIKE $1", [`${prefix}%`]);
  const nextSequence = String(Number(rows[0]?.count || 0) + 1).padStart(4, "0");
  return {
    subjectKey: key,
    serial: `${prefix}${nextSequence}`
  };
}

async function analyzeDraftForApproval({ subject, body, recipientEmail, ccList }) {
  const text = `${subject || ""}\n${body || ""}`.trim();
  const recommendations = [];
  const riskFlags = [];
  let toneScore = 88;
  let sentiment = "Neutral";
  let riskLevel = "low";

  const criticalPatterns = [
    /\b(guarantee|guaranteed|guaranty)\b/i,
    /\b(liability|liable)\b/i,
    /\b(indemnif(?:y|ication)|hold harmless)\b/i,
    /\b(penalt(?:y|ies)|fine|breach)\b/i
  ];
  const highPatterns = [
    /\b(lawsuit|legal action|court|claim)\b/i,
    /\b(terminate|termination|cancel contract)\b/i,
    /\b(refund|compensation|damages)\b/i,
    /\b(final notice|immediately|urgent|asap)\b/i
  ];

  if (!text) {
    recommendations.push("Add meaningful subject and body content before submission.");
    toneScore = 25;
  }

  if ((subject || "").trim().length < 5) {
    recommendations.push("Use a clearer subject line for better serialization and searchability.");
    toneScore -= 8;
  }

  if ((body || "").trim().length < 40) {
    recommendations.push("Expand the body with more context before sending to the manager.");
    toneScore -= 10;
  }

  if (/\b(urgent|asap|immediately)\b/i.test(text)) {
    sentiment = "Urgent";
    recommendations.push("Review urgency wording to keep the email professional and precise.");
    toneScore -= 6;
  }

  if (/\b(thanks|please|kindly|appreciate)\b/i.test(text)) {
    sentiment = sentiment === "Urgent" ? "Urgent but polite" : "Positive";
  }

  if (!recipientEmail) {
    recommendations.push("Specify the final recipient email before requesting approval.");
    toneScore -= 12;
  }

  if (ccList && String(ccList).split(",").length > 5) {
    recommendations.push("Review the CC list and remove unnecessary recipients.");
    toneScore -= 4;
  }

  if (criticalPatterns.some((pattern) => pattern.test(text))) {
    riskLevel = "critical";
    riskFlags.push("liability-language");
    recommendations.push("Critical legal or liability wording detected. Manager review is required before any delivery.");
    toneScore -= 18;
  } else if (highPatterns.some((pattern) => pattern.test(text))) {
    riskLevel = "high";
    riskFlags.push("dangerous-language");
    recommendations.push("Potentially sensitive or risky wording detected. Confirm intent and wording before approval.");
    toneScore -= 12;
  }

  if (String(recipientEmail || "").split(/[,\n;]+/).filter(Boolean).length > 5) {
    riskLevel = riskLevel === "critical" ? "critical" : "medium";
    riskFlags.push("multi-recipient");
    recommendations.push("Large recipient list detected. Verify all recipients before submitting for approval.");
    toneScore -= 6;
  }

  const fallbackAnalysis = {
    sentiment,
    tone_score: Math.max(1, Math.min(100, toneScore)),
    recommendations,
    risk_level: riskLevel,
    risk_flags: [...new Set(riskFlags)],
    provider: "rules"
  };

  return analyzeDraftWithLlm(
    {
      subject,
      body,
      recipientEmail,
      ccList
    },
    fallbackAnalysis
  );
}

async function analyzeIncomingEmail({ subject, body, senderEmail, recipientEmail, ccList = "", attachmentNames = [] }) {
  const text = `${subject || ""}\n${body || ""}`.trim();
  const recommendations = [];
  const riskFlags = [];
  let toneScore = 84;
  let sentiment = "Neutral";
  let riskLevel = "low";

  const criticalPatterns = [
    /\b(guarantee|guaranteed|guaranty)\b/i,
    /\b(liability|liable)\b/i,
    /\b(indemnif(?:y|ication)|hold harmless)\b/i,
    /\b(penalt(?:y|ies)|fine|breach)\b/i,
    /\b(confidential settlement|wire transfer immediately)\b/i
  ];
  const highPatterns = [
    /\b(lawsuit|legal action|court|claim)\b/i,
    /\b(terminate|termination|cancel contract)\b/i,
    /\b(refund|compensation|damages)\b/i,
    /\b(final notice|immediately|urgent|asap)\b/i,
    /\b(password|bank account|swift|iban|otp)\b/i
  ];

  if (!text) {
    toneScore = 30;
    recommendations.push("Incoming email has little readable body content. Verify the original message and attachments.");
  }

  if (criticalPatterns.some((pattern) => pattern.test(text))) {
    riskLevel = "critical";
    riskFlags.push("liability-language");
    recommendations.push("Critical legal or liability wording detected in the inbound email.");
    toneScore -= 20;
  } else if (highPatterns.some((pattern) => pattern.test(text))) {
    riskLevel = "high";
    riskFlags.push("dangerous-language");
    recommendations.push("Potentially sensitive or risky inbound wording detected.");
    toneScore -= 14;
  }

  if (/\b(confidential|strictly private|do not share)\b/i.test(text)) {
    riskLevel = riskLevel === "critical" ? "critical" : "medium";
    riskFlags.push("sensitive-language");
    recommendations.push("Treat this email as sensitive until the assigned employee reviews it.");
  }

  if (Array.isArray(attachmentNames) && attachmentNames.length > 0) {
    riskFlags.push("has-attachments");
    recommendations.push("Review attachments before forwarding or approving follow-up actions.");
  }

  if (/\b(invoice|payment|po|purchase order|quotation|quote)\b/i.test(text)) {
    riskLevel = riskLevel === "critical" ? "critical" : riskLevel === "high" ? "high" : "medium";
    riskFlags.push("commercial-content");
  }

  if (/\b(thanks|please|kindly|appreciate)\b/i.test(text)) {
    sentiment = "Positive";
  }
  if (/\b(urgent|immediately|asap)\b/i.test(text)) {
    sentiment = sentiment === "Positive" ? "Urgent but polite" : "Urgent";
  }

  const fallbackAnalysis = {
    sentiment,
    tone_score: Math.max(1, Math.min(100, toneScore)),
    recommendations: [...new Set(recommendations)],
    risk_level: riskLevel,
    risk_flags: [...new Set(riskFlags)],
    provider: "rules"
  };

  return analyzeDraftWithLlm(
    {
      subject,
      body,
      recipientEmail: recipientEmail || senderEmail || "",
      ccList
    },
    fallbackAnalysis
  );
}

async function getNextApprovalVersion(approvalRootId) {
  const { rows } = await query(
    "SELECT COALESCE(MAX(version_number), 0)::int AS max_version FROM emails WHERE approval_root_id = $1 OR id = $1",
    [Number(approvalRootId)]
  );
  return Number(rows[0]?.max_version || 0) + 1;
}

async function appendApprovalLog({
  approvalRootId,
  emailId,
  versionNumber,
  serialId,
  actionType,
  actorUserId,
  feedbackContent = "",
  snapshotSubject = "",
  snapshotBody = "",
  snapshotRecipientEmail = "",
  metadata = "",
  ipAddress = ""
}) {
  const approvalLogId = await getNextPrimaryKeyId("approval_logs");
  await query(
    `
      INSERT INTO approval_logs (
        id, approval_root_id, email_id, version_number, serial_id, action_type,
        actor_user_id, feedback_content, snapshot_subject, snapshot_body,
        snapshot_recipient_email, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      approvalLogId,
      approvalRootId,
      emailId,
      versionNumber,
      serialId,
      actionType,
      actorUserId || null,
      feedbackContent || "",
      snapshotSubject || "",
      snapshotBody || "",
      snapshotRecipientEmail || "",
      metadata || ""
    ]
  );

  const trailId = await getNextPrimaryKeyId("email_trail");
  await query(
    `
      INSERT INTO email_trail (
        id, email_id, employee_id, actor_user_id, action, details, ip_address,
        version_number, feedback_content, serial_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      trailId,
      emailId,
      actorUserId || null,
      actorUserId || null,
      actionType,
      `${actionType} for serial ${serialId}`,
      ipAddress || "",
      versionNumber,
      feedbackContent || "",
      serialId
    ]
  );
}

async function addMissingEmailColumns() {
  const cols = [
    "recipient_name TEXT", "recipient_email TEXT", "cc_list TEXT", "bcc_list TEXT",
    "queued_at TIMESTAMPTZ", "sent_at TIMESTAMPTZ",
    "sensitivity TEXT DEFAULT 'Normal'", "read_receipt BOOLEAN DEFAULT FALSE",
    "delivery_receipt BOOLEAN DEFAULT FALSE", "recalled BOOLEAN DEFAULT FALSE",
    "recalled_at TIMESTAMPTZ", "employee_id INTEGER",
    "serialized BOOLEAN DEFAULT FALSE", "serialized_at TIMESTAMPTZ",
    "approval_status TEXT DEFAULT 'none'", "approved_by INTEGER",
    "approved_at TIMESTAMPTZ", "rejection_reason TEXT DEFAULT ''",
    "parent_id INTEGER", "thread_depth INTEGER DEFAULT 0",
    "approval_root_id INTEGER", "version_number INTEGER DEFAULT 1",
    "subject_key TEXT DEFAULT ''", "assigned_manager_id INTEGER",
    "submitted_by INTEGER", "manager_comments TEXT DEFAULT ''",
    "approval_requested_at TIMESTAMPTZ", "approval_decision_at TIMESTAMPTZ",
    "last_action_at TIMESTAMPTZ", "body_html TEXT",
    "ai_sentiment TEXT DEFAULT 'Unknown'", "ai_tone_score INTEGER DEFAULT 0",
    "ai_recommendations TEXT DEFAULT ''", "ai_provider TEXT DEFAULT 'rules'",
    "needs_revision BOOLEAN DEFAULT FALSE", "risk_level TEXT DEFAULT 'low'",
    "risk_flags TEXT DEFAULT ''", "reminder_count INTEGER DEFAULT 0",
    "last_reminder_at TIMESTAMPTZ", "last_reminder_slot TEXT DEFAULT ''",
    "scheduled_at TIMESTAMPTZ", "snoozed_until TIMESTAMPTZ",
    "project_id INTEGER", "email_key_id INTEGER",
    "account_id INTEGER",
    "ai_summary TEXT", "transaction_type TEXT", "urgency_level TEXT",
    "needs_reply BOOLEAN DEFAULT FALSE", "reply_deadline TIMESTAMPTZ",
    "replied_at TIMESTAMPTZ", "archived BOOLEAN DEFAULT FALSE",
    "archived_at TIMESTAMPTZ"
  ];
  for (const col of cols) {
    try { await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS ${col}`); } catch (e) { /* already exists */ }
  }
  try { await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_notified BOOLEAN DEFAULT FALSE`); } catch (e) {}
  try { await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ`); } catch (e) {}
  try { await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline_reminder_sent BOOLEAN DEFAULT FALSE`); } catch (e) {}
  try { await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline_reminder_at TIMESTAMPTZ`); } catch (e) {}
}

async function initializeDatabase() {
  migrateLegacyRuntimeData();
  fs.mkdirSync(uploadsDir, { recursive: true });
  pool = createPool();
  await runSchema();
  await addMissingEmailColumns();
  await restorePersistentState();
  await migrateLegacyDefaultAdminIdentity();
  await migrateRecentContactsFromHistory();
  await seedRecentContactsFromAllEmails();
  await seedDefaults();
  await ensureSystemDefaults();
  await repairIncomingUncategorizedEmails();
  await backfillArchiveTrackingData();
  persistenceReady = true;
  await savePersistentState();

  if (!persistenceIntervalHandle) {
    persistenceIntervalHandle = setInterval(() => {
      try { savePersistentState(); } catch (e) { /* silent */ }
    }, 15000);
  }
  registerPersistenceHandlers();
  scheduleAutomaticBackups();
  await createBackupSnapshot("startup", { trigger: "server-start" });

  return pool;
}

async function repairIncomingUncategorizedEmails() {
  const folderLookup = await query("SELECT id, name FROM folders WHERE name IN ('Inbox', 'Uncategorized')");
  const inboxFolder = folderLookup.rows.find((row) => row.name === "Inbox");
  const uncategorizedFolder = folderLookup.rows.find((row) => row.name === "Uncategorized");

  if (!inboxFolder || !uncategorizedFolder) {
    return;
  }

  await query(
    `
      UPDATE emails
      SET folder_id = $1
      WHERE folder_id = $2
        AND status = 'Received'
        AND source IN ('pop3', 'imap', 'graph')
    `,
    [inboxFolder.id, uncategorizedFolder.id]
  );
}

async function migrateLegacyDefaultAdminIdentity() {
  const legacyAdmin = await query("SELECT id FROM users WHERE email = $1", [legacyDefaultAdminEmail]);
  const canonicalAdmin = await query("SELECT id FROM users WHERE email = $1", [defaultAdminEmail]);

  if (legacyAdmin.rows[0] && !canonicalAdmin.rows[0]) {
    await query(
      `
        UPDATE users
        SET email = $1,
            role = 'Admin',
            can_manage_users = TRUE,
            can_manage_reports = TRUE,
            can_archive = TRUE
        WHERE email = $2
      `,
      [defaultAdminEmail, legacyDefaultAdminEmail]
    );
  }

  await query(
    `
      UPDATE user_mail_settings
      SET email_address = CASE WHEN email_address = $2 THEN $1 ELSE email_address END,
          username = CASE WHEN username = $2 THEN $1 ELSE username END,
          graph_mailbox_user = CASE WHEN graph_mailbox_user = $2 THEN $1 ELSE graph_mailbox_user END
      WHERE email_address = $2 OR username = $2 OR graph_mailbox_user = $2
    `,
    [defaultAdminEmail, legacyDefaultAdminEmail]
  );

  await query(
    `
      UPDATE app_settings
      SET email_address = CASE WHEN email_address = $2 THEN $1 ELSE email_address END,
          username = CASE WHEN username = $2 THEN $1 ELSE username END,
          graph_mailbox_user = CASE WHEN graph_mailbox_user = $2 THEN $1 ELSE graph_mailbox_user END
      WHERE email_address = $2 OR username = $2 OR graph_mailbox_user = $2
    `,
    [defaultAdminEmail, legacyDefaultAdminEmail]
  );
}

function schedulePersistentStateSave() {
  if (databaseMode !== "pg-mem" || !persistenceReady || isRestoringPersistentState) {
    return;
  }
  if (persistenceWriteTimer) {
    clearTimeout(persistenceWriteTimer);
  }
  persistenceWriteTimer = setTimeout(() => {
    persistenceWriteTimer = null;
    savePersistentState().catch(() => {});
  }, 250);
}

async function collectPersistentState() {
  const state = { version: 1, saved_at: new Date().toISOString(), tables: {} };
  for (const [tableName, sql] of Object.entries(persistedTableQueries)) {
    const { rows } = await pool.query(sql);
    state.tables[tableName] = rows;
  }
  return state;
}

async function savePersistentState() {
  if (databaseMode !== "pg-mem" || !pool) {
    return;
  }
  const state = await collectPersistentState();
  writeJsonAtomic(persistentStatePath, state);
}

function savePersistentStateSync() {
  if (databaseMode !== "pg-mem" || !pool) {
    return;
  }
  const state = { version: 1, saved_at: new Date().toISOString(), tables: {} };
  for (const [tableName, sql] of Object.entries(persistedTableQueries)) {
    const queryResult = memDb.public.many(sql);
    state.tables[tableName] = queryResult;
  }
  writeJsonAtomic(persistentStatePath, state);
}

async function insertPersistedRow(tableName, row) {
  const entries = Object.entries(row || {});
  if (!entries.length) {
    return;
  }
  const columns = entries.map(([key]) => key);
  const values = entries.map(([, value]) => value);
  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  await pool.query(
    `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
    values
  );
}

async function resetPersistedSequences() {
  for (const { tableName, sequenceName, pkColumn } of serialSequences) {
    try {
      await pool.query(
        `SELECT setval('${sequenceName}', COALESCE((SELECT MAX(${pkColumn}) FROM ${tableName}), 1), true)`
      );
    } catch {
      // ignore sequence reset issues on unsupported backends
    }
  }
}

async function getNextPrimaryKeyId(tableName) {
  if (databaseMode !== "pg-mem") {
    return null;
  }

  const result = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${tableName}`);
  return Number(result.rows[0]?.next_id || 1);
}

async function restorePersistentState() {
  if (databaseMode !== "pg-mem" || !fs.existsSync(persistentStatePath)) {
    return;
  }
  try {
    const saved = JSON.parse(fs.readFileSync(persistentStatePath, "utf8"));
    await restoreCollectedState(saved);
  } catch (error) {
    console.warn("Could not restore persistent state:", error.message);
  }
}

function saveBackup() {
  if (!memDb || databaseMode !== "pg-mem") return;
  const backup = memDb.backup();
  if (!backup) return;
  const saveObj = { data: backup.data, schemaVersion: backup.schemaVersion };
  writeJsonAtomic(dbBackupPath, saveObj);
}

async function runSchema() {
  const schemaStatements = [
    `
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
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS folders (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        icon TEXT,
        unread_count INTEGER DEFAULT 0
      )
    `,
    `
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
        status TEXT DEFAULT 'Archived',
        has_attachments BOOLEAN DEFAULT FALSE,
        recommendation TEXT,
        report_status TEXT DEFAULT 'Pending Review',
        source TEXT DEFAULT 'manual',
        external_message_id TEXT UNIQUE,
        scheduled_at TIMESTAMPTZ,
        snoozed_until TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS attachments (
        id SERIAL PRIMARY KEY,
        email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER,
        content_id TEXT,
        is_inline BOOLEAN DEFAULT FALSE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS reminders (
        id SERIAL PRIMARY KEY,
        email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        remind_at TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'Scheduled'
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS recommendations (
        id SERIAL PRIMARY KEY,
        email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        confidence INTEGER DEFAULT 80,
        category TEXT NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        metric TEXT NOT NULL,
        value TEXT NOT NULL,
        trend TEXT DEFAULT 'Stable'
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        location TEXT,
        category TEXT DEFAULT 'Meeting'
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY,
        company_name TEXT NOT NULL,
        logo_url TEXT,
        company_address TEXT DEFAULT '',
        company_phone TEXT DEFAULT '',
        company_website TEXT DEFAULT '',
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
        outbound_subject_companies_json TEXT DEFAULT '[]',
        outbound_subject_quotations_json TEXT DEFAULT '[]',
        outbound_subject_clients_json TEXT DEFAULT '[]',
        outbound_subject_studies_json TEXT DEFAULT '[]',
        outbound_subject_admin_subjects_json TEXT DEFAULT '[]',
        enforce_outbound_subject_schema BOOLEAN DEFAULT TRUE,
        default_priority TEXT DEFAULT 'Normal',
        default_sensitivity TEXT DEFAULT 'Normal',
        default_read_receipt BOOLEAN DEFAULT FALSE,
        default_delivery_receipt BOOLEAN DEFAULT FALSE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS user_mail_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        logo_url TEXT,
        company_address TEXT DEFAULT '',
        company_phone TEXT DEFAULT '',
        company_website TEXT DEFAULT '',
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
        outbound_subject_companies_json TEXT DEFAULT '[]',
        outbound_subject_quotations_json TEXT DEFAULT '[]',
        outbound_subject_clients_json TEXT DEFAULT '[]',
        outbound_subject_studies_json TEXT DEFAULT '[]',
        outbound_subject_admin_subjects_json TEXT DEFAULT '[]',
        enforce_outbound_subject_schema BOOLEAN DEFAULT TRUE,
        default_priority TEXT DEFAULT 'Normal',
        default_sensitivity TEXT DEFAULT 'Normal',
        default_read_receipt BOOLEAN DEFAULT FALSE,
        default_delivery_receipt BOOLEAN DEFAULT FALSE,
        signature TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS outbox_queue (
        id SERIAL PRIMARY KEY,
        email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
        attempts INTEGER DEFAULT 0,
        queued_at TIMESTAMPTZ DEFAULT NOW(),
        last_attempt_at TIMESTAMPTZ,
        next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
        last_error TEXT,
        status TEXT DEFAULT 'Queued'
      )
    `
  ];

  for (const statement of schemaStatements) {
    await query(statement);
  }

  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS recipient_name TEXT");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS recipient_email TEXT");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS cc_list TEXT");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS bcc_list TEXT");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS sensitivity TEXT DEFAULT 'Normal'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS read_receipt BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS delivery_receipt BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS recalled BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS serialized BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS serialized_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'none'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES emails(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS thread_depth INTEGER DEFAULT 0");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_root_id INTEGER REFERENCES emails(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS subject_key TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS assigned_manager_id INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS manager_comments TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_decision_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ DEFAULT NOW()");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS body_html TEXT");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_sentiment TEXT DEFAULT 'Unknown'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_tone_score INTEGER DEFAULT 0");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_recommendations TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'rules'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS needs_revision BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'low'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS risk_flags TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_reminder_slot TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id)");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_notifications_enabled BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_projects BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_tasks BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_keys BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_settings BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_analytics BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_backups BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_archives BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_email_accounts BOOLEAN DEFAULT FALSE");

  await query(`
    CREATE TABLE IF NOT EXISTS email_archives (
      id SERIAL PRIMARY KEY,
      archive_serial TEXT NOT NULL UNIQUE,
      employee_id INTEGER REFERENCES users(id),
      email_ids INTEGER[] NOT NULL DEFAULT '{}',
      total_emails INTEGER DEFAULT 0,
      archived_at TIMESTAMPTZ DEFAULT NOW(),
      archived_by INTEGER REFERENCES users(id),
      notes TEXT DEFAULT ''
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_trail (
      id SERIAL PRIMARY KEY,
      email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      employee_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query("ALTER TABLE email_trail ADD COLUMN IF NOT EXISTS actor_user_id INTEGER REFERENCES users(id)");
  await query("ALTER TABLE email_trail ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1");
  await query("ALTER TABLE email_trail ADD COLUMN IF NOT EXISTS feedback_content TEXT DEFAULT ''");
  await query("ALTER TABLE email_trail ADD COLUMN IF NOT EXISTS serial_snapshot TEXT DEFAULT ''");

  await query(`
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
    )
  `);

  await query(`
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
    )
  `);

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS recent_contacts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        contact_email TEXT,
        contact_name TEXT DEFAULT '',
        last_used_at TIMESTAMPTZ DEFAULT NOW(),
        use_count INTEGER DEFAULT 1
      )
    `);
  } catch (e) { /* recent_contacts table optional */ }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ai_analysis (
        id SERIAL PRIMARY KEY,
        email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
        sender_email TEXT,
        receiver_email TEXT,
        project_id TEXT,
        email_category TEXT DEFAULT 'General',
        summary TEXT DEFAULT '',
        ai_tasks JSONB DEFAULT '[]',
        priority TEXT DEFAULT 'Medium',
        raw_response JSONB,
        analyzed_at TIMESTAMPTZ DEFAULT NOW(),
        analyzed_by INTEGER
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_ai_analysis_email ON ai_analysis(email_id)`);
  } catch (e) { /* ai_analysis table optional */ }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS attachment_analysis (
        id SERIAL PRIMARY KEY,
        email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        document_type TEXT DEFAULT 'other',
        document_type_ar TEXT DEFAULT 'مستند أخرى',
        summary TEXT DEFAULT '',
        key_entities JSONB DEFAULT '{}',
        extracted_data JSONB DEFAULT '{}',
        requires_action BOOLEAN DEFAULT FALSE,
        action_description TEXT DEFAULT '',
        urgency TEXT DEFAULT 'low',
        confidence TEXT DEFAULT 'medium',
        language TEXT DEFAULT 'en',
        pages_estimate INTEGER DEFAULT 1,
        provider TEXT DEFAULT 'rules',
        analyzed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_attachment_analysis_email ON attachment_analysis(email_id)`);
  } catch (e) { /* attachment_analysis table optional */ }

  try {
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_threads_thread_id ON email_threads(thread_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_threads_serial ON email_threads(serial)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_threads_message_ids ON email_threads USING GIN(message_ids)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_threads_participants ON email_threads USING GIN(participant_emails)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_emails_external_msg_id ON emails(external_message_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_emails_project ON emails(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_emails_key ON emails(email_key_id)`);
  } catch (e) { /* email_threads table optional */ }

  try {
    await query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`);
  } catch (e) { /* tasks table optional */ }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS milestones (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        milestone_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        due_date TIMESTAMPTZ,
        status TEXT DEFAULT 'pending',
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_milestones_due ON milestones(due_date)`);
  } catch (e) { /* milestones table optional */ }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS email_keys (
        id SERIAL PRIMARY KEY,
        key_code TEXT NOT NULL UNIQUE,
        key_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        color TEXT DEFAULT '#1a237e',
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_keys_code ON email_keys(key_code)`);
  } catch (e) { /* email_keys table optional */ }

  try {
    await query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code)`);
  } catch (e) { /* projects table optional */ }

  try {
    await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS email_key_id INTEGER REFERENCES email_keys(id) ON DELETE SET NULL`);
  } catch (e) { /* columns may already exist */ }

  try {
    await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget NUMERIC DEFAULT 0`);
    await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS completion_pct INTEGER DEFAULT 0`);
  } catch (e) { /* columns may already exist */ }

  // Tasks and milestones depend on projects, so ensure they exist only after
  // the projects table has been created successfully.
  await ensureDeferredTable(
    "tasks",
    `
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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
    [
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`
    ],
    "tasks_pkey"
  );

  await ensureDeferredTable(
    "milestones",
    `
      CREATE TABLE IF NOT EXISTS milestones (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        milestone_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        due_date TIMESTAMPTZ,
        status TEXT DEFAULT 'pending',
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
    [
      `CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_milestones_due ON milestones(due_date)`
    ],
    "milestones_pkey"
  );

  try {
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_registry_email_id ON email_registry(email_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_registry_project_id ON email_registry(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_registry_thread_id ON email_registry(thread_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_registry_serial_number ON email_registry(serial_number)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_registry_subject_key ON email_registry(subject_key)`);
  } catch (e) { /* email_registry table optional */ }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS email_content_archive (
        email_db_id BIGINT PRIMARY KEY REFERENCES email_registry(email_db_id) ON DELETE CASCADE,
        raw_body TEXT,
        body_html TEXT,
        ai_summary TEXT,
        attachments_path TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (e) { /* email_content_archive table optional */ }

  try {
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_memory_project_id ON contract_memory(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_memory_employee_id ON contract_memory(employee_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_memory_email_id ON contract_memory(source_email_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_memory_attachment_id ON contract_memory(source_attachment_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_memory_type ON contract_memory(memory_type)`);
  } catch (e) { /* contract_memory table optional */ }

  try {
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_project_id ON contract_clause_memory(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_employee_id ON contract_clause_memory(employee_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_memory_id ON contract_clause_memory(source_memory_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contract_clause_memory_type ON contract_clause_memory(clause_type)`);
  } catch (e) { /* contract_clause_memory table optional */ }

  try {
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_tracking_tasks_email_db_id ON tracking_tasks(email_db_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tracking_tasks_status ON tracking_tasks(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tracking_tasks_due_date ON tracking_tasks(due_date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tracking_tasks_assigned_to ON tracking_tasks(assigned_to)`);
  } catch (e) { /* tracking_tasks table optional */ }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tracking_task_history (
        id BIGSERIAL PRIMARY KEY,
        tracking_task_id BIGINT NOT NULL REFERENCES tracking_tasks(task_id) ON DELETE CASCADE,
        existing_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action_type TEXT DEFAULT 'updated',
        field_name TEXT DEFAULT 'task',
        previous_value TEXT,
        next_value TEXT,
        previous_display TEXT,
        next_display TEXT,
        metadata_json TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_tracking_task_history_task_id ON tracking_task_history(tracking_task_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tracking_task_history_created_at ON tracking_task_history(created_at DESC)`);
  } catch (e) { /* tracking_task_history table optional */ }

  try {
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email_address)`);
  } catch (e) { /* email_accounts table optional */ }

  try {
    await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL`);
  } catch (e) { /* account_id column may already exist */ }

  try {
    await query(`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS signature_html TEXT DEFAULT ''`);
    await query(`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS signature_text TEXT DEFAULT ''`);
  } catch (e) { /* signature columns may already exist */ }

  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS signature TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_priority TEXT DEFAULT 'Normal'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_sensitivity TEXT DEFAULT 'Normal'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_read_receipt BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_delivery_receipt BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS inbox_folder_name TEXT DEFAULT 'Inbox'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sent_folder_name TEXT DEFAULT 'Sent'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sync_sent_items BOOLEAN DEFAULT TRUE");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS graph_tenant_id TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS graph_client_id TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS graph_client_secret TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS graph_mailbox_user TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS company_address TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS company_phone TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS company_website TEXT DEFAULT ''");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS outbound_subject_companies_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS outbound_subject_quotations_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS outbound_subject_clients_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS outbound_subject_studies_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS outbound_subject_admin_subjects_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS enforce_outbound_subject_schema BOOLEAN DEFAULT TRUE");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS default_priority TEXT DEFAULT 'Normal'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS default_sensitivity TEXT DEFAULT 'Normal'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS default_read_receipt BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS default_delivery_receipt BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS inbox_folder_name TEXT DEFAULT 'Inbox'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS sent_folder_name TEXT DEFAULT 'Sent'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS sync_sent_items BOOLEAN DEFAULT TRUE");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS graph_tenant_id TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS graph_client_id TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS graph_client_secret TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS graph_mailbox_user TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS company_address TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS company_phone TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS company_website TEXT DEFAULT ''");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS outbound_subject_companies_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS outbound_subject_quotations_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS outbound_subject_clients_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS outbound_subject_studies_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS outbound_subject_admin_subjects_json TEXT DEFAULT '[]'");
  await query("ALTER TABLE user_mail_settings ADD COLUMN IF NOT EXISTS enforce_outbound_subject_schema BOOLEAN DEFAULT TRUE");
}

async function seedDefaults() {
  const adminUser = await getUserByEmail(defaultAdminEmail);
  if (adminUser) {
    return;
  }

  const { rows: userCountRows } = await query("SELECT COUNT(*)::int AS count FROM users");
  if (userCountRows[0].count) {
    try {
      const userId = await getNextPrimaryKeyId("users");
      await query(
        "INSERT INTO users (id, name, email, password_hash, role, avatar, can_manage_users, can_manage_reports, can_archive) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [userId, "M. Safadi", defaultAdminEmail, bcrypt.hashSync("Admin@123", 10), "Admin", "MS", true, true, true]
      );
    } catch (e) { /* ignore */ }
    return;
  }

  const defaultUsers = [
    {
      name: "M. Safadi",
      email: defaultAdminEmail,
      password: "Admin@123",
      role: "Admin",
      avatar: "MS",
      can_manage_users: true,
      can_manage_reports: true,
      can_archive: true
    },
    {
      name: "Operations Analyst",
      email: "ops@audit.techno-grp.com",
      password: "Analyst123!",
      role: "Analyst",
      avatar: "OA",
      can_manage_users: false,
      can_manage_reports: true,
      can_archive: true
    },
    {
      name: "Viewer",
      email: "viewer@audit.techno-grp.com",
      password: "Viewer123!",
      role: "Viewer",
      avatar: "VW",
      can_manage_users: false,
      can_manage_reports: false,
      can_archive: true
    }
  ];

  for (const user of defaultUsers) {
    const existing = await getUserByEmail(user.email);
    if (existing) continue;
    const userId = await getNextPrimaryKeyId("users");
    await query(
      `
        INSERT INTO users (
          id, name, email, password_hash, role, avatar, can_manage_users, can_manage_reports, can_archive
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        userId,
        user.name,
        user.email,
        bcrypt.hashSync(user.password, 10),
        user.role,
        user.avatar,
        user.can_manage_users,
        user.can_manage_reports,
        user.can_archive
      ]
    );
  }

  const defaultFolders = [
    ["Inbox", "Inbox", 18],
    ["Sent", "Send", 0],
    ["Outbox", "Send", 0],
    ["Drafts", "FilePenLine", 4],
    ["Deleted", "Trash2", 0],
    ["Junk", "ShieldAlert", 2],
    ["Spam", "OctagonAlert", 6],
    ["Archive", "Archive", 1]
  ];

  const { rows: existingFolders } = await query("SELECT name FROM folders");
  const existingFolderNames = new Set(existingFolders.map(r => r.name));

  for (const [name, icon, unreadCount] of defaultFolders) {
    if (existingFolderNames.has(name)) continue;
    const folderId = await getNextPrimaryKeyId("folders");
    await query(
      "INSERT INTO folders (id, name, icon, unread_count) VALUES ($1, $2, $3, $4)",
      [folderId, name, icon, unreadCount]
    );
  }

  const folderLookup = await query("SELECT id, name FROM folders");
  const folderIds = Object.fromEntries(folderLookup.rows.map((row) => [row.name, row.id]));

  const seedEmails = [
    {
      folder_id: folderIds.Inbox,
      sender_name: "Ghaith AlSeid",
      sender_email: "ghaith@techno-grp.com",
      subject: "Tender Follow-up for Variable Frequency Drives",
      body:
        "Please review the tender response before tomorrow noon. The finance team needs the final approval, and the technical file is attached for archiving and reporting.",
      preview: "Please review the tender response before tomorrow noon.",
      received_at: "2026-07-01T15:11:00.000Z",
      is_read: false,
      priority: "High",
      status: "Action Required",
      has_attachments: true,
      recommendation: "Escalate to procurement and finance for same-day review.",
      report_status: "Flagged",
      source: "seed"
    },
    {
      folder_id: folderIds.Drafts,
      sender_name: "Internal Draft",
      sender_email: defaultAdminEmail,
      subject: "Draft Response to Vendor Clarification",
      body:
        "This draft response captures the open technical clarifications requested by the vendor. Keep it in drafts until the compliance team signs off.",
      preview: "This draft response captures the open technical clarifications.",
      received_at: "2026-07-01T12:30:00.000Z",
      is_read: true,
      priority: "Normal",
      status: "Draft",
      has_attachments: false,
      recommendation: "Add compliance note before sending.",
      report_status: "Pending Review",
      source: "seed"
    },
    {
      folder_id: folderIds.Junk,
      sender_name: "Unknown Sender",
      sender_email: "promo@unknown.com",
      subject: "Urgent prize confirmation",
      body:
        "Congratulations, your mailbox has been selected for a special reward. Open the attached file to claim your prize.",
      preview: "Congratulations, your mailbox has been selected.",
      received_at: "2026-07-01T09:18:00.000Z",
      is_read: false,
      priority: "Low",
      status: "Suspicious",
      has_attachments: false,
      recommendation: "Keep quarantined and do not interact with links.",
      report_status: "Blocked",
      source: "seed"
    },
    {
      folder_id: folderIds.Spam,
      sender_name: "External Campaign",
      sender_email: "bulk@marketing.example",
      subject: "Limited-time software discount",
      body:
        "This unsolicited message was automatically routed to spam. It remains archived for compliance and reporting purposes.",
      preview: "This unsolicited message was automatically routed to spam.",
      received_at: "2026-07-01T08:10:00.000Z",
      is_read: true,
      priority: "Low",
      status: "Archived",
      has_attachments: false,
      recommendation: "No action needed.",
      report_status: "Ignored",
      source: "seed"
    },
    {
      folder_id: folderIds.Deleted,
      sender_name: "Hashem Alhijazeen",
      sender_email: "hashem@techno-grp.com",
      subject: "Install update for PO#202600872",
      body:
        "The deleted mailbox retains this message for traceability. The updated purchase order was already filed, but the archive copy is preserved.",
      preview: "The deleted mailbox retains this message for traceability.",
      received_at: "2026-06-30T14:57:00.000Z",
      is_read: true,
      priority: "Normal",
      status: "Archived",
      has_attachments: false,
      recommendation: "Retain for audit trail.",
      report_status: "Closed",
      source: "seed"
    }
  ];

  let tenderEmailId = null;
  for (const email of seedEmails) {
    const serial = await createSerial(email.subject);
    const emailId = await getNextPrimaryKeyId("emails");
    const result = await query(
      `
        INSERT INTO emails (
          id, serial, folder_id, sender_name, sender_email, subject, body, preview, received_at,
          is_read, priority, status, has_attachments, recommendation, report_status, source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id
      `,
      [
        emailId,
        serial,
        email.folder_id,
        email.sender_name,
        email.sender_email,
        email.subject,
        email.body,
        email.preview,
        email.received_at,
        email.is_read,
        email.priority,
        email.status,
        email.has_attachments,
        email.recommendation,
        email.report_status,
        email.source
      ]
    );

    if (email.subject === "Tender Follow-up for Variable Frequency Drives") {
      tenderEmailId = result.rows[0].id;
    }
  }

  const seededAttachment = placeholderAttachmentPath("tender-drive-specs.pdf");
  if (!fs.existsSync(seededAttachment)) {
    fs.writeFileSync(seededAttachment, "Sample archived attachment placeholder.");
  }

  if (tenderEmailId) {
    const seededAttachmentId = await getNextPrimaryKeyId("attachments");
    await query(
      `
        INSERT INTO attachments (id, email_id, file_name, file_path, mime_type, file_size)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [seededAttachmentId, tenderEmailId, "tender-drive-specs.pdf", "/uploads/tender-drive-specs.pdf", "application/pdf", 582144]
    );

    const seededReminderId = await getNextPrimaryKeyId("reminders");
    await query(
      `
        INSERT INTO reminders (id, email_id, title, remind_at, status)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [seededReminderId, tenderEmailId, "Tender response deadline", "2026-07-02T08:00:00.000Z", "Scheduled"]
    );

    const seededRecommendationId = await getNextPrimaryKeyId("recommendations");
    await query(
      `
        INSERT INTO recommendations (id, email_id, summary, confidence, category)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        seededRecommendationId,
        tenderEmailId,
        "Recommend notifying finance, procurement, and legal because the subject contains tender and approval signals.",
        92,
        "Operational"
      ]
    );
  }

  const defaultReports = [
    ["Archived Messages", "Total emails", "1,254", "Up 8%"],
    ["Priority Queue", "High priority", "37", "Up 3%"],
    ["Spam Containment", "Blocked messages", "112", "Stable"],
    ["Attachment Storage", "Files archived", "286", "Up 12%"]
  ];

  for (const report of defaultReports) {
    const reportId = await getNextPrimaryKeyId("reports");
    await query("INSERT INTO reports (id, title, metric, value, trend) VALUES ($1, $2, $3, $4, $5)", [reportId, ...report]);
  }

  const calendarEvents = [
    ["Tender Review Meeting", "2026-07-01T11:00:00.000Z", "2026-07-01T12:00:00.000Z", "Meeting Room A", "Meeting"],
    ["Finance Approval Window", "2026-07-02T09:00:00.000Z", "2026-07-02T10:30:00.000Z", "Finance Office", "Approval"],
    ["Archive Compliance Check", "2026-07-03T13:00:00.000Z", "2026-07-03T14:00:00.000Z", "Dashboard Review", "Audit"]
  ];

  for (const event of calendarEvents) {
    const eventId = await getNextPrimaryKeyId("calendar_events");
    await query(
      "INSERT INTO calendar_events (id, title, starts_at, ends_at, location, category) VALUES ($1, $2, $3, $4, $5, $6)",
      [eventId, ...event]
    );
  }

  await query(
    `
      INSERT INTO app_settings (
        id, company_name, logo_url, display_name, email_address, account_type,
        incoming_server, incoming_port, incoming_ssl, outgoing_server, outgoing_port,
        outgoing_encryption, smtp_auth_required, smtp_same_as_incoming, username, password,
        remember_password, require_spa, leave_copy_on_server, remove_after_days,
        remove_when_deleted, auto_send_receive_minutes, inbox_folder_name, sent_folder_name,
        sync_sent_items, graph_tenant_id, graph_client_id, graph_client_secret, graph_mailbox_user
      )
      VALUES (
        1, $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28
      )
    `,
    [
      "TECHNO GROUP",
      "/logo.gif",
      "M. Safadi",
      defaultAdminEmail,
      "POP3",
      "pop.emailarray.com",
      995,
      true,
      "smtp.emailarray.com",
      465,
      "SSL/TLS",
      true,
      true,
      defaultAdminEmail,
      "Admin@123",
      true,
      false,
      true,
      14,
      false,
      9,
      "Inbox",
      "Sent",
      true,
      "",
      "",
      "",
      defaultAdminEmail
    ]
  );
}

async function sanitizeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar,
    can_manage_users: row.can_manage_users,
    can_manage_reports: row.can_manage_reports,
    can_manage_projects: row.can_manage_projects || false,
    can_manage_tasks: row.can_manage_tasks || false,
    can_manage_keys: row.can_manage_keys || false,
    can_manage_settings: row.can_manage_settings || false,
    can_view_analytics: row.can_view_analytics || false,
    can_manage_backups: row.can_manage_backups || false,
    can_manage_archives: row.can_manage_archives || false,
    can_manage_email_accounts: row.can_manage_email_accounts || false,
    can_archive: row.can_archive,
    manager_id: row.manager_id || null,
    is_active: row.is_active !== undefined ? Boolean(row.is_active) : true,
    phone: row.phone || "",
    department: row.department || "",
    telegram_chat_id: row.telegram_chat_id || "",
    telegram_username: row.telegram_username || "",
    telegram_notifications_enabled: Boolean(row.telegram_notifications_enabled)
  };
}

async function ensureFolder(name, icon = "Mail", unreadCount = 0) {
  const existing = await query("SELECT * FROM folders WHERE name = $1", [name]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const folderId = await getNextPrimaryKeyId("folders");
  const inserted = await query(
    "INSERT INTO folders (id, name, icon, unread_count) VALUES ($1, $2, $3, $4) RETURNING *",
    [folderId, name, icon, unreadCount]
  );
  return inserted.rows[0];
}

async function ensureSystemDefaults() {
  const baselineFolders = [
    ["Inbox", "Inbox", 0],
    ["Sent", "Send", 0],
    ["Outbox", "Send", 0],
    ["Drafts", "FilePenLine", 0],
    ["Deleted", "Trash2", 0],
    ["Junk", "ShieldAlert", 0],
    ["Spam", "OctagonAlert", 0],
    ["Archive", "Archive", 0]
  ];

  for (const [name, icon, unreadCount] of baselineFolders) {
    await ensureFolder(name, icon, unreadCount);
  }

  await query(
    `
      UPDATE users
      SET can_archive = TRUE
      WHERE email = $1 AND can_archive = FALSE
    `,
    ["viewer@audit.techno-grp.com"]
  );

  await query(`UPDATE users SET created_by = 1 WHERE created_by IS NULL AND id != 1`);

  const settings = await getAppSettings();
  if (settings) {
    await restoreSettingsFromFile();
    await migrateLegacyGlobalMailSettingsToUserRows();
  } else {
    await query(
      `
        INSERT INTO app_settings (
          id, company_name, logo_url, display_name, email_address, account_type,
          incoming_server, incoming_port, incoming_ssl, outgoing_server, outgoing_port,
          outgoing_encryption, smtp_auth_required, smtp_same_as_incoming, username, password,
          remember_password, require_spa, leave_copy_on_server, remove_after_days,
          remove_when_deleted, auto_send_receive_minutes, inbox_folder_name, sent_folder_name,
          sync_sent_items, graph_tenant_id, graph_client_id, graph_client_secret, graph_mailbox_user
        )
        VALUES (
          1, $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23,
          $24, $25, $26, $27, $28
        )
      `,
      [
        "TECHNO GROUP",
        "/logo.gif",
        "M. Safadi",
        defaultAdminEmail,
        "POP3",
        "pop.emailarray.com",
        995,
        true,
        "smtp.emailarray.com",
        465,
        "SSL/TLS",
        true,
        true,
        defaultAdminEmail,
        "Admin@123",
        true,
        false,
        true,
        14,
        true,
        9,
        "Inbox",
        "Sent",
        true,
        "",
        "",
        "",
        defaultAdminEmail
      ]
    );
    await migrateLegacyGlobalMailSettingsToUserRows();
  }

  // Ensure employee + manager users exist on every startup with POP3 settings
  const ensureUserWithMailSettings = async (userData, mailSettings) => {
    let user = await getUserByEmail(userData.email);
    if (!user) {
      const userId = await getNextPrimaryKeyId("users");
      const hash = bcrypt.hashSync(userData.password, 10);
      await query(
        `INSERT INTO users (id, name, email, password_hash, role, created_by, manager_id, is_active,
          can_manage_users, can_manage_reports, can_archive, phone, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, TRUE, '', '')`,
        [userId, userData.name, userData.email, hash, userData.role, 1, userData.manager_id || null,
         userData.can_manage_users || false, userData.can_manage_reports || false]
      );
      user = await getUserByEmail(userData.email);
    }
    if (user) {
      const existingMs = await query("SELECT id FROM user_mail_settings WHERE user_id = $1", [user.id]);
      if (!existingMs.rows[0]) {
        await updateMailSettingsForUser(user.id, {
          email_address: mailSettings.email,
          username: mailSettings.email,
          password: mailSettings.password,
          incoming_server: "pop.emailarray.com",
          incoming_port: 995,
          incoming_ssl: true,
          outgoing_server: "smtp.emailarray.com",
          outgoing_port: 465,
          outgoing_encryption: "SSL/TLS",
          smtp_auth_required: true,
          smtp_same_as_incoming: true,
          account_type: "POP3",
          company_name: "TECHNO GROUP",
          logo_url: "/logo.gif",
          display_name: userData.name,
          leave_copy_on_server: true,
          remove_after_days: 14,
          auto_send_receive_minutes: 9,
          remember_password: true
        });
      }
    }
  };

  const managerUser = await getUserByEmail("ahmad.kamal@techno-grp.com");
  if (!managerUser) {
    const managerId = await getNextPrimaryKeyId("users");
    const hash = bcrypt.hashSync("Aa@2024@@!@#", 10);
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, created_by, manager_id, is_active,
        can_manage_users, can_manage_reports, can_archive, phone, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, TRUE, '', '')`,
      [managerId, "Ahmad Kamal", "ahmad.kamal@techno-grp.com", hash, "Admin", 1, null, true, true]
    );
  }

  const manager = await getUserByEmail("ahmad.kamal@techno-grp.com");
  if (manager) {
    const existingMs = await query("SELECT id FROM user_mail_settings WHERE user_id = $1", [manager.id]);
    if (!existingMs.rows[0]) {
      await updateMailSettingsForUser(manager.id, {
        email_address: "ahmad.kamal@techno-grp.com",
        username: "ahmad.kamal@techno-grp.com",
        password: "Aa@2024@@!@#",
        incoming_server: "pop.emailarray.com", incoming_port: 995, incoming_ssl: true,
        outgoing_server: "smtp.emailarray.com", outgoing_port: 465, outgoing_encryption: "SSL/TLS",
        smtp_auth_required: true, smtp_same_as_incoming: true, account_type: "POP3",
        company_name: "TECHNO GROUP", logo_url: "/logo.gif", display_name: "Ahmad Kamal",
        leave_copy_on_server: true, remove_after_days: 14, auto_send_receive_minutes: 9, remember_password: true
      });
    }
  }

  const employeeUser = await getUserByEmail("m.safadi@techno-grp.com");
  if (!employeeUser) {
    const empId = await getNextPrimaryKeyId("users");
    const hash = bcrypt.hashSync("Aa@2024@@!@#", 10);
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, created_by, manager_id, is_active,
        can_manage_users, can_manage_reports, can_archive, phone, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, TRUE, '', '')`,
      [empId, "M. Safadi (Employee)", "m.safadi@techno-grp.com", hash, "Employee", 1, manager?.id || null, false, false]
    );
  }

  const employee = await getUserByEmail("m.safadi@techno-grp.com");
  if (employee) {
    const existingMs = await query("SELECT id FROM user_mail_settings WHERE user_id = $1", [employee.id]);
    if (!existingMs.rows[0]) {
      await updateMailSettingsForUser(employee.id, {
        email_address: "m.safadi@techno-grp.com",
        username: "m.safadi@techno-grp.com",
        password: "Aa@2024@@!@#",
        incoming_server: "pop.emailarray.com", incoming_port: 995, incoming_ssl: true,
        outgoing_server: "smtp.emailarray.com", outgoing_port: 465, outgoing_encryption: "SSL/TLS",
        smtp_auth_required: true, smtp_same_as_incoming: true, account_type: "POP3",
        company_name: "TECHNO GROUP", logo_url: "/logo.gif", display_name: "M. Safadi",
        leave_copy_on_server: true, remove_after_days: 14, auto_send_receive_minutes: 9, remember_password: true
      });
    }
  }

  // Admin does NOT need POP3 - they see all emails via admin override.
  // Remove admin's POP3 config to prevent conflict with employee's POP3.
  const adminUser = await getUserByEmail(defaultAdminEmail);
  if (adminUser) {
    const adminMs = await query("SELECT id FROM user_mail_settings WHERE user_id = $1", [adminUser.id]);
    if (adminMs.rows[0]) {
      await query("DELETE FROM user_mail_settings WHERE user_id = $1", [adminUser.id]);
      console.log("Removed admin POP3 config to avoid conflict with employee mailbox.");
    }
  }
}

async function restoreSettingsFromFile() {
  try {
    if (!fs.existsSync(settingsPath)) return;
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (!saved || !saved.email_address) return;
    await query(
      `UPDATE app_settings SET
        company_name=$1, display_name=$2, email_address=$3, account_type=$4,
        incoming_server=$5, incoming_port=$6, incoming_ssl=$7,
        outgoing_server=$8, outgoing_port=$9, outgoing_encryption=$10,
        smtp_auth_required=$11, smtp_same_as_incoming=$12, username=$13,
        remember_password=$14, require_spa=$15, leave_copy_on_server=$16,
        remove_after_days=$17, remove_when_deleted=$18, auto_send_receive_minutes=$19,
        signature=$20, default_priority=$21, default_sensitivity=$22,
        default_read_receipt=$23, default_delivery_receipt=$24,
        inbox_folder_name=$25, sent_folder_name=$26, sync_sent_items=$27,
        graph_tenant_id=$28, graph_client_id=$29, graph_client_secret=$30, graph_mailbox_user=$31
      WHERE id=1`,
      [
        saved.company_name || "TECHNO GROUP", saved.display_name || "",
        saved.email_address || "", saved.account_type || "POP3",
        saved.incoming_server || "", Number(saved.incoming_port) || 995,
        Boolean(saved.incoming_ssl), saved.outgoing_server || "",
        Number(saved.outgoing_port) || 465, saved.outgoing_encryption || "SSL/TLS",
        Boolean(saved.smtp_auth_required), Boolean(saved.smtp_same_as_incoming),
        saved.username || "", Boolean(saved.remember_password),
        Boolean(saved.require_spa), Boolean(saved.leave_copy_on_server),
        Number(saved.remove_after_days) || 14, Boolean(saved.remove_when_deleted),
        Number(saved.auto_send_receive_minutes) || 9, saved.signature || "",
        saved.default_priority || saved.priority || "Normal",
        saved.default_sensitivity || saved.sensitivity || "Normal",
        Boolean(saved.default_read_receipt ?? saved.read_receipt),
        Boolean(saved.default_delivery_receipt ?? saved.delivery_receipt),
        saved.inbox_folder_name || "Inbox",
        saved.sent_folder_name || "Sent",
        saved.sync_sent_items === undefined ? true : Boolean(saved.sync_sent_items),
        saved.graph_tenant_id || "",
        saved.graph_client_id || "",
        saved.graph_client_secret || "",
        saved.graph_mailbox_user || saved.email_address || ""
      ]
    );
  } catch (e) { /* silent */ }
}

async function getUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const candidateEmails = normalizedEmail === defaultAdminEmail
    ? [defaultAdminEmail, legacyDefaultAdminEmail]
    : normalizedEmail === legacyDefaultAdminEmail
      ? [legacyDefaultAdminEmail, defaultAdminEmail]
      : [normalizedEmail];
  const placeholders = candidateEmails.map((_, index) => `$${index + 1}`).join(", ");
  const { rows } = await query(`SELECT * FROM users WHERE LOWER(email) IN (${placeholders}) ORDER BY CASE WHEN LOWER(email) = $1 THEN 0 ELSE 1 END`, candidateEmails);
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getAllAdminUsers() {
  const { rows } = await query("SELECT * FROM users WHERE role = 'Admin'");
  return rows;
}

async function revokeApprovalActionTokens({
  emailId,
  managerId = null,
  action = null,
  reason = "Approval action link revoked."
}) {
  const filters = ["email_id = $1", "revoked_at IS NULL", "consumed_at IS NULL"];
  const values = [Number(emailId)];
  let nextIndex = 2;

  if (managerId !== null && managerId !== undefined) {
    filters.push(`manager_id = $${nextIndex++}`);
    values.push(Number(managerId));
  }

  if (action) {
    filters.push(`action = $${nextIndex++}`);
    values.push(String(action).toLowerCase());
  }

  values.push(reason || "Approval action link revoked.");

  const result = await query(
    `
      UPDATE approval_action_tokens
      SET revoked_at = NOW(),
          revoked_reason = $${nextIndex}
      WHERE ${filters.join(" AND ")}
    `,
    values
  );

  return { revoked: result.rowCount || 0 };
}

async function issueApprovalActionToken({
  tokenHash,
  tokenNonce,
  emailId,
  approvalRootId = null,
  managerId,
  action,
  expiresAt,
  issuedBy = null,
  deliveryChannel = "app",
  telegramChatId = "",
  metadata = ""
}) {
  await revokeApprovalActionTokens({
    emailId,
    managerId,
    action,
    reason: "Superseded by a newly issued approval link."
  });

  const tokenId = await getNextPrimaryKeyId("approval_action_tokens");
  const result = await query(
    `
      INSERT INTO approval_action_tokens (
        id, token_hash, token_nonce, email_id, approval_root_id, manager_id,
        action, delivery_channel, issued_by, telegram_chat_id, metadata, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `,
    [
      tokenId,
      tokenHash,
      tokenNonce,
      Number(emailId),
      approvalRootId ? Number(approvalRootId) : null,
      Number(managerId),
      String(action || "").toLowerCase(),
      deliveryChannel || "app",
      issuedBy ? Number(issuedBy) : null,
      telegramChatId || "",
      metadata || "",
      expiresAt
    ]
  );

  return result.rows[0] || null;
}

async function getApprovalActionTokenByHash(tokenHash) {
  if (!tokenHash) {
    return null;
  }

  const result = await query(
    `
      SELECT *
      FROM approval_action_tokens
      WHERE token_hash = $1
      LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function consumeApprovalActionToken(tokenHash) {
  if (!tokenHash) {
    return null;
  }

  const result = await query(
    `
      UPDATE approval_action_tokens
      SET consumed_at = NOW()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND revoked_at IS NULL
      RETURNING *
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function getApprovalActionLinksState(emailId, managerId = null) {
  const values = [Number(emailId)];
  let managerClause = "";
  if (managerId !== null && managerId !== undefined) {
    values.push(Number(managerId));
    managerClause = " AND manager_id = $2";
  }

  const { rows } = await query(
    `
      SELECT *
      FROM approval_action_tokens
      WHERE email_id = $1
        ${managerClause}
      ORDER BY created_at DESC, id DESC
    `,
    values
  );

  const latestByAction = {};
  for (const row of rows) {
    if (!latestByAction[row.action]) {
      latestByAction[row.action] = row;
    }
  }

  return {
    approve: latestByAction.approve || null,
    reject: latestByAction.reject || null,
    rows
  };
}

function buildUserMailSettings(user, settings = {}) {
  const parseCatalog = (value, fallback = []) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return fallback;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item || "").trim()).filter(Boolean);
        }
      } catch {
        return trimmed.split(/\r?\n|,/).map((item) => String(item || "").trim()).filter(Boolean);
      }
    }
    return fallback;
  };
  const userName = user?.name || "User";
  const userEmail = user?.email || "";
  const effectiveEmailAddress = settings.user_id ? settings.email_address : userEmail;
  const effectiveUsername = settings.user_id ? settings.username : userEmail;

  return {
    company_name: settings.company_name || "TECHNO GROUP",
    logo_url: settings.logo_url || "",
    company_address: settings.company_address || "",
    company_phone: settings.company_phone || "",
    company_website: settings.company_website || "",
    display_name: settings.display_name || userName,
    email_address: effectiveEmailAddress || userEmail,
    account_type: settings.account_type || "POP3",
    incoming_server: settings.incoming_server || "",
    incoming_port: Number(settings.incoming_port || 995),
    incoming_ssl: settings.incoming_ssl === undefined ? true : Boolean(settings.incoming_ssl),
    outgoing_server: settings.outgoing_server || "",
    outgoing_port: Number(settings.outgoing_port || 465),
    outgoing_encryption: settings.outgoing_encryption || "SSL/TLS",
    smtp_auth_required: settings.smtp_auth_required === undefined ? true : Boolean(settings.smtp_auth_required),
    smtp_same_as_incoming: settings.smtp_same_as_incoming === undefined ? true : Boolean(settings.smtp_same_as_incoming),
    username: effectiveUsername || userEmail,
    password: settings.user_id ? (settings.password || "") : "",
    remember_password: settings.remember_password === undefined ? true : Boolean(settings.remember_password),
    require_spa: Boolean(settings.require_spa),
    leave_copy_on_server: settings.leave_copy_on_server === undefined ? true : Boolean(settings.leave_copy_on_server),
    remove_after_days: Number(settings.remove_after_days || 14),
    remove_when_deleted: Boolean(settings.remove_when_deleted),
    auto_send_receive_minutes: Number(settings.auto_send_receive_minutes || 9),
    inbox_folder_name: settings.inbox_folder_name || "Inbox",
    sent_folder_name: settings.sent_folder_name || "Sent",
    sync_sent_items: settings.sync_sent_items === undefined ? true : Boolean(settings.sync_sent_items),
    graph_tenant_id: settings.graph_tenant_id || "",
    graph_client_id: settings.graph_client_id || "",
    graph_client_secret: settings.graph_client_secret || "",
    graph_mailbox_user: settings.graph_mailbox_user || effectiveEmailAddress || userEmail || "",
    priority: settings.priority || settings.default_priority || "Normal",
    sensitivity: settings.sensitivity || settings.default_sensitivity || "Normal",
    read_receipt:
      settings.read_receipt === undefined
        ? Boolean(settings.default_read_receipt)
        : Boolean(settings.read_receipt),
    delivery_receipt:
      settings.delivery_receipt === undefined
        ? Boolean(settings.default_delivery_receipt)
        : Boolean(settings.delivery_receipt),
    signature: settings.signature || "",
    outbound_subject_companies: parseCatalog(settings.outbound_subject_companies ?? settings.outbound_subject_companies_json, []),
    outbound_subject_quotations: parseCatalog(settings.outbound_subject_quotations ?? settings.outbound_subject_quotations_json, []),
    outbound_subject_clients: parseCatalog(settings.outbound_subject_clients ?? settings.outbound_subject_clients_json, []),
    outbound_subject_studies: parseCatalog(settings.outbound_subject_studies ?? settings.outbound_subject_studies_json, []),
    outbound_subject_admin_subjects: parseCatalog(settings.outbound_subject_admin_subjects ?? settings.outbound_subject_admin_subjects_json, []),
    enforce_outbound_subject_schema:
      settings.enforce_outbound_subject_schema === undefined
        ? true
        : Boolean(settings.enforce_outbound_subject_schema),
    user_id: user?.id || settings.user_id || null
  };
}

async function getAppSettings() {
  const { rows } = await query("SELECT * FROM app_settings WHERE id = 1");
  return rows[0] || null;
}

async function migrateLegacyGlobalMailSettingsToUserRows() {
  const appSettings = await getAppSettings();
  if (!appSettings?.email_address || !appSettings?.password) {
    return null;
  }

  const ownerUser = await getUserByEmail(appSettings.email_address);
  if (!ownerUser) {
    return null;
  }

  const existing = await query("SELECT id FROM user_mail_settings WHERE user_id = $1", [ownerUser.id]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  return updateMailSettingsForUser(ownerUser.id, {
    ...appSettings,
    email_address: appSettings.email_address,
    username: appSettings.username || appSettings.email_address,
    password: appSettings.password
  });
}

async function getMailSettingsForUser(userId) {
  const user = await getUserById(userId);
  if (!user) {
    return null;
  }

  const [appSettings, result] = await Promise.all([
    getAppSettings(),
    query("SELECT * FROM user_mail_settings WHERE user_id = $1", [userId])
  ]);

  return buildUserMailSettings(user, {
    ...(appSettings || {}),
    ...(result.rows[0] || {})
  });
}

async function listConfiguredMailSettings() {
  const result = await query(
    `
      SELECT settings.*, users.email AS user_email, users.name AS user_name
      FROM user_mail_settings settings
      JOIN users ON users.id = settings.user_id
      WHERE users.is_active = TRUE
        AND COALESCE(settings.email_address, '') <> ''
        AND COALESCE(settings.outgoing_server, '') <> ''
        AND (
          (
            UPPER(COALESCE(settings.account_type, 'POP3')) = 'GRAPH'
            AND COALESCE(settings.graph_tenant_id, '') <> ''
            AND COALESCE(settings.graph_client_id, '') <> ''
            AND COALESCE(settings.graph_client_secret, '') <> ''
            AND COALESCE(settings.graph_mailbox_user, settings.email_address, '') <> ''
          )
          OR
          (
            UPPER(COALESCE(settings.account_type, 'POP3')) <> 'GRAPH'
            AND COALESCE(settings.username, '') <> ''
            AND COALESCE(settings.password, '') <> ''
            AND COALESCE(settings.incoming_server, '') <> ''
          )
        )
      ORDER BY settings.user_id ASC
    `
  );

  return result.rows.map((row) =>
    buildUserMailSettings(
      { id: row.user_id, name: row.user_name, email: row.user_email },
      row
    )
  );
}

async function listBootstrapData(currentUserId) {
  const currentUser = await getUserById(currentUserId);
  // The daily mail workspace is always scoped to the signed-in user.
  // Managers review employee submissions through Pending Approvals, not via employee mailboxes.
  // Admin (user_id=1) sees all emails.
  const isAdminOverride = currentUserId === 1;
  const folderScopeJoin = isAdminOverride
    ? "LEFT JOIN emails ON emails.folder_id = folders.id"
    : "LEFT JOIN emails ON emails.folder_id = folders.id AND emails.employee_id = $1";
  const folderScopeParams = isAdminOverride ? [] : [currentUserId];
  const emailScopeWhere = isAdminOverride ? "" : "WHERE emails.employee_id = $1";
  const scopedEmailParams = isAdminOverride ? [] : [currentUserId];

  const [folders, emails, attachments, reminders, recommendations, reports, calendar, settings] = await Promise.all([
    query(
      `
      SELECT
        folders.id,
        folders.name,
        folders.icon,
        COUNT(emails.id)::int AS message_count,
        SUM(CASE WHEN emails.is_read = FALSE OR emails.is_read = 'false' THEN 1 ELSE 0 END)::int AS unread_count
      FROM folders
      ${folderScopeJoin}
      GROUP BY folders.id, folders.name, folders.icon
      ORDER BY folders.id
    `,
      folderScopeParams
    ),
    query(
      `
        SELECT
          emails.*,
          folders.name AS folder_name,
          outbox_queue.attempts AS queue_attempts,
          outbox_queue.last_error AS queue_last_error,
          outbox_queue.next_attempt_at,
          outbox_queue.status AS queue_status
        FROM emails
        JOIN folders ON folders.id = emails.folder_id
        LEFT JOIN outbox_queue ON outbox_queue.email_id = emails.id
        ${emailScopeWhere}
        ORDER BY received_at DESC
      `,
      scopedEmailParams
    ),
    query(
      isAdminOverride
        ? `SELECT attachments.* FROM attachments JOIN emails ON emails.id = attachments.email_id ORDER BY attachments.id DESC`
        : `SELECT attachments.* FROM attachments JOIN emails ON emails.id = attachments.email_id WHERE emails.employee_id = $1 OR emails.assigned_manager_id = $1 ORDER BY attachments.id DESC`,
      scopedEmailParams
    ),
    query(
      isAdminOverride
        ? `SELECT reminders.* FROM reminders JOIN emails ON emails.id = reminders.email_id ORDER BY reminders.remind_at ASC`
        : `SELECT reminders.* FROM reminders JOIN emails ON emails.id = reminders.email_id WHERE emails.employee_id = $1 ORDER BY reminders.remind_at ASC`,
      scopedEmailParams
    ),
    query(
      isAdminOverride
        ? `SELECT recommendations.* FROM recommendations JOIN emails ON emails.id = recommendations.email_id ORDER BY recommendations.confidence DESC`
        : `SELECT recommendations.* FROM recommendations JOIN emails ON emails.id = recommendations.email_id WHERE emails.employee_id = $1 ORDER BY recommendations.confidence DESC`,
      scopedEmailParams
    ),
    query("SELECT * FROM reports ORDER BY id"),
    query("SELECT * FROM calendar_events ORDER BY starts_at ASC"),
    getMailSettingsForUser(currentUserId)
  ]);

  return {
    currentUser: await sanitizeUser(currentUser),
    settings: settings || null,
    folders: folders.rows,
    emails: emails.rows,
    attachments: attachments.rows,
    reminders: reminders.rows,
    recommendations: recommendations.rows,
    reports: reports.rows,
    calendar: calendar.rows
  };
}

async function createEmail(email, files = [], source = "manual", employeeId = null) {
  const folderResult = await query(
    "SELECT * FROM folders WHERE id = $1 OR name = $2 LIMIT 1",
    [Number(email.folder_id) || 0, email.folder_name || "Inbox"]
  );
  const folder = folderResult.rows[0];

  if (!folder) {
    throw new Error("Folder does not exist");
  }

  const serial = email.serial || await createSerial(email.subject);
  const preview = email.preview || email.body.slice(0, 120);
  const externalMessageId = email.external_message_id || null;
  const emailId = await getNextPrimaryKeyId("emails");

  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS serialized BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS serialized_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES emails(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS thread_depth INTEGER DEFAULT 0");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_root_id INTEGER REFERENCES emails(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS subject_key TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS assigned_manager_id INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id)");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS manager_comments TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS approval_decision_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ DEFAULT NOW()");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_sentiment TEXT DEFAULT 'Unknown'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_tone_score INTEGER DEFAULT 0");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_recommendations TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS needs_revision BOOLEAN DEFAULT FALSE");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'low'");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS risk_flags TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_reminder_slot TEXT DEFAULT ''");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
  await query("ALTER TABLE emails ADD COLUMN IF NOT EXISTS email_key_id INTEGER REFERENCES email_keys(id) ON DELETE SET NULL");
  await query("ALTER TABLE attachments ADD COLUMN IF NOT EXISTS content_id TEXT");
  await query("ALTER TABLE attachments ADD COLUMN IF NOT EXISTS is_inline BOOLEAN DEFAULT FALSE");
  const inserted = await query(
    `
      INSERT INTO emails (
        id,
        serial, folder_id, sender_name, sender_email, recipient_name, recipient_email, cc_list, bcc_list,
        subject, body, body_html, preview, received_at, queued_at, sent_at,
        is_read, priority, status, has_attachments, recommendation, report_status, source, external_message_id,
        sensitivity, read_receipt, delivery_receipt, employee_id, approval_status, approved_by, approved_at,
        parent_id, thread_depth, rejection_reason, approval_root_id, version_number, subject_key,
        assigned_manager_id, submitted_by, manager_comments, approval_requested_at, approval_decision_at,
        last_action_at, ai_sentiment, ai_tone_score, ai_recommendations, ai_provider, needs_revision,
        risk_level, risk_flags, reminder_count, last_reminder_at, last_reminder_slot, account_id,
        project_id, email_key_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56)
      RETURNING *
    `,
    [
      emailId,
      serial,
      folder.id,
      email.sender_name,
      email.sender_email,
      email.recipient_name || null,
      email.recipient_email || null,
      email.cc_list || null,
      email.bcc_list || null,
      email.subject,
      email.body,
      email.body_html || null,
      preview,
      email.received_at || new Date().toISOString(),
      email.queued_at || null,
      email.sent_at || null,
      Boolean(email.is_read),
      email.priority || "Normal",
      email.status || "Archived",
      Boolean(files.length),
      email.recommendation || "Review based on workflow rules.",
      email.report_status || "Pending Review",
      source,
      externalMessageId,
      email.sensitivity || "Normal",
      Boolean(email.read_receipt),
      Boolean(email.delivery_receipt),
      employeeId || email.employee_id || null,
      email.approval_status || 'none',
      email.approved_by || null,
      email.approved_at || null,
      email.parent_id || null,
      email.thread_depth || 0,
      email.rejection_reason || "",
      email.approval_root_id || null,
      Number(email.version_number || 1),
      email.subject_key || "",
      email.assigned_manager_id || null,
      email.submitted_by || employeeId || email.employee_id || null,
      email.manager_comments || "",
      email.approval_requested_at || null,
      email.approval_decision_at || null,
      email.last_action_at || new Date().toISOString(),
      email.ai_sentiment || "Unknown",
      Number(email.ai_tone_score || 0),
      email.ai_recommendations || "",
      email.ai_provider || "rules",
      Boolean(email.needs_revision),
      email.risk_level || "low",
      Array.isArray(email.risk_flags) ? email.risk_flags.join(",") : email.risk_flags || "",
      Number(email.reminder_count || 0),
      email.last_reminder_at || null,
      email.last_reminder_slot || "",
      email.account_id || null,
      email.project_id || null,
      email.email_key_id || null
    ]
  );

  const savedEmail = inserted.rows[0];

  if (employeeId) {
    if (email.sender_email) await upsertRecentContact(employeeId, email.sender_email, email.sender_name || "");
    if (email.recipient_email) await upsertRecentContact(employeeId, email.recipient_email, email.recipient_name || "");
    if (email.cc_list) {
      for (const r of String(email.cc_list).split(/[,\n;]+/)) {
        const trimmed = r.trim();
        if (trimmed) await upsertRecentContact(employeeId, trimmed, "");
      }
    }
  }

  for (const file of files) {
    const attachmentId = await getNextPrimaryKeyId("attachments");
    await query(
      `
        INSERT INTO attachments (id, email_id, file_name, file_path, mime_type, file_size, content_id, is_inline)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        attachmentId,
        savedEmail.id,
        file.originalname,
        `/uploads/${path.basename(file.path)}`,
        file.mimetype,
        file.size,
        file.contentId || file.content_id || null,
        Boolean(file.isInline || file.is_inline)
      ]
    );
  }

  if (email.reminder_title && email.remind_at) {
    const reminderId = await getNextPrimaryKeyId("reminders");
    await query(
      `
        INSERT INTO reminders (id, email_id, title, remind_at, status)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [reminderId, savedEmail.id, email.reminder_title, email.remind_at, "Scheduled"]
    );
  }

  const recommendationId = await getNextPrimaryKeyId("recommendations");
  await query(
    `
      INSERT INTO recommendations (id, email_id, summary, confidence, category)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [recommendationId, savedEmail.id, email.recommendation || `Recommended follow-up for subject "${email.subject}".`, 86, "Automation"]
  );

  if (!email.is_read) {
    await query("UPDATE folders SET unread_count = unread_count + 1 WHERE id = $1", [folder.id]);
  }

  const fullEmail = await query(
    `
      SELECT emails.*, folders.name AS folder_name
      FROM emails
      JOIN folders ON folders.id = emails.folder_id
      WHERE emails.id = $1
    `,
    [savedEmail.id]
  );
  await syncEmailRegistryForEmail(fullEmail.rows[0]);
  return fullEmail.rows[0];
}

async function updateAppSettings(settings) {
  const result = await query(
    `
      UPDATE app_settings
      SET
        company_name = $1,
        logo_url = $2,
        company_address = $3,
        company_phone = $4,
        company_website = $5,
        display_name = $6,
        email_address = $7,
        account_type = $8,
        incoming_server = $9,
        incoming_port = $10,
        incoming_ssl = $11,
        outgoing_server = $12,
        outgoing_port = $13,
        outgoing_encryption = $14,
        smtp_auth_required = $15,
        smtp_same_as_incoming = $16,
        username = $17,
        password = $18,
        remember_password = $19,
        require_spa = $20,
        leave_copy_on_server = $21,
        remove_after_days = $22,
        remove_when_deleted = $23,
        auto_send_receive_minutes = $24,
        signature = $25,
        default_priority = $26,
        default_sensitivity = $27,
        default_read_receipt = $28,
        default_delivery_receipt = $29,
        inbox_folder_name = $30,
        sent_folder_name = $31,
        sync_sent_items = $32,
        graph_tenant_id = $33,
        graph_client_id = $34,
        graph_client_secret = $35,
        graph_mailbox_user = $36,
        outbound_subject_companies_json = $37,
        outbound_subject_quotations_json = $38,
        outbound_subject_clients_json = $39,
        outbound_subject_studies_json = $40,
        outbound_subject_admin_subjects_json = $41,
        enforce_outbound_subject_schema = $42
      WHERE id = 1
      RETURNING *
    `,
    [
      settings.company_name,
      settings.logo_url || "",
      settings.company_address || "",
      settings.company_phone || "",
      settings.company_website || "",
      settings.display_name,
      settings.email_address,
      settings.account_type,
      settings.incoming_server,
      Number(settings.incoming_port),
      Boolean(settings.incoming_ssl),
      settings.outgoing_server,
      Number(settings.outgoing_port),
      settings.outgoing_encryption,
      Boolean(settings.smtp_auth_required),
      Boolean(settings.smtp_same_as_incoming),
      settings.username,
      settings.password,
      Boolean(settings.remember_password),
      Boolean(settings.require_spa),
      Boolean(settings.leave_copy_on_server),
      Number(settings.remove_after_days),
      Boolean(settings.remove_when_deleted),
      Number(settings.auto_send_receive_minutes),
      settings.signature || "",
      settings.default_priority || settings.priority || "Normal",
      settings.default_sensitivity || settings.sensitivity || "Normal",
      Boolean(settings.default_read_receipt ?? settings.read_receipt),
      Boolean(settings.default_delivery_receipt ?? settings.delivery_receipt),
      settings.inbox_folder_name || "Inbox",
      settings.sent_folder_name || "Sent",
      settings.sync_sent_items === undefined ? true : Boolean(settings.sync_sent_items),
      settings.graph_tenant_id || "",
      settings.graph_client_id || "",
      settings.graph_client_secret || "",
      settings.graph_mailbox_user || settings.email_address || "",
      JSON.stringify(Array.isArray(settings.outbound_subject_companies) ? settings.outbound_subject_companies : []),
      JSON.stringify(Array.isArray(settings.outbound_subject_quotations) ? settings.outbound_subject_quotations : []),
      JSON.stringify(Array.isArray(settings.outbound_subject_clients) ? settings.outbound_subject_clients : []),
      JSON.stringify(Array.isArray(settings.outbound_subject_studies) ? settings.outbound_subject_studies : []),
      JSON.stringify(Array.isArray(settings.outbound_subject_admin_subjects) ? settings.outbound_subject_admin_subjects : []),
      settings.enforce_outbound_subject_schema === undefined ? true : Boolean(settings.enforce_outbound_subject_schema)
    ]
  );
  const updated = result.rows[0];
  if (updated) {
    try {
      const { password, ...safe } = updated;
      writeJsonAtomic(settingsPath, safe);
    } catch (e) { /* silent */ }
  }
  return updated;
}

async function updateMailSettingsForUser(userId, settings) {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const [appSettings, existingSettingsResult] = await Promise.all([
    getAppSettings(),
    query("SELECT * FROM user_mail_settings WHERE user_id = $1", [userId])
  ]);
  const existingSettings = existingSettingsResult.rows[0] || {};
  const normalized = buildUserMailSettings(user, {
    ...(appSettings || {}),
    ...(existingSettings || {}),
    ...(settings || {})
  });

  normalized.user_id = userId;
  normalized.email_address =
    settings?.email_address ||
    existingSettings.email_address ||
    user.email ||
    "";
  normalized.username =
    settings?.username ||
    existingSettings.username ||
    user.email ||
    "";
  normalized.password =
    settings?.password ??
    existingSettings.password ??
    "";
  const settingsId = existingSettings.id || await getNextPrimaryKeyId("user_mail_settings");

  const result = await query(
    `
      INSERT INTO user_mail_settings (
        id, user_id, company_name, logo_url, company_address, company_phone, company_website, display_name, email_address, account_type,
        incoming_server, incoming_port, incoming_ssl, outgoing_server, outgoing_port,
        outgoing_encryption, smtp_auth_required, smtp_same_as_incoming, username, password,
        remember_password, require_spa, leave_copy_on_server, remove_after_days,
        remove_when_deleted, auto_send_receive_minutes, default_priority, default_sensitivity,
        default_read_receipt, default_delivery_receipt, signature, inbox_folder_name, sent_folder_name,
        sync_sent_items, graph_tenant_id, graph_client_id, graph_client_secret, graph_mailbox_user,
        outbound_subject_companies_json, outbound_subject_quotations_json, outbound_subject_clients_json,
        outbound_subject_studies_json, outbound_subject_admin_subjects_json, enforce_outbound_subject_schema, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44, NOW()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        company_name = EXCLUDED.company_name,
        logo_url = EXCLUDED.logo_url,
        company_address = EXCLUDED.company_address,
        company_phone = EXCLUDED.company_phone,
        company_website = EXCLUDED.company_website,
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
        default_priority = EXCLUDED.default_priority,
        default_sensitivity = EXCLUDED.default_sensitivity,
        default_read_receipt = EXCLUDED.default_read_receipt,
        default_delivery_receipt = EXCLUDED.default_delivery_receipt,
        signature = EXCLUDED.signature,
        inbox_folder_name = EXCLUDED.inbox_folder_name,
        sent_folder_name = EXCLUDED.sent_folder_name,
        sync_sent_items = EXCLUDED.sync_sent_items,
        graph_tenant_id = EXCLUDED.graph_tenant_id,
        graph_client_id = EXCLUDED.graph_client_id,
        graph_client_secret = EXCLUDED.graph_client_secret,
        graph_mailbox_user = EXCLUDED.graph_mailbox_user,
        outbound_subject_companies_json = EXCLUDED.outbound_subject_companies_json,
        outbound_subject_quotations_json = EXCLUDED.outbound_subject_quotations_json,
        outbound_subject_clients_json = EXCLUDED.outbound_subject_clients_json,
        outbound_subject_studies_json = EXCLUDED.outbound_subject_studies_json,
        outbound_subject_admin_subjects_json = EXCLUDED.outbound_subject_admin_subjects_json,
        enforce_outbound_subject_schema = EXCLUDED.enforce_outbound_subject_schema,
        updated_at = NOW()
      RETURNING *
    `,
    [
      settingsId,
      userId,
      normalized.company_name,
      normalized.logo_url || "",
      normalized.company_address || "",
      normalized.company_phone || "",
      normalized.company_website || "",
      normalized.display_name,
      normalized.email_address,
      normalized.account_type,
      normalized.incoming_server,
      Number(normalized.incoming_port),
      Boolean(normalized.incoming_ssl),
      normalized.outgoing_server,
      Number(normalized.outgoing_port),
      normalized.outgoing_encryption,
      Boolean(normalized.smtp_auth_required),
      Boolean(normalized.smtp_same_as_incoming),
      normalized.username,
      normalized.password,
      Boolean(normalized.remember_password),
      Boolean(normalized.require_spa),
      Boolean(normalized.leave_copy_on_server),
      Number(normalized.remove_after_days),
      Boolean(normalized.remove_when_deleted),
      Number(normalized.auto_send_receive_minutes),
      normalized.priority || "Normal",
      normalized.sensitivity || "Normal",
      Boolean(normalized.read_receipt),
      Boolean(normalized.delivery_receipt),
      normalized.signature || "",
      normalized.inbox_folder_name || "Inbox",
      normalized.sent_folder_name || "Sent",
      normalized.sync_sent_items === undefined ? true : Boolean(normalized.sync_sent_items),
      normalized.graph_tenant_id || "",
      normalized.graph_client_id || "",
      normalized.graph_client_secret || "",
      normalized.graph_mailbox_user || normalized.email_address || "",
      JSON.stringify(Array.isArray(normalized.outbound_subject_companies) ? normalized.outbound_subject_companies : []),
      JSON.stringify(Array.isArray(normalized.outbound_subject_quotations) ? normalized.outbound_subject_quotations : []),
      JSON.stringify(Array.isArray(normalized.outbound_subject_clients) ? normalized.outbound_subject_clients : []),
      JSON.stringify(Array.isArray(normalized.outbound_subject_studies) ? normalized.outbound_subject_studies : []),
      JSON.stringify(Array.isArray(normalized.outbound_subject_admin_subjects) ? normalized.outbound_subject_admin_subjects : []),
      normalized.enforce_outbound_subject_schema === undefined ? true : Boolean(normalized.enforce_outbound_subject_schema)
    ]
  );

  const updated = buildUserMailSettings(user, result.rows[0]);
  try { await savePersistentState(); } catch (e) { /* silent */ }
  return updated;
}

async function importSyncedEmails(items = []) {
  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.external_message_id) {
      const existing = await query("SELECT id FROM emails WHERE external_message_id = $1", [item.external_message_id]);
      if (existing.rows.length) {
        skipped += 1;
        continue;
      }
    }

    const subject = item.subject || "Imported email";
    let serial = null;
    let subjectKey = null;

    if (item.serial) {
      serial = item.serial;
      const keyParts = serial.split("-");
      if (keyParts.length >= 2) subjectKey = keyParts[0];
    } else {
      const subjectMatch = subject.match(/\[REF:\s*([^\]]+)\]/i);
      if (subjectMatch) {
        serial = subjectMatch[1].trim();
        const keyParts = serial.split("-");
        if (keyParts.length >= 2) subjectKey = keyParts[0];
      }
    }

    if (!serial && (item.in_reply_to || item.references_header)) {
      serial = await resolveSerialFromHeaders(item.message_id, item.in_reply_to, item.references_header);
      if (serial) {
        const keyParts = serial.split("-");
        if (keyParts.length >= 2) subjectKey = keyParts[0];
      }
    }

    if (!serial) {
      const serialInfo = await createSerialFromSubjectKey(subject, "", new Date());
      serial = serialInfo.serial;
      subjectKey = serialInfo.subjectKey;
    }

    let parentId = null;
    let threadDepth = 0;
    let approvalRootId = null;
    if (serial) {
      const parentResult = await query(
        `SELECT id, approval_root_id, thread_depth FROM emails WHERE serial = $1 ORDER BY id DESC LIMIT 1`,
        [serial]
      );
      if (parentResult.rows.length > 0) {
        const parent = parentResult.rows[0];
        parentId = parent.id;
        threadDepth = (parent.thread_depth || 0) + 1;
        approvalRootId = parent.approval_root_id || parent.id;
      }
    }

    const archivedEmail = await createEmail(
      {
        serial,
        subject_key: subjectKey,
        parent_id: parentId,
        thread_depth: threadDepth,
        approval_root_id: approvalRootId || null,
        folder_name: item.folder_name || "Inbox",
        sender_name: item.sender_name || "Mailbox Sync",
        sender_email: item.sender_email || "sync@emailarray.local",
        subject,
        body: item.body || "",
        preview: item.preview || "",
        received_at: item.received_at,
        priority: item.priority || "Normal",
        status: item.status || "Archived",
        recommendation: serial ? `Archived with serial ${serial}. Thread depth: ${threadDepth}.` : "Imported from existing mail sync pipeline.",
        report_status: item.report_status || "Pending Review",
        external_message_id: item.external_message_id,
        reminder_title: item.reminder_title,
        remind_at: item.remind_at
      },
      [],
      "sync"
    );

    if (item.message_id && archivedEmail) {
      await trackEmailThread(item.message_id, item.in_reply_to, item.references_header, serial, archivedEmail.id, subject, item.sender_email || "");
    }

    inserted += 1;
  }

  return { inserted, skipped };
}

async function emailExistsByExternalMessageId(externalMessageId) {
  if (!externalMessageId) {
    return false;
  }

  const existing = await query("SELECT id FROM emails WHERE external_message_id = $1", [externalMessageId]);
  return Boolean(existing.rows[0]);
}

async function getEmailByExternalMessageId(externalMessageId) {
  if (!externalMessageId) {
    return null;
  }

  const result = await query(
    `
      SELECT emails.*, folders.name AS folder_name
      FROM emails
      JOIN folders ON folders.id = emails.folder_id
      WHERE emails.external_message_id = $1
      LIMIT 1
    `,
    [externalMessageId]
  );

  return result.rows[0] || null;
}

async function getEmailAttachments(emailId) {
  const result = await query("SELECT * FROM attachments WHERE email_id = $1 ORDER BY id", [emailId]);
  return result.rows;
}

async function listLegacyAttachmentRepairCandidates({ userId = null, limit = 100 } = {}) {
  const values = [];
  const whereClauses = [
    "emails.source = 'pop3'",
    "COALESCE(emails.external_message_id, '') LIKE 'pop3:%'",
    "(emails.has_attachments = TRUE OR emails.has_attachments = 'true')"
  ];

  if (userId) {
    values.push(Number(userId));
    whereClauses.push(`emails.employee_id = $${values.length}`);
  }

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  values.push(normalizedLimit);
  const limitPlaceholder = `$${values.length}`;

  const result = await query(
    `
      SELECT
        emails.*,
        folders.name AS folder_name,
        COALESCE(attachment_counts.attachment_count, 0)::int AS attachment_count
      FROM emails
      JOIN folders ON folders.id = emails.folder_id
      LEFT JOIN (
        SELECT email_id, COUNT(*)::int AS attachment_count
        FROM attachments
        GROUP BY email_id
      ) attachment_counts ON attachment_counts.email_id = emails.id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY COALESCE(emails.received_at, emails.sent_at, emails.last_action_at) DESC, emails.id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );

  return result.rows;
}

async function replaceEmailAttachments(emailId, files = []) {
  const normalizedEmailId = Number(emailId || 0);
  if (!normalizedEmailId) {
    throw new Error("Email id is required.");
  }

  const existingAttachments = await getEmailAttachments(normalizedEmailId);
  const newPublicPaths = new Set(
    (files || [])
      .map((file) => `/uploads/${path.basename(file.path || file.file_path || "")}`)
      .filter(Boolean)
  );

  await query("DELETE FROM attachments WHERE email_id = $1", [normalizedEmailId]);

  for (const file of files || []) {
    const attachmentId = await getNextPrimaryKeyId("attachments");
    await query(
      `
        INSERT INTO attachments (id, email_id, file_name, file_path, mime_type, file_size, content_id, is_inline)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        attachmentId,
        normalizedEmailId,
        file.originalname,
        `/uploads/${path.basename(file.path || file.file_path || "")}`,
        file.mimetype || file.mime_type || "application/octet-stream",
        Number(file.size || file.file_size || 0),
        file.contentId || file.content_id || null,
        Boolean(file.isInline || file.is_inline)
      ]
    );
  }

  for (const attachment of existingAttachments) {
    const publicPath = String(attachment.file_path || "").trim();
    if (!publicPath || newPublicPaths.has(publicPath)) {
      continue;
    }
    const diskPath = resolveStoredAttachmentDiskPath(publicPath);
    if (!diskPath || !fs.existsSync(diskPath)) {
      continue;
    }
    try {
      fs.unlinkSync(diskPath);
    } catch {
      // Ignore stale files that cannot be deleted.
    }
  }

  return getEmailAttachments(normalizedEmailId);
}

async function updateEmailAttachmentRepairState(emailId, { hasAttachments, bodyHtml } = {}) {
  const normalizedEmailId = Number(emailId || 0);
  if (!normalizedEmailId) {
    throw new Error("Email id is required.");
  }

  const result = await query(
    `
      UPDATE emails
      SET
        has_attachments = COALESCE($2, has_attachments),
        body_html = COALESCE($3, body_html),
        last_action_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      normalizedEmailId,
      typeof hasAttachments === "boolean" ? hasAttachments : null,
      typeof bodyHtml === "string" && bodyHtml.trim() ? bodyHtml : null
    ]
  );

  return result.rows[0] || null;
}

async function getEmailById(emailId) {
  const result = await query(
    `
      SELECT emails.*, folders.name AS folder_name
      FROM emails
      JOIN folders ON folders.id = emails.folder_id
      WHERE emails.id = $1
      LIMIT 1
    `,
    [emailId]
  );

  return result.rows[0] || null;
}

async function queueOutgoingEmail(emailId, errorMessage = "SMTP delivery queued.") {
  const nextAttemptAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const queueId = await getNextPrimaryKeyId("outbox_queue");
  const result = await query(
    `
      INSERT INTO outbox_queue (id, email_id, attempts, queued_at, last_attempt_at, next_attempt_at, last_error, status)
      VALUES ($1, $2, 1, NOW(), NOW(), $3, $4, 'Queued')
      ON CONFLICT (email_id)
      DO UPDATE SET
        attempts = outbox_queue.attempts + 1,
        last_attempt_at = NOW(),
        next_attempt_at = $3,
        last_error = $4,
        status = 'Queued'
      RETURNING *
    `,
    [queueId, emailId, nextAttemptAt, errorMessage]
  );

  return result.rows[0];
}

async function listDueOutboxEmails(employeeId = null) {
  const values = [];
  const employeeClause = employeeId ? ` AND emails.employee_id = $1` : "";
  if (employeeId) {
    values.push(Number(employeeId));
  }

  const result = await query(
    `
      SELECT
        outbox_queue.id AS queue_id,
        outbox_queue.attempts,
        outbox_queue.queued_at AS queue_queued_at,
        outbox_queue.last_attempt_at,
        outbox_queue.next_attempt_at,
        outbox_queue.last_error,
        outbox_queue.status AS queue_status,
        emails.*
      FROM outbox_queue
      JOIN emails ON emails.id = outbox_queue.email_id
      WHERE outbox_queue.status = 'Queued'
        AND outbox_queue.next_attempt_at <= NOW()
        ${employeeClause}
      ORDER BY outbox_queue.next_attempt_at ASC, outbox_queue.id ASC
    `,
    values
  );

  return result.rows;
}

async function getQueuedOutboxEmail(emailId, employeeId = null) {
  const values = [emailId];
  const employeeClause = employeeId ? " AND emails.employee_id = $2" : "";
  if (employeeId) {
    values.push(Number(employeeId));
  }

  const result = await query(
    `
      SELECT
        outbox_queue.id AS queue_id,
        outbox_queue.attempts,
        outbox_queue.queued_at AS queue_queued_at,
        outbox_queue.last_attempt_at,
        outbox_queue.next_attempt_at,
        outbox_queue.last_error,
        outbox_queue.status AS queue_status,
        emails.*
      FROM outbox_queue
      JOIN emails ON emails.id = outbox_queue.email_id
      WHERE outbox_queue.email_id = $1
        ${employeeClause}
      LIMIT 1
    `,
    values
  );

  return result.rows[0] || null;
}

async function markOutboxSent(emailId, externalMessageId) {
  const sentFolder = await ensureFolder("Sent", "Send", 0);
  await query(
    `
      UPDATE emails
      SET
        folder_id = $2,
        status = 'Sent',
        sent_at = NOW(),
        external_message_id = $3,
        is_read = TRUE,
        approval_status = CASE
          WHEN approval_status = 'approved' THEN 'sent'
          ELSE approval_status
        END,
        report_status = CASE
          WHEN approval_status = 'approved' THEN 'Delivered after approval'
          ELSE report_status
        END,
        last_action_at = NOW()
      WHERE id = $1
    `,
    [emailId, sentFolder.id, externalMessageId]
  );
  await query("DELETE FROM outbox_queue WHERE email_id = $1", [emailId]);
}

async function markApprovalEmailQueued(emailId, errorMessage = "Manager approved the email but SMTP delivery has been queued.") {
  const outboxFolder = await ensureFolder("Outbox", "Send", 0);
  await query(
    `
      UPDATE emails
      SET
        folder_id = $2,
        status = 'Queued',
        queued_at = NOW(),
        report_status = 'Queued for Retry',
        recommendation = $3,
        last_action_at = NOW()
      WHERE id = $1
    `,
    [emailId, outboxFolder.id, errorMessage]
  );
}

async function markOutboxRetry(emailId, errorMessage) {
  const nextAttemptAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await query(
    `
      UPDATE outbox_queue
      SET
        attempts = attempts + 1,
        last_attempt_at = NOW(),
        next_attempt_at = $2,
        last_error = $3,
        status = 'Queued'
      WHERE email_id = $1
    `,
    [emailId, nextAttemptAt, errorMessage]
  );
}

async function moveEmailToFolder(emailId, targetFolderName) {
  const email = await getEmailById(emailId);
  if (!email) {
    throw new Error("Email not found.");
  }

  const targetFolder = await ensureFolder(targetFolderName, "Mail", 0);
  if (Number(email.folder_id) === Number(targetFolder.id)) {
    return email;
  }

  const nextStatus =
    targetFolderName === "Deleted"
      ? "Deleted"
      : targetFolderName === "Junk" || targetFolderName === "Spam"
        ? "Filtered"
        : email.status === "Queued" && targetFolderName !== "Outbox"
          ? "Archived"
          : email.status;

  await query("UPDATE emails SET folder_id = $2, status = $3 WHERE id = $1", [emailId, targetFolder.id, nextStatus]);

  if (!email.is_read) {
    await query("UPDATE folders SET unread_count = GREATEST(unread_count - 1, 0) WHERE id = $1", [email.folder_id]);
    await query("UPDATE folders SET unread_count = unread_count + 1 WHERE id = $1", [targetFolder.id]);
  }

  if (targetFolderName !== "Outbox") {
    await query("DELETE FROM outbox_queue WHERE email_id = $1", [emailId]);
  }

  const updated = await getEmailById(emailId);
  await syncEmailRegistryForEmail(updated);
  return updated;
}

async function setEmailsReadState(emailIds = [], isRead = true) {
  const uniqueIds = [...new Set((emailIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) {
    return { updated: 0 };
  }

  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await query(`UPDATE emails SET is_read = $${uniqueIds.length + 1} WHERE id IN (${placeholders})`, [...uniqueIds, Boolean(isRead)]);
  return { updated: result.rowCount || 0 };
}

async function deleteEmailsPermanently(emailIds = []) {
  const uniqueIds = [...new Set((emailIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) {
    return { deleted: 0 };
  }

  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await query(`DELETE FROM emails WHERE id IN (${placeholders})`, uniqueIds);
  return { deleted: result.rowCount || 0 };
}

async function emptyDeletedFolder() {
  const result = await query(
    "DELETE FROM emails WHERE folder_id = (SELECT id FROM folders WHERE name = 'Deleted')"
  );
  return { deleted: result.rowCount || 0 };
}

async function moveEmailsToFolder(emailIds = [], targetFolderName) {
  const uniqueIds = [...new Set((emailIds || []).map((id) => Number(id)).filter(Boolean))];
  const moved = [];

  for (const emailId of uniqueIds) {
    moved.push(await moveEmailToFolder(emailId, targetFolderName));
  }

  return { moved: moved.length, emails: moved };
}

async function recallEmail(emailId) {
  const { rows } = await query(
    `SELECT emails.*, folders.name AS folder_name
     FROM emails JOIN folders ON folders.id = emails.folder_id
     WHERE emails.id = $1`,
    [Number(emailId)]
  );
  if (!rows[0]) throw new Error("Email not found");
  const email = rows[0];
  if (email.folder_name !== "Sent" && email.folder_name !== "Outbox") {
    throw new Error("Only sent or queued emails can be recalled");
  }
  await query(
    "UPDATE emails SET recalled = TRUE, recalled_at = NOW(), status = 'Recalled', folder_id = (SELECT id FROM folders WHERE name = 'Deleted') WHERE id = $1",
    [Number(emailId)]
  );
  const { rows: updated } = await query(
    `SELECT emails.*, folders.name AS folder_name
     FROM emails JOIN folders ON folders.id = emails.folder_id
     WHERE emails.id = $1`,
    [Number(emailId)]
  );
  return updated[0];
}

async function getAdminSummary(currentUser) {
  const totalsResult = await query(`
    SELECT
      COUNT(*)::int AS total_emails,
      SUM(CASE WHEN priority = 'High' THEN 1 ELSE 0 END)::int AS high_priority,
      SUM(CASE WHEN has_attachments = TRUE OR has_attachments = 'true' THEN 1 ELSE 0 END)::int AS attachments,
      SUM(CASE WHEN report_status = 'Flagged' THEN 1 ELSE 0 END)::int AS flagged
    FROM emails
  `);

  const roleMatrix = currentUser?.can_manage_users
    ? (
        await query(
          `
            SELECT id, name, email, role, can_manage_users, can_manage_reports, can_archive
            FROM users
            ORDER BY id
          `
        )
      ).rows
    : [];

  return {
    totals: totalsResult.rows[0],
    roleMatrix,
    capabilities: {
      can_manage_users: Boolean(currentUser?.can_manage_users),
      can_manage_reports: Boolean(currentUser?.can_manage_reports)
    }
  };
}

async function listEmployees(adminId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.avatar, u.is_active, u.phone, u.department, u.created_by, u.manager_id,
            u.telegram_chat_id, u.telegram_username, u.telegram_notifications_enabled,
            m.name AS manager_name, m.email AS manager_email,
            m.telegram_chat_id AS manager_telegram_chat_id,
            m.telegram_username AS manager_telegram_username,
            m.telegram_notifications_enabled AS manager_telegram_notifications_enabled,
            u.can_manage_users, u.can_manage_reports, u.can_archive, u.created_at
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     ORDER BY
       CASE WHEN u.role = 'Admin' THEN 0 ELSE 1 END,
       u.name`
  );
  return rows.map(r => ({ ...r, password: null }));
}

async function listEmployeesWithMailSettings() {
  const { rows } = await query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.is_active,
        s.id AS mail_settings_id,
        s.account_type,
        s.email_address AS mailbox_email_address,
        s.username,
        s.incoming_server,
        s.incoming_port,
        s.incoming_ssl,
        s.outgoing_server,
        s.outgoing_port,
        s.outgoing_encryption,
        s.inbox_folder_name,
        s.sent_folder_name,
        s.sync_sent_items,
        s.graph_tenant_id,
        s.graph_client_id,
        s.graph_mailbox_user,
        s.updated_at AS mail_settings_updated_at
      FROM users u
      LEFT JOIN user_mail_settings s ON s.user_id = u.id
      ORDER BY
        CASE WHEN u.role = 'Admin' THEN 0 ELSE 1 END,
        u.name
    `
  );

  return rows.map((row) => ({
    ...row,
    has_mail_settings: Boolean(row.mail_settings_id)
  }));
}

async function createEmployee(adminId, {
  name,
  email,
  password,
  role = "Employee",
  phone = "",
  department = "",
  manager_id = null,
  telegram_chat_id = "",
  telegram_username = "",
  telegram_notifications_enabled = false,
  can_manage_users = false,
  can_manage_reports = false,
  can_manage_projects = false,
  can_manage_tasks = false,
  can_manage_keys = false,
  can_manage_settings = false,
  can_view_analytics = false,
  can_manage_backups = false,
  can_manage_archives = false,
  can_manage_email_accounts = false,
  can_archive = true
}) {
  const existing = await getUserByEmail(email);
  if (existing) throw new Error("Email already exists");
  const hash = bcrypt.hashSync(password, 10);
  const userId = await getNextPrimaryKeyId("users");
  const normalizedManagerId =
    manager_id === "" || manager_id === null || manager_id === undefined
      ? null
      : Number(manager_id);
  const { rows } = await query(
    `INSERT INTO users (
       id, name, email, password_hash, role, phone, department, created_by, manager_id, is_active,
       telegram_chat_id, telegram_username, telegram_notifications_enabled,
       can_manage_users, can_manage_reports, can_manage_projects, can_manage_tasks,
       can_manage_keys, can_manage_settings, can_view_analytics, can_manage_backups,
       can_manage_archives, can_manage_email_accounts, can_archive
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     RETURNING id, name, email, role, phone, department, manager_id, telegram_chat_id, telegram_username, telegram_notifications_enabled, is_active, created_at`,
    [
      userId,
      name,
      email,
      hash,
      role,
      phone || "",
      department || "",
      adminId,
      normalizedManagerId,
      telegram_chat_id || "",
      telegram_username || "",
      Boolean(telegram_notifications_enabled),
      Boolean(can_manage_users),
      Boolean(can_manage_reports),
      Boolean(can_manage_projects),
      Boolean(can_manage_tasks),
      Boolean(can_manage_keys),
      Boolean(can_manage_settings),
      Boolean(can_view_analytics),
      Boolean(can_manage_backups),
      Boolean(can_manage_archives),
      Boolean(can_manage_email_accounts),
      Boolean(can_archive)
    ]
  );
  return rows[0];
}

async function updateEmployee(employeeId, updates) {
  if (updates.email) {
    const existing = await getUserByEmail(updates.email);
    if (existing && existing.id !== employeeId) {
      throw new Error(`Email "${updates.email}" is already assigned to another user.`);
    }
  }
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.email !== undefined) { fields.push(`email = $${idx++}`); values.push(updates.email); }
  if (updates.password) { fields.push(`password_hash = $${idx++}`); values.push(bcrypt.hashSync(updates.password, 10)); }
  if (updates.role !== undefined) { fields.push(`role = $${idx++}`); values.push(updates.role); }
  if (updates.is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(Boolean(updates.is_active)); }
  if (updates.can_manage_users !== undefined) { fields.push(`can_manage_users = $${idx++}`); values.push(Boolean(updates.can_manage_users)); }
  if (updates.can_manage_reports !== undefined) { fields.push(`can_manage_reports = $${idx++}`); values.push(Boolean(updates.can_manage_reports)); }
  if (updates.can_manage_projects !== undefined) { fields.push(`can_manage_projects = $${idx++}`); values.push(Boolean(updates.can_manage_projects)); }
  if (updates.can_manage_tasks !== undefined) { fields.push(`can_manage_tasks = $${idx++}`); values.push(Boolean(updates.can_manage_tasks)); }
  if (updates.can_manage_keys !== undefined) { fields.push(`can_manage_keys = $${idx++}`); values.push(Boolean(updates.can_manage_keys)); }
  if (updates.can_manage_settings !== undefined) { fields.push(`can_manage_settings = $${idx++}`); values.push(Boolean(updates.can_manage_settings)); }
  if (updates.can_view_analytics !== undefined) { fields.push(`can_view_analytics = $${idx++}`); values.push(Boolean(updates.can_view_analytics)); }
  if (updates.can_manage_backups !== undefined) { fields.push(`can_manage_backups = $${idx++}`); values.push(Boolean(updates.can_manage_backups)); }
  if (updates.can_manage_archives !== undefined) { fields.push(`can_manage_archives = $${idx++}`); values.push(Boolean(updates.can_manage_archives)); }
  if (updates.can_manage_email_accounts !== undefined) { fields.push(`can_manage_email_accounts = $${idx++}`); values.push(Boolean(updates.can_manage_email_accounts)); }
  if (updates.can_archive !== undefined) { fields.push(`can_archive = $${idx++}`); values.push(Boolean(updates.can_archive)); }
  if (updates.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(updates.phone); }
  if (updates.department !== undefined) { fields.push(`department = $${idx++}`); values.push(updates.department); }
  if (updates.telegram_chat_id !== undefined) { fields.push(`telegram_chat_id = $${idx++}`); values.push(updates.telegram_chat_id || ""); }
  if (updates.telegram_username !== undefined) { fields.push(`telegram_username = $${idx++}`); values.push(updates.telegram_username || ""); }
  if (updates.telegram_notifications_enabled !== undefined) {
    fields.push(`telegram_notifications_enabled = $${idx++}`);
    values.push(Boolean(updates.telegram_notifications_enabled));
  }
  if (updates.manager_id !== undefined) {
    const mgr = updates.manager_id === "" || updates.manager_id === null ? null : Number(updates.manager_id);
    fields.push(`manager_id = $${idx++}`);
    values.push(mgr);
  }
  if (!fields.length) return null;
  values.push(employeeId);
  const { rows } = await query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${idx}
     RETURNING id, name, email, role, phone, department, manager_id,
               telegram_chat_id, telegram_username, telegram_notifications_enabled,
               is_active, created_at,
               can_manage_users, can_manage_reports, can_manage_projects, can_manage_tasks,
               can_manage_keys, can_manage_settings, can_view_analytics, can_manage_backups,
               can_manage_archives, can_manage_email_accounts, can_archive`,
    values
  );
  return rows[0] || null;
}

async function deleteEmployee(employeeId) {
  const { rowCount } = await query("DELETE FROM users WHERE id = $1 AND role != 'Admin'", [employeeId]);
  return { deleted: rowCount > 0 };
}

async function getEmailTrail(filters = {}) {
  let where = [];
  let values = [];
  let idx = 1;
  if (filters.employee_id) { where.push(`e.employee_id = $${idx++}`); values.push(Number(filters.employee_id)); }
  if (filters.folder_name) { where.push(`f.name = $${idx++}`); values.push(filters.folder_name); }
  if (filters.search) { where.push(`(e.subject ILIKE $${idx} OR e.sender_email ILIKE $${idx} OR e.recipient_email ILIKE $${idx})`); values.push(`%${filters.search}%`); idx++; }
  if (filters.from_date) { where.push(`e.created_at >= $${idx++}`); values.push(filters.from_date); }
  if (filters.to_date) { where.push(`e.created_at <= $${idx++}`); values.push(filters.to_date); }
  const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { rows } = await query(
    `SELECT e.id, e.serial, e.sender_name, e.sender_email, e.recipient_email, e.subject, e.body, e.preview,
            e.received_at, e.sent_at, e.is_read, e.priority, e.status, e.employee_id, e.serialized, e.serialized_at,
            e.source, f.name AS folder_name,
            u.name AS employee_name, u.email AS employee_email
     FROM emails e
     JOIN folders f ON f.id = e.folder_id
     LEFT JOIN users u ON u.id = e.employee_id
     ${whereClause}
     ORDER BY e.received_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset]
  );
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM emails e JOIN folders f ON f.id = e.folder_id LEFT JOIN users u ON u.id = e.employee_id ${whereClause}`,
    values.slice(0, -2)
  );
  return { rows, total: countRows[0]?.total || 0, limit, offset };
}

async function getEmployeeAnalytics() {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.department, u.is_active,
            COUNT(e.id)::int AS total_emails,
            SUM(CASE WHEN f.name = 'Sent' THEN 1 ELSE 0 END)::int AS sent_count,
            SUM(CASE WHEN f.name = 'Inbox' THEN 1 ELSE 0 END)::int AS received_count,
            SUM(CASE WHEN e.serialized = TRUE OR e.serialized = 'true' THEN 1 ELSE 0 END)::int AS serialized_count,
            SUM(CASE WHEN e.priority = 'High' THEN 1 ELSE 0 END)::int AS high_priority_count,
            MAX(e.received_at) AS last_activity
     FROM users u
     LEFT JOIN emails e ON e.employee_id = u.id
     LEFT JOIN folders f ON f.id = e.folder_id
     GROUP BY u.id, u.name, u.email, u.department, u.is_active
     ORDER BY total_emails DESC`
  );
  const { rows: summary } = await query(
    `SELECT COUNT(*)::int AS total_employees,
            SUM(CASE WHEN is_active = TRUE OR is_active = 'true' THEN 1 ELSE 0 END)::int AS active_employees,
            (SELECT COUNT(*)::int FROM emails) AS total_emails,
            (SELECT COUNT(*)::int FROM emails WHERE serialized = TRUE OR serialized = 'true') AS total_serialized,
            (SELECT COUNT(*)::int FROM email_archives) AS total_archives
     FROM users`
  );
  return { employees: rows, summary: summary[0] };
}

async function createArchive(adminId, { employee_id, email_ids, notes = "" }) {
  const ids = (email_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new Error("No email IDs provided");
  const archiveSerial = `ARC-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const archiveId = await getNextPrimaryKeyId("email_archives");
  const { rows } = await query(
    `INSERT INTO email_archives (id, archive_serial, employee_id, email_ids, total_emails, archived_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [archiveId, archiveSerial, employee_id || null, ids, ids.length, adminId, notes || ""]
  );
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  await query(`UPDATE emails SET serialized = TRUE, serialized_at = NOW() WHERE id IN (${placeholders})`, ids);
  return rows[0];
}

async function listArchives() {
  const { rows } = await query(
    `SELECT a.*, u.name AS archived_by_name
     FROM email_archives a
     LEFT JOIN users u ON u.id = a.archived_by
     ORDER BY a.archived_at DESC LIMIT 100`
  );
  return rows;
}

async function logEmailTrail(emailId, employeeId, action, details = "", ipAddress = "") {
  const trailId = await getNextPrimaryKeyId("email_trail");
  await query(
    `INSERT INTO email_trail (id, email_id, employee_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)`,
    [trailId, emailId, employeeId, action, details, ipAddress]
  );
}

async function getPendingApprovals(managerId) {
  const { rows } = await query(
    `SELECT e.*, f.name AS folder_name,
            u.name AS employee_name, u.email AS employee_email, u.department AS employee_department, u.phone AS employee_phone,
            m.name AS manager_name, m.email AS manager_email
     FROM emails e
     JOIN folders f ON f.id = e.folder_id
     JOIN users u ON u.id = e.employee_id
     LEFT JOIN users m ON m.id = u.manager_id
     WHERE e.approval_status = 'pending' AND COALESCE(e.assigned_manager_id, u.manager_id) = $1
     ORDER BY e.received_at DESC`,
    [managerId]
  );
  return rows;
}

async function listApprovalReminderCandidates(reminderSlot) {
  const { rows } = await query(
    `
      SELECT
        e.*,
        employee.name AS employee_name,
        employee.email AS employee_email,
        employee.department AS employee_department,
        manager.id AS manager_id,
        manager.name AS manager_name,
        manager.email AS manager_email,
        manager.telegram_chat_id,
        manager.telegram_username,
        manager.telegram_notifications_enabled
      FROM emails e
      JOIN users employee ON employee.id = e.employee_id
      JOIN users manager ON manager.id = COALESCE(e.assigned_manager_id, employee.manager_id)
      WHERE e.approval_status = 'pending'
        AND (
          COALESCE(e.priority, 'Normal') = 'High'
          OR COALESCE(e.risk_level, 'low') IN ('high', 'critical')
          OR COALESCE(e.risk_flags, '') <> ''
        )
        AND COALESCE(e.last_reminder_slot, '') <> $1
      ORDER BY
        CASE COALESCE(e.risk_level, 'low')
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        e.approval_requested_at ASC NULLS LAST,
        e.id ASC
    `,
    [String(reminderSlot || "")]
  );
  return rows;
}

async function recordApprovalReminder(emailId, reminderSlot, metadata = {}) {
  await query(
    `
      UPDATE emails
      SET reminder_count = COALESCE(reminder_count, 0) + 1,
          last_reminder_at = NOW(),
          last_reminder_slot = $2,
          last_action_at = NOW()
      WHERE id = $1
    `,
    [Number(emailId), String(reminderSlot || "")]
  );

  const updated = await getEmailById(emailId);
  await appendApprovalLog({
    approvalRootId: updated.approval_root_id || updated.id,
    emailId: updated.id,
    versionNumber: updated.version_number || 1,
    serialId: updated.serial,
    actionType: "Reminder Sent",
    actorUserId: null,
    feedbackContent: String(metadata?.channel || "telegram"),
    snapshotSubject: updated.subject,
    snapshotBody: updated.body,
    snapshotRecipientEmail: updated.recipient_email || "",
    metadata: JSON.stringify({
      reminder_slot: reminderSlot,
      reminder_count: updated.reminder_count || 0,
      risk_level: updated.risk_level || "low",
      delivery: metadata
    })
  });
  return updated;
}

async function getApprovalEmailForManager(emailId, managerId, allowedStatuses = ["pending"]) {
  const placeholders = allowedStatuses.map((_, index) => `$${index + 3}`).join(", ");
  const result = await query(
    `
      SELECT e.*, employee.name AS employee_name, employee.email AS employee_email,
             manager.name AS manager_name, manager.email AS manager_email
      FROM emails e
      JOIN users employee ON employee.id = e.employee_id
      LEFT JOIN users manager ON manager.id = e.assigned_manager_id
      WHERE e.id = $1
        AND e.assigned_manager_id = $2
        AND e.approval_status IN (${placeholders})
      LIMIT 1
    `,
    [Number(emailId), Number(managerId), ...allowedStatuses]
  );
  return result.rows[0] || null;
}

async function getApprovalEmailForEmployee(emailId, employeeId, allowedStatuses = ["rejected", "draft"]) {
  const placeholders = allowedStatuses.map((_, index) => `$${index + 3}`).join(", ");
  const result = await query(
    `
      SELECT e.*
      FROM emails e
      WHERE e.id = $1
        AND e.employee_id = $2
        AND e.approval_status IN (${placeholders})
      LIMIT 1
    `,
    [Number(emailId), Number(employeeId), ...allowedStatuses]
  );
  return result.rows[0] || null;
}

async function getEmployeesWithManager() {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.manager_id,
            u.telegram_chat_id, u.telegram_username, u.telegram_notifications_enabled,
            m.name AS manager_name, m.email AS manager_email,
            m.telegram_chat_id AS manager_telegram_chat_id,
            m.telegram_username AS manager_telegram_username,
            m.telegram_notifications_enabled AS manager_telegram_notifications_enabled
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     ORDER BY u.name`
  );
  return rows;
}

async function generateApprovalSerial({ subject, subjectKey = "", approvalRootId = null }) {
  let versionNumber = approvalRootId ? await getNextApprovalVersion(approvalRootId) : 1;
  let serial = buildApprovalSerial(subject, subjectKey, versionNumber);
  const { rows: existing } = await query("SELECT id FROM emails WHERE serial = $1", [serial]);
  while (existing.length > 0) {
    versionNumber++;
    serial = buildApprovalSerial(subject, subjectKey, versionNumber);
    const { rows: nextCheck } = await query("SELECT id FROM emails WHERE serial = $1", [serial]);
    existing.length = 0;
    existing.push(...nextCheck);
  }
  return {
    serial,
    versionNumber,
    subjectKey: buildApprovalSubjectKey(subject, subjectKey)
  };
}

function buildManagerApprovalNotification(emailRecord, employee, manager, aiAnalysis = null) {
  return {
    channel: "manager-review",
    assigned_manager_id: manager?.id || emailRecord.assigned_manager_id || null,
    manager_email: manager?.email || "",
    employee_email: employee?.email || emailRecord.sender_email || "",
    email_id: emailRecord.id,
    approval_root_id: emailRecord.approval_root_id || emailRecord.id,
    serial: emailRecord.serial,
    version_number: emailRecord.version_number || 1,
    subject: emailRecord.subject,
    preview: emailRecord.preview,
    ai_analysis: aiAnalysis,
    risk_level: emailRecord.risk_level || aiAnalysis?.risk_level || "low",
    risk_flags: emailRecord.risk_flags || aiAnalysis?.risk_flags || []
  };
}

async function createPendingApprovalEmail({ employeeId, managerId, recipientName, recipientEmail, ccList, bccList, subject, body, bodyHtml = "", priority, sensitivity, readReceipt, deliveryReceipt, subjectKey = "", previousEmailId = null }, files = [], ipAddress = "") {
  const employee = await getUserById(employeeId);
  const manager = await getUserById(managerId);
  if (!employee) {
    throw new Error("Employee not found.");
  }
  if (!manager) {
    throw new Error("Assigned manager not found.");
  }

  let previousEmail = null;
  let approvalRootId = null;
  let parentId = null;
  let threadDepth = 0;
  let existingComments = "";

  if (previousEmailId) {
    previousEmail = await getApprovalEmailForEmployee(previousEmailId, employeeId, ["rejected"]);
    if (!previousEmail) {
      throw new Error("Rejected email not found or not owned by the current employee.");
    }
    approvalRootId = previousEmail.approval_root_id || previousEmail.id;
    parentId = previousEmail.id;
    threadDepth = Number(previousEmail.thread_depth || 0) + 1;
    existingComments = previousEmail.manager_comments || previousEmail.rejection_reason || "";
  }
  const provisionalSerial = `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const email = await createEmail(
    {
      folder_name: "Outbox",
      serial: provisionalSerial,
      sender_name: employee.name || "Employee",
      sender_email: employee.email || "",
      recipient_name: recipientName || "",
      recipient_email: recipientEmail || "",
      cc_list: ccList || null,
      bcc_list: bccList || null,
      subject,
      body,
      body_html: bodyHtml || null,
      preview: (body || "").slice(0, 120),
      received_at: new Date().toISOString(),
      priority: priority || "Normal",
      sensitivity: sensitivity || "Normal",
      read_receipt: Boolean(readReceipt),
      delivery_receipt: Boolean(deliveryReceipt),
      status: "Pending Approval",
      recommendation: "Awaiting manager review before delivery.",
      report_status: "Pending Approval",
      approval_status: "pending",
      employee_id: employeeId,
      submitted_by: employeeId,
      assigned_manager_id: managerId,
      parent_id: parentId,
      thread_depth: threadDepth,
      approval_root_id: approvalRootId,
      version_number: 1,
      subject_key: "",
      manager_comments: existingComments,
      approval_requested_at: new Date().toISOString(),
      last_action_at: new Date().toISOString(),
      ai_sentiment: "Unknown",
      ai_tone_score: 0,
      ai_recommendations: "",
      ai_provider: "rules",
      needs_revision: false,
      rejection_reason: "",
      risk_level: "low",
      risk_flags: "",
      reminder_count: 0,
      last_reminder_at: null,
      last_reminder_slot: ""
    },
    files,
    previousEmail ? "approval-resubmission" : "approval-submission",
    employeeId
  );

  if (!approvalRootId) {
    approvalRootId = email.id;
    await query("UPDATE emails SET approval_root_id = $2 WHERE id = $1", [email.id, email.id]);
    email.approval_root_id = email.id;
  }

  const serialInfo = await generateApprovalSerial({
    subject,
    subjectKey,
    approvalRootId
  });

  const aiAnalysis = await analyzeDraftForApproval({
    subject,
    body,
    recipientEmail,
    ccList
  });

  await query(
    `
      UPDATE emails
      SET serial = $1,
          preview = $2,
          recommendation = $3,
          report_status = 'Pending Approval',
          subject_key = $4,
          approval_root_id = $5,
          version_number = $6,
          ai_sentiment = $7,
          ai_tone_score = $8,
          ai_recommendations = $9,
          ai_provider = $10,
          risk_level = $11,
          risk_flags = $12,
          last_action_at = NOW()
      WHERE id = $13
    `,
    [
      serialInfo.serial,
      (body || "").slice(0, 120),
      aiAnalysis.recommendations.length
        ? aiAnalysis.recommendations.join(" ")
        : "Awaiting manager review before delivery.",
      serialInfo.subjectKey,
      approvalRootId,
      serialInfo.versionNumber,
      aiAnalysis.sentiment,
      aiAnalysis.tone_score,
      aiAnalysis.recommendations.join("\n"),
      aiAnalysis.provider || "rules",
      aiAnalysis.risk_level || "low",
      (aiAnalysis.risk_flags || []).join(","),
      email.id
    ]
  );

  const hydratedEmail = await getEmailById(email.id);

  await appendApprovalLog({
    approvalRootId,
    emailId: hydratedEmail.id,
    versionNumber: serialInfo.versionNumber,
    serialId: serialInfo.serial,
    actionType: previousEmail ? "Resubmitted" : "Submitted",
    actorUserId: employeeId,
    feedbackContent: existingComments,
    snapshotSubject: subject,
    snapshotBody: body,
    snapshotRecipientEmail: recipientEmail || "",
    metadata: JSON.stringify({
      subject_key: serialInfo.subjectKey,
      assigned_manager_id: managerId,
      ai_analysis: aiAnalysis
    }),
    ipAddress
  });

  return {
    email: hydratedEmail,
    serial: serialInfo.serial,
    analysis: aiAnalysis,
    managerNotification: buildManagerApprovalNotification(hydratedEmail, employee, manager, aiAnalysis)
  };
}

async function approveEmail(emailId, approverId, managerComments = "", ipAddress = "") {
  const email = await getApprovalEmailForManager(emailId, approverId, ["pending"]);
  if (!email) {
    throw new Error("Email not found, not pending approval, or not assigned to the current manager.");
  }

  await query(
    `
      UPDATE emails
      SET approval_status = 'approved',
          status = 'Approved',
          approved_by = $1,
          approved_at = NOW(),
          approval_decision_at = NOW(),
          manager_comments = $2,
          needs_revision = FALSE,
          last_action_at = NOW()
      WHERE id = $3
    `,
    [approverId, managerComments || "", emailId]
  );

  const updated = await getEmailById(emailId);
  await appendApprovalLog({
    approvalRootId: updated.approval_root_id || updated.id,
    emailId: updated.id,
    versionNumber: updated.version_number || 1,
    serialId: updated.serial,
    actionType: "Approved",
    actorUserId: approverId,
    feedbackContent: managerComments || "",
    snapshotSubject: updated.subject,
    snapshotBody: updated.body,
    snapshotRecipientEmail: updated.recipient_email || "",
    metadata: JSON.stringify({ assigned_manager_id: updated.assigned_manager_id }),
    ipAddress
  });
  await syncEmailRegistryForEmail(updated);
  return updated;
}

async function rejectEmail(emailId, approverId, reason = "", ipAddress = "") {
  const email = await getApprovalEmailForManager(emailId, approverId, ["pending"]);
  if (!email) {
    throw new Error("Email not found, not pending approval, or not assigned to the current manager.");
  }

  const draftsFolder = await ensureFolder("Drafts", "FilePenLine", 0);

  await query(
    `
      UPDATE emails
      SET approval_status = 'rejected',
          folder_id = $4,
          status = 'Rejected',
          rejection_reason = $1,
          manager_comments = $1,
          approved_by = $2,
          approved_at = NOW(),
          approval_decision_at = NOW(),
          needs_revision = TRUE,
          report_status = 'Revision Required',
          recommendation = CASE
            WHEN COALESCE($1, '') = '' THEN 'Revision requested by the manager before external delivery.'
            ELSE $1
          END,
          last_action_at = NOW()
      WHERE id = $3
    `,
    [reason || "", approverId, emailId, draftsFolder.id]
  );

  const updated = await getEmailById(emailId);
  await appendApprovalLog({
    approvalRootId: updated.approval_root_id || updated.id,
    emailId: updated.id,
    versionNumber: updated.version_number || 1,
    serialId: updated.serial,
    actionType: "Rejected",
    actorUserId: approverId,
    feedbackContent: reason || "",
    snapshotSubject: updated.subject,
    snapshotBody: updated.body,
    snapshotRecipientEmail: updated.recipient_email || "",
    metadata: JSON.stringify({ assigned_manager_id: updated.assigned_manager_id }),
    ipAddress
  });
  await syncEmailRegistryForEmail(updated);
  return updated;
}

async function reviseRejectedApproval(emailId, employeeId, draftUpdates = {}, files = [], ipAddress = "", options = {}) {
  const rejected = await getApprovalEmailForEmployee(emailId, employeeId, ["rejected"]);
  if (!rejected) {
    throw new Error("Rejected email not found or not owned by the current employee.");
  }

  const owner = await getUserById(employeeId);
  const overrideManagerId = Number(options.managerId || 0) || null;
  const assignedManagerId = overrideManagerId || owner?.manager_id || rejected.assigned_manager_id;
  if (!assignedManagerId) {
    throw new Error("No manager is assigned to this employee.");
  }

  return createPendingApprovalEmail(
    {
      employeeId,
      managerId: assignedManagerId,
      recipientName: draftUpdates.recipient_name ?? rejected.recipient_name,
      recipientEmail: draftUpdates.recipient_email ?? rejected.recipient_email,
      ccList: draftUpdates.cc_list ?? rejected.cc_list,
      bccList: draftUpdates.bcc_list ?? rejected.bcc_list,
      subject: draftUpdates.subject ?? rejected.subject,
      body: draftUpdates.body ?? rejected.body,
      bodyHtml: draftUpdates.body_html ?? rejected.body_html ?? "",
      priority: draftUpdates.priority ?? rejected.priority,
      sensitivity: draftUpdates.sensitivity ?? rejected.sensitivity,
      readReceipt: draftUpdates.read_receipt ?? rejected.read_receipt,
      deliveryReceipt: draftUpdates.delivery_receipt ?? rejected.delivery_receipt,
      subjectKey: draftUpdates.subject_key || rejected.subject_key,
      previousEmailId: rejected.id
    },
    files,
    ipAddress
  );
}

async function getApprovalHistory(emailId, requesterId = null) {
  const email = await getEmailById(emailId);
  if (!email) {
    throw new Error("Approval email not found.");
  }

  if (
    requesterId &&
    Number(email.employee_id) !== Number(requesterId) &&
    Number(email.assigned_manager_id) !== Number(requesterId) &&
    Number(email.submitted_by) !== Number(requesterId)
  ) {
    const requester = await getUserById(requesterId);
    if (!requester?.can_manage_reports && !requester?.can_manage_users && requester?.role !== "Admin") {
      throw new Error("You are not allowed to view this approval history.");
    }
  }

  const rootId = email.approval_root_id || email.id;
  const { rows } = await query(
    `
      SELECT logs.*, actor.name AS actor_name, actor.email AS actor_email
      FROM approval_logs logs
      LEFT JOIN users actor ON actor.id = logs.actor_user_id
      WHERE logs.approval_root_id = $1
      ORDER BY logs.version_number ASC, logs.created_at ASC
    `,
    [rootId]
  );
  return rows;
}

async function getApprovalAnalytics() {
  const { rows: employeeAverages } = await query(
    `
      SELECT
        u.id AS employee_id,
        u.name AS employee_name,
        u.email AS employee_email,
        COUNT(e.id)::int AS total_cycles,
        SUM(CASE WHEN e.approval_status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected_cycles,
        SUM(CASE WHEN COALESCE(e.risk_level, 'low') IN ('high', 'critical') THEN 1 ELSE 0 END)::int AS high_risk_cycles,
        SUM(CASE WHEN COALESCE(e.risk_level, 'low') = 'critical' THEN 1 ELSE 0 END)::int AS critical_risk_cycles,
        SUM(COALESCE(e.reminder_count, 0))::int AS reminder_count,
        AVG(
          CASE
            WHEN e.approval_requested_at IS NOT NULL AND e.approval_decision_at IS NOT NULL
            THEN (
              EXTRACT(EPOCH FROM e.approval_decision_at)
              - EXTRACT(EPOCH FROM e.approval_requested_at)
            ) / 60.0
            ELSE NULL
          END
        ) AS avg_approval_minutes,
        MAX(e.approval_requested_at) AS last_requested_at,
        MAX(e.approval_decision_at) AS last_decision_at,
        MAX(e.last_reminder_at) AS last_reminder_at
      FROM users u
      LEFT JOIN emails e ON e.employee_id = u.id AND e.version_number >= 1
      GROUP BY u.id, u.name, u.email
      ORDER BY total_cycles DESC, u.name ASC
    `
  );

  const { rows: correctionTrends } = await query(
    `
      SELECT feedback_content, COUNT(*)::int AS occurrences
      FROM approval_logs
      WHERE action_type = 'Rejected'
        AND feedback_content IS NOT NULL AND feedback_content <> ''
      GROUP BY feedback_content
      ORDER BY occurrences DESC, feedback_content ASC
      LIMIT 10
    `
  );

  return {
    employees: employeeAverages.map((row) => ({
      ...row,
      rejection_rate: row.total_cycles
        ? Number(((Number(row.rejected_cycles || 0) / Number(row.total_cycles || 1)) * 100).toFixed(2))
        : 0,
      avg_approval_minutes: row.avg_approval_minutes ? Number(Number(row.avg_approval_minutes).toFixed(2)) : 0
    })),
    correction_trends: correctionTrends
  };
}

async function getThreadEmails(parentId) {
  const { rows } = await query(
    `SELECT e.*, f.name AS folder_name, u.name AS employee_name
     FROM emails e
     JOIN folders f ON f.id = e.folder_id
     LEFT JOIN users u ON u.id = e.employee_id
     WHERE e.id = $1 OR e.parent_id = $1 OR e.approval_root_id = $1
     ORDER BY e.version_number ASC, e.received_at ASC`,
    [parentId]
  );
  return rows;
}

async function searchEmailsBySerial(serial) {
  const { rows } = await query(
    `SELECT e.*, f.name AS folder_name FROM emails e
     JOIN folders f ON f.id = e.folder_id
     WHERE e.serial ILIKE $1
     ORDER BY e.received_at DESC`,
    [`%${serial}%`]
  );
  return rows;
}

async function getThreadBySerial(serial) {
  const threadResult = await query(
    `SELECT * FROM email_threads WHERE serial = $1 LIMIT 1`,
    [serial]
  );

  if (threadResult.rows.length) {
    const thread = threadResult.rows[0];
    const messageIds = thread.message_ids || [];
    if (messageIds.length === 0) return [];

    const emailsResult = await query(
      `SELECT e.*, f.name AS folder_name FROM emails e
       JOIN folders f ON f.id = e.folder_id
       WHERE e.external_message_id = ANY($1)
          OR e.serial = $2
       ORDER BY e.received_at ASC`,
      [messageIds, serial]
    );
    return emailsResult.rows;
  }

  const exactMatch = await query(
    `SELECT id, approval_root_id, parent_id FROM emails WHERE serial = $1 ORDER BY id ASC LIMIT 1`,
    [serial]
  );
  if (!exactMatch.rows.length) return [];
  const rootId = exactMatch.rows[0].approval_root_id || exactMatch.rows[0].parent_id || exactMatch.rows[0].id;
  return getThreadEmails(rootId);
}

async function getThreadByMessageId(messageId) {
  const result = await query(
    `SELECT * FROM email_threads WHERE $1 = ANY(message_ids) LIMIT 1`,
    [messageId]
  );
  return result.rows[0] || null;
}

async function getThreadMessages(threadId) {
  const result = await query(
    `SELECT * FROM email_threads WHERE thread_id = $1 LIMIT 1`,
    [threadId]
  );
  return result.rows[0] || null;
}

function deriveRegistryThreadId(email) {
  if (!email) return null;
  if (email.approval_root_id) return `approval:${email.approval_root_id}`;
  if (email.parent_id) return `parent:${email.parent_id}`;
  if (email.serial) return `serial:${email.serial}`;
  if (email.external_message_id) return `message:${email.external_message_id}`;
  return `email:${email.id}`;
}

function deriveArchiveSummary(email) {
  const summary =
    email?.ai_recommendations ||
    email?.recommendation ||
    email?.preview ||
    email?.body ||
    "";
  return String(summary || "").trim();
}

function buildAttachmentsPathValue(attachments = []) {
  if (!attachments.length) return "";
  return JSON.stringify(
    attachments.map((attachment) => ({
      file_name: attachment.file_name || "",
      file_path: attachment.file_path || "",
      mime_type: attachment.mime_type || "",
      content_id: attachment.content_id || null,
      is_inline: Boolean(attachment.is_inline)
    }))
  );
}

async function getHydratedEmailForArchive(emailOrId) {
  if (!emailOrId) return null;
  if (typeof emailOrId === "number") {
    return getEmailById(emailOrId);
  }
  if (!emailOrId.folder_name && emailOrId.id) {
    return getEmailById(emailOrId.id);
  }
  return emailOrId;
}

async function syncEmailRegistryForEmail(emailOrId) {
  const email = await getHydratedEmailForArchive(emailOrId);
  if (!email?.id) {
    return null;
  }

  const attachmentsResult = await query(
    `SELECT file_name, file_path, mime_type, content_id, is_inline
     FROM attachments
     WHERE email_id = $1
     ORDER BY id ASC`,
    [email.id]
  );
  const attachments = attachmentsResult.rows || [];
  const isArchived = String(email.folder_name || "").toLowerCase() === "archive";
  const existing = await query(
    `SELECT email_db_id FROM email_registry WHERE email_id = $1 LIMIT 1`,
    [email.id]
  );

  let registry;
  if (existing.rows[0]) {
    const updated = await query(
      `
        UPDATE email_registry
        SET project_id = $1,
            employee_id = $2,
            assigned_manager_id = $3,
            message_id = $4,
            thread_id = $5,
            subject_key = $6,
            serial_number = $7,
            folder_name = $8,
            approval_status = $9,
            source_provider = $10,
            risk_level = $11,
            is_archived = $12,
            updated_at = NOW()
        WHERE email_db_id = $13
        RETURNING *
      `,
      [
        email.project_id || null,
        email.employee_id || null,
        email.assigned_manager_id || null,
        email.external_message_id || null,
        deriveRegistryThreadId(email),
        email.subject_key || "",
        email.serial || "",
        email.folder_name || "Inbox",
        email.approval_status || "none",
        email.source || "manual",
        email.risk_level || "low",
        isArchived,
        existing.rows[0].email_db_id
      ]
    );
    registry = updated.rows[0];
  } else {
    const inserted = await query(
      `
        INSERT INTO email_registry (
          email_id, project_id, employee_id, assigned_manager_id, message_id, thread_id,
          subject_key, serial_number, folder_name, approval_status, source_provider,
          risk_level, is_archived, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        RETURNING *
      `,
      [
        email.id,
        email.project_id || null,
        email.employee_id || null,
        email.assigned_manager_id || null,
        email.external_message_id || null,
        deriveRegistryThreadId(email),
        email.subject_key || "",
        email.serial || "",
        email.folder_name || "Inbox",
        email.approval_status || "none",
        email.source || "manual",
        email.risk_level || "low",
        isArchived,
        email.received_at || email.sent_at || new Date().toISOString()
      ]
    );
    registry = inserted.rows[0];
  }

  if (!registry?.email_db_id) {
    return null;
  }

  const contentExists = await query(
    `SELECT email_db_id FROM email_content_archive WHERE email_db_id = $1 LIMIT 1`,
    [registry.email_db_id]
  );
  const attachmentsPath = buildAttachmentsPathValue(attachments);
  if (contentExists.rows[0]) {
    await query(
      `
        UPDATE email_content_archive
        SET raw_body = $1,
            body_html = $2,
            ai_summary = $3,
            attachments_path = $4,
            updated_at = NOW()
        WHERE email_db_id = $5
      `,
      [
        email.body || "",
        email.body_html || null,
        deriveArchiveSummary(email),
        attachmentsPath,
        registry.email_db_id
      ]
    );
  } else {
    await query(
      `
        INSERT INTO email_content_archive (
          email_db_id, raw_body, body_html, ai_summary, attachments_path, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      [
        registry.email_db_id,
        email.body || "",
        email.body_html || null,
        deriveArchiveSummary(email),
        attachmentsPath
      ]
    );
  }

  return registry;
}

async function syncTrackingTaskRecord(taskOrId) {
  const task = typeof taskOrId === "number" ? await getTaskById(taskOrId) : taskOrId;
  if (!task?.id) {
    return null;
  }

  const registry = task.email_id ? await syncEmailRegistryForEmail(task.email_id) : null;
  const existing = await query(
    `SELECT task_id, alert_count FROM tracking_tasks WHERE existing_task_id = $1 LIMIT 1`,
    [task.id]
  );

  const nextAlertCount = task.alerted
    ? Math.max(Number(existing.rows[0]?.alert_count || 0), 1)
    : Number(existing.rows[0]?.alert_count || 0);

  if (existing.rows[0]) {
    const updated = await query(
      `
        UPDATE tracking_tasks
        SET email_db_id = $1,
            email_id = $2,
            assigned_to = $3,
            task_type = $4,
            priority = $5,
            due_date = $6,
            status = $7,
            is_alerted = $8,
            alert_count = $9,
            updated_at = NOW()
        WHERE task_id = $10
        RETURNING *
      `,
      [
        registry?.email_db_id || null,
        task.email_id || null,
        task.assigned_to || null,
        task.task_type || "general",
        task.priority || "medium",
        task.due_date || null,
        String(task.status || "pending").toUpperCase(),
        Boolean(task.alerted),
        nextAlertCount,
        existing.rows[0].task_id
      ]
    );
    return updated.rows[0] || null;
  }

  const maxResult = await query(`SELECT COALESCE(MAX(task_id), 0) + 1 AS next_id FROM tracking_tasks`);
  const nextId = maxResult.rows[0].next_id;
  const inserted = await query(
    `
      INSERT INTO tracking_tasks (
        task_id, existing_task_id, email_db_id, email_id, assigned_to, task_type,
        priority, due_date, status, is_alerted, alert_count, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *
    `,
    [
      nextId,
      task.id,
      registry?.email_db_id || null,
      task.email_id || null,
      task.assigned_to || null,
      task.task_type || "general",
      task.priority || "medium",
      task.due_date || null,
      String(task.status || "pending").toUpperCase(),
      Boolean(task.alerted),
      task.alerted ? 1 : 0
    ]
  );
  if (inserted.rows[0]) {
    await createTrackingTaskHistoryEntry({
      trackingTaskId: inserted.rows[0].task_id,
      existingTaskId: inserted.rows[0].existing_task_id || null,
      actionType: "created",
      fieldName: "task",
      previousValue: null,
      nextValue: inserted.rows[0].status || "PENDING",
      previousDisplay: null,
      nextDisplay: `Created from operational task sync as ${inserted.rows[0].task_type || "general"} (${inserted.rows[0].status || "PENDING"})`,
      metadata: {
        source: "syncTrackingTaskRecord",
        task_id: task.id || null,
        email_id: task.email_id || null
      }
    });
  }
  return inserted.rows[0] || null;
}

async function backfillArchiveTrackingData() {
  try {
    const emailsResult = await query(
      `
        SELECT emails.*, folders.name AS folder_name
        FROM emails
        JOIN folders ON folders.id = emails.folder_id
        ORDER BY emails.id ASC
      `
    );
    for (const email of emailsResult.rows) {
      await syncEmailRegistryForEmail(email);
    }

    const tasksResult = await query(`SELECT * FROM tasks ORDER BY id ASC`);
    for (const task of tasksResult.rows) {
      await syncTrackingTaskRecord(task);
    }
  } catch (error) {
    console.warn("Archive/tracking backfill skipped:", error.message);
  }
}

async function createTask(taskData) {
  const maxResult = await query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM tasks`);
  const nextId = maxResult.rows[0].next_id;
  const result = await query(
    `INSERT INTO tasks (id, email_id, project_id, assigned_to, created_by, title, description, task_type, status, priority, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [nextId, taskData.email_id || null, taskData.project_id || null, taskData.assigned_to || null,
     taskData.created_by || null, taskData.title, taskData.description || "",
     taskData.task_type || "general", taskData.status || "pending",
     taskData.priority || "medium", taskData.due_date || null]
  );
  await syncTrackingTaskRecord(result.rows[0]);
  return result.rows[0];
}

async function getTasks(filters = {}) {
  let where = "WHERE 1=1";
  const params = [];
  let idx = 1;
  if (filters.status) { where += ` AND status = $${idx}`; params.push(filters.status); idx++; }
  if (filters.project_id) { where += ` AND project_id = $${idx}`; params.push(filters.project_id); idx++; }
  if (filters.assigned_to) { where += ` AND assigned_to = $${idx}`; params.push(filters.assigned_to); idx++; }
  if (filters.due_before) { where += ` AND due_date <= $${idx}`; params.push(filters.due_before); idx++; }
  if (filters.due_after) { where += ` AND due_date >= $${idx}`; params.push(filters.due_after); idx++; }

  const result = await query(
    `SELECT * FROM tasks ${where} ORDER BY due_date ASC NULLS LAST, created_at DESC`,
    params
  );

  const projectIds = [...new Set(result.rows.map(r => r.project_id).filter(Boolean))];
  const userIds = [...new Set(result.rows.map(r => r.assigned_to).filter(Boolean))];
  const emailIds = [...new Set(result.rows.map(r => r.email_id).filter(Boolean))];

  const [allProjects, allUsers, allEmails] = await Promise.all([
    projectIds.length ? query(`SELECT id, project_code, project_name FROM projects`) : Promise.resolve({ rows: [] }),
    userIds.length ? query(`SELECT id, name FROM users`) : Promise.resolve({ rows: [] }),
    emailIds.length ? query(`SELECT id, subject, serial FROM emails`) : Promise.resolve({ rows: [] })
  ]);

  const projectMap = Object.fromEntries(allProjects.rows.filter(p => projectIds.includes(p.id)).map(p => [p.id, p]));
  const userMap = Object.fromEntries(allUsers.rows.filter(u => userIds.includes(u.id)).map(u => [u.id, u]));
  const emailMap = Object.fromEntries(allEmails.rows.filter(e => emailIds.includes(e.id)).map(e => [e.id, e]));

  return result.rows.map(t => ({
    ...t,
    project_code: projectMap[t.project_id]?.project_code || null,
    project_name: projectMap[t.project_id]?.project_name || null,
    assigned_to_name: userMap[t.assigned_to]?.name || null,
    email_subject: emailMap[t.email_id]?.subject || null,
    email_serial: emailMap[t.email_id]?.serial || null
  }));
}

async function getActiveTrackingTasks(filters = {}) {
  const params = [];
  const where = [];
  let idx = 1;

  const normalizedStatus = String(filters.status || "PENDING").trim().toUpperCase();
  if (normalizedStatus && normalizedStatus !== "ALL") {
    where.push(`tt.status = $${idx}`);
    params.push(normalizedStatus);
    idx += 1;
  }
  if (filters.project_id) {
    where.push(`er.project_id = $${idx}`);
    params.push(Number(filters.project_id));
    idx += 1;
  }
  if (filters.assigned_to) {
    where.push(`tt.assigned_to = $${idx}`);
    params.push(Number(filters.assigned_to));
    idx += 1;
  }
  if (filters.due_before) {
    where.push(`tt.due_date IS NOT NULL AND tt.due_date <= $${idx}`);
    params.push(filters.due_before);
    idx += 1;
  }
  if (filters.due_after) {
    where.push(`tt.due_date IS NOT NULL AND tt.due_date >= $${idx}`);
    params.push(filters.due_after);
    idx += 1;
  }

  const limit = Math.min(200, Math.max(1, Number(filters.limit || 100)));
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);

  const result = await query(
    `
      SELECT
        tt.task_id,
        tt.task_type,
        tt.priority,
        tt.due_date,
        tt.status,
        er.project_id,
        p.project_code,
        p.project_name,
        COALESCE(e.subject, '') AS email_subject,
        tt.assigned_to,
        assigned.name AS assigned_to_name,
        COALESCE(aa.summary, eca.ai_summary, e.ai_summary, '') AS ai_summary
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      LEFT JOIN projects p ON p.id = er.project_id
      LEFT JOIN emails e ON e.id = COALESCE(tt.email_id, er.email_id)
      LEFT JOIN users assigned ON assigned.id = tt.assigned_to
      LEFT JOIN ai_analysis aa ON aa.email_id = COALESCE(tt.email_id, er.email_id)
      LEFT JOIN email_content_archive eca ON eca.email_db_id = tt.email_db_id
      ${whereSql}
      ORDER BY
        tt.due_date ASC NULLS LAST,
        tt.updated_at DESC,
        tt.task_id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows || [];
}

async function getTrackingTaskSummary(filters = {}) {
  const params = [];
  const where = [];
  let idx = 1;

  const normalizedStatus = String(filters.status || "ALL").trim().toUpperCase();
  if (normalizedStatus && normalizedStatus !== "ALL") {
    where.push(`tt.status = $${idx}`);
    params.push(normalizedStatus);
    idx += 1;
  }
  if (filters.project_id) {
    where.push(`er.project_id = $${idx}`);
    params.push(Number(filters.project_id));
    idx += 1;
  }
  if (filters.assigned_to) {
    where.push(`tt.assigned_to = $${idx}`);
    params.push(Number(filters.assigned_to));
    idx += 1;
  }
  if (filters.due_before) {
    where.push(`tt.due_date IS NOT NULL AND tt.due_date <= $${idx}`);
    params.push(filters.due_before);
    idx += 1;
  }
  if (filters.due_after) {
    where.push(`tt.due_date IS NOT NULL AND tt.due_date >= $${idx}`);
    params.push(filters.due_after);
    idx += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const summaryResult = await query(
    `
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN tt.status = 'PENDING' THEN 1 ELSE 0 END)::int AS pending,
        SUM(CASE WHEN tt.status = 'IN_PROGRESS' THEN 1 ELSE 0 END)::int AS in_progress,
        SUM(CASE WHEN tt.status = 'COMPLETED' THEN 1 ELSE 0 END)::int AS completed,
        SUM(CASE WHEN tt.status = 'PENDING' AND tt.due_date IS NOT NULL AND tt.due_date < NOW() THEN 1 ELSE 0 END)::int AS overdue,
        SUM(CASE WHEN tt.status = 'PENDING' AND tt.due_date IS NOT NULL AND tt.due_date >= NOW() AND tt.due_date <= NOW() + INTERVAL '48 hours' THEN 1 ELSE 0 END)::int AS due_soon
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      ${whereSql}
    `,
    params
  );

  const byStatusResult = await query(
    `
      SELECT
        tt.status,
        COUNT(*)::int AS total
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      ${whereSql}
      GROUP BY tt.status
      ORDER BY tt.status ASC
    `,
    params
  );

  const byTaskTypeResult = await query(
    `
      SELECT
        COALESCE(tt.task_type, 'general') AS task_type,
        COUNT(*)::int AS total
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      ${whereSql}
      GROUP BY COALESCE(tt.task_type, 'general')
      ORDER BY total DESC, task_type ASC
    `,
    params
  );

  const byPriorityResult = await query(
    `
      SELECT
        COALESCE(tt.priority, 'medium') AS priority,
        COUNT(*)::int AS total
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      ${whereSql}
      GROUP BY COALESCE(tt.priority, 'medium')
      ORDER BY total DESC, priority ASC
    `,
    params
  );

  return {
    filters: {
      status: normalizedStatus,
      project_id: filters.project_id ? Number(filters.project_id) : null,
      assigned_to: filters.assigned_to ? Number(filters.assigned_to) : null,
      due_before: filters.due_before || null,
      due_after: filters.due_after || null
    },
    totals: {
      total: Number(summaryResult.rows[0]?.total || 0),
      pending: Number(summaryResult.rows[0]?.pending || 0),
      in_progress: Number(summaryResult.rows[0]?.in_progress || 0),
      completed: Number(summaryResult.rows[0]?.completed || 0),
      overdue: Number(summaryResult.rows[0]?.overdue || 0),
      due_soon: Number(summaryResult.rows[0]?.due_soon || 0)
    },
    by_status: (byStatusResult.rows || []).map((row) => ({
      status: row.status || "UNKNOWN",
      total: Number(row.total || 0)
    })),
    by_task_type: (byTaskTypeResult.rows || []).map((row) => ({
      task_type: row.task_type || "general",
      total: Number(row.total || 0)
    })),
    by_priority: (byPriorityResult.rows || []).map((row) => ({
      priority: row.priority || "medium",
      total: Number(row.total || 0)
    }))
  };
}

async function getTrackingTaskById(taskId) {
  const result = await query(
    `
      SELECT
        tt.task_id,
        tt.existing_task_id,
        tt.email_db_id,
        tt.email_id,
        tt.assigned_to,
        tt.task_type,
        tt.priority,
        tt.due_date,
        tt.status,
        tt.is_alerted,
        tt.alert_count,
        tt.updated_at,
        er.project_id,
        p.project_code,
        p.project_name,
        COALESCE(e.subject, '') AS email_subject,
        assigned.name AS assigned_to_name,
        COALESCE(aa.summary, eca.ai_summary, e.ai_summary, '') AS ai_summary
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      LEFT JOIN projects p ON p.id = er.project_id
      LEFT JOIN emails e ON e.id = COALESCE(tt.email_id, er.email_id)
      LEFT JOIN users assigned ON assigned.id = tt.assigned_to
      LEFT JOIN ai_analysis aa ON aa.email_id = COALESCE(tt.email_id, er.email_id)
      LEFT JOIN email_content_archive eca ON eca.email_db_id = tt.email_db_id
      WHERE tt.task_id = $1
      LIMIT 1
    `,
    [Number(taskId)]
  );
  return result.rows[0] || null;
}

function normalizeTrackingHistoryValue(value, fieldName = "") {
  const normalizedField = String(fieldName || "").trim().toLowerCase();
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (normalizedField === "due_date") {
    const dateValue = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateValue.getTime())) {
      return String(value);
    }
    return dateValue.toISOString();
  }
  return String(value);
}

function areTrackingHistoryValuesEqual(left, right, fieldName = "") {
  return normalizeTrackingHistoryValue(left, fieldName) === normalizeTrackingHistoryValue(right, fieldName);
}

async function resolveTrackingHistoryDisplay(fieldName, value) {
  const normalizedField = String(fieldName || "").trim().toLowerCase();
  const normalizedValue = normalizeTrackingHistoryValue(value, fieldName);
  if (normalizedValue === null || normalizedValue === undefined) {
    if (normalizedField === "assigned_to") {
      return "Unassigned";
    }
    return "Empty";
  }
  if (normalizedField === "assigned_to") {
    const userId = Number(normalizedValue || 0);
    if (!userId) {
      return "Unassigned";
    }
    const user = await getUserById(userId).catch(() => null);
    return user?.name || user?.email || `User ${userId}`;
  }
  if (normalizedField === "status") {
    return String(normalizedValue).replace(/_/g, " ").toUpperCase();
  }
  if (normalizedField === "priority") {
    const label = String(normalizedValue).trim().toLowerCase();
    return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "Medium";
  }
  if (normalizedField === "due_date") {
    return String(normalizedValue);
  }
  return String(normalizedValue);
}

async function createTrackingTaskHistoryEntry({
  trackingTaskId,
  existingTaskId = null,
  actorUserId = null,
  actionType = "updated",
  fieldName = "task",
  previousValue = null,
  nextValue = null,
  previousDisplay = null,
  nextDisplay = null,
  metadata = null
} = {}) {
  const normalizedTrackingTaskId = Number(trackingTaskId || 0);
  if (!normalizedTrackingTaskId) {
    return null;
  }
  const result = await query(
    `
      INSERT INTO tracking_task_history (
        tracking_task_id,
        existing_task_id,
        actor_user_id,
        action_type,
        field_name,
        previous_value,
        next_value,
        previous_display,
        next_display,
        metadata_json,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `,
    [
      normalizedTrackingTaskId,
      Number(existingTaskId || 0) || null,
      Number(actorUserId || 0) || null,
      String(actionType || "updated").trim().toLowerCase(),
      String(fieldName || "task").trim().toLowerCase(),
      normalizeTrackingHistoryValue(previousValue, fieldName),
      normalizeTrackingHistoryValue(nextValue, fieldName),
      previousDisplay,
      nextDisplay,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
  return result.rows[0] || null;
}

async function createTrackingTaskHistoryEntries({
  trackingTaskId,
  existingTaskId = null,
  actorUserId = null,
  actionType = "updated",
  changes = [],
  metadata = null
} = {}) {
  const normalizedChanges = Array.isArray(changes) ? changes : [];
  const entries = [];
  for (const change of normalizedChanges) {
    const fieldName = String(change?.field_name || change?.fieldName || "task").trim().toLowerCase();
    const previousValue = change?.previous_value ?? change?.previousValue ?? null;
    const nextValue = change?.next_value ?? change?.nextValue ?? null;
    entries.push(await createTrackingTaskHistoryEntry({
      trackingTaskId,
      existingTaskId,
      actorUserId,
      actionType,
      fieldName,
      previousValue,
      nextValue,
      previousDisplay: change?.previous_display ?? change?.previousDisplay ?? await resolveTrackingHistoryDisplay(fieldName, previousValue),
      nextDisplay: change?.next_display ?? change?.nextDisplay ?? await resolveTrackingHistoryDisplay(fieldName, nextValue),
      metadata
    }));
  }
  return entries;
}

async function getTrackingTaskHistory(taskId, options = {}) {
  const normalizedTaskId = Number(taskId || 0);
  const normalizedLimit = Math.max(1, Math.min(200, Number(options?.limit || 40) || 40));
  const conditions = ["history.tracking_task_id = $1"];
  const values = [normalizedTaskId];
  let idx = 2;

  if (options?.hasActorFilter) {
    if (options.actorUserId === null) {
      conditions.push("history.actor_user_id IS NULL");
    } else {
      conditions.push(`history.actor_user_id = $${idx}`);
      values.push(Number(options.actorUserId || 0));
      idx += 1;
    }
  }

  if (options?.actionType) {
    conditions.push(`LOWER(history.action_type) = $${idx}`);
    values.push(String(options.actionType).trim().toLowerCase());
    idx += 1;
  }

  if (options?.fromDate) {
    conditions.push(`history.created_at >= $${idx}`);
    values.push(options.fromDate);
    idx += 1;
  }

  if (options?.toDate) {
    conditions.push(`history.created_at <= $${idx}`);
    values.push(options.toDate);
    idx += 1;
  }

  values.push(normalizedLimit);
  const result = await query(
    `
      SELECT
        history.*,
        actor.name AS actor_name,
        actor.email AS actor_email
      FROM tracking_task_history history
      LEFT JOIN users actor ON actor.id = history.actor_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY history.created_at DESC, history.id DESC
      LIMIT $${idx}
    `,
    values
  );
  return (result.rows || []).map((row) => ({
    ...row,
    metadata: safeJsonParse(row.metadata_json, null)
  }));
}

async function updateTrackingTask(taskId, updates = {}, options = {}) {
  const current = await getTrackingTaskById(taskId);
  if (!current) {
    throw new Error("Tracking task not found.");
  }

  const fields = [];
  const values = [];
  let idx = 1;
  const normalizedUpdates = {};
  const historyChanges = [];

  if (updates.assigned_to !== undefined) {
    normalizedUpdates.assigned_to = Number(updates.assigned_to || 0) || null;
    if (!areTrackingHistoryValuesEqual(current.assigned_to, normalizedUpdates.assigned_to, "assigned_to")) {
      fields.push(`assigned_to = $${idx}`);
      values.push(normalizedUpdates.assigned_to);
      idx += 1;
      historyChanges.push({
        field_name: "assigned_to",
        previous_value: current.assigned_to,
        next_value: normalizedUpdates.assigned_to
      });
    }
  }
  if (updates.status !== undefined) {
    normalizedUpdates.status = String(updates.status || "").trim().toUpperCase();
    if (!areTrackingHistoryValuesEqual(current.status, normalizedUpdates.status, "status")) {
      fields.push(`status = $${idx}`);
      values.push(normalizedUpdates.status);
      idx += 1;
      historyChanges.push({
        field_name: "status",
        previous_value: current.status,
        next_value: normalizedUpdates.status
      });
    }
  }
  if (updates.priority !== undefined) {
    normalizedUpdates.priority = String(updates.priority || "").trim().toLowerCase() || "medium";
    if (!areTrackingHistoryValuesEqual(current.priority, normalizedUpdates.priority, "priority")) {
      fields.push(`priority = $${idx}`);
      values.push(normalizedUpdates.priority);
      idx += 1;
      historyChanges.push({
        field_name: "priority",
        previous_value: current.priority,
        next_value: normalizedUpdates.priority
      });
    }
  }
  if (updates.due_date !== undefined) {
    normalizedUpdates.due_date = updates.due_date || null;
    if (!areTrackingHistoryValuesEqual(current.due_date, normalizedUpdates.due_date, "due_date")) {
      fields.push(`due_date = $${idx}`);
      values.push(normalizedUpdates.due_date);
      idx += 1;
      historyChanges.push({
        field_name: "due_date",
        previous_value: current.due_date,
        next_value: normalizedUpdates.due_date
      });
    }
  }

  if (!fields.length) {
    return current;
  }

  fields.push("updated_at = NOW()");
  values.push(Number(taskId));

  await query(
    `UPDATE tracking_tasks SET ${fields.join(", ")} WHERE task_id = $${idx}`,
    values
  );

  if (current.existing_task_id) {
    const taskUpdates = {};
    if (normalizedUpdates.assigned_to !== undefined) taskUpdates.assigned_to = normalizedUpdates.assigned_to;
    if (normalizedUpdates.status !== undefined) taskUpdates.status = normalizedUpdates.status.toLowerCase();
    if (normalizedUpdates.priority !== undefined) taskUpdates.priority = normalizedUpdates.priority;
    if (normalizedUpdates.due_date !== undefined) taskUpdates.due_date = normalizedUpdates.due_date;
    if (Object.keys(taskUpdates).length) {
      await updateTask(current.existing_task_id, taskUpdates);
    }
  }

  if (historyChanges.length) {
    await createTrackingTaskHistoryEntries({
      trackingTaskId: taskId,
      existingTaskId: current.existing_task_id || null,
      actorUserId: options.actorUserId || null,
      actionType: options.actionType || "updated",
      changes: historyChanges,
      metadata: options.metadata || null
    });
  }

  return getTrackingTaskById(taskId);
}

async function getTaskById(id) {
  const result = await query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!result.rows[0]) return null;
  const t = result.rows[0];
  const extras = await Promise.all([
    t.project_id ? query(`SELECT project_code, project_name FROM projects WHERE id = $1`, [t.project_id]) : Promise.resolve({ rows: [] }),
    t.assigned_to ? query(`SELECT name FROM users WHERE id = $1`, [t.assigned_to]) : Promise.resolve({ rows: [] }),
    t.email_id ? query(`SELECT subject, serial FROM emails WHERE id = $1`, [t.email_id]) : Promise.resolve({ rows: [] })
  ]);
  return {
    ...t,
    project_code: extras[0].rows[0]?.project_code || null,
    project_name: extras[0].rows[0]?.project_name || null,
    assigned_to_name: extras[1].rows[0]?.name || null,
    email_subject: extras[2].rows[0]?.subject || null,
    email_serial: extras[2].rows[0]?.serial || null
  };
}

async function updateTask(id, taskData) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(taskData)) {
    if (["title", "description", "status", "priority", "due_date", "assigned_to", "alerted", "alerted_at", "completed_at"].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
  }
  fields.push(`updated_at = NOW()`);
  if (fields.length === 0) return null;
  values.push(id);
  await query(`UPDATE tasks SET ${fields.join(", ")} WHERE id = $${idx}`, values);
  const updated = await getTaskById(id);
  await syncTrackingTaskRecord(updated);
  return updated;
}

async function deleteTask(id) {
  await query(`DELETE FROM tasks WHERE id = $1`, [id]);
}

async function getDueTasks(hoursAhead = 48) {
  const result = await query(
    `SELECT t.*, p.project_code, p.project_name, u.name AS assigned_to_name, u.email AS assigned_to_email
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.status = 'pending'
       AND t.due_date IS NOT NULL
       AND t.due_date <= NOW() + ($1 || ' hours')::INTERVAL
       AND (t.alerted = FALSE OR t.alerted_at < NOW() - INTERVAL '12 hours')
     ORDER BY t.due_date ASC`,
    [hoursAhead]
  );
  return result.rows;
}

async function markTaskAlerted(taskId) {
  await query(`UPDATE tasks SET alerted = TRUE, alerted_at = NOW() WHERE id = $1`, [taskId]);
  await syncTrackingTaskRecord(taskId);
}

async function getTaskStats(userId = null) {
  let userFilter = "";
  const params = [];
  if (userId) {
    userFilter = "WHERE assigned_to = $1";
    params.push(userId);
  }
  const result = await query(
    `SELECT * FROM tasks ${userFilter}`,
    params
  );
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const rows = result.rows;
  return {
    total: rows.length,
    pending: rows.filter(r => r.status === "pending").length,
    in_progress: rows.filter(r => r.status === "in_progress").length,
    completed: rows.filter(r => r.status === "completed").length,
    overdue: rows.filter(r => r.status === "pending" && r.due_date && new Date(r.due_date) < now).length,
    due_soon: rows.filter(r => r.status === "pending" && r.due_date && new Date(r.due_date) >= now && new Date(r.due_date) <= in48h).length
  };
}

async function getUnclassifiedCount() {
  const result = await query(
    "SELECT COUNT(*)::int AS count FROM emails WHERE project_id IS NULL AND email_key_id IS NULL"
  );
  return result.rows[0]?.count || 0;
}

async function getUnclassifiedEmails() {
  const result = await query(
    `SELECT e.*, f.name AS folder_name, ek.key_code, p.project_code
     FROM emails e
     JOIN folders f ON f.id = e.folder_id
     LEFT JOIN email_keys ek ON ek.id = e.email_key_id
     LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.project_id IS NULL AND e.email_key_id IS NULL
     ORDER BY e.received_at DESC LIMIT 200`
  );
  return result.rows;
}

async function classifyEmail(emailId, projectId, keyId) {
  const result = await query(
    `UPDATE emails SET project_id = $1, email_key_id = $2 WHERE id = $3 RETURNING *`,
    [projectId || null, keyId || null, emailId]
  );
  const updated = result.rows[0] || null;
  if (updated) {
    await syncEmailRegistryForEmail(updated);
  }
  return updated;
}

async function createEmailKey(keyData) {
  const result = await query(
    `INSERT INTO email_keys (key_code, key_name, description, color, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [keyData.key_code.toUpperCase(), keyData.key_name, keyData.description || "", keyData.color || "#1a237e", keyData.sort_order || 0]
  );
  return result.rows[0];
}

async function getEmailKeys() {
  const result = await query(
    `SELECT * FROM email_keys WHERE is_active = TRUE ORDER BY sort_order ASC, key_code ASC`
  );
  return result.rows;
}

async function updateEmailKey(id, keyData) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(keyData)) {
    if (["key_code", "key_name", "description", "color", "is_active", "sort_order"].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(key);
      idx++;
    }
  }
  if (fields.length === 0) return null;
  values.push(id);
  await query(`UPDATE email_keys SET ${fields.join(", ")} WHERE id = $${idx}`, values);
  return (await query(`SELECT * FROM email_keys WHERE id = $1`, [id])).rows[0];
}

async function deleteEmailKey(id) {
  await query(`UPDATE email_keys SET is_active = FALSE WHERE id = $1`, [id]);
}

async function createProject(projectData) {
  const result = await query(
    `INSERT INTO projects (project_code, project_name, client_name, location, status, start_date, end_date, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [projectData.project_code.toUpperCase(), projectData.project_name, projectData.client_name || "",
     projectData.location || "", projectData.status || "Active", projectData.start_date || null,
     projectData.end_date || null, projectData.description || ""]
  );
  return result.rows[0];
}

async function getProjects() {
  const result = await query(
    `SELECT * FROM projects WHERE status != 'Deleted' ORDER BY project_code ASC`
  );
  return result.rows;
}

async function getProjectById(id) {
  const result = await query(`SELECT * FROM projects WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function getProjectByCode(code) {
  const result = await query(`SELECT * FROM projects WHERE project_code = $1`, [code]);
  return result.rows[0] || null;
}

async function updateProject(id, projectData) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(projectData)) {
    if (["project_code", "project_name", "client_name", "location", "status", "start_date", "end_date", "description"].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
  }
  if (fields.length === 0) return null;
  values.push(id);
  await query(`UPDATE projects SET ${fields.join(", ")} WHERE id = $${idx}`, values);
  return (await query(`SELECT * FROM projects WHERE id = $1`, [id])).rows[0];
}

async function deleteProject(id) {
  await query(`UPDATE projects SET status = 'Deleted' WHERE id = $1`, [id]);
}

async function getEmailsByProject(projectId) {
  const result = await query(
    `SELECT e.*, f.name AS folder_name, ek.key_code, ek.key_name FROM emails e
     JOIN folders f ON f.id = e.folder_id
     LEFT JOIN email_keys ek ON ek.id = e.email_key_id
     WHERE e.project_id = $1
     ORDER BY e.received_at DESC`,
    [projectId]
  );
  return result.rows;
}

async function getProjectEmailHistoryForDrafting({
  projectId,
  employeeId = null,
  excludeEmailId = null,
  limit = 10
} = {}) {
  if (!projectId) {
    return [];
  }

  const params = [Number(projectId)];
  let whereSql = `WHERE er.project_id = $1`;

  if (employeeId) {
    params.push(Number(employeeId));
    whereSql += ` AND e.employee_id = $${params.length}`;
  }
  if (excludeEmailId) {
    params.push(Number(excludeEmailId));
    whereSql += ` AND e.id != $${params.length}`;
  }

  params.push(Math.min(20, Math.max(1, Number(limit || 10))));

  const result = await query(
    `
      SELECT
        er.email_db_id,
        er.email_id,
        er.project_id,
        er.thread_id,
        er.serial_number,
        p.project_code,
        p.project_name,
        e.subject,
        e.sender_name,
        e.sender_email,
        e.recipient_email,
        e.cc_list,
        e.received_at,
        e.sent_at,
        COALESCE(aa.summary, eca.ai_summary, '') AS ai_summary,
        SUBSTRING(
          REGEXP_REPLACE(COALESCE(eca.raw_body, e.body, e.body_html, ''), '<[^>]+>', ' ', 'g')
          FROM 1 FOR 1400
        ) AS body_excerpt
      FROM email_registry er
      JOIN emails e ON e.id = er.email_id
      LEFT JOIN projects p ON p.id = er.project_id
      LEFT JOIN email_content_archive eca ON eca.email_db_id = er.email_db_id
      LEFT JOIN ai_analysis aa ON aa.email_id = er.email_id
      ${whereSql}
      ORDER BY COALESCE(e.sent_at, e.received_at, er.updated_at) DESC, er.email_db_id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows || [];
}

function normalizeContractMemoryText(value = "") {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeContractMemoryCandidate(text = "", fileName = "", mimeType = "") {
  const combined = `${text || ""}\n${fileName || ""}\n${mimeType || ""}`.toLowerCase();
  return /(contract|agreement|mou|memorandum|annex|appendix|quotation|quote|proposal|offer|pricing|price|payment terms|sla|scope of work|statement of work|po\b|invoice|nd?a|warranty|penalty|liability|delivery|milestone|renewal|amendment|terms and conditions|اتفاقية|عقد|ملحق|عرض سعر|عرض فني|عرض مالي|التزام|شروط|أحكام|ضمان|غرامة|مسؤولية|موعد تسليم|دفعات|نطاق العمل|أمر شراء|فاتورة)/i.test(combined);
}

function inferContractMemoryType(text = "", fileName = "", mimeType = "") {
  const combined = `${text || ""}\n${fileName || ""}\n${mimeType || ""}`.toLowerCase();
  if (/(price|pricing|discount|quotation|quote|offer|عرض سعر|خصم|سعر)/i.test(combined)) return "pricing";
  if (/(payment terms|invoice|iban|swift|remittance|دفعة|دفعات|فاتورة|سداد|تحويل)/i.test(combined)) return "payment_terms";
  if (/(sla|delivery|deadline|milestone|due date|موعد|تسليم|جدول زمني|مهلة)/i.test(combined)) return "sla";
  if (/(liability|penalty|warranty|indemnity|guarantee|nda|terms and conditions|مسؤولية|غرامة|ضمان|شروط|أحكام)/i.test(combined)) return "legal";
  if (/(scope of work|statement of work|deliverables|scope|نطاق العمل|المخرجات|المواصفات)/i.test(combined)) return "scope";
  if (/(contract|agreement|mou|memorandum|amendment|annex|appendix|عقد|اتفاقية|ملحق)/i.test(combined)) return "contract";
  return "general";
}

function buildContractMemorySnippets(text = "", maxSnippets = 3) {
  const normalized = normalizeContractMemoryText(text);
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[\.\!\?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const prioritySentences = sentences.filter((sentence) => looksLikeContractMemoryCandidate(sentence));
  const source = prioritySentences.length ? prioritySentences : sentences;
  const snippets = [];

  for (const sentence of source) {
    if (sentence.length < 25) continue;
    const compact = sentence.slice(0, 650).trim();
    if (!compact) continue;
    snippets.push(compact);
    if (snippets.length >= maxSnippets) break;
  }

  if (!snippets.length && normalized.length) {
    snippets.push(normalized.slice(0, 650).trim());
  }

  return [...new Set(snippets)].slice(0, maxSnippets);
}

function isSupportedAttachmentTextExtension(extension = "") {
  return [".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log", ".xlsx", ".xls", ".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"].includes(String(extension || "").toLowerCase());
}

function isImageAttachmentExtension(extension = "") {
  return [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"].includes(String(extension || "").toLowerCase());
}

function isVisualAttachmentExtension(extension = "") {
  const normalized = String(extension || "").toLowerCase();
  return normalized === ".pdf" || isImageAttachmentExtension(normalized);
}

function hasMeaningfulExtractedText(text = "", minimumLength = 120) {
  const normalized = normalizeContractMemoryText(text);
  if (normalized.length >= minimumLength) {
    return true;
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount >= 24;
}

function extractTextFromSpreadsheet(filePath) {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheetTexts = (workbook.SheetNames || []).slice(0, 3).map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
      const rowText = rows
        .slice(0, 80)
        .map((row) => Array.isArray(row) ? row.filter(Boolean).join(" | ") : "")
        .filter(Boolean)
        .join("\n");
      return rowText ? `Sheet: ${sheetName}\n${rowText}` : "";
    }).filter(Boolean);
    return sheetTexts.join("\n\n");
  } catch {
    return "";
  }
}

async function extractTextFromPdf(filePath) {
  let parser = null;
  try {
    const buffer = await fs.promises.readFile(filePath);
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result?.text || "";
  } catch {
    return "";
  } finally {
    if (parser && typeof parser.destroy === "function") {
      try {
        await parser.destroy();
      } catch {
        // Ignore parser cleanup errors.
      }
    }
  }
}

async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result?.value || "";
  } catch {
    return "";
  }
}

async function extractTextFromImageWithTesseract(filePath) {
  let worker = null;
  try {
    const language = process.env.CONTRACT_OCR_LANGS || "eng+ara";
    worker = await createWorker(language);
    const result = await worker.recognize(filePath);
    return result?.data?.text || "";
  } catch {
    return "";
  } finally {
    if (worker && typeof worker.terminate === "function") {
      try {
        await worker.terminate();
      } catch {
        // Ignore worker cleanup errors.
      }
    }
  }
}

async function extractTextUsingVisionFallback(filePath, mimeType = "", fileName = "") {
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    return await extractTextWithVisionOcr({
      fileBuffer,
      mimeType,
      fileName
    });
  } catch {
    return "";
  }
}

async function extractAttachmentTextForContractMemory(attachment = {}) {
  const filePath = resolveStoredAttachmentDiskPath(attachment.file_path || "");
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  const extension = path.extname(String(attachment.file_name || attachment.originalname || "")).toLowerCase();
  if (!isSupportedAttachmentTextExtension(extension)) {
    return "";
  }

  try {
    if (extension === ".pdf") {
      const pdfText = await extractTextFromPdf(filePath);
      if (hasMeaningfulExtractedText(pdfText)) {
        return pdfText;
      }
      return await extractTextUsingVisionFallback(filePath, attachment.mime_type || "application/pdf", attachment.file_name || attachment.originalname || "attachment.pdf");
    }
    if (extension === ".docx") {
      return await extractTextFromDocx(filePath);
    }
    if (isImageAttachmentExtension(extension)) {
      const imageText = await extractTextFromImageWithTesseract(filePath);
      if (hasMeaningfulExtractedText(imageText, 60)) {
        return imageText;
      }
      return await extractTextUsingVisionFallback(filePath, attachment.mime_type || "image/png", attachment.file_name || attachment.originalname || "attachment-image");
    }
    if (extension === ".xlsx" || extension === ".xls") {
      return extractTextFromSpreadsheet(filePath);
    }
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function buildContractMemoryReference(email = {}, attachment = null, snippetIndex = 0) {
  const serial = email.serial_number || email.serial || email.subject || "memory";
  const attachmentName = attachment?.file_name || attachment?.originalname || "";
  return [serial, attachmentName, snippetIndex + 1].filter(Boolean).join(" | ");
}

async function upsertContractMemoryEntry(entry = {}) {
  if (!entry?.memory_key || !entry?.project_id || !entry?.snippet) {
    return null;
  }
  const result = await query(
    `
      INSERT INTO contract_memory (
        memory_key, project_id, employee_id, source_email_id, source_attachment_id, source_kind,
        memory_type, title, snippet, source_file_name, reference_key, confidence, source_updated_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (memory_key)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        employee_id = EXCLUDED.employee_id,
        source_email_id = EXCLUDED.source_email_id,
        source_attachment_id = EXCLUDED.source_attachment_id,
        source_kind = EXCLUDED.source_kind,
        memory_type = EXCLUDED.memory_type,
        title = EXCLUDED.title,
        snippet = EXCLUDED.snippet,
        source_file_name = EXCLUDED.source_file_name,
        reference_key = EXCLUDED.reference_key,
        confidence = EXCLUDED.confidence,
        source_updated_at = EXCLUDED.source_updated_at,
        updated_at = NOW()
      RETURNING *
    `,
    [
      entry.memory_key,
      entry.project_id,
      entry.employee_id || null,
      entry.source_email_id || null,
      entry.source_attachment_id || null,
      entry.source_kind || "email",
      entry.memory_type || "general",
      entry.title || "",
      entry.snippet,
      entry.source_file_name || "",
      entry.reference_key || "",
      entry.confidence || "medium",
      entry.source_updated_at || null
    ]
  );
  return result.rows[0] || null;
}

async function replaceStructuredClausesForMemory(memoryEntry = {}) {
  if (!memoryEntry?.id || !memoryEntry?.project_id || !memoryEntry?.snippet) {
    return [];
  }

  await query(`DELETE FROM contract_clause_memory WHERE source_memory_id = $1`, [memoryEntry.id]);

  const extracted = await extractStructuredContractClauses({
    snippet: memoryEntry.snippet,
    title: memoryEntry.title,
    memoryType: memoryEntry.memory_type,
    referenceKey: memoryEntry.reference_key,
    sourceFileName: memoryEntry.source_file_name
  });
  const clauses = Array.isArray(extracted?.clauses) ? extracted.clauses : [];
  const savedClauses = [];

  for (const [index, clause] of clauses.entries()) {
    if (!clause?.clause_value) continue;
    const result = await query(
      `
        INSERT INTO contract_clause_memory (
          clause_key, project_id, employee_id, source_memory_id, source_email_id, source_attachment_id,
          clause_type, clause_title, clause_value, normalized_value, reference_key, confidence, source_updated_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        RETURNING *
      `,
      [
        `${memoryEntry.id}:${clause.clause_type || "general"}:${index}`,
        memoryEntry.project_id,
        memoryEntry.employee_id || null,
        memoryEntry.id,
        memoryEntry.source_email_id || null,
        memoryEntry.source_attachment_id || null,
        clause.clause_type || "general",
        clause.clause_title || "",
        clause.clause_value,
        clause.normalized_value || "",
        memoryEntry.reference_key || "",
        clause.confidence || memoryEntry.confidence || "medium",
        memoryEntry.source_updated_at || null
      ]
    );
    if (result.rows[0]) {
      savedClauses.push(result.rows[0]);
    }
  }

  return savedClauses;
}

async function ensureContractMemoryForProject(projectId, employeeId = null) {
  if (!projectId) {
    return [];
  }

  const params = [Number(projectId)];
  let whereSql = `WHERE er.project_id = $1`;
  if (employeeId) {
    params.push(Number(employeeId));
    whereSql += ` AND e.employee_id = $${params.length}`;
  }

  const emailResult = await query(
    `
      SELECT
        er.email_db_id,
        er.email_id,
        er.serial_number,
        er.thread_id,
        er.project_id,
        er.employee_id,
        e.subject,
        e.body,
        e.body_html,
        e.received_at,
        e.sent_at,
        e.updated_at AS email_updated_at,
        COALESCE(aa.summary, eca.ai_summary, '') AS ai_summary,
        eca.updated_at AS archive_updated_at
      FROM email_registry er
      JOIN emails e ON e.id = er.email_id
      LEFT JOIN email_content_archive eca ON eca.email_db_id = er.email_db_id
      LEFT JOIN ai_analysis aa ON aa.email_id = er.email_id
      ${whereSql}
      ORDER BY COALESCE(e.sent_at, e.received_at, e.updated_at) DESC, er.email_db_id DESC
      LIMIT 60
    `,
    params
  );

  const refreshedEntries = [];
  for (const email of emailResult.rows || []) {
    const emailSourceUpdatedAt = email.archive_updated_at || email.email_updated_at || email.sent_at || email.received_at || new Date().toISOString();
    const emailText = [email.subject, email.ai_summary, email.body, email.body_html].filter(Boolean).join("\n");
    if (looksLikeContractMemoryCandidate(emailText, email.subject || "", "message/rfc822")) {
      const emailSnippets = buildContractMemorySnippets(emailText, 2);
      for (const [index, snippet] of emailSnippets.entries()) {
        const entry = await upsertContractMemoryEntry({
          memory_key: `email:${email.project_id}:${email.email_id}:${index}`,
          project_id: email.project_id,
          employee_id: email.employee_id || employeeId || null,
          source_email_id: email.email_id,
          source_attachment_id: null,
          source_kind: "email",
          memory_type: inferContractMemoryType(snippet, email.subject || "", "message/rfc822"),
          title: email.subject || "Project email context",
          snippet,
          source_file_name: "",
          reference_key: buildContractMemoryReference(email, null, index),
          confidence: "medium",
          source_updated_at: emailSourceUpdatedAt
        });
        if (entry) refreshedEntries.push(entry);
      }
    }

    const attachments = await getEmailAttachments(email.email_id);
    for (const attachment of attachments || []) {
      const attachmentExtension = path.extname(String(attachment.file_name || attachment.originalname || "")).toLowerCase();
      const parentSuggestsContract = looksLikeContractMemoryCandidate(emailText, email.subject || "", "message/rfc822");
      const candidate =
        looksLikeContractMemoryCandidate("", attachment.file_name || "", attachment.mime_type || "")
        || (parentSuggestsContract && isVisualAttachmentExtension(attachmentExtension));
      const attachmentTextRaw = candidate ? await extractAttachmentTextForContractMemory(attachment) : "";
      const attachmentText = normalizeContractMemoryText(attachmentTextRaw);
      if (!candidate && !looksLikeContractMemoryCandidate(attachmentText, attachment.file_name || "", attachment.mime_type || "")) {
        continue;
      }

      const snippets = attachmentText
        ? buildContractMemorySnippets(attachmentText, 3)
        : [`Attachment "${attachment.file_name || "file"}" was referenced in project correspondence and appears to contain contractual or commercial terms.`];

      for (const [index, snippet] of snippets.entries()) {
        const entry = await upsertContractMemoryEntry({
          memory_key: `attachment:${email.project_id}:${email.email_id}:${attachment.id}:${index}`,
          project_id: email.project_id,
          employee_id: email.employee_id || employeeId || null,
          source_email_id: email.email_id,
          source_attachment_id: attachment.id,
          source_kind: "attachment",
          memory_type: inferContractMemoryType(snippet, attachment.file_name || "", attachment.mime_type || ""),
          title: attachment.file_name || email.subject || "Attachment contract memory",
          snippet,
          source_file_name: attachment.file_name || "",
          reference_key: buildContractMemoryReference(email, attachment, index),
          confidence: attachmentText ? "high" : "low",
          source_updated_at: emailSourceUpdatedAt
        });
        if (entry) refreshedEntries.push(entry);
      }
    }
  }

  return refreshedEntries;
}

async function ensureStructuredContractClausesForProject(projectId, employeeId = null, memoryEntries = null) {
  if (!projectId) {
    return [];
  }

  const ensuredMemoryEntries = Array.isArray(memoryEntries) && memoryEntries.length
    ? memoryEntries
    : await getContractMemoryForProject({
      projectId,
      employeeId,
      limit: 30
    });

  const refreshed = [];
  for (const memoryEntry of ensuredMemoryEntries) {
    const clauses = await replaceStructuredClausesForMemory(memoryEntry);
    refreshed.push(...clauses);
  }

  return refreshed;
}

async function getContractMemoryForProject({
  projectId,
  employeeId = null,
  limit = 12
} = {}) {
  if (!projectId) {
    return [];
  }

  await ensureContractMemoryForProject(projectId, employeeId);

  const params = [Number(projectId)];
  let whereSql = `WHERE project_id = $1`;
  if (employeeId) {
    params.push(Number(employeeId));
    whereSql += ` AND (employee_id = $${params.length} OR employee_id IS NULL)`;
  }
  params.push(Math.min(30, Math.max(1, Number(limit || 12))));

  const result = await query(
    `
      SELECT *
      FROM contract_memory
      ${whereSql}
      ORDER BY
        CASE confidence
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          ELSE 2
        END ASC,
        updated_at DESC,
        id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows || [];
}

async function getStructuredContractClausesForProject({
  projectId,
  employeeId = null,
  limit = 16
} = {}) {
  if (!projectId) {
    return [];
  }

  const memoryEntries = await getContractMemoryForProject({
    projectId,
    employeeId,
    limit: 30
  });
  await ensureStructuredContractClausesForProject(projectId, employeeId, memoryEntries);

  const params = [Number(projectId)];
  let whereSql = `WHERE project_id = $1`;
  if (employeeId) {
    params.push(Number(employeeId));
    whereSql += ` AND (employee_id = $${params.length} OR employee_id IS NULL)`;
  }
  params.push(Math.min(40, Math.max(1, Number(limit || 16))));

  const result = await query(
    `
      SELECT *
      FROM contract_clause_memory
      ${whereSql}
      ORDER BY
        CASE confidence
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          ELSE 2
        END ASC,
        updated_at DESC,
        id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows || [];
}

async function parseSubjectForMetadata(subject) {
  const metadata = { key_code: null, project_code: null, clean_subject: subject };

  // Level 1: Extract from [KEY] [PROJECT] pattern (handles flexible spacing)
  const combinedMatch = subject.match(/\[(.*?)\]\s*\[(.*?)\]/);
  if (combinedMatch) {
    const possibleKey = combinedMatch[1].trim().toUpperCase();
    const possibleProject = combinedMatch[2].trim().toUpperCase();
    if (/^[A-Z][A-Z0-9\-]*$/.test(possibleKey) && possibleKey.length <= 30) {
      metadata.key_code = possibleKey;
    }
    if (/^[A-Z]+[\-\.]?\d+[A-Z0-9\-]*$/i.test(possibleProject) && possibleProject.length <= 30) {
      metadata.project_code = possibleProject;
    }
    metadata.clean_subject = subject.replace(combinedMatch[0], "").trim();
    return metadata;
  }

  // Level 2: Extract key only [KEY]
  if (!metadata.key_code) {
    const keyMatch = subject.match(/^\[([A-Z][A-Z0-9\-]*)\]/i);
    if (keyMatch) {
      const possibleKey = keyMatch[1].toUpperCase();
      if (possibleKey.length <= 30) {
        metadata.key_code = possibleKey;
        metadata.clean_subject = subject.substring(keyMatch[0].length).trim();
      }
    }
  }

  // Level 3: Extract project only [PROJECT] (search anywhere in subject)
  if (!metadata.project_code) {
    const projectMatch = subject.match(/\[([A-Z][A-Z0-9\-]*[\-\.]?\d+[A-Z0-9\-]*)\]/i);
    if (projectMatch) {
      const possibleProject = projectMatch[1].toUpperCase();
      if (possibleProject.length <= 30) {
        metadata.project_code = possibleProject;
        metadata.clean_subject = metadata.clean_subject.replace(projectMatch[0], "").trim();
      }
    }
  }

  return metadata;
}

async function generateHiddenFooter(projectCode, serial) {
  const hash = serial ? serial.replace(/[^A-Za-z0-9]/g, "").slice(-10) : Math.random().toString(36).slice(2, 12);
  return `<div style="display:none;color:white;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">System-Ref: ${projectCode || "UNSPECIFIED"}-${new Date().getFullYear()} | Msg-Hash: ${hash} | Serial: ${serial || "NONE"}</div>`;
}

function extractHiddenRef(htmlContent, textContent) {
  const sources = [htmlContent, textContent].filter(Boolean);
  for (const source of sources) {
    const refMatch = source.match(/System-Ref:\s*([^\|<\n]+)/i);
    if (refMatch) {
      const raw = refMatch[1].trim();
      const parts = raw.split("-");
      const yearIdx = parts.findIndex(p => /^\d{4}$/.test(p));
      if (yearIdx > 0) {
        const projectCode = parts.slice(0, yearIdx).join("-");
        const year = parts[yearIdx];
        return { project_code: projectCode, year: parseInt(year, 10), raw };
      }
      return { project_code: raw, year: null, raw };
    }
  }
  return null;
}

async function extractEmailMetadata(htmlBody, textBody, subject, inReplyTo, referencesHeader, messageId) {
  // Level 1 (Priority): Hidden Footer - if found, this is the source of truth
  const hiddenRef = extractHiddenRef(htmlBody, textBody);
  if (hiddenRef && hiddenRef.project_code && hiddenRef.project_code !== "UNSPECIFIED") {
    return {
      source: "hidden_footer",
      key_code: null,
      project_code: hiddenRef.project_code,
      confidence: "high"
    };
  }

  // Level 2: In-Reply-To - look up original email in database
  if (inReplyTo) {
    const replyChainResult = await query(
      "SELECT email_key_id, project_id, subject_key FROM emails WHERE external_message_id = $1 LIMIT 1",
      [inReplyTo]
    );
    if (replyChainResult.rows.length) {
      const original = replyChainResult.rows[0];
      let keyCode = null;
      let projectCode = null;
      if (original.email_key_id) {
        const keyResult = await query("SELECT key_code FROM email_keys WHERE id = $1", [original.email_key_id]);
        if (keyResult.rows.length) keyCode = keyResult.rows[0].key_code;
      }
      if (original.project_id) {
        const projResult = await query("SELECT project_code FROM projects WHERE id = $1", [original.project_id]);
        if (projResult.rows.length) projectCode = projResult.rows[0].project_code;
      }
      if (keyCode || projectCode) {
        return {
          source: "in_reply_to",
          key_code: keyCode,
          project_code: projectCode,
          confidence: "high"
        };
      }
    }
  }

  // Level 3: Subject Regex - parse [KEY] [PROJECT] from subject
  const subjectMeta = await parseSubjectForMetadata(subject);
  if (subjectMeta.key_code || subjectMeta.project_code) {
    return {
      source: "subject_regex",
      key_code: subjectMeta.key_code,
      project_code: subjectMeta.project_code,
      confidence: subjectMeta.key_code && subjectMeta.project_code ? "medium" : "low"
    };
  }

  return { source: "none", key_code: null, project_code: null, confidence: "none" };
}

async function createEmailAccount(userId, accountData) {
  const result = await query(
    `INSERT INTO email_accounts (user_id, email_address, display_name, is_default, smtp_host, smtp_port, smtp_ssl, smtp_username, smtp_password, imap_host, imap_port, imap_ssl, imap_username, imap_password, pop3_host, pop3_port, pop3_ssl, pop3_username, pop3_password, signature_html, signature_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
    [userId, accountData.email_address, accountData.display_name || "", accountData.is_default || false,
     accountData.smtp_host || "", accountData.smtp_port || 587, accountData.smtp_ssl !== false,
     accountData.smtp_username || "", accountData.smtp_password || "",
     accountData.imap_host || "", accountData.imap_port || 993, accountData.imap_ssl !== false,
     accountData.imap_username || "", accountData.imap_password || "",
     accountData.pop3_host || "", accountData.pop3_port || 995, accountData.pop3_ssl !== false,
     accountData.pop3_username || "", accountData.pop3_password || "",
     accountData.signature_html || "", accountData.signature_text || ""]
  );
  return result.rows[0];
}

async function getEmailAccounts(userId) {
  const result = await query(
    `SELECT id, user_id, email_address, display_name, is_active, is_default, smtp_host, smtp_port, smtp_ssl, smtp_username,
     imap_host, imap_port, imap_ssl, imap_username, pop3_host, pop3_port, pop3_ssl, pop3_username, created_at
     FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, email_address ASC`,
    [userId]
  );
  return result.rows;
}

async function getEmailAccountById(accountId) {
  const result = await query(`SELECT * FROM email_accounts WHERE id = $1`, [accountId]);
  return result.rows[0] || null;
}

async function updateEmailAccount(accountId, accountData) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(accountData)) {
    if (["email_address", "display_name", "is_active", "is_default", "smtp_host", "smtp_port", "smtp_ssl", "smtp_username", "smtp_password", "imap_host", "imap_port", "imap_ssl", "imap_username", "imap_password", "pop3_host", "pop3_port", "pop3_ssl", "pop3_username", "pop3_password", "signature_html", "signature_text"].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
  }
  if (fields.length === 0) return null;
  fields.push(`updated_at = NOW()`);
  values.push(accountId);
  await query(`UPDATE email_accounts SET ${fields.join(", ")} WHERE id = $${idx}`, values);
  return getEmailAccountById(accountId);
}

async function deleteEmailAccount(accountId) {
  await query(`DELETE FROM email_accounts WHERE id = $1`, [accountId]);
}

async function setEmailAccountDefault(userId, accountId) {
  await query(`UPDATE email_accounts SET is_default = FALSE WHERE user_id = $1`, [userId]);
  await query(`UPDATE email_accounts SET is_default = TRUE WHERE id = $1 AND user_id = $2`, [accountId, userId]);
}

async function getUserActiveAccounts(userId) {
  const result = await query(
    `SELECT * FROM email_accounts WHERE user_id = $1 AND is_active = TRUE ORDER BY is_default DESC`,
    [userId]
  );
  return result.rows;
}

async function trackEmailThread(messageId, inReplyTo, referencesHeader, serial, emailId, subject, senderEmail) {
  if (!messageId) return;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let threadId = null;
      let existingThread = null;

      if (serial) {
        const serialResult = await client.query(
          `SELECT id, thread_id, message_ids FROM email_threads WHERE serial = $1 LIMIT 1`,
          [serial]
        );
        if (serialResult.rows.length) {
          existingThread = serialResult.rows[0];
          threadId = existingThread.thread_id;
        }
      }

      if (!threadId && inReplyTo) {
        const parentResult = await client.query(
          `SELECT id, thread_id, serial, message_ids FROM email_threads WHERE $1 = ANY(message_ids) LIMIT 1`,
          [inReplyTo]
        );
        if (parentResult.rows.length) {
          existingThread = parentResult.rows[0];
          threadId = existingThread.thread_id;
          if (!serial) serial = existingThread.serial;
        }
      }

      if (!threadId && referencesHeader && typeof referencesHeader === "string") {
        const refs = referencesHeader.split(/\s+/).filter(Boolean);
        for (const ref of refs) {
          const refResult = await client.query(
            `SELECT id, thread_id, serial, message_ids FROM email_threads WHERE $1 = ANY(message_ids) LIMIT 1`,
            [ref]
          );
          if (refResult.rows.length) {
            existingThread = refResult.rows[0];
            threadId = existingThread.thread_id;
            if (!serial) serial = existingThread.serial;
            break;
          }
        }
      }

      if (!threadId) {
        threadId = `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }

      const participantEmail = senderEmail || "";
      if (existingThread) {
        await client.query(
          `UPDATE email_threads SET
            message_ids = array_append(message_ids, $1),
            participant_emails = CASE WHEN $2 = ANY(participant_emails) THEN participant_emails ELSE array_append(participant_emails, $2) END,
            message_count = message_count + 1,
            last_message_at = NOW()
           WHERE id = $3`,
          [messageId, participantEmail, existingThread.id]
        );
      } else {
        await client.query(
          `INSERT INTO email_threads (thread_id, serial, message_ids, root_message_id, subject, sender_email, participant_emails, message_count)
           VALUES ($1, $2, ARRAY[$3]::TEXT[], $3, $4, $5, ARRAY[$5]::TEXT[], 1)`,
          [threadId, serial, messageId, subject || "", participantEmail]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("trackEmailThread error:", e.message);
  }
}

async function resolveSerialFromHeaders(messageId, inReplyTo, referencesHeader) {
  if (inReplyTo) {
    const result = await query(
      `SELECT serial FROM email_threads WHERE $1 = ANY(message_ids) AND serial IS NOT NULL LIMIT 1`,
      [inReplyTo]
    );
    if (result.rows.length && result.rows[0].serial) return result.rows[0].serial;
  }

  if (referencesHeader && typeof referencesHeader === "string") {
    const refs = referencesHeader.split(/\s+/).filter(Boolean);
    for (const ref of refs) {
      const result = await query(
        `SELECT serial FROM email_threads WHERE $1 = ANY(message_ids) AND serial IS NOT NULL LIMIT 1`,
        [ref]
      );
      if (result.rows.length && result.rows[0].serial) return result.rows[0].serial;
    }
  }

  if (messageId) {
    const result = await query(
      `SELECT serial FROM email_threads WHERE $1 = ANY(message_ids) AND serial IS NOT NULL LIMIT 1`,
      [messageId]
    );
    if (result.rows.length && result.rows[0].serial) return result.rows[0].serial;
  }

  return null;
}

async function getThreadByEmailId(emailId) {
  const result = await query(
    `SELECT * FROM email_threads WHERE email_id = $1 LIMIT 1`, [emailId]
  );
  return result.rows[0] || null;
}

async function getFullThreadBySerial(serial) {
  const threadEmails = await query(
    `SELECT e.*, f.name AS folder_name FROM emails e
     JOIN folders f ON f.id = e.folder_id
     WHERE e.serial = $1 ORDER BY e.received_at ASC`,
    [serial]
  );
  return threadEmails.rows;
}

async function getArchiveStats() {
  const totalResult = await query(`SELECT COUNT(*)::int AS total, COUNT(DISTINCT serial)::int AS unique_serials FROM emails`);
  const recentResult = await query(
    `SELECT e.serial, e.subject, e.sender_name, e.sender_email, e.recipient_email, e.received_at, f.name AS folder_name
     FROM emails e JOIN folders f ON f.id = e.folder_id
     WHERE e.serial IS NOT NULL ORDER BY e.received_at DESC LIMIT 20`
  );
  return { stats: totalResult.rows[0], recent: recentResult.rows };
}

function normalizeArchiveExplorerFilters(filters = {}) {
  return {
    project_code: String(filters.project_code || "").trim(),
    serial_number: String(filters.serial_number || "").trim(),
    thread_id: String(filters.thread_id || "").trim(),
    limit: Math.min(200, Math.max(1, Number(filters.limit || 50)))
  };
}

function buildArchiveExplorerWhereClause(filters = {}) {
  const params = [];
  const clauses = [];

  if (filters.project_code) {
    params.push(`%${filters.project_code}%`);
    clauses.push(`p.project_code ILIKE $${params.length}`);
  }
  if (filters.serial_number) {
    params.push(`%${filters.serial_number}%`);
    clauses.push(`er.serial_number ILIKE $${params.length}`);
  }
  if (filters.thread_id) {
    params.push(`%${filters.thread_id}%`);
    clauses.push(`er.thread_id ILIKE $${params.length}`);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

async function listAdminArchiveExplorer(filters = {}) {
  const normalized = normalizeArchiveExplorerFilters(filters);
  const { whereSql, params } = buildArchiveExplorerWhereClause(normalized);
  const limitParam = params.length + 1;
  const queryParams = [...params, normalized.limit];

  const registryResult = await query(
    `
      SELECT
        er.email_db_id,
        er.email_id,
        er.project_id,
        er.employee_id,
        er.assigned_manager_id,
        er.message_id,
        er.thread_id,
        er.subject_key,
        er.serial_number,
        er.folder_name,
        er.approval_status,
        er.source_provider,
        er.risk_level,
        er.is_archived,
        er.created_at,
        er.updated_at,
        p.project_code,
        p.project_name,
        employee.name AS employee_name,
        employee.email AS employee_email,
        manager.name AS assigned_manager_name,
        manager.email AS assigned_manager_email,
        e.subject,
        e.sender_name,
        e.sender_email,
        e.recipient_email,
        e.cc_list,
        e.status AS email_status,
        e.received_at,
        e.sent_at
      FROM email_registry er
      LEFT JOIN projects p ON p.id = er.project_id
      LEFT JOIN users employee ON employee.id = er.employee_id
      LEFT JOIN users manager ON manager.id = er.assigned_manager_id
      LEFT JOIN emails e ON e.id = er.email_id
      ${whereSql}
      ORDER BY er.updated_at DESC, er.email_db_id DESC
      LIMIT $${limitParam}
    `,
    queryParams
  );

  const contentResult = await query(
    `
      SELECT
        eca.email_db_id,
        er.email_id,
        er.thread_id,
        er.serial_number,
        er.folder_name,
        er.risk_level,
        p.project_code,
        p.project_name,
        e.subject,
        e.sender_email,
        e.recipient_email,
        eca.ai_summary,
        eca.attachments_path,
        SUBSTRING(COALESCE(eca.raw_body, '') FROM 1 FOR 500) AS raw_body_preview,
        COALESCE(LENGTH(eca.raw_body), 0)::int AS raw_body_length,
        eca.updated_at
      FROM email_content_archive eca
      JOIN email_registry er ON er.email_db_id = eca.email_db_id
      LEFT JOIN projects p ON p.id = er.project_id
      LEFT JOIN emails e ON e.id = er.email_id
      ${whereSql}
      ORDER BY eca.updated_at DESC, eca.email_db_id DESC
      LIMIT $${limitParam}
    `,
    queryParams
  );

  const trackingResult = await query(
    `
      SELECT
        tt.task_id,
        tt.existing_task_id,
        tt.email_db_id,
        tt.email_id,
        tt.assigned_to,
        tt.task_type,
        tt.priority,
        tt.due_date,
        tt.status,
        tt.is_alerted,
        tt.alert_count,
        tt.updated_at,
        er.thread_id,
        er.serial_number,
        er.folder_name,
        p.project_code,
        p.project_name,
        assigned.name AS assigned_to_name,
        assigned.email AS assigned_to_email,
        e.subject AS email_subject,
        e.sender_email,
        e.recipient_email,
        t.title AS source_task_title,
        t.description AS source_task_description,
        aa.email_category,
        aa.summary AS ai_summary,
        aa.ai_tasks
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      LEFT JOIN projects p ON p.id = er.project_id
      LEFT JOIN users assigned ON assigned.id = tt.assigned_to
      LEFT JOIN emails e ON e.id = COALESCE(tt.email_id, er.email_id)
      LEFT JOIN tasks t ON t.id = tt.existing_task_id
      LEFT JOIN ai_analysis aa ON aa.email_id = COALESCE(tt.email_id, er.email_id)
      ${whereSql}
      ORDER BY tt.updated_at DESC, tt.task_id DESC
      LIMIT $${limitParam}
    `,
    queryParams
  );

  const registryCountResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM email_registry er
      LEFT JOIN projects p ON p.id = er.project_id
      ${whereSql}
    `,
    params
  );
  const contentCountResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM email_content_archive eca
      JOIN email_registry er ON er.email_db_id = eca.email_db_id
      LEFT JOIN projects p ON p.id = er.project_id
      ${whereSql}
    `,
    params
  );
  const trackingCountResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM tracking_tasks tt
      LEFT JOIN email_registry er ON er.email_db_id = tt.email_db_id
      LEFT JOIN projects p ON p.id = er.project_id
      ${whereSql}
    `,
    params
  );

  return {
    filters: normalized,
    totals: {
      registry: Number(registryCountResult.rows[0]?.total || 0),
      content_archive: Number(contentCountResult.rows[0]?.total || 0),
      tracking_tasks: Number(trackingCountResult.rows[0]?.total || 0)
    },
    email_registry: registryResult.rows || [],
    email_content_archive: contentResult.rows || [],
    tracking_tasks: trackingResult.rows || []
  };
}

function getDatabaseMode() {
  return databaseMode;
}

async function migrateRecentContactsFromHistory() {
  try {
    const { rows: users } = await query("SELECT id FROM users");
    for (const user of users) {
      try {
        const { rows: sent } = await query(
          `SELECT sender_email, sender_name FROM emails WHERE employee_id = $1 AND sender_email IS NOT NULL AND sender_email != ''`,
          [user.id]
        );
        for (const row of sent) {
          if (row.sender_email) await upsertRecentContact(user.id, row.sender_email, row.sender_name || "");
        }
      } catch (e) { /* ignore per-user errors */ }
      try {
        const { rows: received } = await query(
          `SELECT recipient_email, recipient_name FROM emails WHERE employee_id = $1 AND recipient_email IS NOT NULL AND recipient_email != ''`,
          [user.id]
        );
        for (const row of received) {
          if (row.recipient_email) await upsertRecentContact(user.id, row.recipient_email, row.recipient_name || "");
        }
      } catch (e) { /* ignore per-user errors */ }
    }
  } catch (e) { /* ignore migration errors */ }
}

async function seedRecentContactsFromAllEmails() {
  try {
    const { rows: existing } = await query("SELECT COUNT(*) as cnt FROM recent_contacts");
    if (Number(existing[0]?.cnt || 0) > 0) return;
    const { rows: users } = await query("SELECT id FROM users");
    for (const user of users) {
      try {
        const { rows: emails } = await query(
          `SELECT sender_email, sender_name, recipient_email, recipient_name FROM emails WHERE employee_id = $1`,
          [user.id]
        );
        for (const row of emails) {
          if (row.sender_email) await upsertRecentContact(user.id, row.sender_email, row.sender_name || "");
          if (row.recipient_email) await upsertRecentContact(user.id, row.recipient_email, row.recipient_name || "");
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

async function upsertRecentContact(userId, email, name) {
  if (!userId || !email) return;
  const rawValue = String(email || "").trim();
  const bracketMatch = rawValue.match(/^(.*?)<([^>]+)>$/);
  const normalized = (bracketMatch?.[2] || rawValue).toLowerCase().trim();
  const derivedName = bracketMatch?.[1]?.trim().replace(/^"|"$/g, "") || "";
  const contactName = String(name || derivedName || "").trim();
  if (!normalized || !normalized.includes("@")) return;
  try {
    const { rows } = await query("SELECT id FROM recent_contacts WHERE user_id = $1 AND contact_email = $2", [userId, normalized]);
    if (rows.length) {
      await query("UPDATE recent_contacts SET last_used_at = NOW(), use_count = use_count + 1, contact_name = CASE WHEN $2 != '' THEN $2 ELSE contact_name END WHERE id = $1", [rows[0].id, contactName]);
    } else {
      await query("INSERT INTO recent_contacts (user_id, contact_email, contact_name, last_used_at, use_count) VALUES ($1, $2, $3, NOW(), 1)", [userId, normalized, contactName]);
    }
  } catch (e) { /* ignore */ }
}

async function getRecentContacts(userId, limit = 50) {
  if (!userId) return [];
  const { rows } = await query(
    `SELECT contact_email, contact_name, last_used_at, use_count
     FROM recent_contacts
     WHERE user_id = $1
     ORDER BY last_used_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function saveAiAnalysis(emailId, analysisData, userId) {
  const result = await query(
    `INSERT INTO ai_analysis (email_id, sender_email, receiver_email, project_id, email_category, summary, ai_tasks, priority, raw_response, analyzed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (email_id) DO UPDATE SET
       sender_email = EXCLUDED.sender_email, receiver_email = EXCLUDED.receiver_email,
       project_id = EXCLUDED.project_id, email_category = EXCLUDED.email_category,
       summary = EXCLUDED.summary, ai_tasks = EXCLUDED.ai_tasks, priority = EXCLUDED.priority,
       raw_response = EXCLUDED.raw_response, analyzed_at = NOW()
     RETURNING *`,
    [emailId, analysisData.sender_email, analysisData.receiver_email, analysisData.project_id,
     analysisData.email_category, analysisData.summary, JSON.stringify(analysisData.ai_tasks || []),
     analysisData.priority, JSON.stringify(analysisData), userId]
  );
  return result.rows[0];
}

async function saveAiBrainAnalysis(emailId, brainData, userId) {
  try {
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'general'`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS has_deadline BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS deadline_date DATE`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS needs_response BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS urgency_level TEXT DEFAULT 'low'`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS action_items JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS key_entities JSONB DEFAULT '{}'`);
    await query(`ALTER TABLE ai_analysis ADD COLUMN IF NOT EXISTS response_suggestion TEXT DEFAULT ''`);
  } catch (e) { /* columns may already exist */ }

  await query(`DELETE FROM ai_analysis WHERE email_id = $1`, [emailId]);

  const result = await query(
    `INSERT INTO ai_analysis (
      email_id, sender_email, receiver_email, project_id, email_category, summary, ai_tasks,
      priority, raw_response, analyzed_by, transaction_type, has_deadline, deadline_date,
      needs_response, urgency_level, action_items, key_entities, response_suggestion
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    [
      emailId, brainData.sender_email || "", brainData.receiver_email || "", null,
      brainData.transaction_type || "general", brainData.summary || "",
      JSON.stringify(brainData.ai_tasks || []),
      brainData.urgency_level === "critical" ? "High" : brainData.urgency_level === "high" ? "High" : "Medium",
      JSON.stringify(brainData), userId,
      brainData.transaction_type || "general", brainData.has_deadline || false,
      brainData.deadline_date || null, brainData.needs_response || false,
      brainData.urgency_level || "low", JSON.stringify(brainData.action_items || []),
      JSON.stringify(brainData.key_entities || {}), brainData.response_suggestion || ""
    ]
  );
  return result.rows[0];
}

async function saveAiBrainSummaryToEmail(emailId, summary, transactionType, urgencyLevel) {
  try {
    await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_summary TEXT`);
    await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS transaction_type TEXT`);
    await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS urgency_level TEXT`);
  } catch (e) { /* columns may already exist */ }

  await query(
    `UPDATE emails SET ai_summary = $1, transaction_type = $2, urgency_level = $3 WHERE id = $4`,
    [summary, transactionType, urgencyLevel, emailId]
  );
}

async function createTrackingTasksFromBrainAnalysis(emailId, actionItems, userId) {
  if (!Array.isArray(actionItems) || actionItems.length === 0) return [];

  const createdTasks = [];
  for (const item of actionItems) {
    if (!item.description) continue;
    try {
      const taskResult = await query(
        `INSERT INTO tasks (
          title, description, status, priority, due_date, assigned_to, created_by, email_id, source
        ) VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, 'ai_brain')
        RETURNING *`,
        [
          item.description.slice(0, 200),
          item.description,
          (item.priority || "medium").toLowerCase(),
          item.due_date || null,
          item.assignee_email_id || null,
          userId || null,
          emailId
        ]
      );
      const task = taskResult.rows[0];

      const trackingInsertResult = await query(
        `INSERT INTO tracking_tasks (
          existing_task_id, email_id, assigned_to, task_type, priority, due_date, status
        ) VALUES ($1, $2, $3, 'ai_extracted', $4, $5, 'PENDING')
        ON CONFLICT (existing_task_id) DO NOTHING
        RETURNING *`,
        [
          task.id, emailId, item.assignee_email_id || null,
          (item.priority || "medium").toLowerCase(), item.due_date || null
        ]
      );
      if (trackingInsertResult.rows[0]) {
        await createTrackingTaskHistoryEntry({
          trackingTaskId: trackingInsertResult.rows[0].task_id,
          existingTaskId: trackingInsertResult.rows[0].existing_task_id || null,
          actionType: "created",
          fieldName: "task",
          previousValue: null,
          nextValue: trackingInsertResult.rows[0].status || "PENDING",
          previousDisplay: null,
          nextDisplay: `Created from AI extraction as ${trackingInsertResult.rows[0].task_type || "ai_extracted"} (${trackingInsertResult.rows[0].status || "PENDING"})`,
          metadata: {
            source: "createTrackingTasksFromBrainAnalysis",
            email_id: emailId || null
          }
        });
      }
      createdTasks.push(task);
    } catch (e) {
      console.error("[AI-BRAIN] Failed to create tracking task:", e.message);
    }
  }
  return createdTasks;
}

async function getAiBrainAnalysisByEmailId(emailId) {
  try {
    const result = await query(
      `SELECT * FROM ai_analysis WHERE email_id = $1 AND (transaction_type IS NOT NULL OR urgency_level IS NOT NULL)`,
      [emailId]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

async function getAiAnalysisByEmailId(emailId) {
  const result = await query(`SELECT * FROM ai_analysis WHERE email_id = $1`, [emailId]);
  return result.rows[0] || null;
}

async function getAiAnalysisByUserId(userId, limit = 50) {
  const result = await query(
    `SELECT a.*, e.subject, e.sender_name FROM ai_analysis a
     LEFT JOIN emails e ON a.email_id = e.id
     WHERE a.analyzed_by = $1 ORDER BY a.analyzed_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

async function getActiveProjects() {
  try {
    const result = await query(
      `SELECT DISTINCT project_id FROM ai_analysis WHERE project_id IS NOT NULL AND project_id != '' ORDER BY project_id`
    );
    return result.rows.map(r => r.project_id);
  } catch (e) {
    return [];
  }
}

async function scheduleEmail(emailId, scheduledAt) {
  const outboxFolder = await query(`SELECT id FROM folders WHERE name = 'Outbox' LIMIT 1`);
  const folderId = outboxFolder.rows[0]?.id;
  if (!folderId) throw new Error("Outbox folder not found");
  await query(`UPDATE emails SET scheduled_at = $1, folder_id = $2 WHERE id = $3`, [scheduledAt, folderId, emailId]);
}

async function cancelScheduleEmail(emailId) {
  const draftsFolder = await query(`SELECT id FROM folders WHERE name = 'Drafts' LIMIT 1`);
  const folderId = draftsFolder.rows[0]?.id;
  if (!folderId) throw new Error("Drafts folder not found");
  await query(`UPDATE emails SET scheduled_at = NULL, folder_id = $2 WHERE id = $1`, [emailId, folderId]);
}

async function snoozeEmail(emailId, snoozedUntil) {
  await query(`UPDATE emails SET snoozed_until = $1 WHERE id = $2`, [snoozedUntil, emailId]);
}

async function unsnoozeEmail(emailId) {
  await query(`UPDATE emails SET snoozed_until = NULL WHERE id = $1`, [emailId]);
}

async function getScheduledEmails(userId) {
  const result = await query(
    `SELECT e.*, f.name as folder_name FROM emails e JOIN folders f ON e.folder_id = f.id
     WHERE e.scheduled_at IS NOT NULL AND e.scheduled_at > NOW() ORDER BY e.scheduled_at ASC`
  );
  return result.rows;
}

async function getSnoozedEmails(userId) {
  const result = await query(
    `SELECT e.*, f.name as folder_name FROM emails e JOIN folders f ON e.folder_id = f.id
     WHERE e.snoozed_until IS NOT NULL AND e.snoozed_until > NOW() ORDER BY e.snoozed_until ASC`
  );
  return result.rows;
}

async function getAiTaskEmails(userId) {
  const result = await query(
    `SELECT e.*, f.name as folder_name FROM emails e JOIN folders f ON e.folder_id = f.id
     JOIN ai_analysis a ON a.email_id = e.id
     WHERE a.ai_tasks IS NOT NULL AND a.ai_tasks != '[]' ORDER BY e.received_at DESC`
  );
  return result.rows;
}

async function seedDefaultEmailKeys() {
  const defaults = [
    { key_code: "TENDER", key_name: "Tender", color: "#e65100", sort_order: 1 },
    { key_code: "PROJECT", key_name: "Project", color: "#1565c0", sort_order: 2 },
    { key_code: "CONTRACT", key_name: "Contract", color: "#6a1b9a", sort_order: 3 },
    { key_code: "RENEWAL", key_name: "Renewal", color: "#00838f", sort_order: 4 },
    { key_code: "SUBMITTAL", key_name: "Submittal", color: "#2e7d32", sort_order: 5 },
    { key_code: "PAYMENT", key_name: "Payment", color: "#c62828", sort_order: 6 },
    { key_code: "URGENT", key_name: "Urgent", color: "#d84315", sort_order: 7 },
    { key_code: "PROCUREMENTS", key_name: "Procurements", color: "#4527a0", sort_order: 8 },
    { key_code: "ACCOUNTING", key_name: "Accounting", color: "#37474f", sort_order: 9 },
    { key_code: "APPROVE", key_name: "Approve", color: "#1b5e20", sort_order: 10 },
    { key_code: "MANAGER", key_name: "Manager", color: "#0d47a1", sort_order: 11 },
  ];
  for (const k of defaults) {
    await query(
      `INSERT INTO email_keys (key_code, key_name, description, color, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE) ON CONFLICT (key_code) DO UPDATE
       SET key_name = EXCLUDED.key_name, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, is_active = TRUE`,
      [k.key_code, k.key_name, "", k.color, k.sort_order]
    );
  }
}

async function searchThreadsForReport(query, limit = 50) {
  if (!query || !query.trim()) return [];
  const q = `%${query.trim()}%`;
  const { rows } = await query(
    `SELECT DISTINCT ON (e.serial)
       e.id, e.serial, e.subject, e.sender_name, e.sender_email, e.recipient_email,
       e.received_at, e.priority, e.read_state, f.name AS folder_name,
       e.project_id, e.email_key_id,
       p.project_code, p.project_name,
       ek.key_code, ek.key_name, ek.color AS key_color,
       (SELECT COUNT(*)::int FROM emails e2 WHERE e2.serial = e.serial) AS message_count,
       (SELECT ARRAY_AGG(DISTINCT e3.sender_email ORDER BY e3.sender_email)
        FROM emails e3 WHERE e3.serial = e.serial) AS participants,
       (SELECT MAX(e4.received_at) FROM emails e4 WHERE e4.serial = e.serial) AS last_message_at
     FROM emails e
     JOIN folders f ON f.id = e.folder_id
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN email_keys ek ON ek.id = e.email_key_id
     WHERE e.serial ILIKE $1
        OR e.subject ILIKE $1
        OR e.sender_email ILIKE $1
        OR e.sender_name ILIKE $1
        OR e.recipient_email ILIKE $1
        OR e.body_text ILIKE $1
     ORDER BY e.serial, e.received_at DESC
     LIMIT $2`,
    [q, limit]
  );
  return rows;
}

async function getThreadTreeForReport(serial) {
  const { rows: emails } = await query(
    `SELECT e.*, f.name AS folder_name, u.name AS employee_name,
            p.project_code, p.project_name,
            ek.key_code, ek.key_name, ek.color AS key_color
     FROM emails e
     JOIN folders f ON f.id = e.folder_id
     LEFT JOIN users u ON u.id = e.employee_id
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN email_keys ek ON ek.id = e.email_key_id
     WHERE e.serial = $1
     ORDER BY e.received_at ASC`,
    [serial]
  );
  if (!emails.length) return null;
  const { rows: threadRow } = await query(
    `SELECT * FROM email_threads WHERE serial = $1 LIMIT 1`,
    [serial]
  );
  const participants = [...new Set(emails.map(e => e.sender_email).filter(Boolean))];
  const participantNames = {};
  emails.forEach(e => { if (e.sender_email && e.sender_name) participantNames[e.sender_email] = e.sender_name; });
  const firstEmail = emails[0];
  const lastEmail = emails[emails.length - 1];
  const timeSpanHours = firstEmail.received_at && lastEmail.received_at
    ? (new Date(lastEmail.received_at) - new Date(firstEmail.received_at)) / 3600000
    : 0;
  return {
    serial,
    subject: firstEmail.subject,
    key_code: firstEmail.key_code,
    key_name: firstEmail.key_name,
    key_color: firstEmail.key_color,
    project_code: firstEmail.project_code,
    project_name: firstEmail.project_name,
    emails: emails.map(e => ({
      id: e.id,
      subject: e.subject,
      sender_name: e.sender_name,
      sender_email: e.sender_email,
      recipient_email: e.recipient_email,
      received_at: e.received_at,
      folder_name: e.folder_name,
      employee_name: e.employee_name,
      priority: e.priority,
      read_state: e.read_state,
      body_text: e.body_text ? e.body_text.substring(0, 500) : "",
      body_html: e.body_html ? e.body_html.substring(0, 500) : "",
      parent_id: e.parent_id,
      approval_root_id: e.approval_root_id,
      approval_status: e.approval_status,
      version_number: e.version_number,
      thread_depth: e.thread_depth,
      external_message_id: e.external_message_id
    })),
    participants,
    participantNames,
    thread: threadRow[0] || null,
    stats: {
      total_messages: emails.length,
      unique_participants: participants.length,
      first_message: firstEmail.received_at,
      last_message: lastEmail.received_at,
      time_span_hours: Math.round(timeSpanHours * 10) / 10,
      has_approval_flow: emails.some(e => e.approval_root_id),
      max_depth: Math.max(...emails.map(e => e.thread_depth || 0)),
      high_priority_count: emails.filter(e => e.priority === "High").length,
    }
  };
}

async function getThreadAnalytics(serial) {
  const { rows: emails } = await query(
    `SELECT e.*, f.name AS folder_name FROM emails e
     JOIN folders f ON f.id = e.folder_id
     WHERE e.serial = $1 ORDER BY e.received_at ASC`,
    [serial]
  );
  if (!emails.length) return null;
  const participants = {};
  emails.forEach(e => {
    if (!participants[e.sender_email]) {
      participants[e.sender_email] = { name: e.sender_name || e.sender_email, email: e.sender_email, sent: 0, received: 0 };
    }
    participants[e.sender_email].sent++;
    if (e.recipient_email && !participants[e.recipient_email]) {
      participants[e.recipient_email] = { name: "", email: e.recipient_email, sent: 0, received: 0 };
    }
    if (e.recipient_email) participants[e.recipient_email].received++;
  });
  const timeline = emails.map(e => ({
    id: e.id,
    date: e.received_at,
    sender: e.sender_email,
    subject: e.subject,
    folder: e.folder_name,
    priority: e.priority,
    action: e.approval_status || (e.parent_id ? "reply" : "original")
  }));
  return {
    serial,
    subject: emails[0].subject,
    total: emails.length,
    participants: Object.values(participants),
    timeline,
    folders: [...new Set(emails.map(e => e.folder_name))],
    priorities: { high: emails.filter(e => e.priority === "High").length, normal: emails.filter(e => e.priority === "Normal").length, low: emails.filter(e => e.priority === "Low").length }
  };
}

export {
  query,
  uploadsDir,
  getDataRootDir,
  getBackupsRootDir,
  initializeDatabase,
  getDatabaseMode,
  getUserByEmail,
  getUserById,
  getAllAdminUsers,
  sanitizeUser,
  listBootstrapData,
  getAppSettings,
  getMailSettingsForUser,
  ensureFolder,
  createEmail,
  createSerialFromSubjectKey,
  updateAppSettings,
  updateMailSettingsForUser,
  listConfiguredMailSettings,
  emailExistsByExternalMessageId,
  getEmailByExternalMessageId,
  getEmailAttachments,
  listLegacyAttachmentRepairCandidates,
  replaceEmailAttachments,
  updateEmailAttachmentRepairState,
  getEmailById,
  queueOutgoingEmail,
  listDueOutboxEmails,
  getQueuedOutboxEmail,
  markOutboxSent,
  markApprovalEmailQueued,
  markOutboxRetry,
  moveEmailToFolder,
  moveEmailsToFolder,
  setEmailsReadState,
  deleteEmailsPermanently,
  emptyDeletedFolder,
  importSyncedEmails,
  getAdminSummary,
  recallEmail,
  listEmployees,
  listEmployeesWithMailSettings,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmailTrail,
  getEmployeeAnalytics,
  createArchive,
  listArchives,
  logEmailTrail,
  getPendingApprovals,
  listApprovalReminderCandidates,
  recordApprovalReminder,
  approveEmail,
  rejectEmail,
  reviseRejectedApproval,
  getApprovalHistory,
  getApprovalAnalytics,
  getEmployeesWithManager,
  issueApprovalActionToken,
  getApprovalActionTokenByHash,
  consumeApprovalActionToken,
  revokeApprovalActionTokens,
  getApprovalActionLinksState,
  generateApprovalSerial,
  createPendingApprovalEmail,
  getThreadEmails,
  analyzeIncomingEmail,
  createBackupSnapshot,
  createDailyArchiveExport,
  listBackups,
  restoreBackupByName,
  upsertRecentContact,
  getRecentContacts,
  saveAiAnalysis,
  saveAiBrainAnalysis,
  saveAiBrainSummaryToEmail,
  createTrackingTasksFromBrainAnalysis,
  getAiBrainAnalysisByEmailId,
  getAiAnalysisByEmailId,
  getAiAnalysisByUserId,
  getActiveProjects,
  scheduleEmail,
  cancelScheduleEmail,
  snoozeEmail,
  unsnoozeEmail,
  getScheduledEmails,
  getSnoozedEmails,
  getAiTaskEmails,
  searchEmailsBySerial,
  getThreadBySerial,
  getArchiveStats,
  listAdminArchiveExplorer,
  trackEmailThread,
  resolveSerialFromHeaders,
  getThreadByEmailId,
  getFullThreadBySerial,
  getThreadByMessageId,
  getThreadMessages,
  createEmailKey,
  getEmailKeys,
  updateEmailKey,
  deleteEmailKey,
  seedDefaultEmailKeys,
  searchThreadsForReport,
  getThreadTreeForReport,
  getThreadAnalytics,
  createProject,
  getProjects,
  getProjectById,
  getProjectByCode,
  updateProject,
  deleteProject,
  getEmailsByProject,
  getProjectEmailHistoryForDrafting,
  getContractMemoryForProject,
  getStructuredContractClausesForProject,
  parseSubjectForMetadata,
  generateHiddenFooter,
  extractHiddenRef,
  extractEmailMetadata,
  createTask,
  getTasks,
  getActiveTrackingTasks,
  getTrackingTaskSummary,
  getTrackingTaskById,
  getTrackingTaskHistory,
  updateTrackingTask,
  getTaskById,
  updateTask,
  deleteTask,
  getDueTasks,
  markTaskAlerted,
  getTaskStats,
  getUnclassifiedCount,
  getUnclassifiedEmails,
  classifyEmail,
  createEmailAccount,
  getEmailAccounts,
  getEmailAccountById,
  updateEmailAccount,
  deleteEmailAccount,
  setEmailAccountDefault,
  getUserActiveAccounts
};
