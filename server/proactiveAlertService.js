import { query } from "./database.js";

const CYCLE_INTERVAL_MS = 60 * 60 * 1000;

let proactiveAlertHandle = null;

export async function ensureNotificationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      email_id INTEGER,
      task_id INTEGER,
      project_id INTEGER,
      priority TEXT NOT NULL DEFAULT 'medium',
      read BOOLEAN DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      action_url TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(category)`);

  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_notified BOOLEAN DEFAULT FALSE`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline_reminder_sent BOOLEAN DEFAULT FALSE`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline_reminder_at TIMESTAMPTZ`);

  await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS needs_reply BOOLEAN DEFAULT FALSE`);
  await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS reply_deadline TIMESTAMPTZ`);
  await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ`);
  await query(`ALTER TABLE emails ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`);
}

export async function createNotification(userId, { type, category, title, message, emailId, taskId, projectId, priority, actionUrl, metadata }) {
  const result = await query(
    `INSERT INTO notifications (user_id, type, category, title, message, email_id, task_id, project_id, priority, action_url, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [userId, type || "info", category || "general", title, message,
     emailId || null, taskId || null, projectId || null,
     priority || "medium", actionUrl || null, JSON.stringify(metadata || {})]
  );
  return result.rows[0];
}

export async function getNotifications(userId, { limit = 50, unreadOnly = false, category } = {}) {
  let where = "WHERE n.user_id = $1";
  const params = [userId];
  let idx = 2;
  if (unreadOnly) { where += ` AND n.read = FALSE`; }
  if (category) { where += ` AND n.category = $${idx}`; params.push(category); idx++; }
  where += ` ORDER BY n.created_at DESC LIMIT $${idx}`;
  params.push(limit);
  const result = await query(
    `SELECT n.*, e.subject AS email_subject, t.title AS task_title, p.project_code
     FROM notifications n
     LEFT JOIN emails e ON e.id = n.email_id
     LEFT JOIN tasks t ON t.id = n.task_id
     LEFT JOIN projects p ON p.id = n.project_id
     ${where}`, params
  );
  return result.rows;
}

