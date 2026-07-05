import crypto from "crypto";
import {
  consumeApprovalActionToken,
  getApprovalActionTokenByHash,
  issueApprovalActionToken
} from "./database.js";

function getApprovalTokenSecret() {
  return (
    process.env.APPROVAL_ACTION_SECRET ||
    process.env.JWT_SECRET ||
    "tiger-mail-approval-secret"
  );
}

function hashApprovalActionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function buildApprovalActionSignature(payload) {
  return crypto
    .createHmac("sha256", getApprovalTokenSecret())
    .update(payload)
    .digest("hex")
    .slice(0, 24);
}

function createApprovalActionToken({ emailId, managerId, action, expiresInMinutes = 60 * 24 }) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(5, Number(expiresInMinutes || 0)) * 60;
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${Number(emailId)}.${Number(managerId)}.${String(action || "").toLowerCase()}.${exp}.${nonce}`;
  const signature = buildApprovalActionSignature(payload);
  return `${payload}.${signature}`;
}

async function verifyApprovalActionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 6) {
    throw new Error("Invalid approval action token.");
  }

  const [emailIdRaw, managerIdRaw, action, expRaw, nonce, providedSignature] = parts;
  const emailId = Number(emailIdRaw);
  const managerId = Number(managerIdRaw);
  const exp = Number(expRaw);
  if (!emailId || !managerId || !action || !exp || !nonce || !providedSignature) {
    throw new Error("Invalid approval action token.");
  }

  const payload = `${emailId}.${managerId}.${action}.${exp}.${nonce}`;
  const expectedSignature = buildApprovalActionSignature(payload);

  if (providedSignature !== expectedSignature) {
    throw new Error("Approval action token signature is invalid.");
  }

  if (exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Approval action token has expired.");
  }

  if (!["approve", "reject"].includes(action)) {
    throw new Error("Approval action token contains an unsupported action.");
  }

  const tokenHash = hashApprovalActionToken(token);
  const tokenRecord = await getApprovalActionTokenByHash(tokenHash);
  if (!tokenRecord) {
    throw new Error("Approval action token is not registered anymore.");
  }

  if (tokenRecord.revoked_at) {
    throw new Error(tokenRecord.revoked_reason || "Approval action token has been revoked.");
  }

  if (tokenRecord.consumed_at) {
    throw new Error("Approval action token has already been used.");
  }

  if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
    throw new Error("Approval action token has expired.");
  }

  if (
    Number(tokenRecord.email_id) !== emailId ||
    Number(tokenRecord.manager_id) !== managerId ||
    String(tokenRecord.action || "").toLowerCase() !== action ||
    String(tokenRecord.token_nonce || "") !== String(nonce)
  ) {
    throw new Error("Approval action token metadata is invalid.");
  }

  return {
    emailId,
    managerId,
    action,
    exp,
    nonce,
    tokenHash,
    tokenRecord
  };
}

function resolveTelegramChatId(manager = null) {
  if (manager && (manager.telegram_chat_id || manager.telegram_username)) {
    return manager.telegram_chat_id && manager.telegram_notifications_enabled
      ? String(manager.telegram_chat_id)
      : "";
  }
  const directChatId = process.env.TELEGRAM_APPROVAL_DEFAULT_CHAT_ID;
  const mapped = process.env.TELEGRAM_APPROVAL_CHAT_MAP;
  if (mapped) {
    try {
      const parsed = JSON.parse(mapped);
      const byEmail = parsed?.[manager?.email || ""];
      if (byEmail) {
        return String(byEmail);
      }
    } catch {}
  }
  return directChatId ? String(directChatId) : "";
}

async function buildApprovalActionLinks({
  emailId,
  managerId,
  subject = "",
  serial = "",
  preview = "",
  baseUrl,
  approvalRootId = null,
  issuedByUserId = null,
  deliveryChannel = "app",
  manager = null,
  expiresInMinutes = 60 * 24
}) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const approveToken = createApprovalActionToken({ emailId, managerId, action: "approve", expiresInMinutes });
  const rejectToken = createApprovalActionToken({ emailId, managerId, action: "reject", expiresInMinutes });
  const approveParts = approveToken.split(".");
  const rejectParts = rejectToken.split(".");
  const approveExp = Number(approveParts[3] || 0);
  const rejectExp = Number(rejectParts[3] || 0);
  const telegramChatId = resolveTelegramChatId(manager);
  const approveRecord = await issueApprovalActionToken({
    tokenHash: hashApprovalActionToken(approveToken),
    tokenNonce: approveParts[4] || "",
    emailId,
    approvalRootId,
    managerId,
    action: "approve",
    expiresAt: new Date(approveExp * 1000).toISOString(),
    issuedBy: issuedByUserId,
    deliveryChannel,
    telegramChatId,
    metadata: JSON.stringify({ subject, serial, preview })
  });
  const rejectRecord = await issueApprovalActionToken({
    tokenHash: hashApprovalActionToken(rejectToken),
    tokenNonce: rejectParts[4] || "",
    emailId,
    approvalRootId,
    managerId,
    action: "reject",
    expiresAt: new Date(rejectExp * 1000).toISOString(),
    issuedBy: issuedByUserId,
    deliveryChannel,
    telegramChatId,
    metadata: JSON.stringify({ subject, serial, preview })
  });
  const historyUrl = `${cleanBaseUrl}/?view=approvals&email=${emailId}&panel=history`;
  const approveUrl = `${cleanBaseUrl}/?view=approvals&email=${emailId}&action=approve&token=${encodeURIComponent(approveToken)}`;
  const rejectUrl = `${cleanBaseUrl}/?view=approvals&email=${emailId}&action=reject&token=${encodeURIComponent(rejectToken)}`;
  const apiApproveUrl = `${cleanBaseUrl}/api/approval-actions/execute?token=${encodeURIComponent(approveToken)}`;
  const apiRejectUrl = `${cleanBaseUrl}/api/approval-actions/execute?token=${encodeURIComponent(rejectToken)}`;
  const shareText = [
    `Approval review required for ${serial || `Email #${emailId}`}`,
    `Subject: ${subject || "(No subject)"}`,
    preview ? `Preview: ${String(preview).slice(0, 160)}` : "",
    `Approve: ${approveUrl}`,
    `Reject: ${rejectUrl}`,
    `History: ${historyUrl}`
  ].filter(Boolean).join("\n");

  return {
    approve_token: approveToken,
    reject_token: rejectToken,
    approve_expires_at: approveRecord?.expires_at || new Date(approveExp * 1000).toISOString(),
    reject_expires_at: rejectRecord?.expires_at || new Date(rejectExp * 1000).toISOString(),
    issued_at: approveRecord?.created_at || new Date().toISOString(),
    telegram_chat_id: telegramChatId || "",
    telegram_notifications_enabled: Boolean(manager?.telegram_notifications_enabled),
    approve_url: approveUrl,
    reject_url: rejectUrl,
    history_url: historyUrl,
    api_approve_url: apiApproveUrl,
    api_reject_url: apiRejectUrl,
    telegram_share_url: `https://t.me/share/url?url=${encodeURIComponent(historyUrl)}&text=${encodeURIComponent(shareText)}`,
    share_text: shareText
  };
}

