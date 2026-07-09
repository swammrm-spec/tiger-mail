import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  uploadsDir,
  initializeDatabase,
  getDatabaseMode,
  sanitizeUser,
  listBootstrapData,
  getAppSettings,
  getMailSettingsForUser,
  createEmail,
  moveEmailToFolder,
  moveEmailsToFolder,
  setEmailsReadState,
  deleteEmailsPermanently,
  emptyDeletedFolder,
  updateMailSettingsForUser,
  importSyncedEmails,
  getAdminSummary,
  recallEmail,
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmailTrail,
  getEmployeeAnalytics,
  createArchive,
  listArchives,
  logEmailTrail,
  getUserById,
  getEmailById,
  getPendingApprovals,
  listApprovalReminderCandidates,
  recordApprovalReminder,
  approveEmail,
  rejectEmail,
  reviseRejectedApproval,
  getApprovalHistory,
  getApprovalAnalytics,
  getEmployeesWithManager,
  getEmailAttachments,
  listConfiguredMailSettings,
  createPendingApprovalEmail,
  getThreadEmails,
  createBackupSnapshot,
  createDailyArchiveExport,
  listBackups,
  restoreBackupByName,
  getDataRootDir,
  revokeApprovalActionTokens,
  getApprovalActionLinksState,
  upsertRecentContact,
  getRecentContacts,
  listEmployeesWithMailSettings,
  createSerialFromSubjectKey,
  saveAiAnalysis,
  saveAiBrainAnalysis,
  saveAiBrainSummaryToEmail,
  getAiAnalysisByEmailId,
  getAiBrainAnalysisByEmailId,
  createTrackingTasksFromBrainAnalysis,
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
  createEmailAccount,
  getEmailAccounts,
  getEmailAccountById,
  updateEmailAccount,
  deleteEmailAccount,
  setEmailAccountDefault,
  getUserActiveAccounts,
  createEmailKey,
  getEmailKeys,
  updateEmailKey,
  deleteEmailKey,
  createProject,
  getProjects,
  getProjectById,
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
  seedDefaultEmailKeys,
  searchThreadsForReport,
  getThreadTreeForReport,
  getThreadAnalytics
} from "./database.js";
import {
  canAccessAdmin,
  loginWithPassword,
  authenticateRequest,
  requireArchivePermission,
  requireAdminAccess,
  requireSyncKey
} from "./auth.js";
import { applyMailSettings, applyAllMailSettings, testMailSettings, getMailServiceStatus, runCycle, runFullMailSyncAllAccounts, sendMailMessage, deliverApprovalEmail, retryQueuedEmailNow, repairLegacyEmailAttachments, runAiBackfillReanalysis, startAiBackfillReanalysisJob, getAiBackfillJobStatus, listAiBackfillJobs, cancelAiBackfillJob, retryFailedAiBackfillItems, saveParsedAttachments, getSmtpTransporter } from "./mailService.js";
import {
  buildApprovalActionLinks,
  verifyApprovalActionToken,
  markApprovalActionTokenConsumed,
  sendTelegramApprovalNotification,
  sendTelegramApprovalReminder,
  parseTelegramApprovalUpdate,
  answerTelegramCallback
} from "./telegramApprovalBot.js";
import { analyzeInboundTaskExtractionWithLlm, analyzeEmailBrain, generateReplyDraftWithHistory, generateResponsePolicyGuard, analyzeAttachment, analyzeEmailWithAttachments } from "./aiAnalysisService.js";
import {
  ensureNotificationsTable,
  createTrackingTaskNotification,
  getAdminNotificationAnalytics,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  markEmailNeedsReply,
  markEmailReplied,
  runProactiveAlertCycle,
  startProactiveAlertEngine,
  stopProactiveAlertEngine,
  normalizeNotificationMetadata,
  getNotificationHistory
} from "./proactiveAlertService.js";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

// #region debug-point startup-localhost-refused
const debugDir = path.resolve(".dbg");
const startupDebugFile = path.join(debugDir, "localhost-refused.ndjson");

function reportStartupDebug(step, data = {}) {
  try {
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    fs.appendFileSync(
      startupDebugFile,
      `${JSON.stringify({
        sessionId: "localhost-refused",
        location: "server/index.js",
        step,
        data,
        ts: Date.now()
      })}\n`
    );
  } catch {}
}

process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error?.message);
  console.error(error?.stack);
  reportStartupDebug("uncaughtException", {
    name: error?.name,
    message: error?.message,
    stack: error?.stack
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Rejection:", reason instanceof Error ? reason.message : String(reason));
  if (reason instanceof Error) console.error(reason?.stack);
  reportStartupDebug("unhandledRejection", {
    reason: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : String(reason)
  });
});
// #endregion

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });
const approvalReminderHours = new Set(
  String(process.env.APPROVAL_REMINDER_HOURS || "9,13,17")
    .split(",")
    .map((value) => Number(String(value).trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23)
);
const approvalReminderWindowMinutes = Math.max(1, Number(process.env.APPROVAL_REMINDER_WINDOW_MINUTES || 5));
let approvalReminderHandle = null;
let approvalReminderInFlight = null;

function getBaseUrl(req) {
  const configured = process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "";
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const host = req.get("host");
  return `${req.protocol}://${host}`;
}

function getReminderSlot(now = new Date()) {
  if (!approvalReminderHours.has(now.getHours()) || now.getMinutes() >= approvalReminderWindowMinutes) {
    return null;
  }
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

function getPublicReminderBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "http://localhost:5173").replace(/\/+$/, "");
}

async function notifyTrackingTaskTransition({ beforeTask, afterTask, actorUser, actionType }) {
  const normalizedActionType = String(actionType || "").trim().toLowerCase();
  const actorName = actorUser?.name || actorUser?.email || "System";
  const titleBase = afterTask?.email_subject || `Tracking Task #${afterTask?.task_id || beforeTask?.task_id || ""}`;
  const trackingTaskId = Number(afterTask?.task_id || beforeTask?.task_id || 0) || null;
  const existingTaskId = Number(afterTask?.existing_task_id || beforeTask?.existing_task_id || 0) || null;
  const emailId = Number(afterTask?.email_id || beforeTask?.email_id || 0) || null;
  const projectId = Number(afterTask?.project_id || beforeTask?.project_id || 0) || null;

  if (normalizedActionType === "reassigned") {
    const previousAssigneeId = Number(beforeTask?.assigned_to || 0) || null;
    const nextAssigneeId = Number(afterTask?.assigned_to || 0) || null;
    if (previousAssigneeId === nextAssigneeId) {
      return;
    }
    const operations = [];

    if (nextAssigneeId) {
      operations.push(createTrackingTaskNotification(nextAssigneeId, {
        type: "info",
        category: "tracking_task_reassigned",
        title: `تم تعيين مهمة متابعة: ${titleBase}`,
        message: `قام ${actorName} بتعيين المهمة لك${afterTask?.project_code ? ` ضمن المشروع ${afterTask.project_code}` : ""}.`,
        trackingTaskId,
        existingTaskId,
        emailId,
        projectId,
        priority: String(afterTask?.priority || "").toLowerCase() === "critical" ? "high" : "medium",
        actorUserId: actorUser?.id || null,
        actorName,
        actionType: "reassigned",
        metadata: {
          previous_assignee_id: previousAssigneeId,
          previous_assignee_name: beforeTask?.assigned_to_name || "",
          next_assignee_id: nextAssigneeId,
          next_assignee_name: afterTask?.assigned_to_name || ""
        }
      }));
    }

    if (previousAssigneeId && previousAssigneeId !== nextAssigneeId) {
      operations.push(createTrackingTaskNotification(previousAssigneeId, {
        type: "warning",
        category: "tracking_task_reassigned",
        title: `تم تحديث تعيين المهمة: ${titleBase}`,
        message: nextAssigneeId
          ? `قام ${actorName} بإعادة تعيين هذه المهمة إلى ${afterTask?.assigned_to_name || "مستخدم آخر"}.`
          : `قام ${actorName} بإلغاء تعيين هذه المهمة من حسابك.`,
        trackingTaskId,
        existingTaskId,
        emailId,
        projectId,
        priority: "medium",
        actorUserId: actorUser?.id || null,
        actorName,
        actionType: "reassigned",
        metadata: {
          previous_assignee_id: previousAssigneeId,
          previous_assignee_name: beforeTask?.assigned_to_name || "",
          next_assignee_id: nextAssigneeId,
          next_assignee_name: afterTask?.assigned_to_name || ""
        }
      }));
    }

    await Promise.all(operations);
    return;
  }

  if (normalizedActionType === "completed") {
    if (String(beforeTask?.status || "").trim().toUpperCase() === String(afterTask?.status || "").trim().toUpperCase()) {
      return;
    }
    const recipientUserId = Number(afterTask?.assigned_to || beforeTask?.assigned_to || actorUser?.id || 0) || null;
    if (!recipientUserId) {
      return;
    }
    await createTrackingTaskNotification(recipientUserId, {
      type: "success",
      category: "tracking_task_completed",
      title: `تم إكمال المهمة: ${titleBase}`,
      message: `تم تعليم المهمة كمكتملة بواسطة ${actorName}${afterTask?.project_code ? ` ضمن المشروع ${afterTask.project_code}` : ""}.`,
      trackingTaskId,
      existingTaskId,
      emailId,
      projectId,
      priority: "medium",
      actorUserId: actorUser?.id || null,
      actorName,
      actionType: "completed",
      metadata: {
        completed_by_user_id: actorUser?.id || null,
        completed_by_name: actorName
      }
    });
  }
}