export async function getUnreadNotificationCount(userId) {
  const result = await query(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE`, [userId]);
  return result.rows[0].count;
}

export async function markNotificationRead(notificationId, userId) {
  await query(`UPDATE notifications SET read = TRUE, read_at = NOW() WHERE id = $1 AND user_id = $2`, [notificationId, userId]);
}

export async function markAllNotificationsRead(userId) {
  await query(`UPDATE notifications SET read = TRUE, read_at = NOW() WHERE user_id = $1 AND read = FALSE`, [userId]);
}

export async function deleteNotification(notificationId, userId) {
  await query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [notificationId, userId]);
}

export async function markEmailNeedsReply(emailId, replyDeadline) {
  await query(`UPDATE emails SET needs_reply = TRUE, reply_deadline = $2 WHERE id = $1`, [emailId, replyDeadline || null]);
}

export async function markEmailReplied(emailId) {
  await query(`UPDATE emails SET replied_at = NOW() WHERE id = $1`, [emailId]);
}

async function getOverdueTasks() {
  const result = await query(
    `SELECT t.*, p.project_code, p.project_name, u.name AS assigned_to_name, u.email AS assigned_to_email
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.status = 'pending'
       AND t.due_date IS NOT NULL
     ORDER BY t.due_date ASC`
  );
  const now = new Date();
  return result.rows.filter(t => new Date(t.due_date) < now && (!t.overdue_notified || (t.overdue_notified_at && (now - new Date(t.overdue_notified_at)) > 24*60*60*1000)));
}

async function getUpcomingDeadlineTasks(hoursAhead = 24) {
  const result = await query(
    `SELECT t.*, p.project_code, p.project_name, u.name AS assigned_to_name, u.email AS assigned_to_email
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.status = 'pending'
       AND t.due_date IS NOT NULL
     ORDER BY t.due_date ASC`,
    []
  );
  const now = new Date();
  const ahead = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  return result.rows.filter(t => {
    const d = new Date(t.due_date);
    return d > now && d <= ahead && (!t.deadline_reminder_sent || (t.deadline_reminder_at && (now - new Date(t.deadline_reminder_at)) > 12*60*60*1000));
  });
}

async function getUnansweredEmails() {
  const result = await query(
    `SELECT e.*, u.name AS employee_name, u.email AS employee_email, u.id AS employee_user_id
     FROM emails e
     LEFT JOIN users u ON LOWER(e.from_email) = LOWER(u.email)
     WHERE e.needs_reply = TRUE
       AND e.replied_at IS NULL
       AND e.direction = 'incoming'
       AND e.reply_deadline IS NOT NULL
     ORDER BY e.reply_deadline ASC`
  );
  const now = new Date();
  const overdue = result.rows.filter(e => {
    const d = new Date(e.reply_deadline);
    return d < now && (!e.last_reminder_at || (now - new Date(e.last_reminder_at)) > 24*60*60*1000);
  });
  return overdue;
}

async function getStaleAwaitingReplyEmails(daysThreshold = 7) {
  const result = await query(
    `SELECT e.*, u.name AS employee_name, u.email AS employee_email, u.id AS employee_user_id
     FROM emails e
     LEFT JOIN users u ON LOWER(e.from_email) = LOWER(u.email)
     WHERE e.direction = 'incoming'
       AND e.replied_at IS NULL
       AND e.archived = TRUE
     ORDER BY e.archived_at ASC
     LIMIT 50`
  );
  const threshold = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);
  const stale = result.rows.filter(e => {
    const archivedAt = e.archived_at ? new Date(e.archived_at) : null;
    return archivedAt && archivedAt < threshold && (!e.last_reminder_at || (new Date() - new Date(e.last_reminder_at)) > 48*60*60*1000);
  });
  return stale;
}

export async function runProactiveAlertCycle() {
  const now = new Date();
  console.log(`[ProactiveAlert] Cycle started at ${now.toISOString()}`);

  let overdueCount = 0;
  let upcomingCount = 0;
  let unansweredCount = 0;
  let staleCount = 0;

  try {
    const overdueTasks = await getOverdueTasks();
    console.log(`[ProactiveAlert] Overdue tasks found: ${overdueTasks.length}`);
    for (const task of overdueTasks) {
      if (!task.assigned_to) continue;
      const daysOverdue = Math.round((now - new Date(task.due_date)) / (1000 * 60 * 60 * 24));
      await createNotification(task.assigned_to, {
        type: "warning",
        category: "task_overdue",
        title: `مهمة متأخرة: ${task.title}`,
        message: `المهمة "${task.title}" تأخرت عن مواعدها منذ ${daysOverdue} يوم. المشروع: ${task.project_code || "بدون"}`,
        taskId: task.id,
        projectId: task.project_id,
        priority: "high",
        actionUrl: `/tasks/${task.id}`,
        metadata: { days_overdue: daysOverdue, project_code: task.project_code }
      });
      await query(`UPDATE tasks SET overdue_notified = TRUE, overdue_notified_at = CURRENT_TIMESTAMP WHERE id = $1`, [task.id]);
      overdueCount++;
    }
  } catch (e) { console.error("[ProactiveAlert] Overdue tasks error:", e.message); }

  try {
    const upcomingTasks = await getUpcomingDeadlineTasks(24);
    for (const task of upcomingTasks) {
      if (!task.assigned_to) continue;
      const hoursLeft = Math.round((new Date(task.due_date) - now) / (1000 * 60 * 60));
      const urgency = hoursLeft <= 4 ? "critical" : hoursLeft <= 12 ? "high" : "medium";
      await createNotification(task.assigned_to, {
        type: "warning",
        category: "task_deadline",
        title: `تذكير موعد: ${task.title}`,
        message: `المهمة "${task.title}" مواعدها بعد ${hoursLeft} ساعة. المشروع: ${task.project_code || "بدون"}`,
        taskId: task.id,
        projectId: task.project_id,
        priority: urgency,
        actionUrl: `/tasks/${task.id}`,
        metadata: { hours_left: hoursLeft, project_code: task.project_code }
      });
      await query(`UPDATE tasks SET deadline_reminder_sent = TRUE, deadline_reminder_at = CURRENT_TIMESTAMP WHERE id = $1`, [task.id]);
      upcomingCount++;
    }
  } catch (e) { console.error("[ProactiveAlert] Upcoming tasks error:", e.message); }

  try {
    const unanswered = await getUnansweredEmails();
    for (const email of unanswered) {
      if (!email.employee_user_id) continue;
      const daysWaiting = Math.round((now - new Date(email.reply_deadline)) / (1000 * 60 * 60 * 24));
      await createNotification(email.employee_user_id, {
        type: "error",
        category: "email_unanswered",
        title: `لم يتم الرد على إيميل`,
        message: `لم يصل رد بخصوص "${email.subject}" منذ ${daysWaiting} يوم. المُرسل: ${email.from_name || email.from_email}`,
        emailId: email.id,
        priority: "high",
        actionUrl: `/email/${email.id}`,
        metadata: { days_waiting: daysWaiting, from_email: email.from_email, from_name: email.from_name }
      });
      await query(`UPDATE emails SET last_reminder_at = CURRENT_TIMESTAMP WHERE id = $1`, [email.id]);
      unansweredCount++;
    }
  } catch (e) { console.error("[ProactiveAlert] Unanswered emails error:", e.message); }

  try {
    const stale = await getStaleAwaitingReplyEmails(7);
    for (const email of stale) {
      if (!email.employee_user_id) continue;
      const daysSinceArchived = Math.round((now - new Date(email.archived_at)) / (1000 * 60 * 60 * 24));
      await createNotification(email.employee_user_id, {
        type: "warning",
        category: "email_stale",
        title: `إيميل ينتظر رداً`,
        message: `الإيميل "${email.subject}" لا يزال ينتظر الرد منذ ${daysSinceArchived} يوم. المُرسل: ${email.from_name || email.from_email}`,
        emailId: email.id,
        priority: "medium",
        actionUrl: `/email/${email.id}`,
        metadata: { days_since_archived: daysSinceArchived, from_email: email.from_email }
      });
      await query(`UPDATE emails SET last_reminder_at = CURRENT_TIMESTAMP WHERE id = $1`, [email.id]);
      staleCount++;
    }
  } catch (e) { console.error("[ProactiveAlert] Stale emails error:", e.message); }

  const total = overdueCount + upcomingCount + unansweredCount + staleCount;
  if (total > 0) {
    console.log(`[ProactiveAlert] Created ${total} notifications: ${overdueCount} overdue, ${upcomingCount} upcoming, ${unansweredCount} unanswered, ${staleCount} stale`);
  }
  console.log(`[ProactiveAlert] Cycle completed at ${new Date().toISOString()}`);
  return { overdueCount, upcomingCount, unansweredCount, staleCount, total };
}

export function startProactiveAlertEngine() {
  if (proactiveAlertHandle) clearInterval(proactiveAlertHandle);

  const now = new Date();
  const next8AM = new Date(now);
  next8AM.setHours(8, 0, 0, 0);
  if (now >= next8AM) next8AM.setDate(next8AM.getDate() + 1);
  const msUntil8AM = next8AM.getTime() - now.getTime();

  console.log(`[ProactiveAlert] Engine starting. Next full scan at ${next8AM.toISOString()} (${Math.round(msUntil8AM / 60000)} min)`);

  setTimeout(() => {
    runProactiveAlertCycle().catch(e => console.error("[ProactiveAlert] Initial cycle failed:", e.message));
    proactiveAlertHandle = setInterval(() => {
      runProactiveAlertCycle().catch(e => console.error("[ProactiveAlert] Cycle failed:", e.message));
    }, CYCLE_INTERVAL_MS);
  }, msUntil8AM);
}

export function stopProactiveAlertEngine() {
  if (proactiveAlertHandle) {
    clearInterval(proactiveAlertHandle);
    proactiveAlertHandle = null;
  }
}
