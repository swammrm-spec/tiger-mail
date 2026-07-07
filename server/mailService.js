import fs from "fs";
import path from "path";
import crypto from "crypto";
import net from "net";
import tls from "tls";
import Imap from "node-imap";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import {
  uploadsDir,
  createEmail,
  createSerialFromSubjectKey,
  analyzeIncomingEmail,
  getUserByEmail,
  getMailSettingsForUser,
  getEmailById,
  getEmailByExternalMessageId,
  getEmailAttachments,
  listConfiguredMailSettings,
  listLegacyAttachmentRepairCandidates,
  replaceEmailAttachments,
  updateEmailAttachmentRepairState,
  ensureFolder,
  getQueuedOutboxEmail,
  listDueOutboxEmails,
  markOutboxRetry,
  markOutboxSent,
  markApprovalEmailQueued,
  queueOutgoingEmail,
  logEmailTrail,
  upsertRecentContact,
  trackEmailThread,
  resolveSerialFromHeaders,
  getEmailAccountById,
  getUserActiveAccounts,
  parseSubjectForMetadata,
  generateHiddenFooter,
  extractEmailMetadata,
  extractHiddenRef,
  createTask
} from "./database.js";

const activeConfigs = new Map();
const smtpTransporters = new Map();
const userServiceState = new Map();
const nextCycleByUser = new Map();
let schedulerHandle = null;
const cycleInFlightByUser = new Map();
let globalCycleInFlight = null;
const backgroundFetchIntervalMinutes = Math.max(0.5, Number(process.env.BACKGROUND_MAIL_FETCH_MINUTES || 1));

// #region debug-point send-receive-auth:reporter
function reportSendReceiveAuthDebug(location, msg, data = {}, runId = "pre-fix", hypothesisId = "") {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "send-receive-auth",
      runId: process.env.DEBUG_RUN_ID || runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}
// #endregion

// #region debug-point send-receive-sync:reporter
function reportSendReceiveSyncDebug(location, msg, data = {}, runId = "pre-fix", hypothesisId = "") {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "send-receive-sync",
      runId: process.env.DEBUG_RUN_ID || runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}
// #endregion

let serviceState = {
  configured: false,
  schedulerRunning: false,
  configuredAccounts: 0,
  auto_send_receive_minutes: null,
  lastAppliedAt: null,
  lastTestAt: null,
  lastTestResult: null,
  lastCycleAt: null,
  nextCycleAt: null,
  lastReceiveAt: null,
  lastReceiveCount: 0,
  lastSendAt: null,
  lastSendCount: 0,
  lastQueueCount: 0,
  lastRunSummary: null,
  lastError: null
};

// #region debug-point connection-test-failed
const debugDir = path.resolve(".dbg");
const connectionTestDebugFile = path.join(debugDir, "connection-test-failed.ndjson");

function reportConnectionTestDebug(step, data = {}) {
  try {
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    fs.appendFileSync(
      connectionTestDebugFile,
      `${JSON.stringify({
        sessionId: "connection-test-failed",
        location: "server/mailService.js",
        step,
        data,
        ts: Date.now()
      })}\n`
    );
  } catch {}
}
// #endregion

function sanitizeServiceConfig(settings) {
  if (!settings) {
    return null;
  }

  return {
    user_id: settings.user_id ? Number(settings.user_id) : null,
    company_name: settings.company_name,
    display_name: settings.display_name,
    email_address: settings.email_address,
    account_type: settings.account_type,
    incoming_server: settings.incoming_server,
    incoming_port: Number(settings.incoming_port),
    incoming_ssl: Boolean(settings.incoming_ssl),
    outgoing_server: settings.outgoing_server,
    outgoing_port: Number(settings.outgoing_port),
    outgoing_encryption: settings.outgoing_encryption,
    smtp_auth_required: Boolean(settings.smtp_auth_required),
    smtp_same_as_incoming: Boolean(settings.smtp_same_as_incoming),
    username: settings.username,
    password: settings.password,
    remember_password: Boolean(settings.remember_password),
    require_spa: Boolean(settings.require_spa),
    leave_copy_on_server: Boolean(settings.leave_copy_on_server),
    remove_after_days: Number(settings.remove_after_days),
    remove_when_deleted: Boolean(settings.remove_when_deleted),
    auto_send_receive_minutes: Number(settings.auto_send_receive_minutes),
    inbox_folder_name: settings.inbox_folder_name || "Inbox",
    sent_folder_name: settings.sent_folder_name || "Sent",
    sync_sent_items: settings.sync_sent_items === undefined ? true : Boolean(settings.sync_sent_items),
    graph_tenant_id: settings.graph_tenant_id || "",
    graph_client_id: settings.graph_client_id || "",
    graph_client_secret: settings.graph_client_secret || "",
    graph_mailbox_user: settings.graph_mailbox_user || settings.email_address || ""
  };
}

function getConfigKey(config) {
  return [
    config.user_id || "shared",
    config.outgoing_server,
    config.outgoing_port,
    config.username,
    config.password,
    config.outgoing_encryption
  ].join("|");
}

function getDefaultUserState(config = null) {
  return {
    configured: Boolean(config),
    schedulerRunning: false,
    auto_send_receive_minutes: config?.auto_send_receive_minutes || null,
    lastAppliedAt: null,
    lastTestAt: null,
    lastTestResult: null,
    lastCycleAt: null,
    nextCycleAt: null,
    lastReceiveAt: null,
    lastReceiveCount: 0,
    lastSendAt: null,
    lastSendCount: 0,
    lastQueueCount: 0,
    lastRunSummary: null,
    lastError: null
  };
}

function getUserState(userId, config = null) {
  if (!userServiceState.has(userId)) {
    userServiceState.set(userId, getDefaultUserState(config));
  }
  return userServiceState.get(userId);
}

function setUserState(userId, updates = {}, config = null) {
  const current = getUserState(userId, config);
  const next = { ...current, ...updates };
  userServiceState.set(userId, next);
  return next;
}

function refreshServiceSummary() {
  serviceState = {
    ...serviceState,
    configured: activeConfigs.size > 0,
    configuredAccounts: activeConfigs.size,
    schedulerRunning: Boolean(schedulerHandle)
  };
}

function validateSettings(settings) {
  const errors = [];
  const accountType = String(settings?.account_type || "POP3").trim().toUpperCase();

  if (!settings) errors.push("Mail settings are missing.");
  if (!settings?.company_name) errors.push("Company name is required.");
  if (!settings?.email_address) errors.push("Email address is required.");
  if (!settings?.outgoing_server) errors.push("Outgoing server is required.");

  if (accountType === "GRAPH") {
    if (!settings?.graph_tenant_id) errors.push("Graph tenant id is required.");
    if (!settings?.graph_client_id) errors.push("Graph client id is required.");
    if (!settings?.graph_client_secret) errors.push("Graph client secret is required.");
    if (!settings?.graph_mailbox_user) errors.push("Graph mailbox user is required.");
  } else {
    if (!settings?.username) errors.push("Username is required.");
    if (!settings?.password) errors.push("Password is required.");
    if (!settings?.incoming_server) errors.push("Incoming server is required.");
    if (!Number.isInteger(Number(settings?.incoming_port)) || Number(settings?.incoming_port) <= 0) {
      errors.push("Incoming port must be a valid positive number.");
    }
  }
  if (!Number.isInteger(Number(settings?.outgoing_port)) || Number(settings?.outgoing_port) <= 0) {
    errors.push("Outgoing port must be a valid positive number.");
  }
  if (Number(settings?.auto_send_receive_minutes) <= 0 || isNaN(Number(settings?.auto_send_receive_minutes))) {
    errors.push("Auto send/receive minutes must be a valid positive number.");
  }
  if (!Number.isInteger(Number(settings?.remove_after_days)) || Number(settings?.remove_after_days) <= 0) {
    errors.push("Remove after days must be a valid positive number.");
  }

  return errors;
}

function isSmtpSecure(config) {
  return config.outgoing_encryption === "SSL/TLS" || Number(config.outgoing_port) === 465;
}

function getSmtpTransporter(config) {
  const key = getConfigKey(config);
  if (smtpTransporters.has(key)) {
    return smtpTransporters.get(key);
  }

  const transporterOptions = {
    host: config.outgoing_server,
    port: Number(config.outgoing_port),
    secure: isSmtpSecure(config),
    requireTLS: config.outgoing_encryption === "STARTTLS",
    tls: {
      rejectUnauthorized: false
    }
  };

  if (config.smtp_auth_required) {
    transporterOptions.auth = {
      user: config.username,
      pass: config.password
    };
  }

  const transporter = nodemailer.createTransport(transporterOptions);

  smtpTransporters.set(key, transporter);
  return transporter;
}

async function ensureActiveConfig(userId) {
  const numericUserId = Number(userId || 0);

  const existing = numericUserId ? activeConfigs.get(numericUserId) : null;
  if (existing) {
    // #region debug-point send-receive-auth:ensure-existing
    reportSendReceiveAuthDebug(
      "server/mailService.js:ensureActiveConfig:existing",
      "[DEBUG] using cached active config",
      {
        requestedUserId: numericUserId,
        configUserId: Number(existing?.user_id || 0),
        emailAddress: String(existing?.email_address || ""),
        username: String(existing?.username || ""),
        incomingServer: String(existing?.incoming_server || ""),
        incomingPort: Number(existing?.incoming_port || 0),
        incomingSsl: Boolean(existing?.incoming_ssl),
        outgoingServer: String(existing?.outgoing_server || ""),
        outgoingPort: Number(existing?.outgoing_port || 0),
        outgoingEncryption: String(existing?.outgoing_encryption || ""),
        hasPassword: Boolean(existing?.password)
      },
      "pre-fix",
      "H2"
    );
    // #endregion
    return existing;
  }

  if (numericUserId) {
    const savedSettings = await getMailSettingsForUser(numericUserId);
    // #region debug-point send-receive-auth:ensure-saved-settings
    reportSendReceiveAuthDebug(
      "server/mailService.js:ensureActiveConfig:savedSettings",
      "[DEBUG] loaded persisted settings for requested user",
      {
        requestedUserId: numericUserId,
        hasSavedSettings: Boolean(savedSettings),
        configUserId: Number(savedSettings?.user_id || 0),
        emailAddress: String(savedSettings?.email_address || ""),
        username: String(savedSettings?.username || ""),
        incomingServer: String(savedSettings?.incoming_server || ""),
        incomingPort: Number(savedSettings?.incoming_port || 0),
        incomingSsl: Boolean(savedSettings?.incoming_ssl),
        outgoingServer: String(savedSettings?.outgoing_server || ""),
        outgoingPort: Number(savedSettings?.outgoing_port || 0),
        outgoingEncryption: String(savedSettings?.outgoing_encryption || ""),
        hasPassword: Boolean(savedSettings?.password)
      },
      "pre-fix",
      "H2"
    );
    // #endregion
    if (savedSettings) {
      const validationErrors = validateSettings(sanitizeServiceConfig(savedSettings));
      if (validationErrors.length) {
        // #region debug-point send-receive-auth:ensure-invalid-user-settings
        reportSendReceiveAuthDebug(
          "server/mailService.js:ensureActiveConfig:invalidUserSettings",
          "[DEBUG] requested user settings are present but incomplete",
          {
            requestedUserId: numericUserId,
            configUserId: Number(savedSettings?.user_id || 0),
            emailAddress: String(savedSettings?.email_address || ""),
            username: String(savedSettings?.username || ""),
            hasPassword: Boolean(savedSettings?.password),
            validationErrors
          },
          "pre-fix",
          "H5"
        );
        // #endregion
        return null;
      }
      try {
        await applyMailSettings(savedSettings, numericUserId);
        const activated = activeConfigs.get(numericUserId) || null;
        if (activated) {
          return activated;
        }
      } catch {
        return null;
      }
    }
  }

  const fallback = activeConfigs.values().next().value || null;
  if (!numericUserId && fallback) {
    // #region debug-point send-receive-auth:ensure-fallback
    reportSendReceiveAuthDebug(
      "server/mailService.js:ensureActiveConfig:fallback",
      "[DEBUG] falling back to another active config",
      {
        requestedUserId: numericUserId,
        configUserId: Number(fallback?.user_id || 0),
        emailAddress: String(fallback?.email_address || ""),
        username: String(fallback?.username || "")
      },
      "pre-fix",
      "H2"
    );
    // #endregion
    return fallback;
  }

  if (numericUserId) {
    const savedSettings = await getMailSettingsForUser(numericUserId);
    if (savedSettings) {
      return null;
    }
  }

  // #region debug-point send-receive-auth:ensure-miss
  reportSendReceiveAuthDebug(
    "server/mailService.js:ensureActiveConfig:miss",
    "[DEBUG] no active config resolved",
    {
      requestedUserId: numericUserId,
      activeConfigCount: activeConfigs.size
    },
    "pre-fix",
    "H2"
  );
  // #endregion
  return null;
}