function normalizeHistoryDateFilter(value, boundary = "start") {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return boundary === "end" ? `${raw}T23:59:59.999Z` : `${raw}T00:00:00.000Z`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${boundary === "end" ? "to_date" : "from_date"} filter.`);
  }
  return parsed.toISOString();
}

async function runApprovalReminderCycle(now = new Date()) {
  const reminderSlot = getReminderSlot(now);
  if (!reminderSlot) {
    return { active: false, processed: 0, sent: 0, skipped: 0 };
  }
  if (approvalReminderInFlight) {
    return approvalReminderInFlight;
  }

  approvalReminderInFlight = (async () => {
    const candidates = await listApprovalReminderCandidates(reminderSlot);
    let sent = 0;
    let skipped = 0;

    for (const email of candidates) {
      try {
        const manager = await getUserById(email.manager_id || email.assigned_manager_id);
        if (!manager) {
          skipped += 1;
          continue;
        }

        const actionLinks = await buildApprovalActionLinks({
          emailId: email.id,
          managerId: manager.id,
          subject: email.subject,
          serial: email.serial,
          preview: email.preview,
          baseUrl: getPublicReminderBaseUrl(),
          approvalRootId: email.approval_root_id || email.id,
          issuedByUserId: email.submitted_by || email.employee_id || null,
          deliveryChannel: "reminder",
          manager
        });

        const telegram = await sendTelegramApprovalReminder({
          email,
          employee: {
            name: email.employee_name,
            email: email.employee_email
          },
          manager,
          actionLinks,
          reminderCount: Number(email.reminder_count || 0) + 1
        });

        if (!telegram.sent) {
          skipped += 1;
          continue;
        }

        await recordApprovalReminder(email.id, reminderSlot, {
          channel: "telegram",
          chat_id: telegram.chat_id || "",
          message_id: telegram.message_id || null
        });
        sent += 1;
      } catch (error) {
        skipped += 1;
        console.error("Approval reminder failed:", error?.message || error);
      }
    }

    return {
      active: true,
      reminder_slot: reminderSlot,
      processed: candidates.length,
      sent,
      skipped
    };
  })().finally(() => {
    approvalReminderInFlight = null;
  });

  return approvalReminderInFlight;
}

function startApprovalReminderScheduler() {
  if (approvalReminderHandle) {
    clearInterval(approvalReminderHandle);
  }

  approvalReminderHandle = setInterval(() => {
    runApprovalReminderCycle().catch((error) => {
      console.error("Approval reminder cycle failed:", error?.message || error);
    });
  }, 60 * 1000);

  runApprovalReminderCycle().catch((error) => {
    console.error("Approval reminder bootstrap failed:", error?.message || error);
  });
}

let taskAlertHandle = null;
async function runTaskAlertCycle() {
  try {
    const dueTasks = await getDueTasks(48);
    const tasksByEmail = {};
    for (const task of dueTasks) {
      try {
        const hoursLeft = task.due_date ? Math.round((new Date(task.due_date) - new Date()) / (1000 * 60 * 60)) : null;
        const urgency = hoursLeft !== null && hoursLeft <= 0 ? "OVERDUE" : hoursLeft !== null && hoursLeft <= 24 ? "URGENT" : "UPCOMING";
        console.log(`[TaskAlert] ${urgency}: "${task.title}" (${task.project_code || "No project"}) - Due: ${task.due_date} - Assigned: ${task.assigned_to_name || "Unassigned"}`);

        if (task.assigned_to_email) {
          if (!tasksByEmail[task.assigned_to_email]) tasksByEmail[task.assigned_to_email] = { name: task.assigned_to_name, tasks: [] };
          tasksByEmail[task.assigned_to_email].tasks.push({ ...task, urgency, hoursLeft });
        }
        await markTaskAlerted(task.id);
      } catch (alertError) {
        console.error(`Failed to alert task ${task.id}:`, alertError?.message);
      }
    }

    for (const [email, data] of Object.entries(tasksByEmail)) {
      try {
        await sendTaskAlertEmail(email, data.name, data.tasks);
      } catch (e) { console.error(`Failed to send task alert to ${email}:`, e?.message); }
    }

    if (dueTasks.length > 0) {
      console.log(`[TaskAlert] Processed ${dueTasks.length} task alert(s), sent ${Object.keys(tasksByEmail).length} email(s)`);
    }
  } catch (error) {
    console.error("Task alert cycle failed:", error?.message || error);
  }
}

async function sendTaskAlertEmail(toEmail, toName, tasks) {
  const config = await getAppSettings();
  const transporter = getSmtpTransporter(config);
  if (!transporter) return;

  const overdue = tasks.filter(t => t.urgency === "OVERDUE");
  const urgent = tasks.filter(t => t.urgency === "URGENT");
  const upcoming = tasks.filter(t => t.urgency === "UPCOMING");

  let htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`;
  htmlBody += `<div style="background: #1a237e; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">`;
  htmlBody += `<h2 style="margin: 0; font-size: 18px;">Task Alert - ${config.company_name || "EmailArray"}</h2>`;
  htmlBody += `<p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>`;
  htmlBody += `</div>`;
  htmlBody += `<div style="background: #f5f5f5; padding: 20px; border: 1px solid #e0e0e0;">`;
  htmlBody += `<p style="margin: 0 0 12px;">Hello <strong>${toName || "Team Member"}</strong>,</p>`;
  htmlBody += `<p style="margin: 0 0 16px;">You have <strong>${tasks.length}</strong> task(s) requiring attention:</p>`;

  if (overdue.length) {
    htmlBody += `<div style="background: #ffebee; border-left: 4px solid #d32f2f; padding: 12px; margin-bottom: 12px;">`;
    htmlBody += `<strong style="color: #d32f2f;">OVERDUE (${overdue.length})</strong>`;
    overdue.forEach(t => {
      htmlBody += `<div style="margin-top: 8px; padding: 8px; background: white; border-radius: 4px;">`;
      htmlBody += `<div style="font-weight: 600;">${t.title}</div>`;
      htmlBody += `<div style="font-size: 12px; color: #666;">${t.project_code ? `[${t.project_code}]` : "No project"} | Due: ${new Date(t.due_date).toLocaleDateString()}</div>`;
      htmlBody += `</div>`;
    });
    htmlBody += `</div>`;
  }

  if (urgent.length) {
    htmlBody += `<div style="background: #fff3e0; border-left: 4px solid #f57c00; padding: 12px; margin-bottom: 12px;">`;
    htmlBody += `<strong style="color: #f57c00;">URGENT - Due within 24 hours (${urgent.length})</strong>`;
    urgent.forEach(t => {
      htmlBody += `<div style="margin-top: 8px; padding: 8px; background: white; border-radius: 4px;">`;
      htmlBody += `<div style="font-weight: 600;">${t.title}</div>`;
      htmlBody += `<div style="font-size: 12px; color: #666;">${t.project_code ? `[${t.project_code}]` : "No project"} | Due: ${new Date(t.due_date).toLocaleDateString()} (${t.hoursLeft}h left)</div>`;
      htmlBody += `</div>`;
    });
    htmlBody += `</div>`;
  }

  if (upcoming.length) {
    htmlBody += `<div style="background: #e8f5e9; border-left: 4px solid #388e3c; padding: 12px; margin-bottom: 12px;">`;
    htmlBody += `<strong style="color: #388e3c;">UPCOMING - Due within 48 hours (${upcoming.length})</strong>`;
    upcoming.forEach(t => {
      htmlBody += `<div style="margin-top: 8px; padding: 8px; background: white; border-radius: 4px;">`;
      htmlBody += `<div style="font-weight: 600;">${t.title}</div>`;
      htmlBody += `<div style="font-size: 12px; color: #666;">${t.project_code ? `[${t.project_code}]` : "No project"} | Due: ${new Date(t.due_date).toLocaleDateString()} (${t.hoursLeft}h left)</div>`;
      htmlBody += `</div>`;
    });
    htmlBody += `</div>`;
  }

  htmlBody += `</div>`;
  htmlBody += `<div style="background: #fafafa; padding: 12px 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; font-size: 11px; color: #999;">`;
  htmlBody += `Automated task alert from ${config.company_name || "EmailArray"} Project Management System`;
  htmlBody += `</div></div>`;

  const subject = `[Task Alert] ${overdue.length ? overdue.length + " OVERDUE" : ""} ${urgent.length ? urgent.length + " URGENT" : ""} ${tasks.length} task(s) need attention`;

  await transporter.sendMail({
    from: `"${config.company_name || "Task Alert"}" <${config.email_address || "noreply@techno-grp.com"}>`,
    to: toEmail,
    subject: subject.replace(/\s+/g, " ").trim(),
    html: htmlBody,
    text: `Task Alert: ${tasks.length} task(s) need attention.\n\n` +
      (overdue.length ? `OVERDUE:\n` + overdue.map(t => `- ${t.title} (${t.project_code || "No project"}) Due: ${new Date(t.due_date).toLocaleDateString()}`).join("\n") + "\n\n" : "") +
      (urgent.length ? `URGENT:\n` + urgent.map(t => `- ${t.title} (${t.project_code || "No project"}) Due: ${new Date(t.due_date).toLocaleDateString()} (${t.hoursLeft}h left)`).join("\n") + "\n\n" : "") +
      (upcoming.length ? `UPCOMING:\n` + upcoming.map(t => `- ${t.title} (${t.project_code || "No project"}) Due: ${new Date(t.due_date).toLocaleDateString()} (${t.hoursLeft}h left)`).join("\n") : "")
  });
}

function startTaskAlertEngine() {
  if (taskAlertHandle) clearInterval(taskAlertHandle);

  const now = new Date();
  const next8AM = new Date(now);
  next8AM.setHours(8, 0, 0, 0);
  if (now >= next8AM) next8AM.setDate(next8AM.getDate() + 1);
  const msUntil8AM = next8AM.getTime() - now.getTime();

  console.log(`[TaskAlert] Next daily scan at ${next8AM.toISOString()} (${Math.round(msUntil8AM / 60000)} min)`);

  setTimeout(() => {
    runTaskAlertCycle().catch(() => {});
    taskAlertHandle = setInterval(runTaskAlertCycle, 24 * 60 * 60 * 1000);
  }, msUntil8AM);
}