function buildTelegramApprovalMessage({ email, employee, manager, actionLinks }) {
  return [
    `Tiger.mail Approval Review`,
    ``,
    `Serial: ${email?.serial || `Email #${email?.id || "-"}`}`,
    `Subject: ${email?.subject || "(No subject)"}`,
    `Employee: ${employee?.name || email?.sender_name || "-"} <${employee?.email || email?.sender_email || "-"}>`,
    `Manager: ${manager?.name || "-"} <${manager?.email || "-"}>`,
    email?.preview ? `Preview: ${email.preview}` : "",
    ``,
    `Approve: ${actionLinks?.approve_url || ""}`,
    `Reject: ${actionLinks?.reject_url || ""}`,
    `History: ${actionLinks?.history_url || ""}`
  ].filter(Boolean).join("\n");
}

function buildTelegramReminderMessage({ email, employee, manager, actionLinks, reminderCount = 0 }) {
  const riskFlags = Array.isArray(email?.risk_flags)
    ? email.risk_flags
    : String(email?.risk_flags || "").split(",").map((item) => item.trim()).filter(Boolean);

  return [
    `Tiger.mail Reminder`,
    ``,
    `Pending approval still needs attention.`,
    `Serial: ${email?.serial || `Email #${email?.id || "-"}`}`,
    `Subject: ${email?.subject || "(No subject)"}`,
    `Employee: ${employee?.name || email?.sender_name || "-"} <${employee?.email || email?.sender_email || "-"}>`,
    `Manager: ${manager?.name || "-"} <${manager?.email || "-"}>`,
    `Risk: ${String(email?.risk_level || "low").toUpperCase()}`,
    `Reminders Sent: ${Number(reminderCount || email?.reminder_count || 0)}`,
    riskFlags.length ? `Flags: ${riskFlags.join(", ")}` : "",
    email?.preview ? `Preview: ${email.preview}` : "",
    ``,
    `Approve: ${actionLinks?.approve_url || ""}`,
    `Reject: ${actionLinks?.reject_url || ""}`,
    `History: ${actionLinks?.history_url || ""}`
  ].filter(Boolean).join("\n");
}