class Pop3Client {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = "";
    this.pending = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.pending = {
          multiline: false,
          resolve,
          reject
        };
      };

      this.socket = this.config.incoming_ssl
        ? tls.connect(
            {
              host: this.config.incoming_server,
              port: this.config.incoming_port,
              servername: this.config.incoming_server,
              rejectUnauthorized: false
            },
            onReady
          )
        : net.createConnection(
            {
              host: this.config.incoming_server,
              port: this.config.incoming_port
            },
            onReady
          );

      this.socket.setEncoding("utf8");
      this.socket.setTimeout(10000, () => {
        this.failPending(new Error("POP3 connection timed out."));
        this.socket?.destroy();
      });
      this.socket.on("data", (chunk) => this.consume(chunk));
      this.socket.on("error", (error) => this.failPending(error));
      this.socket.on("close", () => this.failPending(new Error("POP3 connection closed.")));
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    while (this.buffer.includes("\r\n")) {
      const index = this.buffer.indexOf("\r\n");
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.handleLine(line);
    }
  }

  handleLine(line) {
    if (!this.pending) {
      return;
    }

    if (!this.pending.multiline) {
      const pending = this.pending;
      this.pending = null;
      if (line.startsWith("+OK")) {
        pending.resolve(line.slice(3).trim());
      } else {
        pending.reject(new Error(line.replace(/^-ERR\s*/i, "") || "POP3 command failed."));
      }
      return;
    }

    if (!this.pending.receivedIntro) {
      if (!line.startsWith("+OK")) {
        const pending = this.pending;
        this.pending = null;
        pending.reject(new Error(line.replace(/^-ERR\s*/i, "") || "POP3 command failed."));
        return;
      }
      this.pending.receivedIntro = true;
      this.pending.message = line.slice(3).trim();
      return;
    }

    if (line === ".") {
      const pending = this.pending;
      this.pending = null;
      pending.resolve({
        message: pending.message,
        lines: pending.lines
      });
      return;
    }

    this.pending.lines.push(line.startsWith("..") ? line.slice(1) : line);
  }

  failPending(error) {
    if (!this.pending) {
      return;
    }
    const pending = this.pending;
    this.pending = null;
    pending.reject(error);
  }

  send(command, multiline = false) {
    return new Promise((resolve, reject) => {
      this.pending = multiline
        ? {
            multiline: true,
            lines: [],
            receivedIntro: false,
            message: "",
            resolve,
            reject
          }
        : { multiline: false, resolve, reject };
      this.socket.write(`${command}\r\n`);
    });
  }

  async login(username, password) {
    await this.send(`USER ${username}`);
    await this.send(`PASS ${password}`);
  }

  async uidl() {
    return this.send("UIDL", true);
  }

  async retrieve(messageNumber) {
    return this.send(`RETR ${messageNumber}`, true);
  }

  async delete(messageNumber) {
    return this.send(`DELE ${messageNumber}`);
  }

  async quit() {
    try {
      await this.send("QUIT");
    } finally {
      this.socket?.end();
      this.socket?.destroy();
    }
  }
}

function isImapAccount(config) {
  return String(config?.account_type || "").trim().toUpperCase() === "IMAP";
}

function createImapClient(config) {
  return new Imap({
    user: config.username,
    password: config.password,
    host: config.incoming_server,
    port: Number(config.incoming_port || 993),
    tls: Boolean(config.incoming_ssl),
    connTimeout: 20000,
    authTimeout: 15000,
    tlsOptions: {
      rejectUnauthorized: false
    }
  });
}

function connectImap(client) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handleReady = () => {
      if (settled) return;
      settled = true;
      client.removeListener("error", handleError);
      resolve();
    };
    const handleError = (error) => {
      if (settled) return;
      settled = true;
      client.removeListener("ready", handleReady);
      reject(error);
    };
    client.once("ready", handleReady);
    client.once("error", handleError);
    client.connect();
  });
}

function closeImap(client) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    client.once("end", finish);
    client.once("close", finish);
    try {
      client.end();
    } catch {
      finish();
      return;
    }
    setTimeout(finish, 1500);
  });
}

function openImapBox(client, boxName, readOnly = true) {
  return new Promise((resolve, reject) => {
    client.openBox(boxName, readOnly, (error, box) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(box);
    });
  });
}

function searchImap(client, criteria = ["ALL"]) {
  return new Promise((resolve, reject) => {
    client.search(criteria, (error, results) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(results || []);
    });
  });
}

function fetchImapMessages(client, sequenceNumbers = []) {
  if (!Array.isArray(sequenceNumbers) || !sequenceNumbers.length) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const messages = [];
    const fetcher = client.fetch(sequenceNumbers, {
      bodies: "",
      struct: true,
      markSeen: false
    });

    fetcher.on("message", (message) => {
      let attributes = {};
      const chunks = [];

      message.on("attributes", (attrs) => {
        attributes = attrs || {};
      });

      message.on("body", (stream) => {
        stream.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
      });

      message.once("end", () => {
        messages.push({
          attributes,
          rawEmail: Buffer.concat(chunks)
        });
      });
    });

    fetcher.once("error", reject);
    fetcher.once("end", () => resolve(messages));
  });
}

function isGraphAccount(config) {
  return String(config?.account_type || "").trim().toUpperCase() === "GRAPH";
}

function getConfiguredInboxFolder(config) {
  return String(config?.inbox_folder_name || "Inbox").trim() || "Inbox";
}

function getConfiguredSentFolder(config) {
  return String(config?.sent_folder_name || "Sent").trim() || "Sent";
}

function shouldSyncSentItems(config) {
  return Boolean(config?.sync_sent_items);
}

function normalizeTargetFolderName(folderKind = "inbox") {
  return folderKind === "sent" ? "Sent" : "Inbox";
}

function getGraphMailboxUser(config) {
  return String(config?.graph_mailbox_user || config?.email_address || "").trim();
}

function buildGraphTokenRequestBody(config) {
  return new URLSearchParams({
    client_id: String(config.graph_client_id || "").trim(),
    client_secret: String(config.graph_client_secret || "").trim(),
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
  });
}

async function acquireGraphAccessToken(config) {
  const tenantId = String(config.graph_tenant_id || "").trim();
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: buildGraphTokenRequestBody(config)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error?.message || "Unable to acquire Graph API token.");
  }

  return payload.access_token;
}

async function graphApiFetchJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Graph API request failed with ${response.status}.`);
  }
  return payload;
}

function getDefaultGraphFolderAlias(folderKind) {
  return folderKind === "sent" ? "sentitems" : "inbox";
}

function isDefaultGraphFolderName(folderName, folderKind) {
  const normalized = String(folderName || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (folderKind === "sent") {
    return ["sent", "sent items", "sentitems"].includes(normalized);
  }
  return ["inbox"].includes(normalized);
}

async function resolveGraphFolderId(accessToken, mailboxUser, folderName, folderKind = "inbox") {
  if (isDefaultGraphFolderName(folderName, folderKind)) {
    return getDefaultGraphFolderAlias(folderKind);
  }

  const encodedUser = encodeURIComponent(mailboxUser);
  const escapedName = String(folderName || "").replace(/'/g, "''");
  const filter = encodeURIComponent(`displayName eq '${escapedName}'`);
  const payload = await graphApiFetchJson(
    `https://graph.microsoft.com/v1.0/users/${encodedUser}/mailFolders?$filter=${filter}&$top=5`,
    accessToken
  );
  const match = (payload.value || [])[0];
  if (!match?.id) {
    throw new Error(`Graph mail folder "${folderName}" was not found.`);
  }
  return match.id;
}

function addressEntryFromGraphRecipient(recipient = {}) {
  return {
    name: recipient?.emailAddress?.name || "",
    address: recipient?.emailAddress?.address || ""
  };
}

function graphRecipientsToAddressObject(recipients = []) {
  return {
    value: (recipients || [])
      .map(addressEntryFromGraphRecipient)
      .filter((entry) => entry.address)
  };
}

function buildParsedMailFromGraphMessage(message = {}, attachments = []) {
  const bodyContentType = String(message.body?.contentType || "").toLowerCase();
  return {
    subject: message.subject || "Imported email",
    text: bodyContentType === "text" ? message.body?.content || message.bodyPreview || "" : message.bodyPreview || "",
    html: bodyContentType === "html" ? message.body?.content || "" : "",
    date: message.receivedDateTime || message.sentDateTime ? new Date(message.receivedDateTime || message.sentDateTime) : null,
    from: { value: [addressEntryFromGraphRecipient(message.from)] },
    to: graphRecipientsToAddressObject(message.toRecipients),
    cc: graphRecipientsToAddressObject(message.ccRecipients),
    attachments: attachments.map((attachment) => ({
      filename: attachment.name || "attachment.bin",
      content: Buffer.from(attachment.contentBytes || "", "base64"),
      contentType: attachment.contentType || "application/octet-stream",
      size: Number(attachment.size || 0),
      contentId: attachment.contentId || null,
      contentDisposition: attachment.isInline ? "inline" : "attachment",
      related: Boolean(attachment.isInline)
    }))
  };
}

async function listGraphMessagesForFolder(accessToken, mailboxUser, folderId, limit = 100) {
  const encodedUser = encodeURIComponent(mailboxUser);
  const encodedFolder = encodeURIComponent(folderId);
  const payload = await graphApiFetchJson(
    `https://graph.microsoft.com/v1.0/users/${encodedUser}/mailFolders/${encodedFolder}/messages?$top=${limit}&$select=id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,hasAttachments,isRead`,
    accessToken
  );
  return payload.value || [];
}

async function listGraphMessageAttachments(accessToken, mailboxUser, messageId) {
  const encodedUser = encodeURIComponent(mailboxUser);
  const encodedMessageId = encodeURIComponent(messageId);
  const payload = await graphApiFetchJson(
    `https://graph.microsoft.com/v1.0/users/${encodedUser}/messages/${encodedMessageId}/attachments?$top=50`,
    accessToken
  );
  return (payload.value || []).filter((attachment) => attachment["@odata.type"] === "#microsoft.graph.fileAttachment");
}