async function executeApprovalAction({
  emailId,
  action,
  actorUserId,
  managerComments = "",
  ipAddress = "",
  source = "app",
  approvalToken = ""
}) {
  if (action === "approve") {
    const emailRecord = await approveEmail(emailId, actorUserId, managerComments || "", ipAddress);
    if (approvalToken) {
      await markApprovalActionTokenConsumed(approvalToken);
    }
    await revokeApprovalActionTokens({
      emailId: emailRecord.id,
      reason: `Approval action completed via ${source}.`
    });
    const attachments = await getEmailAttachments(emailRecord.id);
    const files = attachments.map((attachment) => ({
      originalname: attachment.file_name,
      file_name: attachment.file_name,
      file_path: attachment.file_path,
      mimetype: attachment.mime_type,
      mime_type: attachment.mime_type,
      size: attachment.file_size
    }));
    const result = await deliverApprovalEmail(emailRecord, files, emailRecord.employee_id);
    await logEmailTrail(
      emailRecord.id,
      actorUserId,
      result.queued ? "approve_queue" : "approve_send",
      result.queued
        ? `Approved via ${source} and queued for retry to ${emailRecord.recipient_email || emailRecord.recipient_name}`
        : `Approved via ${source} and sent to ${emailRecord.recipient_email || emailRecord.recipient_name}`,
      ipAddress
    );
    return {
      email: result.email || emailRecord,
      result,
      message: result.queued
        ? "Email approved. SMTP delivery is queued in Outbox."
        : "Email approved and sent."
    };
  }

  if (action === "reject") {
    const rejectionReason = managerComments || "Rejected via secure approval action.";
    const email = await rejectEmail(emailId, actorUserId, rejectionReason, ipAddress);
    if (approvalToken) {
      await markApprovalActionTokenConsumed(approvalToken);
    }
    await revokeApprovalActionTokens({
      emailId,
      reason: `Approval action completed via ${source}.`
    });
    await logEmailTrail(emailId, actorUserId, "reject_secure_action", `Rejected via ${source}`, ipAddress);
    return {
      email,
      message: "Email rejected. Manager comments are saved and the employee can revise and resubmit."
    };
  }

  throw new Error("Unsupported approval action.");
}

function getUserApprovalPolicy(user, managedUsers = []) {
  const userIsPrivileged = Boolean(
    user?.role === "Admin" ||
    user?.can_manage_users ||
    user?.can_manage_reports
  );
  const userIsManager = Boolean(
    user?.id &&
    managedUsers.some((employee) => Number(employee.manager_id) === Number(user.id))
  );

  return {
    userIsPrivileged,
    userIsManager,
    requiresManagerApproval: Boolean(user && !userIsPrivileged && !userIsManager)
  };
}

const safeRewriteSensitiveConflictTypes = new Set(["payment_mismatch", "unsupported_warranty"]);

async function resolveSafeRewriteApprovalLock({ guard, sourceEmail, requestingUser } = {}) {
  const conflicts = Array.isArray(guard?.conflicts) ? guard.conflicts : [];
  const sensitiveConflicts = conflicts.filter((item) => safeRewriteSensitiveConflictTypes.has(String(item?.conflict_type || "").toLowerCase()));
  if (!sensitiveConflicts.length) {
    return {
      required: false,
      sensitive_conflict_types: [],
      can_submit_for_approval: false,
      approver_id: null
    };
  }

  let approverId = Number(requestingUser?.manager_id || 0) || null;
  let approverSource = approverId ? "direct_manager" : "";

  if (!approverId && Number(sourceEmail?.assigned_manager_id || 0)) {
    approverId = Number(sourceEmail.assigned_manager_id);
    approverSource = "assigned_manager";
  }

  if (!approverId && Number(sourceEmail?.employee_id || 0) && Number(sourceEmail.employee_id || 0) !== Number(requestingUser?.id || 0)) {
    const owner = await getUserById(Number(sourceEmail.employee_id)).catch(() => null);
    if (Number(owner?.manager_id || 0)) {
      approverId = Number(owner.manager_id);
      approverSource = "source_owner_manager";
    }
  }

  const approver = approverId ? await getUserById(approverId).catch(() => null) : null;
  const sensitiveTypes = [...new Set(sensitiveConflicts.map((item) => String(item?.conflict_type || "").toLowerCase()).filter(Boolean))];

  return {
    required: true,
    approver_id: approver?.id || approverId || null,
    approver_name: approver?.name || "",
    approver_email: approver?.email || "",
    approver_source: approverSource || "unresolved",
    sensitive_conflict_types: sensitiveTypes,
    can_submit_for_approval: Boolean(approver?.id || approverId),
    locked_actions: ["apply_safe_rewrite", "send_reply"],
    reason: `Sensitive contractual changes detected (${sensitiveTypes.join(", ")}). Manager approval is required before applying or sending the safe rewrite.`,
    summary: approver?.id
      ? `يتطلب هذا التعديل اعتماد ${approver.name || approver.email || "المسؤول المحدد"} قبل التطبيق أو الإرسال.`
      : "يتطلب هذا التعديل اعتماد مدير أو مسؤول محدد، لكن لم يتم العثور على approver صالح بعد."
  };
}

async function submitPendingApprovalFromCompose(req, user, employeeId, options = {}) {
  const managerId = Number(options.managerId || user?.manager_id || 0) || null;
  const { email, serial, analysis, managerNotification } = await createPendingApprovalEmail({
    employeeId,
    managerId,
    recipientName: req.body.recipient_name,
    recipientEmail: req.body.recipient_email,
    ccList: req.body.cc_list,
    bccList: req.body.bcc_list,
    subject: req.body.subject,
    body: req.body.body,
    priority: req.body.priority,
    sensitivity: req.body.sensitivity,
    readReceipt: req.body.read_receipt,
    deliveryReceipt: req.body.delivery_receipt,
    subjectKey: req.body.subject_key || ""
  }, req.files || [], req.ip || "");
  const manager = await getUserById(managerId);
  const action_links = await buildApprovalActionLinks({
    emailId: email.id,
    managerId,
    subject: email.subject,
    serial,
    preview: email.preview,
    baseUrl: getBaseUrl(req),
    approvalRootId: email.approval_root_id || email.id,
    issuedByUserId: req.user?.id || user.id,
    deliveryChannel: "manager-review",
    manager
  });
  const telegram = await sendTelegramApprovalNotification({
    email,
    employee: user,
    manager,
    actionLinks: action_links
  });

  return {
    email,
    serial,
    analysis,
    manager_notification: {
      ...managerNotification,
      action_links,
      telegram
    },
    pending_approval: true,
    message: `Email ${serial} stored as Pending Approval and submitted to your manager for review.`
  };
}

async function handleComposeSendRoute(req, res) {
  try {
    const employeeId = req.body.user_id || req.user?.id || null;
    const user = employeeId ? await getUserById(employeeId) : null;
    const managedUsers = user?.id ? await getEmployeesWithManager() : [];
    const { requiresManagerApproval } = getUserApprovalPolicy(user, managedUsers);
    const forcedManagerApproval = String(req.body?.force_manager_approval || "").trim().toLowerCase() === "true";
    const forcedManagerId = Number(req.body?.forced_manager_id || 0) || null;
    const effectiveManagerId = forcedManagerId || Number(user?.manager_id || 0) || null;

    if ((requiresManagerApproval || forcedManagerApproval) && !effectiveManagerId) {
      return res.status(400).json({
        error: "No approval manager is available for this sensitive reply. Please assign a manager or configure the required approver first."
      });
    }

    if (employeeId) {
      const allRecipients = [];
      if (req.body?.recipient_email) allRecipients.push(...String(req.body.recipient_email).split(/[,\n;]+/));
      if (req.body?.cc_list) allRecipients.push(...String(req.body.cc_list).split(/[,\n;]+/));
      if (req.body?.bcc_list) allRecipients.push(...String(req.body.bcc_list).split(/[,\n;]+/));
      const name = req.body.recipient_name || "";
      for (const r of allRecipients) {
        const email = r.trim();
        if (email) await upsertRecentContact(employeeId, email, name);
      }
    }

    if ((requiresManagerApproval || forcedManagerApproval) && effectiveManagerId) {
      const pendingResponse = await submitPendingApprovalFromCompose(req, user, employeeId, {
        managerId: effectiveManagerId
      });
      return res.status(201).json(pendingResponse);
    }

    const sendPayload = { ...(req.body || {}), account_id: req.body?.account_id || null };
    const result = await sendMailMessage(sendPayload, req.files || [], employeeId);
    if (result?.archived?.id) {
      await logEmailTrail(result.archived.id, employeeId, "send", `Sent to ${req.body.recipient_email || req.body.recipient_name}`, req.ip || "");
    }
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to send email." });
  }
}

async function handleManagerDecisionRoute(req, res, action) {
  try {
    return res.json(await executeApprovalAction({
      emailId: Number(req.params.emailId || req.params.id),
      action,
      actorUserId: req.user.id,
      managerComments: action === "approve" ? req.body?.manager_comments || "" : req.body?.reason || "",
      ipAddress: req.ip || "",
      source: "manager-dashboard-route"
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const session = await loginWithPassword(email, password);
  if (!session) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  return res.json(session);
});

app.get("/api/auth/me", authenticateRequest, async (req, res) => {
  return res.json({ user: await sanitizeUser(req.user) });
});

app.get("/api/bootstrap", authenticateRequest, async (req, res) => {
  const payload = await listBootstrapData(req.user.id);
  try {
    payload.emailAccounts = await getEmailAccounts(req.user.id);
  } catch (e) { payload.emailAccounts = []; }
  try { payload.emailKeys = await getEmailKeys(); } catch (e) { console.error("[BOOTSTRAP] emailKeys error:", e.message); payload.emailKeys = []; }
  try { payload.projects = await getProjects(); } catch (e) { payload.projects = []; }
  try { payload.unclassifiedCount = await getUnclassifiedCount(); } catch (e) { payload.unclassifiedCount = 0; }
  try { payload.taskStats = await getTaskStats(req.user?.id); } catch (e) { payload.taskStats = {}; }
  try { payload.tasks = await getTasks({}); } catch (e) { payload.tasks = []; }
  return res.json(payload);
});

app.post("/api/emails", authenticateRequest, requireArchivePermission, upload.array("attachments", 10), async (req, res) => {
  try {
    const email = await createEmail(req.body, req.files || [], "manual");
    return res.status(201).json({ email });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/mail/compose", authenticateRequest, upload.array("attachments", 10), handleComposeSendRoute);
app.post("/api/mail/send", authenticateRequest, upload.array("attachments", 10), handleComposeSendRoute);

app.post("/api/emails/:id/retry", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const result = await retryQueuedEmailNow(Number(req.params.id), req.user.id);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to retry queued email." });
  }
});

app.put("/api/emails/:id/move", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const email = await moveEmailToFolder(Number(req.params.id), req.body?.folder_name);
    return res.json({ email });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to move email." });
  }
});

app.post("/api/emails/:id/recall", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const email = await recallEmail(Number(req.params.id));
    await logEmailTrail(Number(req.params.id), req.user?.id, "recall", "Email recalled", req.ip || "");
    return res.json({ email });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to recall email." });
  }
});