async function sendTelegramMessageWithApprovalActions({ manager, actionLinks, text }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = resolveTelegramChatId(manager);
  if (!botToken || !chatId) {
    return { sent: false, reason: "Telegram bot token or chat id is not configured." };
  }

  const callbackApprove = `approval:${actionLinks.approve_token}`;
  const callbackReject = `approval:${actionLinks.reject_token}`;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: callbackApprove },
            { text: "Reject", callback_data: callbackReject }
          ],
          [
            { text: "Open History", url: actionLinks.history_url }
          ]
        ]
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    return {
      sent: false,
      reason: payload?.description || "Telegram API rejected the approval notification."
    };
  }

  return {
    sent: true,
    chat_id: chatId,
    message_id: payload?.result?.message_id || null
  };
}

async function sendTelegramApprovalNotification({ email, employee, manager, actionLinks }) {
  const text = buildTelegramApprovalMessage({ email, employee, manager, actionLinks });
  return sendTelegramMessageWithApprovalActions({ manager, actionLinks, text });
}

async function sendTelegramApprovalReminder({ email, employee, manager, actionLinks, reminderCount = 0 }) {
  const text = buildTelegramReminderMessage({ email, employee, manager, actionLinks, reminderCount });
  return sendTelegramMessageWithApprovalActions({ manager, actionLinks, text });
}

async function markApprovalActionTokenConsumed(token) {
  return consumeApprovalActionToken(hashApprovalActionToken(token));
}

function parseTelegramApprovalUpdate(update) {
  const callbackQuery = update?.callback_query;
  const data = callbackQuery?.data || "";
  if (!data.startsWith("approval:")) {
    return null;
  }
  const token = data.slice("approval:".length);
  if (!token) {
    return null;
  }
  return {
    token,
    callbackQueryId: callbackQuery?.id || "",
    chatId: callbackQuery?.message?.chat?.id || "",
    messageId: callbackQuery?.message?.message_id || null
  };
}

async function answerTelegramCallback(callbackQueryId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !callbackQueryId) {
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || "Processed."
      })
    });
  } catch {}
}

export {
  buildApprovalActionLinks,
  verifyApprovalActionToken,
  markApprovalActionTokenConsumed,
  sendTelegramApprovalNotification,
  sendTelegramApprovalReminder,
  parseTelegramApprovalUpdate,
  answerTelegramCallback
};