function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  serviceState.schedulerRunning = false;
  serviceState.nextCycleAt = null;
  for (const [userId, userState] of userServiceState.entries()) {
    userServiceState.set(userId, {
      ...userState,
      schedulerRunning: false,
      nextCycleAt: null
    });
  }
}

async function runSingleCycle(userId, config) {
  const userState = getUserState(userId, config);
  const now = new Date();

  try {
    // #region debug-point send-receive-sync:run-single-start
    reportSendReceiveSyncDebug(
      "server/mailService.js:runSingleCycle:start",
      "[DEBUG] sync runSingleCycle started",
      {
        userId: Number(userId || 0),
        configUserId: Number(config?.user_id || 0),
        emailAddress: String(config?.email_address || ""),
        username: String(config?.username || "")
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    // #region debug-point send-receive-auth:run-single-start
    reportSendReceiveAuthDebug(
      "server/mailService.js:runSingleCycle:start",
      "[DEBUG] runSingleCycle started",
      {
        userId: Number(userId || 0),
        configUserId: Number(config?.user_id || 0),
        emailAddress: String(config?.email_address || ""),
        username: String(config?.username || ""),
        incomingServer: String(config?.incoming_server || ""),
        incomingPort: Number(config?.incoming_port || 0),
        incomingSsl: Boolean(config?.incoming_ssl),
        outgoingServer: String(config?.outgoing_server || ""),
        outgoingPort: Number(config?.outgoing_port || 0),
        outgoingEncryption: String(config?.outgoing_encryption || ""),
        hasPassword: Boolean(config?.password),
        lastKnownError: String(userState?.lastError || "")
      },
      "pre-fix",
      "H4"
    );
    // #endregion
    const queueResult = await processOutboxQueue(config, userId);
    const receiveResult = await receiveEmailsOnce(config, userId);
    const result = {
      ...receiveResult,
      sent: queueResult.sent,
      queued: queueResult.queued
    };
    const nextCycleAt = new Date(Date.now() + backgroundFetchIntervalMinutes * 60 * 1000).toISOString();

    nextCycleByUser.set(userId, nextCycleAt ? new Date(nextCycleAt).getTime() : null);
    setUserState(
      userId,
      {
        configured: true,
        schedulerRunning: Boolean(schedulerHandle),
        auto_send_receive_minutes: backgroundFetchIntervalMinutes,
        lastCycleAt: now.toISOString(),
        lastReceiveAt: now.toISOString(),
        lastReceiveCount: result.received,
        lastSendAt: now.toISOString(),
        lastSendCount: result.sent,
        lastQueueCount: result.queued,
        lastRunSummary: `${result.sent} sent from Outbox, ${result.received} received, ${result.skipped} skipped`,
        lastError: null,
        nextCycleAt
      },
      config
    );

    serviceState = {
      ...serviceState,
      lastCycleAt: now.toISOString(),
      lastReceiveAt: now.toISOString(),
      lastReceiveCount: result.received,
      lastSendAt: now.toISOString(),
      lastSendCount: result.sent,
      lastQueueCount: result.queued,
      lastRunSummary: `Processed mailbox ${config.email_address}: ${result.sent} sent, ${result.received} received, ${result.skipped} skipped`,
      lastError: null
    };

    // #region debug-point send-receive-auth:run-single-success
    reportSendReceiveAuthDebug(
      "server/mailService.js:runSingleCycle:success",
      "[DEBUG] runSingleCycle completed",
      {
        userId: Number(userId || 0),
        sent: Number(result?.sent || 0),
        queued: Number(result?.queued || 0),
        received: Number(result?.received || 0),
        skipped: Number(result?.skipped || 0),
        deleted: Number(result?.deleted || 0)
      },
      "pre-fix",
      "H4"
    );
    // #endregion
    return result;
    // #region debug-point send-receive-sync:run-single-success
    reportSendReceiveSyncDebug(
      "server/mailService.js:runSingleCycle:success",
      "[DEBUG] sync runSingleCycle completed",
      {
        userId: Number(userId || 0),
        sent: Number(result?.sent || 0),
        queued: Number(result?.queued || 0),
        received: Number(result?.received || 0),
        skipped: Number(result?.skipped || 0),
        deleted: Number(result?.deleted || 0)
      },
      "pre-fix",
      "H1"
    );
    // #endregion
  } catch (error) {
    // #region debug-point send-receive-auth:run-single-error
    // #region debug-point send-receive-sync:run-single-error
    reportSendReceiveSyncDebug(
      "server/mailService.js:runSingleCycle:error",
      "[DEBUG] sync runSingleCycle failed",
      {
        userId: Number(userId || 0),
        configUserId: Number(config?.user_id || 0),
        message: String(error?.message || "")
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    reportSendReceiveAuthDebug(
      "server/mailService.js:runSingleCycle:error",
      "server/mailService.js:runSingleCycle:error",
      "[DEBUG] runSingleCycle failed",
      {
        userId: Number(userId || 0),
        configUserId: Number(config?.user_id || 0),
        emailAddress: String(config?.email_address || ""),
        username: String(config?.username || ""),
        name: String(error?.name || ""),
        message: String(error?.message || "")
      },
      "pre-fix",
      "H4"
    );
    // #endregion
    setUserState(
      userId,
      {
        lastCycleAt: now.toISOString(),
        lastError: error.message
      },
      config
    );
    serviceState = {
      ...serviceState,
      lastCycleAt: now.toISOString(),
      lastError: error.message
    };
    throw error;
  }
}

async function runCycle(userId = null) {
  const numericUserId = userId ? Number(userId) : null;
  const inFlightForRequest = numericUserId
    ? cycleInFlightByUser.get(numericUserId)
    : globalCycleInFlight;

  if (userId) {
    // #region debug-point send-receive-auth:run-cycle-entry
    reportSendReceiveAuthDebug(
      "server/mailService.js:runCycle:entry",
      "[DEBUG] runCycle requested for user",
      {
        requestedUserId: numericUserId,
        activeConfigCount: activeConfigs.size,
        hasCycleInFlight: Boolean(inFlightForRequest)
      },
      "pre-fix",
      "H4"
    );
    // #endregion
    const ensuredConfig = await ensureActiveConfig(numericUserId);
    if (!ensuredConfig) {
      // #region debug-point send-receive-auth:run-cycle-no-config
      reportSendReceiveAuthDebug(
        "server/mailService.js:runCycle:noConfig",
        "[DEBUG] runCycle exited because no config was resolved for requested user",
        {
          requestedUserId: numericUserId,
          activeConfigCount: activeConfigs.size
        },
        "pre-fix",
        "H5"
      );
      // #endregion
      throw new Error("Mail settings are not configured for this account. Open Settings and save this user's mailbox credentials first.");
    }
  }

  if (!activeConfigs.size) {
    return {
      sent: 0,
      received: 0,
      queued: 0,
      skipped: 0
    };
  }

  if (numericUserId) {
    if (inFlightForRequest) {
      return inFlightForRequest;
    }

    const userCycle = (async () => {
      try {
        const config = activeConfigs.get(numericUserId) || await ensureActiveConfig(numericUserId);
        if (!config) {
          throw new Error("Mail settings are not configured for this account. Open Settings and save this user's mailbox credentials first.");
        }
        return await runSingleCycle(numericUserId, config);
      } finally {
        cycleInFlightByUser.delete(numericUserId);
      }
    })();

    cycleInFlightByUser.set(numericUserId, userCycle);
    return userCycle;
  }

  if (globalCycleInFlight) {
    return globalCycleInFlight;
  }

  globalCycleInFlight = (async () => {
    try {
      const totals = { sent: 0, received: 0, queued: 0, skipped: 0, deleted: 0 };
      for (const [configuredUserId, config] of activeConfigs.entries()) {
        const result = await runSingleCycle(configuredUserId, config);
        totals.sent += result.sent || 0;
        totals.received += result.received || 0;
        totals.queued += result.queued || 0;
        totals.skipped += result.skipped || 0;
        totals.deleted += result.deleted || 0;
      }
      return totals;
    } finally {
      globalCycleInFlight = null;
    }
  })();

  return globalCycleInFlight;
}

async function syncEmailAccounts(userId = null) {
  try {
    const { getUserById } = await import("./database.js");
    const users = userId ? [await getUserById(userId)] : (await import("./database.js")).then(m => m.getAllAdminUsers ? m.getAllAdminUsers() : []).catch(() => []);

    for (const user of (Array.isArray(users) ? users : [])) {
      if (!user || !user.id) continue;
      const accounts = await getUserActiveAccounts(user.id);
      for (const account of accounts) {
        const configKey = `account_${account.id}`;
        if (!activeConfigs.has(account.id)) {
          const config = {
            user_id: user.id,
            account_id: account.id,
            email_address: account.email_address,
            display_name: account.display_name,
            account_type: account.imap_host ? "IMAP" : "POP3",
            username: account.imap_username || account.pop3_username || account.email_address,
            password: account.imap_password || account.pop3_password || "",
            incoming_server: account.imap_host || account.pop3_host || "",
            incoming_port: account.imap_port || account.pop3_port || 993,
            incoming_ssl: account.imap_ssl || account.pop3_ssl || true,
            outgoing_server: account.smtp_host || "",
            outgoing_port: account.smtp_port || 587,
            outgoing_ssl: account.smtp_ssl || true,
            outgoing_username: account.smtp_username || account.email_address,
            outgoing_password: account.smtp_password || "",
            company_name: user.company_name || "TECHNO Group"
          };
          activeConfigs.set(account.id, config);
        }
      }
    }
  } catch (e) {
    console.error("Failed to sync email accounts:", e.message);
  }
}

async function runFullMailSyncAllAccounts() {
  await syncEmailAccounts();
  if (!activeConfigs.size) {
    return {
      totals: { sent: 0, received: 0, queued: 0, skipped: 0, deleted: 0, accounts: 0 },
      accounts: []
    };
  }

  if (globalCycleInFlight) {
    const totals = await globalCycleInFlight;
    return {
      totals: {
        sent: totals.sent || 0,
        received: totals.received || 0,
        queued: totals.queued || 0,
        skipped: totals.skipped || 0,
        deleted: totals.deleted || 0,
        accounts: activeConfigs.size
      },
      accounts: []
    };
  }

  globalCycleInFlight = (async () => {
    try {
      const totals = { sent: 0, received: 0, queued: 0, skipped: 0, deleted: 0, accounts: 0 };
      const accounts = [];

      for (const [configuredUserId, config] of activeConfigs.entries()) {
        try {
          const result = await runSingleCycle(configuredUserId, config);
          totals.sent += result.sent || 0;
          totals.received += result.received || 0;
          totals.queued += result.queued || 0;
          totals.skipped += result.skipped || 0;
          totals.deleted += result.deleted || 0;
          totals.accounts += 1;
          accounts.push({
            user_id: configuredUserId,
            email_address: config.email_address || "",
            account_type: config.account_type || "POP3",
            ok: true,
            ...result
          });
        } catch (error) {
          totals.accounts += 1;
          accounts.push({
            user_id: configuredUserId,
            email_address: config.email_address || "",
            account_type: config.account_type || "POP3",
            ok: false,
            error: error.message || "Full sync failed for this account."
          });
        }
      }

      return { totals, accounts };
    } finally {
      globalCycleInFlight = null;
    }
  })();

  return globalCycleInFlight;
}

function startScheduler() {
  stopScheduler();

  if (!activeConfigs.size) {
    refreshServiceSummary();
    return;
  }

  const now = Date.now();
  for (const [userId, config] of activeConfigs.entries()) {
    const dueAt = now;
    nextCycleByUser.set(userId, dueAt);
    setUserState(
      userId,
      {
        configured: true,
        schedulerRunning: true,
        auto_send_receive_minutes: backgroundFetchIntervalMinutes,
        nextCycleAt: new Date(dueAt).toISOString()
      },
      config
    );
  }

  schedulerHandle = setInterval(() => {
    const tickNow = Date.now();
    for (const [userId, config] of activeConfigs.entries()) {
      const dueAt = nextCycleByUser.get(userId) || 0;
      if (dueAt <= tickNow) {
        runCycle(userId).catch((error) => {
          setUserState(userId, { lastError: error.message }, config);
          serviceState = { ...serviceState, lastError: error.message };
        });
      }
    }
  }, 15 * 1000);

  for (const [userId] of activeConfigs.entries()) {
    runCycle(userId).catch(() => {});
  }

  refreshServiceSummary();
}

async function applyMailSettings(settings, userId = null) {
  const normalized = sanitizeServiceConfig(settings);
  const errors = validateSettings(normalized);

  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  const effectiveUserId = Number(userId || normalized.user_id);
  if (!effectiveUserId) {
    throw new Error("Mail settings must be associated with a user.");
  }

  normalized.user_id = effectiveUserId;
  activeConfigs.set(effectiveUserId, normalized);
  getSmtpTransporter(normalized);
  const nextCycleAt = new Date(Date.now() + backgroundFetchIntervalMinutes * 60 * 1000).toISOString();
  nextCycleByUser.set(effectiveUserId, nextCycleAt ? new Date(nextCycleAt).getTime() : null);
  setUserState(
    effectiveUserId,
    {
      configured: true,
      auto_send_receive_minutes: backgroundFetchIntervalMinutes,
      lastAppliedAt: new Date().toISOString(),
      lastError: null,
      nextCycleAt
    },
    normalized
  );
  serviceState = {
    ...serviceState,
    configured: true,
    configuredAccounts: activeConfigs.size,
    auto_send_receive_minutes: backgroundFetchIntervalMinutes,
    lastAppliedAt: new Date().toISOString(),
    lastError: null
  };

  startScheduler();

  return getMailServiceStatus(effectiveUserId);
}

async function applyAllMailSettings(settingsList = []) {
  activeConfigs.clear();
  smtpTransporters.clear();
  nextCycleByUser.clear();
  userServiceState.clear();
  cycleInFlightByUser.clear();
  globalCycleInFlight = null;

  for (const settings of settingsList) {
    const normalized = sanitizeServiceConfig(settings);
    const errors = validateSettings(normalized);
    if (!errors.length && normalized.user_id) {
      activeConfigs.set(Number(normalized.user_id), normalized);
      getSmtpTransporter(normalized);
      setUserState(Number(normalized.user_id), {
        configured: true,
        auto_send_receive_minutes: backgroundFetchIntervalMinutes
      }, normalized);
    }
  }

  refreshServiceSummary();
  startScheduler();
  return getMailServiceStatus();
}

async function verifyPop3Connection(config) {
  const client = new Pop3Client(config);
  try {
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("verifyPop3Connection.start", {
      user_id: config?.user_id || null,
      incoming_server: config?.incoming_server || "",
      incoming_port: Number(config?.incoming_port || 0),
      incoming_ssl: Boolean(config?.incoming_ssl),
      username: config?.username || "",
      email_address: config?.email_address || ""
    });
    // #endregion
    await client.connect();
    await client.login(config.username, config.password);
    await client.quit();
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("verifyPop3Connection.success", {
      user_id: config?.user_id || null,
      incoming_server: config?.incoming_server || "",
      incoming_port: Number(config?.incoming_port || 0)
    });
    // #endregion
    return { ok: true };
  } catch (error) {
    try {
      await client.quit();
    } catch {
      // ignore cleanup failures
    }
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("verifyPop3Connection.error", {
      user_id: config?.user_id || null,
      incoming_server: config?.incoming_server || "",
      incoming_port: Number(config?.incoming_port || 0),
      name: error?.name,
      message: error?.message
    });
    // #endregion
    return { ok: false, error: error.message };
  }
}

async function testMailSettings(settings) {
  const normalized = sanitizeServiceConfig(settings);
  const errors = validateSettings(normalized);
  const effectiveUserId = Number(settings?.user_id || normalized.user_id || 0) || null;

  // #region debug-point connection-test-failed
  reportConnectionTestDebug("testMailSettings.start", {
    requested_user_id: settings?.user_id || null,
    effective_user_id: effectiveUserId,
    company_name: normalized?.company_name || "",
    display_name: normalized?.display_name || "",
    email_address: normalized?.email_address || "",
    username: normalized?.username || "",
    incoming_server: normalized?.incoming_server || "",
    incoming_port: Number(normalized?.incoming_port || 0),
    incoming_ssl: Boolean(normalized?.incoming_ssl),
    outgoing_server: normalized?.outgoing_server || "",
    outgoing_port: Number(normalized?.outgoing_port || 0),
    outgoing_encryption: normalized?.outgoing_encryption || "",
    has_password: Boolean(normalized?.password)
  });
  // #endregion

  if (errors.length) {
    const failedResult = { ok: false, errors };
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("testMailSettings.validationFailed", {
      effective_user_id: effectiveUserId,
      errors
    });
    // #endregion
    serviceState.lastTestAt = new Date().toISOString();
    serviceState.lastTestResult = failedResult;
    if (effectiveUserId) {
      setUserState(effectiveUserId, {
        lastTestAt: serviceState.lastTestAt,
        lastTestResult: failedResult
      }, normalized);
    }
    return failedResult;
  }

  const incomingResult = isGraphAccount(normalized)
    ? await verifyGraphConnection(normalized)
    : isImapAccount(normalized)
      ? await verifyImapConnection(normalized)
      : await verifyPop3Connection(normalized);
  let outgoingResult;
  try {
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("testMailSettings.smtpVerify.start", {
      effective_user_id: effectiveUserId,
      outgoing_server: normalized?.outgoing_server || "",
      outgoing_port: Number(normalized?.outgoing_port || 0),
      outgoing_encryption: normalized?.outgoing_encryption || "",
      username: normalized?.username || "",
      email_address: normalized?.email_address || ""
    });
    // #endregion
    await getSmtpTransporter(normalized).verify();
    outgoingResult = { ok: true };
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("testMailSettings.smtpVerify.success", {
      effective_user_id: effectiveUserId,
      outgoing_server: normalized?.outgoing_server || "",
      outgoing_port: Number(normalized?.outgoing_port || 0)
    });
    // #endregion
  } catch (error) {
    outgoingResult = { ok: false, error: error.message };
    // #region debug-point connection-test-failed
    reportConnectionTestDebug("testMailSettings.smtpVerify.error", {
      effective_user_id: effectiveUserId,
      outgoing_server: normalized?.outgoing_server || "",
      outgoing_port: Number(normalized?.outgoing_port || 0),
      name: error?.name,
      message: error?.message
    });
    // #endregion
  }

  const ok = incomingResult.ok && outgoingResult.ok;
  const result = {
    ok,
    incoming: incomingResult,
    outgoing: outgoingResult
  };

  serviceState.lastTestAt = new Date().toISOString();
  serviceState.lastTestResult = result;
  serviceState.lastError = ok
    ? null
    : incomingResult.error || outgoingResult.error || "Connection test failed.";

  if (effectiveUserId) {
    setUserState(effectiveUserId, {
      configured: true,
      auto_send_receive_minutes: normalized.auto_send_receive_minutes,
      lastTestAt: serviceState.lastTestAt,
      lastTestResult: result,
      lastError: serviceState.lastError
    }, normalized);
  }

  // #region debug-point connection-test-failed
  reportConnectionTestDebug("testMailSettings.result", {
    effective_user_id: effectiveUserId,
    ok,
    incoming: incomingResult,
    outgoing: outgoingResult
  });
  // #endregion

  return result;
}

function plainTextFromMail(parsed) {
  const text = parsed.text || parsed.html || "";
  return String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function htmlFromMail(parsed, attachments = []) {
  let html = parsed.html || parsed.textAsHtml || "";
  html = typeof html === "string" ? html.trim() : "";

  for (const attachment of attachments || []) {
    const rawContentId = String(attachment.contentId || attachment.content_id || "").trim();
    const normalizedContentId = rawContentId.replace(/^<|>$/g, "");
    const publicPath = attachment.publicPath || attachment.file_path || "";
    if (!normalizedContentId || !publicPath) {
      continue;
    }
    const cidPattern = new RegExp(`(["'(])cid:${normalizedContentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["')])`, "gi");
    html = html.replace(cidPattern, `$1${publicPath}$2`);
    html = html.replace(new RegExp(`cid:${normalizedContentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"), publicPath);
  }

  return html;
}

function addressListToString(addressObject) {
  return (addressObject?.value || [])
    .map((entry) => (entry.name ? `${entry.name} <${entry.address}>` : entry.address))
    .filter(Boolean)
    .join(", ");
}

function shouldDeleteFromServer(existingEmail, config, messageDate) {
  if (!config.leave_copy_on_server) {
    return true;
  }

  if (config.remove_when_deleted && existingEmail?.folder_name === "Deleted") {
    return true;
  }

  if (config.remove_after_days > 0 && messageDate) {
    const ageMs = Date.now() - new Date(messageDate).getTime();
    return ageMs >= config.remove_after_days * 24 * 60 * 60 * 1000;
  }

  return false;
}

async function saveParsedAttachments(parsed) {
  const saved = [];

  for (const attachment of parsed.attachments || []) {
    const safeName = `${Date.now()}-${crypto.randomUUID()}-${attachment.filename || "attachment.bin"}`;
    const diskPath = path.join(uploadsDir, safeName);
    fs.writeFileSync(diskPath, attachment.content);
    saved.push({
      originalname: attachment.filename || safeName,
      path: diskPath,
      publicPath: `/uploads/${safeName}`,
      mimetype: attachment.contentType || "application/octet-stream",
      size: attachment.size || attachment.content.length,
      contentId: String(attachment.contentId || "").replace(/^<|>$/g, "") || null,
      isInline: Boolean(attachment.contentDisposition === "inline" || attachment.related)
    });
  }

  return saved;
}

async function identifyProject(parsed) {
  const sender = parsed.from?.value?.[0] || {};
  const textBody = plainTextFromMail(parsed);
  const htmlBody = htmlFromMail(parsed, []);
  const messageId = parsed.messageId || parsed.headers?.get("message-id") || null;
  const inReplyTo = parsed.inReplyTo || parsed.headers?.get("in-reply-to") || null;
  const referencesHeader = parsed.references || parsed.headers?.get("references") || null;

  // Level 1: Hidden Footer (System-Ref) - HIGHEST PRIORITY
  const hiddenRef = extractHiddenRef(htmlBody, textBody);
  if (hiddenRef && hiddenRef.project_code && hiddenRef.project_code !== "UNSPECIFIED") {
    const keyResult = await query("SELECT id, key_code FROM email_keys WHERE key_code ILIKE $1", [hiddenRef.project_code]);
    const projResult = await query("SELECT id, project_code FROM projects WHERE project_code ILIKE $1", [hiddenRef.project_code]);
    if (projResult.rows.length) {
      return {
        source: "hidden_footer",
        project_id: projResult.rows[0].id,
        project_code: projResult.rows[0].project_code,
        key_id: keyResult.rows.length ? keyResult.rows[0].id : null,
        key_code: keyResult.rows.length ? keyResult.rows[0].key_code : null,
        confidence: "high"
      };
    }
  }

  // Level 2: In-Reply-To / References chain
  const replyChain = inReplyTo || (referencesHeader && referencesHeader.split(/\s+/)[0]) || null;
  if (replyChain) {
    try {
      const chainResult = await query(
        `SELECT email_key_id, project_id FROM emails
         WHERE external_message_id = $1
            OR $1 = ANY(string_to_array(references_header, ' '))
         LIMIT 1`,
        [replyChain]
      );
      if (chainResult.rows.length) {
        const original = chainResult.rows[0];
        let projectCode = null;
        let keyCode = null;
        if (original.project_id) {
          const p = await query("SELECT project_code FROM projects WHERE id = $1", [original.project_id]);
          if (p.rows.length) projectCode = p.rows[0].project_code;
        }
        if (original.email_key_id) {
          const k = await query("SELECT key_code FROM email_keys WHERE id = $1", [original.email_key_id]);
          if (k.rows.length) keyCode = k.rows[0].key_code;
        }
        if (original.project_id || original.email_key_id) {
          return {
            source: "in_reply_to",
            project_id: original.project_id || null,
            project_code: projectCode,
            key_id: original.email_key_id || null,
            key_code: keyCode,
            confidence: "high"
          };
        }
      }
    } catch (e) { /* chain lookup failed, continue to level 3 */ }
  }

  // Level 3: Subject Regex
  const subjectMeta = await parseSubjectForMetadata(parsed.subject || "");
  if (subjectMeta.project_code) {
    const projResult = await query("SELECT id, project_code FROM projects WHERE project_code ILIKE $1", [subjectMeta.project_code]);
    const keyResult = subjectMeta.key_code
      ? await query("SELECT id, key_code FROM email_keys WHERE key_code ILIKE $1", [subjectMeta.key_code])
      : { rows: [] };
    return {
      source: "subject_regex",
      project_id: projResult.rows.length ? projResult.rows[0].id : null,
      project_code: projResult.rows.length ? projResult.rows[0].project_code : subjectMeta.project_code,
      key_id: keyResult.rows.length ? keyResult.rows[0].id : null,
      key_code: keyResult.rows.length ? keyResult.rows[0].key_code : subjectMeta.key_code,
      confidence: projResult.rows.length && keyResult.rows.length ? "medium" : "low"
    };
  }

  // Level 4: No match - UNCATEGORIZED
  return {
    source: "none",
    project_id: null,
    project_code: null,
    key_id: null,
    key_code: null,
    confidence: "none"
  };
}

async function archiveIncomingParsedEmail({
  parsed,
  attachments = [],
  externalId,
  ownerUserId = null,
  provider = "pop3",
  sourceFolder = "Inbox",
  targetFolderName = "Inbox",
  messageStatus = "Received",
  isRead = false,
  sentAt = null,
  forceOwnerUser = false
}) {
  const sender = parsed.from?.value?.[0] || {};
  const textBody = plainTextFromMail(parsed);
  const htmlBody = htmlFromMail(parsed, attachments);
  const receivedAt = parsed.date?.toISOString?.() || new Date().toISOString();
  const toLine = addressListToString(parsed.to);
  const ccLine = addressListToString(parsed.cc);
  const recipientEmail = parsed.to?.value?.[0]?.address || "";
  const recipientUser = recipientEmail ? await getUserByEmail(recipientEmail) : null;
  const effectiveEmployeeId = ownerUserId || recipientUser?.id || null;

  const messageId = parsed.messageId || parsed.headers?.get("message-id") || null;
  const inReplyTo = parsed.inReplyTo || parsed.headers?.get("in-reply-to") || null;
  const referencesHeader = parsed.references || parsed.headers?.get("references") || null;
  const xSerial = parsed.headers?.get("x-company-serial") || null;

  let serial = null;
  let subjectKey = null;

  if (xSerial) {
    serial = xSerial;
    const keyParts = serial.split("-");
    if (keyParts.length >= 2) subjectKey = keyParts[0];
  }

  if (!serial) {
    const subject = parsed.subject || "";
    const serialMatch = subject.match(/\[REF:\s*([^\]]+)\]/i);
    if (serialMatch) {
      serial = serialMatch[1].trim();
      const keyParts = serial.split("-");
      if (keyParts.length >= 2) subjectKey = keyParts[0];
    }
  }

  if (!serial && (inReplyTo || referencesHeader)) {
    serial = await resolveSerialFromHeaders(messageId, inReplyTo, referencesHeader);
    if (serial) {
      const keyParts = serial.split("-");
      if (keyParts.length >= 2) subjectKey = keyParts[0];
    }
  }

  if (!serial) {
    const serialInfo = await createSerialFromSubjectKey(parsed.subject || "Imported email", "", parsed.date || new Date());
    serial = serialInfo.serial;
    subjectKey = serialInfo.subjectKey;
  }

  const inboundAnalysis = await analyzeIncomingEmail({
    subject: parsed.subject || "Imported email",
    body: textBody || parsed.textAsHtml || parsed.html || "",
    senderEmail: sender.address || "",
    recipientEmail: toLine,
    ccList: ccLine,
    attachmentNames: attachments.map((attachment) => attachment.originalname || "")
  });

  const projectMatch = await identifyProject(parsed);
  const emailKeyId = projectMatch.key_id || null;
  const projectId = projectMatch.project_id || null;
  const targetFolder = projectMatch.confidence === "none" ? "Uncategorized" : targetFolderName;

  await ensureFolder("Uncategorized", "Archive", 0);

  const archivedEmail = await createEmail(
    {
      folder_name: targetFolder,
      serial: serial,
      sender_name: sender.name || sender.address || "Unknown Sender",
      sender_email: sender.address || "unknown@emailarray.local",
      recipient_name: parsed.to?.value?.[0]?.name || "",
      recipient_email: toLine,
      cc_list: ccLine || null,
      subject: parsed.subject || "Imported email",
      body: textBody || "No message body.",
      body_html: htmlBody || null,
      preview: String(textBody || "").slice(0, 120),
      received_at: receivedAt,
      sent_at: sentAt || null,
      priority: "Normal",
      status: messageStatus,
      recommendation: inboundAnalysis.recommendations.length
        ? inboundAnalysis.recommendations.join(" ")
        : "Received from background mailbox sync and archived automatically.",
      report_status: "Processed by background sync",
      external_message_id: externalId,
      is_read: Boolean(isRead),
      subject_key: subjectKey,
      email_key_id: emailKeyId,
      project_id: projectId,
      ai_sentiment: inboundAnalysis.sentiment,
      ai_tone_score: inboundAnalysis.tone_score,
      ai_recommendations: inboundAnalysis.recommendations.join("\n"),
      ai_provider: inboundAnalysis.provider || "rules",
      risk_level: inboundAnalysis.risk_level || "low",
      risk_flags: (inboundAnalysis.risk_flags || []).join(","),
      last_action_at: new Date().toISOString()
    },
    attachments,
    provider,
    effectiveEmployeeId
  );

  if (messageId && archivedEmail) {
    await trackEmailThread(messageId, inReplyTo, referencesHeader, serial, archivedEmail.id, parsed.subject || "", sender.address || "");
  }

  const auditUserId = effectiveEmployeeId;
  if (auditUserId && sender.address) {
    await upsertRecentContact(auditUserId, sender.address, sender.name || "");
  }
  await logEmailTrail(
    archivedEmail.id,
    auditUserId,
    "Incoming Received",
    JSON.stringify({
      provider,
      external_message_id: externalId,
      source_folder: sourceFolder,
      received_at: receivedAt,
      attachment_count: attachments.length
    })
  );
  await logEmailTrail(
    archivedEmail.id,
    auditUserId,
    "Incoming Processed",
    JSON.stringify({
      processed_at: new Date().toISOString(),
      serial: archivedEmail.serial,
      subject_key: archivedEmail.subject_key || serialInfo.subjectKey,
      ai_provider: archivedEmail.ai_provider || inboundAnalysis.provider || "rules",
      risk_level: archivedEmail.risk_level || inboundAnalysis.risk_level || "low",
      risk_flags: archivedEmail.risk_flags || (inboundAnalysis.risk_flags || []).join(","),
      project_match_source: projectMatch.source,
      project_match_confidence: projectMatch.confidence,
      project_code: projectMatch.project_code,
      key_code: projectMatch.key_code
    })
  );

  if (projectId && archivedEmail.id) {
    try {
      const project = await query("SELECT * FROM projects WHERE id = $1", [projectId]);
      if (project.rows.length) {
        await createTask({
          email_id: archivedEmail.id,
          project_id: projectId,
          assigned_to: project.rows[0].project_manager_id || effectiveEmployeeId,
          created_by: effectiveEmployeeId,
          title: `Review: ${parsed.subject || "New email"}`,
          description: `Incoming email from ${sender.address || "unknown"} regarding project ${project.rows[0].project_code}`,
          task_type: "email_review",
          status: "pending",
          priority: "medium",
          due_date: null
        });
      }
    } catch (taskError) { /* auto-task creation optional */ }
  }

  return archivedEmail;
}

async function verifyImapConnection(config) {
  const client = createImapClient(config);
  try {
    reportConnectionTestDebug("verifyImapConnection.start", {
      user_id: config?.user_id || null,
      incoming_server: config?.incoming_server || "",
      incoming_port: Number(config?.incoming_port || 0),
      incoming_ssl: Boolean(config?.incoming_ssl),
      username: config?.username || "",
      email_address: config?.email_address || ""
    });
    await connectImap(client);
    await openImapBox(client, getConfiguredInboxFolder(config), true);
    await closeImap(client);
    reportConnectionTestDebug("verifyImapConnection.success", {
      user_id: config?.user_id || null,
      incoming_server: config?.incoming_server || "",
      incoming_port: Number(config?.incoming_port || 0)
    });
    return { ok: true };
  } catch (error) {
    try {
      await closeImap(client);
    } catch {}
    reportConnectionTestDebug("verifyImapConnection.error", {
      user_id: config?.user_id || null,
      incoming_server: config?.incoming_server || "",
      incoming_port: Number(config?.incoming_port || 0),
      name: error?.name,
      message: error?.message
    });
    return { ok: false, error: error.message };
  }
}

async function verifyGraphConnection(config) {
  try {
    reportConnectionTestDebug("verifyGraphConnection.start", {
      user_id: config?.user_id || null,
      mailbox_user: getGraphMailboxUser(config),
      tenant_id: String(config?.graph_tenant_id || "")
    });
    const accessToken = await acquireGraphAccessToken(config);
    const mailboxUser = getGraphMailboxUser(config);
    const inboxFolderId = await resolveGraphFolderId(accessToken, mailboxUser, getConfiguredInboxFolder(config), "inbox");
    await listGraphMessagesForFolder(accessToken, mailboxUser, inboxFolderId, 1);
    reportConnectionTestDebug("verifyGraphConnection.success", {
      user_id: config?.user_id || null,
      mailbox_user: mailboxUser
    });
    return { ok: true };
  } catch (error) {
    reportConnectionTestDebug("verifyGraphConnection.error", {
      user_id: config?.user_id || null,
      mailbox_user: getGraphMailboxUser(config),
      name: error?.name,
      message: error?.message
    });
    return { ok: false, error: error.message };
  }
}

async function receivePop3EmailsOnce(config, ownerUserId = null) {
  if (!config) {
    throw new Error("Mail service has not been configured.");
  }

  await ensureFolder("Inbox", "Inbox", 0);
  const client = new Pop3Client(config);
  let received = 0;
  let skipped = 0;
  let deleted = 0;
  const deletions = [];

  try {
    // #region debug-point send-receive-sync:receive-start
    reportSendReceiveSyncDebug(
      "server/mailService.js:receiveEmailsOnce:start",
      "[DEBUG] sync POP3 receive started",
      {
        ownerUserId: Number(ownerUserId || 0),
        configUserId: Number(config?.user_id || 0),
        emailAddress: String(config?.email_address || ""),
        username: String(config?.username || ""),
        incomingServer: String(config?.incoming_server || ""),
        incomingPort: Number(config?.incoming_port || 0)
      },
      "pre-fix",
      "H3"
    );
    // #endregion
    // #region debug-point send-receive-auth:receive-start
    reportSendReceiveAuthDebug(
      "server/mailService.js:receiveEmailsOnce:start",
      "[DEBUG] POP3 receive started",
      {
        ownerUserId: Number(ownerUserId || 0),
        configUserId: Number(config?.user_id || 0),
        emailAddress: String(config?.email_address || ""),
        username: String(config?.username || ""),
        incomingServer: String(config?.incoming_server || ""),
        incomingPort: Number(config?.incoming_port || 0),
        incomingSsl: Boolean(config?.incoming_ssl),
        hasPassword: Boolean(config?.password)
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    await client.connect();
    // #region debug-point send-receive-auth:receive-connected
    reportSendReceiveAuthDebug(
      "server/mailService.js:receiveEmailsOnce:connected",
      "[DEBUG] POP3 socket connected",
      {
        ownerUserId: Number(ownerUserId || 0),
        incomingServer: String(config?.incoming_server || ""),
        incomingPort: Number(config?.incoming_port || 0),
        incomingSsl: Boolean(config?.incoming_ssl)
      },
      "pre-fix",
      "H3"
    );
    // #endregion
    await client.login(config.username, config.password);
    // #region debug-point send-receive-auth:receive-login-success
    reportSendReceiveAuthDebug(
      "server/mailService.js:receiveEmailsOnce:loginSuccess",
      "[DEBUG] POP3 login succeeded",
      {
        ownerUserId: Number(ownerUserId || 0),
        username: String(config?.username || ""),
        emailAddress: String(config?.email_address || "")
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    const uidl = await client.uidl();
    // #region debug-point send-receive-sync:uidl
    reportSendReceiveSyncDebug(
      "server/mailService.js:receiveEmailsOnce:uidl",
      "[DEBUG] sync POP3 UIDL retrieved",
      {
        ownerUserId: Number(ownerUserId || 0),
        totalMessages: Number(uidl?.lines?.length || 0)
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    // #region debug-point send-receive-auth:receive-uidl
    reportSendReceiveAuthDebug(
      "server/mailService.js:receiveEmailsOnce:uidl",
      "[DEBUG] POP3 UIDL retrieved",
      {
        ownerUserId: Number(ownerUserId || 0),
        totalMessages: Number(uidl?.lines?.length || 0)
      },
      "pre-fix",
      "H4"
    );
    // #endregion
    const messageEntries = uidl.lines
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2)
      .map(([messageNumber, uid]) => ({
        messageNumber: Number(messageNumber),
        uid
      }));

    for (const entry of messageEntries) {
      const externalId = `pop3:${entry.uid}`;
      const existingEmail = await getEmailByExternalMessageId(externalId);
      if (existingEmail) {
        // #region debug-point send-receive-sync:duplicate-skip
        reportSendReceiveSyncDebug(
          "server/mailService.js:receiveEmailsOnce:duplicateSkip",
          "[DEBUG] sync skipped existing POP3 message",
          {
            ownerUserId: Number(ownerUserId || 0),
            externalId,
            existingEmailId: Number(existingEmail?.id || 0),
            existingEmployeeId: Number(existingEmail?.employee_id || 0),
            existingFolder: String(existingEmail?.folder_name || "")
          },
          "pre-fix",
          "H5"
        );
        // #endregion
        if (shouldDeleteFromServer(existingEmail, config, existingEmail.received_at)) {
          deletions.push(entry.messageNumber);
        }
        skipped += 1;
        continue;
      }

      const retr = await client.retrieve(entry.messageNumber);
      const rawEmail = retr.lines.join("\r\n");
      const parsed = await simpleParser(rawEmail);
      const attachments = await saveParsedAttachments(parsed);

      // #region debug-point send-receive-sync:import-candidate
      reportSendReceiveSyncDebug(
        "server/mailService.js:receiveEmailsOnce:importCandidate",
        "[DEBUG] sync importing POP3 message",
        {
          ownerUserId: Number(ownerUserId || 0),
          externalId,
          senderEmail: String(parsed.from?.value?.[0]?.address || ""),
          recipientEmail: String(parsed.to?.value?.[0]?.address || ""),
          fallbackOwnerUserId: Number(ownerUserId || 0),
          subject: String(parsed?.subject || "")
        },
        "pre-fix",
        "H2"
      );
      // #endregion

      await archiveIncomingParsedEmail({
        parsed,
        attachments,
        externalId,
        ownerUserId,
        provider: "pop3",
        sourceFolder: "Inbox"
      });

      if (shouldDeleteFromServer(null, config, parsed.date?.toISOString?.() || new Date().toISOString())) {
        deletions.push(entry.messageNumber);
      }
      received += 1;
    }

    for (const messageNumber of deletions) {
      await client.delete(messageNumber);
      deleted += 1;
    }

    await client.quit();
    // #region debug-point send-receive-auth:receive-success
    reportSendReceiveAuthDebug(
      "server/mailService.js:receiveEmailsOnce:success",
      "[DEBUG] POP3 receive finished",
      {
        ownerUserId: Number(ownerUserId || 0),
        received,
        skipped,
        deleted
      },
      "pre-fix",
      "H4"
    );
    // #endregion
    // #region debug-point send-receive-sync:receive-success
    reportSendReceiveSyncDebug(
      "server/mailService.js:receiveEmailsOnce:success",
      "[DEBUG] sync POP3 receive finished",
      {
        ownerUserId: Number(ownerUserId || 0),
        received,
        skipped,
        deleted
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    return { received, skipped, deleted };
  } catch (error) {
    // #region debug-point send-receive-sync:receive-error
    reportSendReceiveSyncDebug(
      "server/mailService.js:receiveEmailsOnce:error",
      "[DEBUG] sync POP3 receive failed",
      {
        ownerUserId: Number(ownerUserId || 0),
        configUserId: Number(config?.user_id || 0),
        message: String(error?.message || "")
      },
      "pre-fix",
      "H3"
    );
    // #endregion
    // #region debug-point send-receive-auth:receive-error
    reportSendReceiveAuthDebug(
      "server/mailService.js:receiveEmailsOnce:error",
      "[DEBUG] POP3 receive failed",
      {
        ownerUserId: Number(ownerUserId || 0),
        configUserId: Number(config?.user_id || 0),
        emailAddress: String(config?.email_address || ""),
        username: String(config?.username || ""),
        incomingServer: String(config?.incoming_server || ""),
        incomingPort: Number(config?.incoming_port || 0),
        incomingSsl: Boolean(config?.incoming_ssl),
        name: String(error?.name || ""),
        message: String(error?.message || "")
      },
      "pre-fix",
      "H1"
    );
    // #endregion
    try {
      await client.quit();
    } catch {
      // ignore cleanup failures
    }
    throw error;
  }
}

async function receiveImapEmailsOnce(config, ownerUserId = null) {
  if (!config) {
    throw new Error("Mail service has not been configured.");
  }

  await ensureFolder("Inbox", "Inbox", 0);
  if (shouldSyncSentItems(config)) {
    await ensureFolder("Sent", "Send", 0);
  }
  const client = createImapClient(config);
  let received = 0;
  let skipped = 0;

  try {
    await connectImap(client);
    const folderPlans = [
      { sourceFolder: getConfiguredInboxFolder(config), folderKind: "inbox" }
    ];
    if (shouldSyncSentItems(config)) {
      folderPlans.push({ sourceFolder: getConfiguredSentFolder(config), folderKind: "sent" });
    }

    for (const folderPlan of folderPlans) {
      let box;
      try {
        box = await openImapBox(client, folderPlan.sourceFolder, true);
      } catch (error) {
        if (folderPlan.folderKind === "sent") {
          continue;
        }
        throw error;
      }

      const sequenceNumbers = await searchImap(client, ["ALL"]);
      const messages = await fetchImapMessages(client, sequenceNumbers);

      for (const message of messages) {
        const uid = Number(message.attributes?.uid || 0);
        const uidValidity = Number(box?.uidvalidity || 0);
        const ownerScope = Number(ownerUserId || config?.user_id || 0);
        const externalId = `imap:${ownerScope}:${folderPlan.folderKind}:${uidValidity}:${uid}`;
        const existingEmail = await getEmailByExternalMessageId(externalId);
        if (existingEmail) {
          skipped += 1;
          continue;
        }

        const parsed = await simpleParser(message.rawEmail);
        const attachments = await saveParsedAttachments(parsed);
        const sentAt = folderPlan.folderKind === "sent"
          ? parsed.date?.toISOString?.() || new Date().toISOString()
          : null;
        await archiveIncomingParsedEmail({
          parsed,
          attachments,
          externalId,
          ownerUserId,
          provider: "imap",
          sourceFolder: folderPlan.sourceFolder,
          targetFolderName: normalizeTargetFolderName(folderPlan.folderKind),
          messageStatus: folderPlan.folderKind === "sent" ? "Sent" : "Received",
          isRead: folderPlan.folderKind === "sent" ? true : Boolean(message.attributes?.flags?.includes("\\Seen")),
          sentAt,
          forceOwnerUser: folderPlan.folderKind === "sent"
        });
        received += 1;
      }
    }

    await closeImap(client);
    return { received, skipped, deleted: 0 };
  } catch (error) {
    try {
      await closeImap(client);
    } catch {
      // ignore cleanup failures
    }
    throw error;
  }
}

async function receiveGraphEmailsOnce(config, ownerUserId = null) {
  if (!config) {
    throw new Error("Mail service has not been configured.");
  }

  await ensureFolder("Inbox", "Inbox", 0);
  if (shouldSyncSentItems(config)) {
    await ensureFolder("Sent", "Send", 0);
  }

  const accessToken = await acquireGraphAccessToken(config);
  const mailboxUser = getGraphMailboxUser(config);
  let received = 0;
  let skipped = 0;

  const folderPlans = [
    { sourceFolder: getConfiguredInboxFolder(config), folderKind: "inbox" }
  ];
  if (shouldSyncSentItems(config)) {
    folderPlans.push({ sourceFolder: getConfiguredSentFolder(config), folderKind: "sent" });
  }

  for (const folderPlan of folderPlans) {
    let folderId;
    try {
      folderId = await resolveGraphFolderId(accessToken, mailboxUser, folderPlan.sourceFolder, folderPlan.folderKind);
    } catch (error) {
      if (folderPlan.folderKind === "sent") {
        continue;
      }
      throw error;
    }

    const messages = await listGraphMessagesForFolder(accessToken, mailboxUser, folderId, 100);
    for (const message of messages) {
      const externalId = `graph:${mailboxUser}:${folderPlan.folderKind}:${message.id}`;
      const existingEmail = await getEmailByExternalMessageId(externalId);
      if (existingEmail) {
        skipped += 1;
        continue;
      }

      const graphAttachments = message.hasAttachments
        ? await listGraphMessageAttachments(accessToken, mailboxUser, message.id)
        : [];
      const parsed = buildParsedMailFromGraphMessage(message, graphAttachments);
      const attachments = await saveParsedAttachments(parsed);
      await archiveIncomingParsedEmail({
        parsed,
        attachments,
        externalId,
        ownerUserId,
        provider: "graph",
        sourceFolder: folderPlan.sourceFolder,
        targetFolderName: normalizeTargetFolderName(folderPlan.folderKind),
        messageStatus: folderPlan.folderKind === "sent" ? "Sent" : "Received",
        isRead: folderPlan.folderKind === "sent" ? true : Boolean(message.isRead),
        sentAt: folderPlan.folderKind === "sent" ? message.sentDateTime || null : null,
        forceOwnerUser: folderPlan.folderKind === "sent"
      });
      received += 1;
    }
  }

  return { received, skipped, deleted: 0 };
}

async function receiveEmailsOnce(config, ownerUserId = null) {
  if (isGraphAccount(config)) {
    return receiveGraphEmailsOnce(config, ownerUserId);
  }
  if (isImapAccount(config)) {
    return receiveImapEmailsOnce(config, ownerUserId);
  }
  return receivePop3EmailsOnce(config, ownerUserId);
}

async function buildAttachmentPayload(files = []) {
  return files.map((file) => ({
    filename: file.originalname || file.file_name,
    path: file.path || path.join(uploadsDir, path.basename(file.file_path)),
    contentType: file.mimetype || file.mime_type
  }));
}

function normalizeAttachmentInlineFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes"].includes(normalized);
}

function resolveStoredAttachmentPath(filePath = "") {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    return "";
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.join(uploadsDir, path.basename(normalized));
}

function extractPop3Uid(externalMessageId = "") {
  const value = String(externalMessageId || "").trim();
  if (!value.startsWith("pop3:")) {
    return "";
  }
  return value.slice(5);
}

function cleanupSavedAttachmentFiles(files = []) {
  for (const file of files || []) {
    const diskPath = file.path || resolveStoredAttachmentPath(file.file_path);
    if (!diskPath || !fs.existsSync(diskPath)) {
      continue;
    }
    try {
      fs.unlinkSync(diskPath);
    } catch {
      // Ignore best-effort cleanup failures.
    }
  }
}

function hasMailboxRepairConfig(config) {
  return Boolean(
    config &&
    Number(config.user_id || 0) > 0 &&
    String(config.email_address || "").trim() &&
    String(config.username || "").trim() &&
    String(config.password || "").trim() &&
    String(config.incoming_server || "").trim()
  );
}

async function repairLegacyEmailAttachments({ userId = null, limit = 100 } = {}) {
  const candidates = await listLegacyAttachmentRepairCandidates({ userId, limit });
  const configuredSettings = userId
    ? [await getMailSettingsForUser(Number(userId || 0))].filter(Boolean)
    : await listConfiguredMailSettings();
  const configByUserId = new Map(
    configuredSettings
      .filter(hasMailboxRepairConfig)
      .map((config) => [Number(config.user_id), config])
  );

  const summary = {
    scanned: candidates.length,
    healthy: 0,
    repaired: 0,
    normalized: 0,
    missing_on_server: 0,
    skipped_no_config: 0,
    mailbox_errors: 0,
    users: []
  };

  const candidatesByUserId = new Map();
  for (const candidate of candidates) {
    const ownerUserId = Number(candidate.employee_id || 0);
    if (!candidatesByUserId.has(ownerUserId)) {
      candidatesByUserId.set(ownerUserId, []);
    }
    candidatesByUserId.get(ownerUserId).push(candidate);
  }

  for (const [ownerUserId, userCandidates] of candidatesByUserId.entries()) {
    const userSummary = {
      user_id: ownerUserId,
      email_address: configByUserId.get(ownerUserId)?.email_address || "",
      scanned: userCandidates.length,
      healthy: 0,
      repaired: 0,
      normalized: 0,
      missing_on_server: 0,
      skipped_no_config: 0,
      mailbox_error: "",
      details: []
    };

    const needsRepair = [];
    for (const candidate of userCandidates) {
      const existingAttachments = await getEmailAttachments(candidate.id);
      const visibleAttachments = existingAttachments.filter((attachment) => !normalizeAttachmentInlineFlag(attachment.is_inline));
      const missingFiles = existingAttachments.filter((attachment) => {
        const diskPath = resolveStoredAttachmentPath(attachment.file_path);
        return !diskPath || !fs.existsSync(diskPath);
      });

      if (visibleAttachments.length > 0 && missingFiles.length === 0) {
        summary.healthy += 1;
        userSummary.healthy += 1;
        userSummary.details.push({
          email_id: candidate.id,
          subject: candidate.subject,
          status: "healthy"
        });
        continue;
      }

      needsRepair.push({
        candidate,
        existingAttachments,
        missingFiles
      });
    }

    if (!needsRepair.length) {
      summary.users.push(userSummary);
      continue;
    }

    const config = configByUserId.get(ownerUserId);
    if (!config) {
      summary.skipped_no_config += needsRepair.length;
      userSummary.skipped_no_config += needsRepair.length;
      for (const item of needsRepair) {
        userSummary.details.push({
          email_id: item.candidate.id,
          subject: item.candidate.subject,
          status: "skipped_no_config"
        });
      }
      summary.users.push(userSummary);
      continue;
    }

    const client = new Pop3Client(config);
    try {
      await client.connect();
      await client.login();
      const uidl = await client.uidl();
      const messageNumberByUid = new Map(
        (uidl?.lines || [])
          .map((line) => line.trim().split(/\s+/))
          .filter((parts) => parts.length >= 2)
          .map(([messageNumber, uid]) => [uid, Number(messageNumber)])
      );

      for (const item of needsRepair) {
        const externalUid = extractPop3Uid(item.candidate.external_message_id);
        const messageNumber = messageNumberByUid.get(externalUid);

        if (!externalUid || !messageNumber) {
          summary.missing_on_server += 1;
          userSummary.missing_on_server += 1;
          userSummary.details.push({
            email_id: item.candidate.id,
            subject: item.candidate.subject,
            status: "missing_on_server"
          });
          continue;
        }

        let repairedFiles = [];
        let replacementPersisted = false;
        try {
          const retr = await client.retrieve(messageNumber);
          const rawEmail = retr.lines.join("\r\n");
          const parsed = await simpleParser(rawEmail);
          repairedFiles = await saveParsedAttachments(parsed);
          const repairedHtmlBody = htmlFromMail(parsed, repairedFiles) || item.candidate.body_html || "";

          await replaceEmailAttachments(item.candidate.id, repairedFiles);
          replacementPersisted = true;
          await updateEmailAttachmentRepairState(item.candidate.id, {
            hasAttachments: repairedFiles.length > 0,
            bodyHtml: repairedHtmlBody
          });

          if (repairedFiles.length > 0) {
            summary.repaired += 1;
            userSummary.repaired += 1;
            userSummary.details.push({
              email_id: item.candidate.id,
              subject: item.candidate.subject,
              status: "repaired",
              attachment_count: repairedFiles.length
            });
          } else {
            summary.normalized += 1;
            userSummary.normalized += 1;
            userSummary.details.push({
              email_id: item.candidate.id,
              subject: item.candidate.subject,
              status: "normalized_no_attachments"
            });
          }
        } catch (error) {
          if (!replacementPersisted) {
            cleanupSavedAttachmentFiles(repairedFiles);
          }
          userSummary.details.push({
            email_id: item.candidate.id,
            subject: item.candidate.subject,
            status: "error",
            error: error?.message || "Attachment repair failed."
          });
        }
      }
    } catch (error) {
      summary.mailbox_errors += needsRepair.length;
      userSummary.mailbox_error = error?.message || "Mailbox access failed during attachment repair.";
      for (const item of needsRepair) {
        userSummary.details.push({
          email_id: item.candidate.id,
          subject: item.candidate.subject,
          status: "mailbox_error",
          error: userSummary.mailbox_error
        });
      }
    } finally {
      try {
        await client.quit();
      } catch {
        // Ignore cleanup failures.
      }
      summary.users.push(userSummary);
    }
  }

  return summary;
}

async function processOutboxQueue(config, userId = null) {
  if (!config) {
    return { sent: 0, queued: 0 };
  }

  const queuedEmails = await listDueOutboxEmails(userId);
  let sent = 0;
  let queued = queuedEmails.length;
  const transporter = getSmtpTransporter(config);

  // #region debug-point send-receive-auth:outbox-start
  reportSendReceiveAuthDebug(
    "server/mailService.js:processOutboxQueue:start",
    "[DEBUG] SMTP outbox processing started",
    {
      userId: Number(userId || 0),
      configUserId: Number(config?.user_id || 0),
      emailAddress: String(config?.email_address || ""),
      username: String(config?.username || ""),
      outgoingServer: String(config?.outgoing_server || ""),
      outgoingPort: Number(config?.outgoing_port || 0),
      outgoingEncryption: String(config?.outgoing_encryption || ""),
      smtpAuthRequired: Boolean(config?.smtp_auth_required),
      queuedEmails: Number(queuedEmails?.length || 0)
    },
    "pre-fix",
    "H4"
  );
  // #endregion

  for (const email of queuedEmails) {
    const attachments = await getEmailAttachments(email.id);
    try {
      // #region debug-point send-receive-auth:outbox-attempt
      reportSendReceiveAuthDebug(
        "server/mailService.js:processOutboxQueue:attempt",
        "[DEBUG] attempting queued SMTP delivery",
        {
          userId: Number(userId || 0),
          emailId: Number(email?.id || 0),
          recipientEmail: String(email?.recipient_email || ""),
          subject: String(email?.subject || "")
        },
        "pre-fix",
        "H4"
      );
      // #endregion
      const info = await transporter.sendMail({
        from: `"${config.display_name || config.company_name}" <${config.email_address}>`,
        to: email.recipient_email,
        cc: email.cc_list || undefined,
        bcc: email.bcc_list || undefined,
        subject: email.subject,
        text: email.body,
        attachments: await buildAttachmentPayload(attachments)
      });
      await markOutboxSent(email.id, info.messageId);
      // #region debug-point send-receive-auth:outbox-success
      reportSendReceiveAuthDebug(
        "server/mailService.js:processOutboxQueue:success",
        "[DEBUG] queued SMTP delivery succeeded",
        {
          userId: Number(userId || 0),
          emailId: Number(email?.id || 0),
          messageId: String(info?.messageId || "")
        },
        "pre-fix",
        "H4"
      );
      // #endregion
      sent += 1;
      queued -= 1;
    } catch (error) {
      // #region debug-point send-receive-auth:outbox-error
      reportSendReceiveAuthDebug(
        "server/mailService.js:processOutboxQueue:error",
        "[DEBUG] queued SMTP delivery failed",
        {
          userId: Number(userId || 0),
          emailId: Number(email?.id || 0),
          recipientEmail: String(email?.recipient_email || ""),
          name: String(error?.name || ""),
          message: String(error?.message || "")
        },
        "pre-fix",
        "H4"
      );
      // #endregion
      await markOutboxRetry(email.id, error.message);
    }
  }

  return { sent, queued };
}

async function retryQueuedEmailNow(emailId, userId = null) {
  const config = activeConfigs.get(Number(userId)) || await ensureActiveConfig(Number(userId));
  if (!config) {
    throw new Error("Mail service has not been configured.");
  }

  const email = await getQueuedOutboxEmail(emailId, userId);
  if (!email) {
    throw new Error("Queued Outbox email not found.");
  }

  const transporter = getSmtpTransporter(config);
  const attachments = await getEmailAttachments(email.id);

  try {
    const info = await transporter.sendMail({
      from: `"${config.display_name || config.company_name}" <${config.email_address}>`,
      to: email.recipient_email,
      cc: email.cc_list || undefined,
      bcc: email.bcc_list || undefined,
      subject: email.subject,
      text: email.body,
      attachments: await buildAttachmentPayload(attachments)
    });

    await markOutboxSent(email.id, info.messageId);
    setUserState(userId, {
      lastSendAt: new Date().toISOString(),
      lastSendCount: 1,
      lastQueueCount: Math.max((getUserState(userId).lastQueueCount || 1) - 1, 0),
      lastRunSummary: `Retry succeeded for ${email.recipient_email}`,
      lastError: null
    }, config);
    serviceState.lastSendAt = new Date().toISOString();
    serviceState.lastSendCount = 1;
    serviceState.lastQueueCount = Math.max((serviceState.lastQueueCount || 1) - 1, 0);
    serviceState.lastRunSummary = `Retry succeeded for ${email.recipient_email}`;
    serviceState.lastError = null;

    return {
      queued: false,
      messageId: info.messageId,
      email: await getEmailById(email.id)
    };
  } catch (error) {
    await markOutboxRetry(email.id, error.message);
    setUserState(userId, {
      lastError: error.message,
      lastRunSummary: `Retry failed for ${email.recipient_email}`
    }, config);
    serviceState.lastError = error.message;
    serviceState.lastRunSummary = `Retry failed for ${email.recipient_email}`;
    return {
      queued: true,
      error: error.message,
      email: await getEmailById(email.id)
    };
  }
}

async function sendMailMessage({ recipient_name, recipient_email, cc_list, bcc_list, subject, body, priority = "Normal", sensitivity = "Normal", read_receipt, delivery_receipt, from, account_id }, files = [], employeeId = null) {
  const ownerUserId = Number(employeeId || 0);
  let config = activeConfigs.get(ownerUserId) || await ensureActiveConfig(ownerUserId);

  if (account_id) {
    const account = await getEmailAccountById(account_id);
    if (account) {
      config = {
        ...config,
        email_address: account.email_address,
        display_name: account.display_name || config.display_name,
        smtp_host: account.smtp_host,
        smtp_port: account.smtp_port,
        smtp_ssl: account.smtp_ssl,
        smtp_username: account.smtp_username,
        smtp_password: account.smtp_password
      };
    }
  }
  if (!config) {
    throw new Error("Mail service has not been configured.");
  }

  const to = recipient_email || recipient_name;
  if (!to) {
    throw new Error("Recipient email is required.");
  }

  await ensureFolder("Sent", "Send", 0);
  await ensureFolder("Outbox", "Send", 0);

  const serialInfo = await createSerialFromSubjectKey(subject || "", "", new Date());
  const serialTag = `[REF: ${serialInfo.serial}]`;
  const subjectWithSerial = subject.includes(serialInfo.serial) ? subject : `${serialTag} ${subject}`;
  const bodyFooter = `\n\n---\nReference: ${serialInfo.serial}\n${config.company_name || "TECHNO Group"} - Internal Archive`;

  const subjectMeta = await parseSubjectForMetadata(subject || "");
  let emailKeyId = null;
  let projectId = null;
  if (subjectMeta.key_code) {
    const keyResult = await query("SELECT id FROM email_keys WHERE key_code = $1", [subjectMeta.key_code]);
    if (keyResult.rows.length) emailKeyId = keyResult.rows[0].id;
  }
  if (subjectMeta.project_code) {
    const projResult = await query("SELECT id FROM projects WHERE project_code = $1", [subjectMeta.project_code]);
    if (projResult.rows.length) projectId = projResult.rows[0].id;
  }

  const hiddenFooter = await generateHiddenFooter(subjectMeta.project_code || "UNSPECIFIED", serialInfo.serial);
  const bodyWithFooter = (body || "") + bodyFooter + hiddenFooter;

  const transporter = getSmtpTransporter(config);
  try {
    const info = await transporter.sendMail({
      from: from || `"${config.display_name || config.company_name}" <${config.email_address}>`,
      to,
      cc: cc_list || undefined,
      bcc: bcc_list || undefined,
      subject: subjectWithSerial,
      text: (body || "") + bodyFooter,
      html: bodyWithFooter,
      attachments: await buildAttachmentPayload(files),
      headers: {
        "X-Company-Serial": serialInfo.serial,
        "X-Company-Department": config.department || "General"
      }
    });

    const archived = await createEmail(
      {
        serial: serialInfo.serial,
        folder_name: "Sent",
        sender_name: from ? from.split("<")[0].trim().replace(/"/g, "") : (config.display_name || config.company_name),
        sender_email: from ? (from.match(/<([^>]+)>/) || [, from])[1] : config.email_address,
        recipient_name,
        recipient_email: to,
        cc_list: cc_list || null,
        bcc_list: bcc_list || null,
        subject: subjectWithSerial,
        body: (body || "") + bodyFooter,
        preview: (body || "").slice(0, 120),
        received_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        priority,
        sensitivity,
        read_receipt: Boolean(read_receipt),
        delivery_receipt: Boolean(delivery_receipt),
        status: "Sent",
        recommendation: `Sent via SMTP to ${to}. Serial: ${serialInfo.serial}`,
        report_status: "Delivered to SMTP",
        external_message_id: info.messageId,
        is_read: true,
        employee_id: employeeId,
        subject_key: serialInfo.subjectKey,
        account_id: account_id || null,
        project_id: projectId,
        email_key_id: emailKeyId
      },
      files,
      "smtp"
    );

    if (info.messageId && archived) {
      await trackEmailThread(info.messageId, null, null, serialInfo.serial, archived.id, subjectWithSerial, from || config.email_address);
    }

    setUserState(ownerUserId, {
      lastSendAt: new Date().toISOString(),
      lastSendCount: 1,
      lastRunSummary: `Last send completed to ${to}`,
      lastError: null
    }, config);
    serviceState.lastSendAt = new Date().toISOString();
    serviceState.lastSendCount = 1;
    serviceState.lastRunSummary = `Last send completed to ${to}`;
    serviceState.lastError = null;

    return {
      queued: false,
      messageId: info.messageId,
      archived
    };
  } catch (error) {
    const queuedEmail = await createEmail(
      {
        folder_name: "Outbox",
        sender_name: from ? from.split("<")[0].trim().replace(/"/g, "") : (config.display_name || config.company_name),
        sender_email: from ? (from.match(/<([^>]+)>/) || [, from])[1] : config.email_address,
        recipient_name,
        recipient_email: to,
        cc_list: cc_list || null,
        subject,
        body,
        preview: body.slice(0, 120),
        received_at: new Date().toISOString(),
        queued_at: new Date().toISOString(),
        priority,
        sensitivity,
        read_receipt: Boolean(read_receipt),
        delivery_receipt: Boolean(delivery_receipt),
        status: "Queued",
        recommendation: `Queued for retry after SMTP failure to ${to}.`,
        report_status: "Queued for Retry",
        is_read: true,
        employee_id: employeeId
      },
      files,
      "smtp-queued"
    );

    await queueOutgoingEmail(queuedEmail.id, error.message);
    setUserState(ownerUserId, {
      lastQueueCount: 1,
      lastRunSummary: `Email queued in Outbox for ${recipient_email}`,
      lastError: error.message
    }, config);
    serviceState.lastQueueCount = 1;
    serviceState.lastRunSummary = `Email queued in Outbox for ${recipient_email}`;
    serviceState.lastError = error.message;

    return {
      queued: true,
      error: error.message,
      archived: queuedEmail
    };
  }
}

async function deliverApprovalEmail(emailRecord, files = [], employeeId = null) {
  if (!emailRecord?.id) {
    throw new Error("Approval email record is required.");
  }

  const ownerUserId = Number(employeeId || emailRecord.employee_id || 0);
  let config = activeConfigs.get(ownerUserId) || await ensureActiveConfig(ownerUserId);

  if (emailRecord.account_id) {
    const account = await getEmailAccountById(emailRecord.account_id);
    if (account) {
      config = {
        ...config,
        email_address: account.email_address,
        display_name: account.display_name || config.display_name,
        smtp_host: account.smtp_host,
        smtp_port: account.smtp_port,
        smtp_ssl: account.smtp_ssl,
        smtp_username: account.smtp_username,
        smtp_password: account.smtp_password
      };
    }
  }

  if (!config) {
    throw new Error("Mail service has not been configured.");
  }

  const to = emailRecord.recipient_email || emailRecord.recipient_name;
  if (!to) {
    throw new Error("Recipient email is required.");
  }

  await ensureFolder("Sent", "Send", 0);
  await ensureFolder("Outbox", "Send", 0);
  const transporter = getSmtpTransporter(config);
  const fromAddress = emailRecord.sender_email
    ? `"${emailRecord.sender_name || config.display_name || config.company_name}" <${emailRecord.sender_email}>`
    : `"${config.display_name || config.company_name}" <${config.email_address}>`;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      cc: emailRecord.cc_list || undefined,
      bcc: emailRecord.bcc_list || undefined,
      subject: emailRecord.subject,
      text: emailRecord.body,
      attachments: await buildAttachmentPayload(files)
    });

    await markOutboxSent(emailRecord.id, info.messageId);
    return {
      queued: false,
      messageId: info.messageId,
      email: await getEmailById(emailRecord.id)
    };
  } catch (error) {
    await markApprovalEmailQueued(
      emailRecord.id,
      `Manager approved the email, but SMTP delivery was queued after failure: ${error.message}`
    );
    await queueOutgoingEmail(emailRecord.id, error.message);
    return {
      queued: true,
      error: error.message,
      email: await getEmailById(emailRecord.id)
    };
  }
}

function getMailServiceStatus(userId = null) {
  if (userId) {
    const numericUserId = Number(userId);
    const config = activeConfigs.get(numericUserId) || null;
    const userState = getUserState(numericUserId, config);
    return {
      ...userState,
      configuredAccounts: activeConfigs.size,
      activeConfig: config
        ? {
            company_name: config.company_name,
            email_address: config.email_address,
            incoming_server: config.incoming_server,
            incoming_port: config.incoming_port,
            outgoing_server: config.outgoing_server,
            outgoing_port: config.outgoing_port,
            outgoing_encryption: config.outgoing_encryption,
            auto_send_receive_minutes: config.auto_send_receive_minutes
          }
        : null
    };
  }

  return {
    ...serviceState,
    accounts: [...activeConfigs.values()].map((config) => ({
      user_id: config.user_id,
      email_address: config.email_address,
      auto_send_receive_minutes: config.auto_send_receive_minutes
    }))
  };
}

export { applyMailSettings, applyAllMailSettings, testMailSettings, getMailServiceStatus, runCycle, runFullMailSyncAllAccounts, receiveEmailsOnce, sendMailMessage, deliverApprovalEmail, retryQueuedEmailNow, repairLegacyEmailAttachments, stopScheduler, saveParsedAttachments, getSmtpTransporter };