app.patch("/api/emails/read-state", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const result = await setEmailsReadState(req.body?.email_ids, req.body?.is_read);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to update read state." });
  }
});

app.put("/api/emails/bulk/move", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const result = await moveEmailsToFolder(req.body?.email_ids, req.body?.folder_name);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to move selected emails." });
  }
});

app.delete("/api/emails", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const result = await deleteEmailsPermanently(req.body?.email_ids);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to delete selected emails." });
  }
});

app.post("/api/emails/empty-trash", authenticateRequest, requireArchivePermission, async (_req, res) => {
  try {
    const result = await emptyDeletedFolder();
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to empty trash." });
  }
});

app.put("/api/emails/:id/schedule", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: "scheduled_at required" });
    await scheduleEmail(req.params.id, scheduled_at);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/emails/:id/cancel-schedule", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    await cancelScheduleEmail(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/emails/:id/snooze", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    const { snoozed_until } = req.body;
    if (!snoozed_until) return res.status(400).json({ error: "snoozed_until required" });
    await snoozeEmail(req.params.id, snoozed_until);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/emails/:id/unsnooze", authenticateRequest, requireArchivePermission, async (req, res) => {
  try {
    await unsnoozeEmail(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/smart/scheduled", authenticateRequest, async (req, res) => {
  try {
    const emails = await getScheduledEmails(req.user.id);
    return res.json({ emails });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/smart/snoozed", authenticateRequest, async (req, res) => {
  try {
    const emails = await getSnoozedEmails(req.user.id);
    return res.json({ emails });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/smart/ai-tasks", authenticateRequest, async (req, res) => {
  try {
    const emails = await getAiTaskEmails(req.user.id);
    return res.json({ emails });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/tasks", authenticateRequest, async (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.project_id) filters.project_id = req.query.project_id;
    if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
    if (!canAccessAdmin(req.user)) filters.assigned_to = req.user?.id;
    const tasks = await getTasks(filters);
    return res.json({ tasks });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/tracking-tasks/active", authenticateRequest, async (req, res) => {
  try {
    const filters = {
      status: req.query.status || "PENDING"
    };
    if (req.query.project_id) filters.project_id = req.query.project_id;
    if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
    if (req.query.due_before) filters.due_before = req.query.due_before;
    if (req.query.due_after) filters.due_after = req.query.due_after;
    if (req.query.limit) filters.limit = req.query.limit;
    if (!canAccessAdmin(req.user)) filters.assigned_to = req.user?.id;

    const tasks = await getActiveTrackingTasks(filters);
    return res.json({ tasks });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/tracking-tasks/summary", authenticateRequest, async (req, res) => {
  try {
    const filters = {
      status: req.query.status || "ALL"
    };
    if (req.query.project_id) filters.project_id = req.query.project_id;
    if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
    if (req.query.due_before) filters.due_before = req.query.due_before;
    if (req.query.due_after) filters.due_after = req.query.due_after;
    if (!canAccessAdmin(req.user)) filters.assigned_to = req.user?.id;

    const summary = await getTrackingTaskSummary(filters);
    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/tracking-tasks/:id/history", authenticateRequest, async (req, res) => {
  try {
    const trackingTaskId = Number(req.params.id || 0);
    if (!trackingTaskId) {
      return res.status(400).json({ error: "Valid tracking task id is required." });
    }

    const existingTask = await getTrackingTaskById(trackingTaskId);
    if (!existingTask) {
      return res.status(404).json({ error: "Tracking task not found." });
    }

    const isAdminUser = canAccessAdmin(req.user);
    const assignedToCurrentUser = Number(existingTask.assigned_to || 0) === Number(req.user?.id || 0);
    if (!isAdminUser && !assignedToCurrentUser) {
      return res.status(403).json({ error: "You can only view history for tracking tasks assigned to you." });
    }

    const historyFilters = {
      limit: req.query?.limit
    };

    const rawActorFilter = req.query?.actor_user_id ?? req.query?.actor ?? "";
    if (String(rawActorFilter).trim() !== "") {
      const normalizedActorFilter = String(rawActorFilter).trim().toLowerCase();
      historyFilters.hasActorFilter = true;
      if (normalizedActorFilter === "system") {
        historyFilters.actorUserId = null;
      } else {
        const actorUserId = Number(rawActorFilter || 0);
        if (!actorUserId) {
          return res.status(400).json({ error: "Valid actor filter is required." });
        }
        historyFilters.actorUserId = actorUserId;
      }
    }

    if (req.query?.action_type) {
      historyFilters.actionType = String(req.query.action_type).trim().toLowerCase();
    }
    if (req.query?.from_date) {
      historyFilters.fromDate = normalizeHistoryDateFilter(req.query.from_date, "start");
    }
    if (req.query?.to_date) {
      historyFilters.toDate = normalizeHistoryDateFilter(req.query.to_date, "end");
    }

    const history = await getTrackingTaskHistory(trackingTaskId, historyFilters);
    return res.json({ history });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load tracking task history." });
  }
});

app.put("/api/tracking-tasks/:id", authenticateRequest, async (req, res) => {
  try {
    const trackingTaskId = Number(req.params.id || 0);
    if (!trackingTaskId) {
      return res.status(400).json({ error: "Valid tracking task id is required." });
    }

    const existingTask = await getTrackingTaskById(trackingTaskId);
    if (!existingTask) {
      return res.status(404).json({ error: "Tracking task not found." });
    }

    const isAdminUser = canAccessAdmin(req.user);
    const assignedToCurrentUser = Number(existingTask.assigned_to || 0) === Number(req.user?.id || 0);
    if (!isAdminUser && !assignedToCurrentUser) {
      return res.status(403).json({ error: "You can only update tracking tasks assigned to you." });
    }

    const payload = {};
    if (req.body?.status !== undefined) {
      payload.status = req.body.status;
    }
    if (req.body?.priority !== undefined) {
      payload.priority = req.body.priority;
    }
    if (req.body?.due_date !== undefined) {
      payload.due_date = req.body.due_date;
    }
    if (req.body?.assigned_to !== undefined) {
      if (!isAdminUser) {
        return res.status(403).json({ error: "Only admin users can reassign tracking tasks." });
      }
      payload.assigned_to = req.body.assigned_to;
    }

    let actionType = "updated";
    const payloadKeys = Object.keys(payload);
    if (payloadKeys.length === 1 && payload.assigned_to !== undefined) {
      actionType = "reassigned";
    } else if (payloadKeys.length === 1 && String(payload.status || "").trim().toUpperCase() === "IN_PROGRESS") {
      actionType = "started";
    } else if (payloadKeys.length === 1 && String(payload.status || "").trim().toUpperCase() === "COMPLETED") {
      actionType = "completed";
    }

    const task = await updateTrackingTask(trackingTaskId, payload, {
      actorUserId: req.user?.id || null,
      actionType,
      metadata: {
        source: "api",
        route: "PUT /api/tracking-tasks/:id"
      }
    });
    await notifyTrackingTaskTransition({
      beforeTask: existingTask,
      afterTask: task,
      actorUser: req.user,
      actionType
    });
    return res.json({ task });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to update tracking task." });
  }
});

app.post("/api/tracking-tasks/:id/complete", authenticateRequest, async (req, res) => {
  try {
    const trackingTaskId = Number(req.params.id || 0);
    if (!trackingTaskId) {
      return res.status(400).json({ error: "Valid tracking task id is required." });
    }

    const existingTask = await getTrackingTaskById(trackingTaskId);
    if (!existingTask) {
      return res.status(404).json({ error: "Tracking task not found." });
    }

    const isAdminUser = canAccessAdmin(req.user);
    const assignedToCurrentUser = Number(existingTask.assigned_to || 0) === Number(req.user?.id || 0);
    if (!isAdminUser && !assignedToCurrentUser) {
      return res.status(403).json({ error: "You can only complete tracking tasks assigned to you." });
    }

    const task = await updateTrackingTask(trackingTaskId, { status: "COMPLETED" }, {
      actorUserId: req.user?.id || null,
      actionType: "completed",
      metadata: {
        source: "api",
        route: "POST /api/tracking-tasks/:id/complete"
      }
    });
    await notifyTrackingTaskTransition({
      beforeTask: existingTask,
      afterTask: task,
      actorUser: req.user,
      actionType: "completed"
    });
    return res.json({ task });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to complete tracking task." });
  }
});

app.get("/api/tasks/stats", authenticateRequest, async (req, res) => {
  try {
    const stats = await getTaskStats(req.user?.id);
    return res.json({ stats });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/tasks", authenticateRequest, async (req, res) => {
  try {
    const task = await createTask({ ...req.body, created_by: req.user?.id });
    return res.json({ task });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/tasks/:id", authenticateRequest, async (req, res) => {
  try {
    const task = await updateTask(req.params.id, req.body);
    return res.json({ task });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/tasks/:id", authenticateRequest, async (req, res) => {
  try {
    await deleteTask(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/tasks/:id/complete", authenticateRequest, async (req, res) => {
  try {
    const task = await updateTask(req.params.id, { status: "completed", completed_at: new Date().toISOString() });
    return res.json({ task });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/keys", authenticateRequest, async (req, res) => {
  try {
    const keys = await getEmailKeys();
    return res.json({ keys });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/keys", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const key = await createEmailKey(req.body);
    return res.json({ key });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/keys/:id", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const key = await updateEmailKey(req.params.id, req.body);
    return res.json({ key });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/keys/:id", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    await deleteEmailKey(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/projects", authenticateRequest, async (req, res) => {
  try {
    const projects = await getProjects();
    return res.json({ projects });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const project = await createProject(req.body);
    return res.json({ project });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/projects/:id", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const project = await updateProject(req.params.id, req.body);
    return res.json({ project });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/projects/:id", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    await deleteProject(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/projects/:id/emails", authenticateRequest, async (req, res) => {
  try {
    const emails = await getEmailsByProject(req.params.id);
    return res.json({ emails });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/unclassified", authenticateRequest, async (req, res) => {
  try {
    const emails = await getUnclassifiedEmails();
    return res.json({ emails });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/unclassified/count", authenticateRequest, async (req, res) => {
  try {
    const count = await getUnclassifiedCount();
    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/unclassified/:id/classify", authenticateRequest, async (req, res) => {
  try {
    const { project_id, email_key_id } = req.body;
    const email = await classifyEmail(req.params.id, project_id, email_key_id);
    if (email) {
      await logEmailTrail(email.id, req.user?.id || null, "Classified", JSON.stringify({ project_id, email_key_id }));
    }
    return res.json({ email });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/accounts", authenticateRequest, async (req, res) => {
  try {
    const accounts = await getEmailAccounts(req.user.id);
    return res.json({ accounts });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/accounts", authenticateRequest, async (req, res) => {
  try {
    const account = await createEmailAccount(req.user.id, req.body);
    return res.json({ account });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/accounts/:id", authenticateRequest, async (req, res) => {
  try {
    const account = await updateEmailAccount(req.params.id, req.body);
    return res.json({ account });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/accounts/:id", authenticateRequest, async (req, res) => {
  try {
    await deleteEmailAccount(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/accounts/:id/default", authenticateRequest, async (req, res) => {
  try {
    await setEmailAccountDefault(req.user.id, req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/archive/search", authenticateRequest, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Search query required" });
    const emails = await searchEmailsBySerial(q);
    return res.json({ emails });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/archive/thread/:serial", authenticateRequest, async (req, res) => {
  try {
    const thread = await getThreadBySerial(req.params.serial);
    return res.json({ thread });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/archive/stats", authenticateRequest, async (req, res) => {
  try {
    const stats = await getArchiveStats();
    return res.json(stats);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/thread-tracker/search", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const results = await searchThreadsForReport(req.query.q || "", parseInt(req.query.limit) || 50);
    return res.json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/thread-tracker/thread/:serial", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const thread = await getThreadTreeForReport(req.params.serial);
    if (!thread) return res.status(404).json({ error: "Thread not found" });
    return res.json({ thread });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/thread-tracker/analyze/:serial", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const analytics = await getThreadAnalytics(req.params.serial);
    if (!analytics) return res.status(404).json({ error: "Thread not found" });
    return res.json({ analytics });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/recent-contacts", authenticateRequest, async (req, res) => {
  try {
    const contacts = await getRecentContacts(req.user.id, 50);
    return res.json({ contacts });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/ai/analyze", authenticateRequest, async (req, res) => {
  try {
    const { email_id } = req.body;
    if (!email_id) return res.status(400).json({ error: "email_id required" });

    const existing = await getAiAnalysisByEmailId(email_id);
    if (existing) return res.json({ analysis: existing, cached: true });

    const email = await getEmailById(email_id);
    if (!email) return res.status(404).json({ error: "Email not found" });

    const activeProjects = await getActiveProjects();
    const body = (email.body || "").replace(/<[^>]+>/g, " ").trim().substring(0, 3000);
    const fullText = `${email.subject || ""} ${body}`.toLowerCase();
    let category = "GENERAL";
    if (/(customs|clearance|broker|الجمارك|تخليص|بيان جمركي)/i.test(fullText)) category = "CUSTOMS";
    else if (/(tender|bid|rfq|rfp|مناقصة|عطاء|عرض فني|عرض مالي)/i.test(fullText)) category = "TENDER";
    else if (/(payment|invoice|remittance|swift|iban|فاتورة|دفعة|تحويل بنكي|سداد)/i.test(fullText)) category = "PAYMENT";

    const priority = /(urgent|asap|immediately|critical|deadline|عاجل|فوري|نهائي)/i.test(fullText)
      ? "High"
      : /(optional|later|when possible|عند الإمكان)/i.test(fullText)
        ? "Low"
        : "Medium";

    const fallbackTask = category === "GENERAL"
      ? []
      : [{
          task_description:
            category === "CUSTOMS"
              ? `Review customs and clearance requirements for "${email.subject || "this email"}".`
              : category === "TENDER"
                ? `Review tender submission and response requirements for "${email.subject || "this email"}".`
                : `Review payment request and finance follow-up for "${email.subject || "this email"}".`,
          due_date: null,
          task_type: category.toLowerCase(),
          category,
          checklist:
            category === "CUSTOMS"
              ? ["Review customs documents", "Confirm broker/clearance status"]
              : category === "TENDER"
                ? ["Review submission requirements", "Confirm deadline and deliverables"]
                : ["Validate invoice/payment data", "Confirm finance status"],
          assigned_to_email: "",
          assigned_to_name: "",
          assigned_department: category === "PAYMENT" ? "finance" : category === "TENDER" ? "sales" : category === "CUSTOMS" ? "customs" : "",
          priority,
          confidence: "medium"
        }];

    let candidateAssignees = [];
    try {
      const employees = await listEmployees(req.user.id);
      candidateAssignees = (employees || [])
        .filter((employee) => employee.is_active !== false)
        .slice(0, 20)
        .map((employee) => ({
          name: employee.name || "",
          email: employee.email || "",
          role: employee.role || "",
          department: employee.department || ""
        }));
    } catch {
      candidateAssignees = [];
    }

    const analysis = await analyzeInboundTaskExtractionWithLlm(
      {
        subject: email.subject || "",
        body,
        senderEmail: email.sender_email || "",
        recipientEmail: email.recipient_email || "",
        ccList: email.cc_list || "",
        receivedAt: email.sent_at || email.received_at || "",
        activeProjects,
        candidateAssignees
      },
      {
        sender_email: email.sender_email || "",
        receiver_email: email.recipient_email || "",
        project_id: null,
        email_category: category,
        summary: `تحليل رسالة بخصوص "${(email.subject || "").substring(0, 80)}".`,
        priority,
        routing: {
          suggested_assigned_to_email: "",
          suggested_assigned_to_name: "",
          suggested_department: fallbackTask[0]?.assigned_department || "",
          reason: "Rule-based fallback"
        },
        ai_tasks: fallbackTask,
        provider: "rules"
      }
    );

    const saved = await saveAiAnalysis(email_id, analysis, req.user.id);
    return res.json({ analysis: saved, cached: false });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/ai/reply-draft", authenticateRequest, async (req, res) => {
  try {
    const emailId = Number(req.body?.email_id || 0);
    if (!emailId) {
      return res.status(400).json({ error: "email_id required" });
    }

    const sourceEmail = await getEmailById(emailId);
    if (!sourceEmail) {
      return res.status(404).json({ error: "Email not found" });
    }

    const isAdminOverride = Number(req.user?.id || 0) === 1;
    if (!isAdminOverride && Number(sourceEmail.employee_id || 0) !== Number(req.user?.id || 0)) {
      return res.status(403).json({ error: "You do not have access to this email drafting context." });
    }

    const requestedSubject = String(req.body?.subject || "").trim();
    const draftBody = String(req.body?.draft_body || "");
    const existingDraftBody = draftBody.split("----- Original Message -----")[0].trim();
    const projectId = Number(sourceEmail.project_id || req.body?.project_id || 0) || null;
    const project = projectId ? await getProjectById(projectId).catch(() => null) : null;
    const employeeScopeId = isAdminOverride ? Number(sourceEmail.employee_id || 0) || null : Number(req.user.id || 0);
    const historyEmails = projectId
      ? await getProjectEmailHistoryForDrafting({
        projectId,
        employeeId: employeeScopeId,
        excludeEmailId: sourceEmail.id,
        limit: 10
      })
      : [];
    const contractMemoryEntries = projectId
      ? await getContractMemoryForProject({
        projectId,
        employeeId: employeeScopeId,
        limit: 12
      })
      : [];
    const structuredContractClauses = projectId
      ? await getStructuredContractClausesForProject({
        projectId,
        employeeId: employeeScopeId,
        limit: 16
      })
      : [];

    const draft = await generateReplyDraftWithHistory({
      sourceEmail,
      historyEmails,
      contractMemoryEntries,
      structuredContractClauses,
      project,
      requestedSubject,
      existingDraftBody,
      replyMode: String(req.body?.mode || "reply").trim() || "reply"
    });

    await logEmailTrail(
      sourceEmail.id,
      req.user?.id || null,
      "Drafting Assistant",
      JSON.stringify({
        project_id: projectId,
        project_code: project?.project_code || "",
        history_count: historyEmails.length,
        contract_memory_count: contractMemoryEntries.length,
        contract_clause_count: structuredContractClauses.length,
        contract_clause_references: structuredContractClauses.map((item) => item.reference_key || item.clause_title || "").filter(Boolean).slice(0, 8),
        contract_memory_references: contractMemoryEntries.map((item) => item.reference_key || item.title || "").filter(Boolean).slice(0, 8),
        references: historyEmails.map((item) => item.serial_number || item.subject || "").filter(Boolean).slice(0, 8),
        provider: draft?.provider || "rules"
      })
    );

    return res.json({
      draft,
      context: {
        project_id: projectId,
        project_code: project?.project_code || "",
        project_name: project?.project_name || "",
        history_count: historyEmails.length,
        contract_memory_count: contractMemoryEntries.length,
        contract_clause_count: structuredContractClauses.length,
        contract_clause_references: structuredContractClauses.map((item) => item.reference_key || item.clause_title || "").filter(Boolean).slice(0, 8),
        contract_memory_references: contractMemoryEntries.map((item) => item.reference_key || item.title || "").filter(Boolean).slice(0, 8),
        references: historyEmails.map((item) => item.serial_number || item.subject || "").filter(Boolean).slice(0, 8)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/ai/reply-policy-guard", authenticateRequest, async (req, res) => {
  try {
    const emailId = Number(req.body?.email_id || 0);
    if (!emailId) {
      return res.status(400).json({ error: "email_id required" });
    }

    const sourceEmail = await getEmailById(emailId);
    if (!sourceEmail) {
      return res.status(404).json({ error: "Email not found" });
    }

    const isAdminOverride = Number(req.user?.id || 0) === 1;
    if (!isAdminOverride && Number(sourceEmail.employee_id || 0) !== Number(req.user?.id || 0)) {
      return res.status(403).json({ error: "You do not have access to this email drafting context." });
    }

    const draftSubject = String(req.body?.subject || "").trim();
    const draftBody = String(req.body?.draft_body || "").trim();
    if (!draftSubject && !draftBody) {
      return res.status(400).json({ error: "Draft subject or body is required." });
    }

    const projectId = Number(sourceEmail.project_id || req.body?.project_id || 0) || null;
    const project = projectId ? await getProjectById(projectId).catch(() => null) : null;
    const employeeScopeId = isAdminOverride ? Number(sourceEmail.employee_id || 0) || null : Number(req.user.id || 0);
    const historyEmails = projectId
      ? await getProjectEmailHistoryForDrafting({
        projectId,
        employeeId: employeeScopeId,
        excludeEmailId: sourceEmail.id,
        limit: 10
      })
      : [];
    const contractMemoryEntries = projectId
      ? await getContractMemoryForProject({
        projectId,
        employeeId: employeeScopeId,
        limit: 12
      })
      : [];
    const structuredContractClauses = projectId
      ? await getStructuredContractClausesForProject({
        projectId,
        employeeId: employeeScopeId,
        limit: 16
      })
      : [];

    const guard = await generateResponsePolicyGuard({
      sourceEmail,
      historyEmails,
      contractMemoryEntries,
      structuredContractClauses,
      project,
      draftSubject,
      draftBody
    });
    guard.approval_lock = await resolveSafeRewriteApprovalLock({
      guard,
      sourceEmail,
      requestingUser: req.user
    });

    await logEmailTrail(
      sourceEmail.id,
      req.user?.id || null,
      "Response Policy Guard",
      JSON.stringify({
        project_id: projectId,
        project_code: project?.project_code || "",
        history_count: historyEmails.length,
        contract_memory_count: contractMemoryEntries.length,
        contract_clause_count: structuredContractClauses.length,
        severity: guard?.severity || "low",
        verdict: guard?.verdict || "clear",
        issue_count: Array.isArray(guard?.issues) ? guard.issues.length : 0,
        conflict_count: Array.isArray(guard?.conflicts) ? guard.conflicts.length : 0,
        approval_lock_required: Boolean(guard?.approval_lock?.required),
        approval_lock_approver_id: guard?.approval_lock?.approver_id || null,
        provider: guard?.provider || "rules"
      })
    );

    return res.json({
      guard,
      context: {
        project_id: projectId,
        project_code: project?.project_code || "",
        project_name: project?.project_name || "",
        history_count: historyEmails.length,
        contract_memory_count: contractMemoryEntries.length,
        contract_clause_count: structuredContractClauses.length,
        contract_clause_references: structuredContractClauses.map((item) => item.reference_key || item.clause_title || "").filter(Boolean).slice(0, 8),
        contract_memory_references: contractMemoryEntries.map((item) => item.reference_key || item.title || "").filter(Boolean).slice(0, 8),
        references: historyEmails.map((item) => item.serial_number || item.subject || "").filter(Boolean).slice(0, 8)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/ai/projects", authenticateRequest, async (req, res) => {
  try {
    const projects = await getActiveProjects();
    return res.json({ projects });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/ai/brain-analyze", authenticateRequest, async (req, res) => {
  try {
    const { email_id } = req.body;
    if (!email_id) return res.status(400).json({ error: "email_id required" });

    const existing = await getAiBrainAnalysisByEmailId(email_id);
    if (existing) return res.json({ analysis: existing, cached: true });

    const email = await getEmailById(email_id);
    if (!email) return res.status(404).json({ error: "Email not found" });

    const body = (email.body || "").replace(/<[^>]+>/g, " ").trim().substring(0, 4000);
    const attachments = await getEmailAttachments(email_id);
    const attachmentNames = attachments.map(a => a.file_name || a.originalname || "file");

    let activeProjects = [];
    try { activeProjects = await getActiveProjects(); } catch {}

    const brainContext = {
      subject: email.subject || "",
      body,
      senderEmail: email.sender_email || "",
      senderName: email.sender_name || "",
      recipientEmail: email.recipient_email || "",
      recipientName: email.recipient_name || "",
      ccList: email.cc_list || "",
      receivedAt: email.received_at || email.sent_at || "",
      attachments: attachmentNames,
      emailKeys: [],
      activeProjects
    };

    const brainAnalysis = await analyzeEmailBrain(brainContext);
    const saved = await saveAiBrainAnalysis(email_id, brainAnalysis, req.user.id);
    await saveAiBrainSummaryToEmail(email_id, brainAnalysis.summary, brainAnalysis.transaction_type, brainAnalysis.urgency_level);

    let createdTasks = [];
    if (brainAnalysis.action_items && brainAnalysis.action_items.length > 0) {
      createdTasks = await createTrackingTasksFromBrainAnalysis(email_id, brainAnalysis.action_items, req.user.id);
    }

    return res.json({
      analysis: saved,
      brain: brainAnalysis,
      tasks_created: createdTasks.length,
      cached: false
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/ai/brain/:emailId", authenticateRequest, async (req, res) => {
  try {
    const emailId = Number(req.params.emailId);
    if (!emailId) return res.status(400).json({ error: "Invalid email ID" });

    const analysis = await getAiBrainAnalysisByEmailId(emailId);
    if (!analysis) return res.status(404).json({ error: "No brain analysis found" });

    return res.json({ analysis });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/ai/analyze-attachment", authenticateRequest, async (req, res) => {
  try {
    const { email_id, attachment_id } = req.body;
    if (!email_id) return res.status(400).json({ error: "email_id required" });

    const email = await getEmailById(email_id);
    if (!email) return res.status(404).json({ error: "Email not found" });

    const attachments = await getEmailAttachments(email_id);
    const targetAttachments = attachment_id
      ? attachments.filter(a => a.id === attachment_id)
      : attachments;

    if (targetAttachments.length === 0) return res.status(404).json({ error: "No attachments found" });

    const body = (email.body || "").replace(/<[^>]+>/g, " ").trim().substring(0, 2000);
    const results = await analyzeEmailWithAttachments(email_id, targetAttachments, email.subject, body);

    return res.json({ results, count: results.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/ai/attachment-analysis/:emailId", authenticateRequest, async (req, res) => {
  try {
    const emailId = Number(req.params.emailId);
    if (!emailId) return res.status(400).json({ error: "Invalid email ID" });

    const attachments = await getEmailAttachments(emailId);
    if (attachments.length === 0) return res.json({ results: [] });

    const email = await getEmailById(emailId);
    const body = (email?.body || "").replace(/<[^>]+>/g, " ").trim().substring(0, 2000);
    const results = await analyzeEmailWithAttachments(emailId, attachments, email?.subject, body);

    return res.json({ results, count: results.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// #region admin-employee-management
app.get("/api/admin/employees", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const employees = await listEmployees(req.user.id);
    return res.json({ employees });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// #region Proactive Alert - Notification Endpoints
app.get("/api/notifications", authenticateRequest, async (req, res) => {
  try {
    const { limit, unreadOnly, category } = req.query;
    const notifications = await getNotifications(req.user.id, {
      limit: limit ? parseInt(limit) : 50,
      unreadOnly: unreadOnly === "true",
      category: category || undefined
    });
    const unreadCount = await getUnreadNotificationCount(req.user.id);
    return res.json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/notifications/count", authenticateRequest, async (req, res) => {
  try {
    const count = await getUnreadNotificationCount(req.user.id);
    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/notifications/:id/read", authenticateRequest, async (req, res) => {
  try {
    await markNotificationRead(Number(req.params.id), req.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/notifications/read-all", authenticateRequest, async (req, res) => {
  try {
    await markAllNotificationsRead(req.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/notifications/:id", authenticateRequest, async (req, res) => {
  try {
    await deleteNotification(Number(req.params.id), req.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/notifications/needs-reply", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const { emailId, replyDeadline } = req.body;
    await markEmailNeedsReply(emailId, replyDeadline);
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/notifications/replied", authenticateRequest, async (req, res) => {
  try {
    const { emailId } = req.body;
    await markEmailReplied(emailId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/notifications/run-cycle", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const result = await runProactiveAlertCycle();
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/notification-analytics", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const analytics = await getAdminNotificationAnalytics({
      days: req.query?.days,
      from_date: req.query?.from_date || null,
      to_date: req.query?.to_date || null
    });
    return res.json({ analytics });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load notification analytics." });
  }
});

app.get("/api/admin/notification-history", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const result = await getNotificationHistory({
      from_date: req.query?.from_date,
      to_date: req.query?.to_date,
      category: req.query?.category,
      actor_user_id: req.query?.actor_user_id,
      limit: req.query?.limit
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load notification history." });
  }
});
// #endregion

app.post("/api/admin/employees", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const employee = await createEmployee(req.user.id, req.body);
    return res.status(201).json({ employee });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.put("/api/admin/employees/:id", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const employee = await updateEmployee(Number(req.params.id), req.body);
    if (!employee) return res.status(404).json({ error: "Employee not found." });
    return res.json({ employee });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete("/api/admin/employees/:id", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const result = await deleteEmployee(Number(req.params.id));
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
// #endregion

// #region admin-email-trail
app.get("/api/admin/email-trail", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const result = await getEmailTrail(req.query);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
// #endregion

// #region admin-archives
app.post("/api/admin/archives", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const archive = await createArchive(req.user.id, req.body);
    return res.status(201).json({ archive });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/archives", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    const archives = await listArchives();
    return res.json({ archives });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/archive-explorer", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const result = await listAdminArchiveExplorer({
      project_code: req.query?.project_code || "",
      serial_number: req.query?.serial_number || "",
      thread_id: req.query?.thread_id || "",
      limit: req.query?.limit || 50
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load archive explorer data." });
  }
});

app.post("/api/admin/attachments/repair", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const summary = await repairLegacyEmailAttachments({
      userId: req.body?.user_id ? Number(req.body.user_id) : null,
      limit: req.body?.limit ? Number(req.body.limit) : 100
    });
    return res.json({ ok: true, summary });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to repair legacy attachments." });
  }
});

app.post("/api/admin/mail-sync/run-all", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    const summary = await runFullMailSyncAllAccounts();
    return res.json({ ok: true, summary, status: getMailServiceStatus() });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to run full mail sync." });
  }
});

app.post("/api/admin/mail-tests/run", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    const employees = await listEmployeesWithMailSettings();
    const results = [];

    for (const employee of employees) {
      if (!employee.has_mail_settings) {
        results.push({
          user_id: employee.id,
          name: employee.name,
          email: employee.email,
          role: employee.role,
          account_type: null,
          has_mail_settings: false,
          ok: false,
          error: "Mail settings are not configured for this user."
        });
        continue;
      }

      const settings = await getMailSettingsForUser(employee.id);
      if (!settings) {
        results.push({
          user_id: employee.id,
          name: employee.name,
          email: employee.email,
          role: employee.role,
          account_type: employee.account_type || null,
          has_mail_settings: true,
          ok: false,
          error: "Unable to load the effective mail settings for this user."
        });
        continue;
      }

      const test = await testMailSettings(settings);
      results.push({
        user_id: employee.id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        account_type: settings.account_type || employee.account_type || "POP3",
        mailbox_email_address: settings.email_address || employee.mailbox_email_address || employee.email,
        has_mail_settings: true,
        ok: Boolean(test.ok),
        incoming: test.incoming || null,
        outgoing: test.outgoing || null,
        errors: test.errors || []
      });
    }

    const summary = {
      total_users: results.length,
      configured_users: results.filter((item) => item.has_mail_settings).length,
      ok_users: results.filter((item) => item.ok).length,
      failed_users: results.filter((item) => item.has_mail_settings && !item.ok).length,
      missing_settings_users: results.filter((item) => !item.has_mail_settings).length,
      tested_at: new Date().toISOString()
    };

    return res.json({ ok: true, summary, results });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to run admin mail tests." });
  }
});

app.post("/api/admin/ai-backfill/reanalyze", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const job = await startAiBackfillReanalysisJob({
      actorUserId: req.user.id,
      limit: req.body?.limit || null,
      includeSent: Boolean(req.body?.includeSent),
      force: req.body?.force !== false
    });
    return res.json({ ok: true, job });
  } catch (error) {
    return res.status(500).json({ error: error.message || "AI backfill re-analysis failed." });
  }
});

app.get("/api/admin/ai-backfill/reanalyze", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const jobs = listAiBackfillJobs(req.query?.limit || 20);
    return res.json({ ok: true, jobs });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load AI backfill jobs." });
  }
});

app.get("/api/admin/ai-backfill/reanalyze/:jobId", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const job = getAiBackfillJobStatus(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "AI backfill job not found." });
    }
    return res.json({ ok: true, job });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load AI backfill status." });
  }
});

app.post("/api/admin/ai-backfill/reanalyze/:jobId/cancel", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const job = cancelAiBackfillJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "AI backfill job not found." });
    }
    return res.json({ ok: true, job });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to cancel AI backfill job." });
  }
});

app.post("/api/admin/ai-backfill/reanalyze/:jobId/retry-failed", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const job = await retryFailedAiBackfillItems(req.params.jobId, {
      actorUserId: req.user.id,
      force: req.body?.force !== false
    });
    return res.json({ ok: true, job });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to retry failed AI backfill items." });
  }
});
// #endregion

// #region admin-analytics
app.get("/api/admin/analytics", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    const analytics = await getEmployeeAnalytics();
    return res.json(analytics);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
// #endregion

// #region admin-backups
app.get("/api/admin/backups", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    return res.json({
      data_root: getDataRootDir(),
      backups: listBackups()
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list backups." });
  }
});

app.post("/api/admin/backups/create", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const backup = await createBackupSnapshot("manual", {
      trigger: "api",
      actor_id: req.user.id,
      label: req.body?.label || ""
    });
    return res.status(201).json({ backup });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create backup." });
  }
});

app.post("/api/admin/backups/daily-export", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    const backup = await createDailyArchiveExport();
    return res.status(201).json({ backup });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create daily archive export." });
  }
});

app.post("/api/admin/backups/restore", authenticateRequest, requireAdminAccess, async (req, res) => {
  try {
    const fileName = req.body?.file_name;
    if (!fileName) {
      return res.status(400).json({ error: "Backup file name is required." });
    }
    const restore = await restoreBackupByName(fileName);
    const configuredSettings = await listConfiguredMailSettings();
    await applyAllMailSettings(configuredSettings);
    return res.json({
      restore,
      status: getMailServiceStatus()
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to restore backup." });
  }
});
// #endregion

app.get("/api/admin/summary", authenticateRequest, requireAdminAccess, async (req, res) => {
  return res.json(await getAdminSummary(req.user));
});

// Approval routes
app.get("/api/admin/employees-with-managers", authenticateRequest, requireAdminAccess, async (_req, res) => {
  return res.json(await getEmployeesWithManager());
});

app.get("/api/approvals/pending", authenticateRequest, async (req, res) => {
  try {
    const pending = await getPendingApprovals(req.user.id);
    return res.json({ pending });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/emails/:id/thread", authenticateRequest, async (req, res) => {
  try {
    const thread = await getThreadEmails(Number(req.params.id));
    return res.json({ thread });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/approvals/:id/history", authenticateRequest, async (req, res) => {
  try {
    const history = await getApprovalHistory(Number(req.params.id), req.user.id);
    return res.json({ history });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/approvals/:id/action-links", authenticateRequest, async (req, res) => {
  try {
    const email = await getEmailById(Number(req.params.id));
    if (!email) {
      return res.status(404).json({ error: "Approval email not found." });
    }
    if (
      Number(email.assigned_manager_id) !== Number(req.user.id) &&
      req.user.role !== "Admin" &&
      !req.user.can_manage_users &&
      !req.user.can_manage_reports
    ) {
      return res.status(403).json({ error: "You are not allowed to generate approval action links for this email." });
    }
    const action_links = await buildApprovalActionLinks({
      emailId: email.id,
      managerId: email.assigned_manager_id || req.user.id,
      subject: email.subject,
      serial: email.serial,
      preview: email.preview,
      baseUrl: getBaseUrl(req),
      approvalRootId: email.approval_root_id || email.id,
      issuedByUserId: req.user.id,
      deliveryChannel: "manager-view",
      manager: Number(email.assigned_manager_id) ? await getUserById(email.assigned_manager_id) : req.user
    });
    return res.json({
      action_links,
      token_state: await getApprovalActionLinksState(email.id, email.assigned_manager_id || req.user.id)
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/approvals/:id/action-links/revoke", authenticateRequest, async (req, res) => {
  try {
    const email = await getEmailById(Number(req.params.id));
    if (!email) {
      return res.status(404).json({ error: "Approval email not found." });
    }
    if (
      Number(email.assigned_manager_id) !== Number(req.user.id) &&
      req.user.role !== "Admin" &&
      !req.user.can_manage_users &&
      !req.user.can_manage_reports
    ) {
      return res.status(403).json({ error: "You are not allowed to revoke approval action links for this email." });
    }
    const revoke = await revokeApprovalActionTokens({
      emailId: email.id,
      managerId: email.assigned_manager_id || req.user.id,
      reason: req.body?.reason || "Approval links revoked manually."
    });
    return res.json({
      revoke,
      token_state: await getApprovalActionLinksState(email.id, email.assigned_manager_id || req.user.id)
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/manager/approve/:emailId", authenticateRequest, async (req, res) => handleManagerDecisionRoute(req, res, "approve"));
app.post("/api/manager/reject/:emailId", authenticateRequest, async (req, res) => handleManagerDecisionRoute(req, res, "reject"));

app.post("/api/approvals/:id/approve", authenticateRequest, async (req, res) => {
  return handleManagerDecisionRoute(req, res, "approve");
});

app.post("/api/approvals/:id/reject", authenticateRequest, async (req, res) => {
  return handleManagerDecisionRoute(req, res, "reject");
});

app.all("/api/approval-actions/execute", async (req, res) => {
  try {
    const token = req.method === "GET" ? req.query?.token : req.body?.token;
    const managerComments = req.method === "GET" ? req.query?.manager_comments : req.body?.manager_comments;
    const payload = await verifyApprovalActionToken(token);
    const result = await executeApprovalAction({
      emailId: payload.emailId,
      action: payload.action,
      actorUserId: payload.managerId,
      managerComments: managerComments || "",
      ipAddress: req.ip || "",
      source: "signed-action-link",
      approvalToken: token
    });
    return res.json({
      ok: true,
      action: payload.action,
      ...result
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || "Unable to execute approval action." });
  }
});

app.post("/api/integrations/telegram/webhook", async (req, res) => {
  const parsed = parseTelegramApprovalUpdate(req.body);
  if (!parsed) {
    return res.json({ ok: true, ignored: true });
  }
  try {
    const payload = await verifyApprovalActionToken(parsed.token);
    const result = await executeApprovalAction({
      emailId: payload.emailId,
      action: payload.action,
      actorUserId: payload.managerId,
      managerComments: payload.action === "reject" ? "Rejected from Telegram bot action." : "Approved from Telegram bot action.",
      ipAddress: req.ip || "",
      source: "telegram-bot",
      approvalToken: parsed.token
    });
    await answerTelegramCallback(parsed.callbackQueryId, result.message);
    return res.json({ ok: true, action: payload.action });
  } catch (error) {
    await answerTelegramCallback(parsed.callbackQueryId, error.message || "Action failed.");
    return res.status(400).json({ ok: false, error: error.message || "Unable to process Telegram approval action." });
  }
});

app.post("/api/approvals/:id/resubmit", authenticateRequest, upload.array("attachments", 10), async (req, res) => {
  try {
    const forcedManagerApproval = String(req.body?.force_manager_approval || "").trim().toLowerCase() === "true";
    const forcedManagerId = forcedManagerApproval ? (Number(req.body?.forced_manager_id || 0) || null) : null;
    const result = await reviseRejectedApproval(
      Number(req.params.id),
      req.user.id,
      req.body || {},
      req.files || [],
      req.ip || "",
      {
        managerId: forcedManagerId
      }
    );
    return res.status(201).json({
      ...result,
      pending_approval: true,
      message: `Email ${result.serial} revised and resubmitted for approval.`
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/approval-analytics", authenticateRequest, requireAdminAccess, async (_req, res) => {
  try {
    return res.json(await getApprovalAnalytics());
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.put("/api/settings", authenticateRequest, async (req, res) => {
  try {
    const settings = await updateMailSettingsForUser(req.user.id, req.body || {});
    let status = getMailServiceStatus(req.user.id);
    let apply_error = null;
    try {
      status = await applyMailSettings(settings, req.user.id);
    } catch (error) {
      apply_error = error.message || "Unable to apply settings automatically.";
    }
    return res.json({ settings, status, apply_error });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to save settings." });
  }
});

app.get("/api/settings/status", authenticateRequest, async (req, res) => {
  return res.json({ status: getMailServiceStatus(req.user.id) });
});

app.post("/api/settings/test", authenticateRequest, async (req, res) => {
  try {
    const result = await testMailSettings({ ...(req.body || {}), user_id: req.user.id });
    return res.json({ result });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to test settings." });
  }
});

app.post("/api/settings/apply", authenticateRequest, async (req, res) => {
  try {
    const settings = await getMailSettingsForUser(req.user.id);
    const status = await applyMailSettings(settings, req.user.id);
    return res.json({ status });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to apply settings." });
  }
});

app.post("/api/settings/run-cycle", authenticateRequest, async (req, res) => {
  try {
    const result = await runCycle(req.user.id);
    const status = getMailServiceStatus(req.user.id);
    return res.json({ result, status });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to run send/receive cycle." });
  }
});

app.post("/api/sync/import", requireSyncKey, async (req, res) => {
  const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
  const result = await importSyncedEmails(emails);
  return res.status(201).json({
    ...result,
    source: "existing-mail-sync-pipeline"
  });
});

app.get("/api/public/company-info", async (_req, res) => {
  try {
    const settings = await getAppSettings();
    return res.json({ company_name: settings?.company_name || "TECHNO GROUP", logo_url: settings?.logo_url || "/logo.gif" });
  } catch { return res.json({ company_name: "TECHNO GROUP", logo_url: "/logo.gif" }); }
});

app.get("/api/health", (_req, res) => {
  return res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    databaseMode: getDatabaseMode()
  });
});

// Serve built frontend (production only — in dev mode use Vite at port 5173)
const isProduction = process.env.NODE_ENV === "production" || process.env.SERVE_DIST === "true";
if (isProduction) {
const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  const distAssetsDir = path.join(distDir, "assets");
  if (fs.existsSync(distAssetsDir)) {
    app.use("/assets", express.static(distAssetsDir, {
      immutable: true,
      maxAge: "1y"
    }));
  }
  app.use(express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    }
  }));
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/uploads/") ||
      req.path.startsWith("/assets/")
    ) {
      return next();
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.sendFile(path.join(distDir, "index.html"));
  });
}
} // end isProduction

app.use((_req, res) => {
  return res.status(404).json({ error: "Not found" });
});

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function startSmtpRelay() {
  const SMTP_RELAY_PORT = Number(process.env.SMTP_RELAY_PORT || 3025);
  const relayServer = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, session, callback) {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", async () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf-8");
          const parsed = await simpleParser(raw);
          const senderEmail = parsed.from?.value?.[0]?.address || "";
          if (!senderEmail) { callback(); return; }
          const senderUser = await getUserByEmail(senderEmail);
          if (!senderUser) { callback(); return; }
          const attachments = await saveParsedAttachments(parsed);
          const serialInfo = await createSerialFromSubjectKey(parsed.subject || "Relayed email", "", parsed.date || new Date());
          const serialTag = `[REF: ${serialInfo.serial}]`;
          const subjectWithSerial = (parsed.subject || "Relayed email").includes(serialInfo.serial) ? parsed.subject : `${serialTag} ${parsed.subject || "Relayed email"}`;
          const toEmail = parsed.to?.value?.[0]?.address || "";
          const toName = parsed.to?.value?.[0]?.name || "";
          const cc = (parsed.cc?.value || []).map((v) => v.address).filter(Boolean).join(", ");
          const bodyText = (parsed.text || parsed.textAsHtml || "").slice(0, 100000);
          const managedUsers = await getEmployeesWithManager();
          const { requiresManagerApproval } = getUserApprovalPolicy(senderUser, managedUsers);
          if (requiresManagerApproval && senderUser.manager_id) {
            await createPendingApprovalEmail({
              employeeId: senderUser.id,
              managerId: senderUser.manager_id,
              recipientName: toName,
              recipientEmail: toEmail,
              ccList: cc,
              subject: subjectWithSerial,
              body: bodyText,
              attachments: attachments.map((a) => ({
                originalname: a.originalname || "attachment",
                path: a.filepath || a.path,
                mimetype: a.mimetype || "application/octet-stream"
              }))
            });
          } else {
            const fileList = attachments.map((a) => ({
              originalname: a.originalname || "attachment",
              path: a.filepath || a.path,
              mimetype: a.mimetype || "application/octet-stream"
            }));
            await sendMailMessage({
              recipient_name: toName,
              recipient_email: toEmail,
              cc_list: cc,
              subject: subjectWithSerial,
              body: bodyText,
              from: `"${senderUser.name || senderEmail}" <${senderEmail}>`,
            }, fileList, senderUser.id);
          }
          callback();
        } catch (err) {
          console.error("SMTP relay error:", err.message);
          callback(new Error("Relay processing failed: " + err.message));
        }
      });
    },
  });
  relayServer.listen(SMTP_RELAY_PORT, "0.0.0.0", () => {
    console.log(`SMTP relay listening on 0.0.0.0:${SMTP_RELAY_PORT} - configure this as your SMTP server in Group-Office`);
  });
  relayServer.on("error", (err) => console.error("SMTP relay error:", err.message));
}

async function startServer() {
  // #region debug-point startup-localhost-refused
  reportStartupDebug("startServer.enter", { cwd: process.cwd(), port });
  // #endregion
  await initializeDatabase();
  // #region debug-point startup-localhost-refused
  reportStartupDebug("startServer.afterInitializeDatabase", { databaseMode: getDatabaseMode() });
  // #endregion
  try { await seedDefaultEmailKeys(); } catch (e) { console.error("Failed to seed email keys:", e.message); }
  const settings = await getAppSettings();
  // #region debug-point startup-localhost-refused
  reportStartupDebug("startServer.afterGetAppSettings", { hasSettings: Boolean(settings) });
  // #endregion
  try {
    const configuredSettings = await listConfiguredMailSettings();
    console.log(`[MAIL] Found ${configuredSettings.length} configured mail settings, applying...`);
    const mailStatus = await applyAllMailSettings(configuredSettings);
    console.log(`[MAIL] Scheduler status: configured=${mailStatus.configured}, accounts=${mailStatus.configuredAccounts}, running=${mailStatus.schedulerRunning}`);
    // #region debug-point startup-localhost-refused
    reportStartupDebug("startServer.afterApplyMailSettings", {
      hasSettings: Boolean(settings),
      configuredMailboxes: configuredSettings.length
    });
    // #endregion
  } catch (error) {
    // #region debug-point startup-localhost-refused
    reportStartupDebug("startServer.applyMailSettingsError", {
      name: error?.name,
      message: error?.message
    });
    // #endregion
    console.error("Mail service settings could not be applied during startup:", error);
  }
  startApprovalReminderScheduler();
  startTaskAlertEngine();
  try {
    await ensureNotificationsTable();
    console.log("[ProactiveAlert] Notifications table ensured");
  } catch (e) { console.error("[ProactiveAlert] Table creation failed:", e.message); }
  startProactiveAlertEngine();
  const server = app.listen(port, "0.0.0.0", () => {
    // #region debug-point startup-localhost-refused
    reportStartupDebug("startServer.listenSuccess", { port });
    // #endregion
    console.log(`API server running at http://0.0.0.0:${port}`);
    startSmtpRelay();
  });
  server.on("error", async (error) => {
    // #region debug-point startup-localhost-refused
    reportStartupDebug("startServer.listenError", {
      code: error?.code,
      name: error?.name,
      message: error?.message,
      port
    });
    // #endregion
    if (error?.code === "EADDRINUSE") {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          // #region debug-point startup-localhost-refused
          reportStartupDebug("startServer.reuseHealthyExistingPort", { port });
          // #endregion
          console.warn(`Backend is already running on http://localhost:${port}; reusing existing instance.`);
          process.exit(0);
          return;
        }
      } catch (reuseError) {
        // #region debug-point startup-localhost-refused
        reportStartupDebug("startServer.reuseProbeFailed", {
          port,
          name: reuseError?.name,
          message: reuseError?.message
        });
        // #endregion
      }
    }

    throw error;
  });
}

startServer().catch((error) => {
  // #region debug-point startup-localhost-refused
  reportStartupDebug("startServer.catch", {
    name: error?.name,
    message: error?.message,
    stack: error?.stack
  });
  // #endregion
  console.error("Unable to start API server:", error);
  process.exit(1);
});
