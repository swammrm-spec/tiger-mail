import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  Archive, Bell, Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  Check, FilePenLine, Forward, Inbox, LayoutDashboard, Lock, LogOut, Mail,
  MoreHorizontal, OctagonAlert, Paperclip, Pen, Play, Plus, RefreshCw, Reply, ReplyAll,
  Search, Send, ShieldAlert, Settings, Download, Trash2, Upload, UserCog,
  Globe, FileText, SpellCheck, Wrench, Clock, AlertTriangle, Eye, EyeOff,
  Printer, Bookmark, Star, Filter, Menu, X, Copy, Flag, ExternalLink, MessageSquare,
  List, Grid3X3, Users, Calendar, Clock as ClockIcon, MessageCircle, CheckCircle, Sparkles
} from "lucide-react";

const folderIcons = { Inbox, Sent: Send, Outbox: Send, Drafts: FilePenLine, Deleted: Trash2, Junk: ShieldAlert, Spam: OctagonAlert, Archive };
const folderDisplayNames = { Sent: "Sent Items", Deleted: "Deleted Items", Junk: "Junk Email" };
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const defaultAdminEmail = "m.safadi@audit.techno-grp.com";
const AdminDashboard = lazy(() => import("./components/AdminDashboard"));
const MailComposeView = lazy(() => import("./components/MailComposeView"));
const MailReaderPane = lazy(() => import("./components/MailReaderPane"));
const NotificationPanel = lazy(() => import("./components/NotificationPanel"));

const savedFiltersStorageKey = "emailarray_saved_filters";
const lastUserStorageKey = "emailarray_last_user";
const deviceMailboxDbName = "emailarray-device-cache";
const deviceMailboxStoreName = "mailboxes";
const emptyBootstrap = { currentUser: null, settings: null, folders: [], emails: [], attachments: [], reminders: [], recommendations: [], reports: [], calendar: [] };
const approvalReminderHours = [9, 13, 17];

function getFolderDisplayName(fn) { return folderDisplayNames[fn] || fn; }
function escapeRegExp(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeCsvCell(value) {
  const stringValue = String(value ?? "");
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function buildApprovalConversationItems(history = []) {
  return (history || []).map((item) => {
    const action = String(item.action_type || "").toLowerCase();
    let lane = "system";
    let summary = item.action_type || "Updated";

    if (action.includes("submit")) {
      lane = "employee";
      summary = action.includes("re") ? "Employee resubmitted for approval" : "Employee sent for approval";
    } else if (action.includes("reject")) {
      lane = "manager";
      summary = "Manager returned it for revision";
    } else if (action.includes("approve")) {
      lane = "manager";
      summary = "Manager approved final delivery";
    }

    return {
      ...item,
      lane,
      summary,
      actorLabel: item.actor_name || item.actor_email || "System",
      previewText: String(item.feedback_content || item.snapshot_body || item.snapshot_subject || "").trim()
    };
  });
}

function getApprovalConversationBadgeClass(lane = "system") {
  if (lane === "employee") return "employee";
  if (lane === "manager") return "manager";
  return "system";
}

function normalizeRiskLevel(level = "") {
  const normalized = String(level || "low").toLowerCase();
  if (["critical", "high", "medium", "low"].includes(normalized)) {
    return normalized;
  }
  return "low";
}

function getRiskBadgeStyle(level = "") {
  const riskLevel = normalizeRiskLevel(level);
  if (riskLevel === "critical") return { background: "#fde7e9", color: "#a4262c", border: "1px solid #f1b6bb" };
  if (riskLevel === "high") return { background: "#fff4ce", color: "#8a6100", border: "1px solid #f5d77b" };
  if (riskLevel === "medium") return { background: "#e5f1fb", color: "#004578", border: "1px solid #b9d6f2" };
  return { background: "#edf6ed", color: "#107c10", border: "1px solid #b7dfb9" };
}

function formatRiskFlags(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function getNextApprovalReminderSlot(now = dayjs()) {
  for (const hour of approvalReminderHours) {
    const candidate = now.hour(hour).minute(0).second(0).millisecond(0);
    if (candidate.isAfter(now)) {
      return candidate;
    }
  }
  return now.add(1, "day").hour(approvalReminderHours[0]).minute(0).second(0).millisecond(0);
}

function formatApprovalReminderCountdown(nowValue) {
  const now = dayjs(nowValue);
  const nextSlot = getNextApprovalReminderSlot(now);
  const diffMinutes = Math.max(0, nextSlot.diff(now, "minute"));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return {
    label: hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`,
    slotLabel: nextSlot.format("HH:mm"),
    absoluteLabel: nextSlot.format("MMM D, HH:mm")
  };
}

function isSafeEmailLinkUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
  return /^(https?:|mailto:|tel:)/i.test(value);
}

function resolveEmailLinkUrl(url = "") {
  const value = String(url || "").trim();
  if (!isSafeEmailLinkUrl(value)) {
    return "";
  }
  if (value.startsWith("#")) {
    return value;
  }
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return "";
  }
}

function isSafeEmailSourceUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return false;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
  if (/^(https?:|blob:)/i.test(value)) return true;
  return /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml)(?:;[^,]*)?,/i.test(value);
}

function sanitizeEmailHtml(rawHtml = "") {
  const html = String(rawHtml || "");
  if (!html) return "";

  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[\s\S]*?<\/embed>/gi, "")
      .replace(/\son\w+=(['"]).*?\1/gi, "")
      .replace(/\son\w+=([^\s>]+)/gi, "");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());

  doc.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || "";

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === "href") {
        if (!isSafeEmailLinkUrl(value)) {
          element.setAttribute("href", "#");
        } else if (element.tagName.toLowerCase() === "a") {
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        }
        return;
      }

      if (name === "src") {
        if (!isSafeEmailSourceUrl(value)) {
          element.removeAttribute("src");
        }
        return;
      }
    });
  });

  return doc.body.innerHTML;
}

function buildEmailHtmlDocument(rawHtml = "") {
  const safeHtml = sanitizeEmailHtml(rawHtml);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #1f1f1f;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.65;
      }
      body {
        padding: 20px 22px 28px;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      p, div, td, th, li {
        line-height: 1.65;
      }
      p {
        margin: 0 0 14px;
      }
      table {
        max-width: 100%;
        border-collapse: collapse;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        color: #0f6cbd;
      }
      pre, code {
        white-space: pre-wrap;
        word-break: break-word;
      }
      blockquote {
        margin: 12px 0;
        padding-left: 12px;
        border-left: 3px solid #d0d0d0;
        color: #555;
      }
    </style>
  </head>
  <body>${safeHtml}</body>
</html>`;
}

function triggerAttachmentDownload(filePath, fileName = "") {
  const anchor = document.createElement("a");
  anchor.href = filePath;
  if (fileName) {
    anchor.download = fileName;
  }
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function formatAttachmentSize(fileSize = 0) {
  const size = Number(fileSize || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "Unknown size";
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  const megaBytes = size / (1024 * 1024);
  return `${megaBytes >= 10 ? megaBytes.toFixed(0) : megaBytes.toFixed(1)} MB`;
}

function normalizeBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }
  return Boolean(value);
}

function parseIcsContent(icsText) {
  if (!icsText || typeof icsText !== "string") return null;
  const unfold = icsText.replace(/\r\n[ \t]/g, "").replace(/\r/g, "");
  const lines = unfold.split("\n");
  const event = { summary: "", location: "", description: "", start: "", end: "", status: "", organizer: "", attendees: [], isAllDay: false, timezone: "" };

  let inEvent = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { inEvent = true; continue; }
    if (line === "END:VEVENT") { inEvent = false; continue; }
    if (!inEvent) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const keyPart = line.substring(0, colonIdx);
    const value = line.substring(colonIdx + 1);
    const [baseName, ...paramParts] = keyPart.split(";");
    const base = baseName.toUpperCase();

    const params = {};
    for (const p of paramParts) {
      const eqIdx = p.indexOf("=");
      if (eqIdx !== -1) params[p.substring(0, eqIdx).toUpperCase()] = p.substring(eqIdx + 1);
    }

    if (base === "SUMMARY") {
      event.summary = value;
    } else if (base === "LOCATION") {
      event.location = value;
    } else if (base === "DESCRIPTION") {
      event.description = value.replace(/\\n/g, "\n").replace(/\\,/g, ",");
    } else if (base === "DTSTART") {
      event.start = parseIcsDate(value, params);
      if (value.length === 8) event.isAllDay = true;
      if (params.TZID) event.timezone = params.TZID;
    } else if (base === "DTEND") {
      event.end = parseIcsDate(value, params);
    } else if (base === "STATUS") {
      event.status = value;
    } else if (base === "ORGANIZER") {
      event.organizer = params.CN || value.replace(/^mailto:/i, "");
    } else if (base === "ATTENDEE") {
      const email = value.replace(/^mailto:/i, "");
      const name = params.CN || email;
      const role = params.ROLE || "REQ-PARTICIPANT";
      const rsvp = params.RSVP === "TRUE";
      event.attendees.push({ name, email, role, rsvp });
    }
  }
  return event.summary ? event : null;
}

function parseIcsDate(value, params = {}) {
  const clean = value.replace(/[^0-9T]/g, "");
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  const dt = clean.replace("T", " ");
  if (dt.length >= 13) {
    const tz = params.TZID ? ` (${params.TZID})` : "";
    return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(9, 11)}:${dt.slice(11, 13)}${tz}`;
  }
  return dt;
}

function getAttachmentPreviewMeta(attachment = {}) {
  const fileName = String(attachment.file_name || "");
  const extension = (fileName.split(".").pop() || "").toUpperCase();
  const mimeType = String(attachment.mime_type || "");

  if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(fileName)) {
    return { kind: "image", label: extension || "IMG", accent: "#0f6cbd", bg: "#e8f4fd" };
  }
  if (/pdf/i.test(mimeType) || /\.pdf$/i.test(fileName)) {
    return { kind: "pdf", label: "PDF", accent: "#d13438", bg: "#fde7e9" };
  }
  if (/sheet|excel|spreadsheet/i.test(mimeType) || /\.(xls|xlsx|csv)$/i.test(fileName)) {
    return { kind: "sheet", label: extension || "XLS", accent: "#107c10", bg: "#edf6ed" };
  }
  if (/word|document/i.test(mimeType) || /\.(doc|docx|rtf)$/i.test(fileName)) {
    return { kind: "doc", label: extension || "DOC", accent: "#185abd", bg: "#e8f1fb" };
  }
  if (/zip|compressed/i.test(mimeType) || /\.(zip|rar|7z)$/i.test(fileName)) {
    return { kind: "archive", label: extension || "ZIP", accent: "#8a6100", bg: "#fff4ce" };
  }
  return { kind: "document", label: extension || "FILE", accent: "#605e5c", bg: "#f3f2f1" };
}

function getEmailTimestamp(email = {}) {
  return email.sent_at || email.received_at || email.created_at || null;
}

function getEmailListPreview(email = {}) {
  const previewSource = email.preview || email.body || "";
  return String(previewSource)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function renderHighlightedTextSegments(text, terms) {
  const raw = String(text ?? "");
  const normalizedTerms = [...new Set((terms || []).map((term) => String(term).trim()).filter(Boolean))];
  if (!normalizedTerms.length || !raw) {
    return [raw];
  }
  const re = new RegExp(`(${normalizedTerms.map(escapeRegExp).join("|")})`, "gi");
  return raw.split(re).map((part, index) =>
    normalizedTerms.some((term) => part.toLowerCase() === term.toLowerCase())
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>
  );
}

function renderPlainEmailBody(text, terms) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return "";
  }

  const blocks = raw.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const safeBlocks = blocks.length ? blocks : [raw];
  const linkPattern = /((?:https?:\/\/|mailto:|tel:)[^\s<]+)/gi;

  return safeBlocks.map((block, blockIndex) => {
    const lines = block.split("\n");
    const renderedLines = [];

    lines.forEach((line, lineIndex) => {
      const segments = [];
      let lastIndex = 0;
      let match;

      while ((match = linkPattern.exec(line)) !== null) {
        if (match.index > lastIndex) {
          segments.push(...renderHighlightedTextSegments(line.slice(lastIndex, match.index), terms));
        }

        const url = match[0];
        const safeUrl = resolveEmailLinkUrl(url);
        if (safeUrl) {
          segments.push(
            <a key={`link-${blockIndex}-${lineIndex}-${match.index}`} href={safeUrl} target="_blank" rel="noopener noreferrer">
              {renderHighlightedTextSegments(url, terms)}
            </a>
          );
        } else {
          segments.push(...renderHighlightedTextSegments(url, terms));
        }

        lastIndex = match.index + url.length;
      }

      if (lastIndex < line.length) {
        segments.push(...renderHighlightedTextSegments(line.slice(lastIndex), terms));
      }

      if (!segments.length) {
        segments.push(...renderHighlightedTextSegments(line, terms));
      }

      renderedLines.push(<Fragment key={`line-${blockIndex}-${lineIndex}`}>{segments}</Fragment>);
      if (lineIndex < lines.length - 1) {
        renderedLines.push(<br key={`br-${blockIndex}-${lineIndex}`} />);
      }
    });

    return <p key={`block-${blockIndex}`}>{renderedLines}</p>;
  });
}

function splitRecipientList(value = "") {
  return String(value || "")
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRecipientToken(value = "") {
  return String(value || "").trim().replace(/[,\s;]+$/g, "");
}

function extractRecipientAddress(value = "") {
  const normalized = normalizeRecipientToken(value);
  const bracketMatch = normalized.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim().toLowerCase();
  }
  return normalized.toLowerCase();
}

function extractRecipientDisplayName(value = "") {
  const normalized = normalizeRecipientToken(value);
  const bracketMatch = normalized.match(/^(.*?)<[^>]+>$/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim().replace(/^"|"$/g, "");
  }
  return "";
}

function formatRecentContactLabel(contact = {}) {
  const email = String(contact.contact_email || "").trim();
  const name = String(contact.contact_name || "").trim();
  return name ? `${name} <${email}>` : email;
}

function getRecipientAvatarSeed(value = "") {
  const source = String(value || "").trim();
  let total = 0;
  for (let i = 0; i < source.length; i += 1) {
    total += source.charCodeAt(i);
  }
  return total;
}

function getRecipientAvatarStyle(value = "") {
  const palette = [
    { background: "#0f6cbd", color: "#ffffff" },
    { background: "#106ebe", color: "#ffffff" },
    { background: "#8764b8", color: "#ffffff" },
    { background: "#038387", color: "#ffffff" },
    { background: "#c239b3", color: "#ffffff" },
    { background: "#ca5010", color: "#ffffff" }
  ];
  return palette[getRecipientAvatarSeed(value) % palette.length];
}

function scoreRecentContactMatch(contact = {}, query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const email = String(contact.contact_email || "").trim().toLowerCase();
  const name = String(contact.contact_name || "").trim().toLowerCase();
  const label = formatRecentContactLabel(contact).toLowerCase();
  const useCount = Number(contact.use_count || 0);
  const lastUsedAt = contact.last_used_at ? new Date(contact.last_used_at).getTime() : 0;

  if (!normalizedQuery) {
    return {
      exactPrefix: 0,
      labelPrefix: 0,
      contains: 0,
      position: Number.MAX_SAFE_INTEGER,
      useCount,
      lastUsedAt
    };
  }

  const exactPrefix = email.startsWith(normalizedQuery) ? 1 : 0;
  const labelPrefix = name.startsWith(normalizedQuery) || label.startsWith(normalizedQuery) ? 1 : 0;
  const contains = email.includes(normalizedQuery) || name.includes(normalizedQuery) || label.includes(normalizedQuery) ? 1 : 0;
  const positions = [email.indexOf(normalizedQuery), name.indexOf(normalizedQuery), label.indexOf(normalizedQuery)].filter((value) => value >= 0);

  return {
    exactPrefix,
    labelPrefix,
    contains,
    position: positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER,
    useCount,
    lastUsedAt
  };
}

function joinRecipientList(items = []) {
  return items.filter(Boolean).join(", ");
}

function createEmptyEmployeeForm() {
  return {
    name: "",
    email: "",
    password: "",
    role: "Employee",
    phone: "",
    department: "",
    manager_id: "",
    telegram_chat_id: "",
    telegram_username: "",
    telegram_notifications_enabled: false,
    can_manage_users: false,
    can_manage_reports: false,
    can_manage_projects: false,
    can_manage_tasks: false,
    can_manage_keys: false,
    can_manage_settings: false,
    can_view_analytics: false,
    can_manage_backups: false,
    can_manage_archives: false,
    can_manage_email_accounts: false,
    can_archive: false
  };
}

function getMailboxCacheKey(user) {
  if (!user) return "";
  if (user.id) return `user:${user.id}`;
  return `email:${String(user.email || "").toLowerCase()}`;
}

function openDeviceMailboxDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = window.indexedDB.open(deviceMailboxDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(deviceMailboxStoreName)) {
        db.createObjectStore(deviceMailboxStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open local mailbox cache."));
  });
}

async function readMailboxSnapshotFromDevice(user) {
  const cacheKey = getMailboxCacheKey(user);
  if (!cacheKey) {
    return null;
  }

  const db = await openDeviceMailboxDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(deviceMailboxStoreName, "readonly");
    const store = transaction.objectStore(deviceMailboxStoreName);
    const request = store.get(cacheKey);
    request.onsuccess = () => {
      const saved = request.result;
      resolve(saved?.snapshot || null);
    };
    request.onerror = () => reject(request.error || new Error("Unable to read local mailbox cache."));
    transaction.oncomplete = () => db.close();
  });
}

async function readMailboxCacheEntryFromDevice(user) {
  const cacheKey = getMailboxCacheKey(user);
  if (!cacheKey) {
    return null;
  }

  const db = await openDeviceMailboxDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(deviceMailboxStoreName, "readonly");
    const store = transaction.objectStore(deviceMailboxStoreName);
    const request = store.get(cacheKey);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Unable to read local mailbox cache metadata."));
    transaction.oncomplete = () => db.close();
  });
}

async function saveMailboxSnapshotToDevice(user, snapshot) {
  const cacheKey = getMailboxCacheKey(user);
  if (!cacheKey || !snapshot) {
    return;
  }

  const db = await openDeviceMailboxDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(deviceMailboxStoreName, "readwrite");
    const store = transaction.objectStore(deviceMailboxStoreName);
    store.put({
      id: cacheKey,
      user: {
        id: user.id || null,
        email: user.email || "",
        name: user.name || "",
        role: user.role || ""
      },
      snapshot,
      saved_at: new Date().toISOString()
    });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error || new Error("Unable to save local mailbox cache."));
  });
}

async function clearMailboxSnapshotFromDevice(user) {
  const cacheKey = getMailboxCacheKey(user);
  if (!cacheKey) {
    return;
  }

  const db = await openDeviceMailboxDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(deviceMailboxStoreName, "readwrite");
    const store = transaction.objectStore(deviceMailboxStoreName);
    store.delete(cacheKey);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error || new Error("Unable to clear local mailbox cache."));
  });
}

const sensitivityOpts = ["Normal", "Personal", "Private", "Confidential"];
const settingsTabs = [
  { id: "account", label: "Account", icon: UserCog },
  { id: "accounts", label: "Email Accounts", icon: Mail },
  { id: "servers", label: "Server Settings", icon: Globe },
  { id: "security", label: "Security", icon: Lock },
  { id: "signature", label: "Signature", icon: FilePenLine },
  { id: "compose", label: "Compose", icon: Send },
  { id: "spell", label: "Spell Check", icon: SpellCheck },
  { id: "language", label: "Language", icon: Globe },
  { id: "addins", label: "Add-ins", icon: Wrench }
];

function App() {
  function decodeJwtPayload(jwt) {
    try {
      const payload = jwt.split(".")[1];
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    } catch { return {}; }
  }
  const [token, setToken] = useState(() => localStorage.getItem("emailarray_token") || "");
  const [lastKnownUser, setLastKnownUser] = useState(() => safeJsonParse(localStorage.getItem(lastUserStorageKey), null));
  const [currentUser, setCurrentUser] = useState(null);
  const [data, setData] = useState(emptyBootstrap);
  const [currentView, setCurrentView] = useState("mail");
  const [selectedFolder, setSelectedFolder] = useState("Inbox");
  const [smartFolder, setSmartFolder] = useState(null);
  const [smartFolderData, setSmartFolderData] = useState({ scheduled: [], snoozed: [], aiTasks: [] });
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveResults, setArchiveResults] = useState([]);
  const [archiveStats, setArchiveStats] = useState({ stats: { total: 0, unique_serials: 0 }, recent: [] });
  const [archiveThread, setArchiveThread] = useState(null);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [emailKeys, setEmailKeys] = useState([]);
  const [projects, setProjects] = useState([]);
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [taskStats, setTaskStats] = useState({});
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [newAccountForm, setNewAccountForm] = useState({
    email_address: "",
    display_name: "",
    smtp_host: "",
    smtp_port: 587,
    smtp_ssl: true,
    smtp_username: "",
    smtp_password: "",
    imap_host: "",
    imap_port: 993,
    imap_ssl: true,
    imap_username: "",
    imap_password: "",
    pop3_host: "",
    pop3_port: 995,
    pop3_ssl: true,
    pop3_username: "",
    pop3_password: "",
    signature_text: ""
  });
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("Current");
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Date");
  const [activeRibbonTab, setActiveRibbonTab] = useState("home");
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [savedFilterName, setSavedFilterName] = useState("");
  const [savedFilters, setSavedFilters] = useState(() => { try { return JSON.parse(localStorage.getItem(savedFiltersStorageKey) || "[]"); } catch { return []; } });
  const [advancedSearch, setAdvancedSearch] = useState({ from: "", to: "", subject: "", dateFrom: "", dateTo: "" });
  const [adminSummary, setAdminSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isGeneratingReplyDraft, setIsGeneratingReplyDraft] = useState(false);
  const [isCheckingResponsePolicyGuard, setIsCheckingResponsePolicyGuard] = useState(false);
  const [responsePolicyGuard, setResponsePolicyGuard] = useState(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingSettings, setIsTestingSettings] = useState(false);
  const [isApplyingSettings, setIsApplyingSettings] = useState(false);
  const [isRunningCycle, setIsRunningCycle] = useState(false);
  const [isRunningFullMailSync, setIsRunningFullMailSync] = useState(false);
  const [isRunningAdminMailTests, setIsRunningAdminMailTests] = useState(false);
  const [isRetryingEmail, setIsRetryingEmail] = useState(false);
  const [isMovingEmail, setIsMovingEmail] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [mailServiceStatus, setMailServiceStatus] = useState(null);
  const [fullMailSyncSummary, setFullMailSyncSummary] = useState(null);
  const [adminMailTests, setAdminMailTests] = useState(null);
  const [impersonatedBy, setImpersonatedBy] = useState(() => {
    const stored = localStorage.getItem("emailarray_impersonated_by");
    if (stored) { try { return JSON.parse(stored); } catch { /* ignore */ } }
    return null;
  });
  const [testResult, setTestResult] = useState(null);
  const [deviceCacheInfo, setDeviceCacheInfo] = useState(null);
  const [isRefreshingDeviceCache, setIsRefreshingDeviceCache] = useState(false);
  const [isSyncingDeviceCache, setIsSyncingDeviceCache] = useState(false);
  const [isClearingDeviceCache, setIsClearingDeviceCache] = useState(false);
  const [authForm, setAuthForm] = useState(() => {
    const last = safeJsonParse(localStorage.getItem(lastUserStorageKey), null);
    return { email: last?.email || defaultAdminEmail, password: "" };
  });
  const [form, setForm] = useState({
    sender_name: "M. Safadi", sender_email: defaultAdminEmail,
    recipient_name: "", recipient_email: "", cc_list: "", bcc_list: "", subject: "", body: "",
    subject_key: "", approval_source_email_id: "", reply_source_email_id: "", reply_mode: "",
    manager_comments: "", ai_recommendations: "", draft_context_project_code: "",
    draft_context_project_name: "", draft_context_history_count: "", draft_context_references: "",
    draft_context_memory_count: "", draft_context_memory_references: "",
    draft_context_clause_count: "", draft_context_clause_references: "",
    folder_name: "Inbox", priority: "Normal", sensitivity: "Normal",
    read_receipt: false, delivery_receipt: false, recommendation: "", reminder_title: "", remind_at: ""
  });
  const [files, setFiles] = useState([]);
  const [moveTarget, setMoveTarget] = useState("Deleted");
  const [bulkMoveTarget, setBulkMoveTarget] = useState("Deleted");
  const [settingsForm, setSettingsForm] = useState({
    company_name: "TECHNO GROUP", logo_url: "/logo.gif", display_name: "M. Safadi",
    email_address: defaultAdminEmail, account_type: "POP3",
    incoming_server: "pop.emailarray.com", incoming_port: 995, incoming_ssl: true,
    outgoing_server: "smtp.emailarray.com", outgoing_port: 465, outgoing_encryption: "SSL/TLS",
    smtp_auth_required: true, smtp_same_as_incoming: true,
    username: defaultAdminEmail, password: "Admin@123",
    remember_password: true, require_spa: false, leave_copy_on_server: true,
    remove_after_days: 14, remove_when_deleted: false, auto_send_receive_minutes: 9,
    inbox_folder_name: "Inbox", sent_folder_name: "Sent", sync_sent_items: true,
    graph_tenant_id: "", graph_client_id: "", graph_client_secret: "", graph_mailbox_user: defaultAdminEmail,
    signature: "", sensitivity: "Normal", read_receipt: false, delivery_receipt: false,
    webmail_url: localStorage.getItem("emailarray_webmail_url") || "https://techno-grp--com.w.emailarray.com/#email"
  });
  const [settingsTab, setSettingsTab] = useState("account");

  // Calendar state
  const [calDate, setCalDate] = useState(() => dayjs());
  const [calView, setCalView] = useState("month"); // month | week | day

  // Undo Send
  const [undoState, setUndoState] = useState(null); // { email, timer }
  const [undoTimer, setUndoTimer] = useState(null);

  // Compose options
  const [showBcc, setShowBcc] = useState(false);
  const [showFrom, setShowFrom] = useState(false);
  const [composeInput, setComposeInput] = useState({ field: null, text: "", show: false });

  // Public company info for login page
  const [publicInfo, setPublicInfo] = useState({ company_name: "TECHNO GROUP", logo_url: "/logo.gif" });

  useEffect(() => {
    fetch("/api/public/company-info").then(r => r.json()).then(d => setPublicInfo(d)).catch(() => {});
  }, []);

  // Dialog
  const [dialog, setDialog] = useState(null);

  // Admin state
  const [adminTab, setAdminTab] = useState("overview");
  const [employees, setEmployees] = useState([]);
  const [employeeForm, setEmployeeForm] = useState(createEmptyEmployeeForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [showManagerQuickForm, setShowManagerQuickForm] = useState(false);
  const [managerQuickForm, setManagerQuickForm] = useState({ name: "", email: "", password: "", role: "Admin" });
  const [emailTrail, setEmailTrail] = useState([]);
  const [emailTrailTotal, setEmailTrailTotal] = useState(0);
  const [emailTrailFilters, setEmailTrailFilters] = useState({ employee_id: "", folder_name: "", search: "", from_date: "", to_date: "", limit: 100, offset: 0 });
  const [archives, setArchives] = useState([]);
  const [archiveForm, setArchiveForm] = useState({ employee_id: "", email_ids: [], notes: "" });
  const [archiveExplorerFilters, setArchiveExplorerFilters] = useState({ project_code: "", serial_number: "", thread_id: "", limit: 50 });
  const [archiveExplorerData, setArchiveExplorerData] = useState({
    totals: { registry: 0, content_archive: 0, tracking_tasks: 0 },
    email_registry: [],
    email_content_archive: [],
    tracking_tasks: []
  });
  const [archiveExplorerFocusEmailId, setArchiveExplorerFocusEmailId] = useState(null);
  const [activeTrackingTaskActionKey, setActiveTrackingTaskActionKey] = useState("");
  const [selectedArchiveTrackingTaskIds, setSelectedArchiveTrackingTaskIds] = useState([]);
  const [bulkArchiveTrackingAssignedTo, setBulkArchiveTrackingAssignedTo] = useState("");
  const [activeBulkTrackingAction, setActiveBulkTrackingAction] = useState("");
  const [archiveBackfillForm, setArchiveBackfillForm] = useState({ limit: 200, includeSent: false, force: true });
  const [archiveBackfillSummary, setArchiveBackfillSummary] = useState(null);
  const [archiveBackfillJob, setArchiveBackfillJob] = useState(null);
  const [archiveBackfillHistory, setArchiveBackfillHistory] = useState([]);
  const [isArchiveBackfillDetailsOpen, setIsArchiveBackfillDetailsOpen] = useState(false);
  const [archiveBackfillDetailsJob, setArchiveBackfillDetailsJob] = useState(null);
  const [archiveBackfillDetailsSearch, setArchiveBackfillDetailsSearch] = useState("");
  const [archiveBackfillDetailsFailedOnly, setArchiveBackfillDetailsFailedOnly] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [isSavingEmployee, setIsSavingEmployee] = useState(false);
  const [isLoadingTrail, setIsLoadingTrail] = useState(false);
  const [isLoadingArchiveExplorer, setIsLoadingArchiveExplorer] = useState(false);
  const [isLoadingArchiveBackfillHistory, setIsLoadingArchiveBackfillHistory] = useState(false);
  const [isRunningArchiveBackfill, setIsRunningArchiveBackfill] = useState(false);
  const [isCancellingArchiveBackfill, setIsCancellingArchiveBackfill] = useState(false);
  const [isRetryingArchiveBackfill, setIsRetryingArchiveBackfill] = useState(false);
  const [isCreatingArchive, setIsCreatingArchive] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);
  const [showHighRiskOnly, setShowHighRiskOnly] = useState(false);
  const [approvalClock, setApprovalClock] = useState(() => Date.now());
  const [approvalHistory, setApprovalHistory] = useState([]);
  const [approvalHistoryEmailId, setApprovalHistoryEmailId] = useState(null);
  const [isLoadingApprovalHistory, setIsLoadingApprovalHistory] = useState(false);
  const [approvalAnalytics, setApprovalAnalytics] = useState(null);
  const [managerDecisionNotes, setManagerDecisionNotes] = useState({});
  const [isApprovalDrawerOpen, setIsApprovalDrawerOpen] = useState(false);
  const [approvalDrawerEmailId, setApprovalDrawerEmailId] = useState(null);
  const [approvalActionLinksByEmail, setApprovalActionLinksByEmail] = useState({});
  const [pendingQueryAction, setPendingQueryAction] = useState(null);
  const [recentContacts, setRecentContacts] = useState([]);
  const [calendarEvent, setCalendarEvent] = useState(null);
  const composeTextareaRef = useRef(null);
  const toInputRef = useRef(null);
  const ccInputRef = useRef(null);
  const bccInputRef = useRef(null);
  const readingHtmlFrameRef = useRef(null);
  const readingHtmlFrameCleanupRef = useRef(null);
  const readingHtmlFrameHeightRef = useRef(640);
  const [readingHtmlFrameHeight, setReadingHtmlFrameHeight] = useState(640);
  const [composeReviewScroll, setComposeReviewScroll] = useState({ top: 0, left: 0 });

  const canAccessAdmin = Boolean(
    currentUser?.role === "Admin" ||
    currentUser?.role === "admin" ||
    currentUser?.can_manage_users ||
    currentUser?.can_manage_reports ||
    currentUser?.can_manage_projects ||
    currentUser?.can_manage_tasks ||
    currentUser?.can_manage_keys ||
    currentUser?.can_manage_settings ||
    currentUser?.can_view_analytics ||
    currentUser?.can_manage_backups ||
    currentUser?.can_manage_archives ||
    currentUser?.can_manage_email_accounts
  );
  const canArchive = Boolean(currentUser?.can_archive);
  const isStandardInboxUser = Boolean(currentUser && !canAccessAdmin);
  const isManager = Boolean(employees.some(e => e.manager_id === currentUser?.id) || canAccessAdmin);
  const requiresManagerApproval = Boolean(currentUser && !canAccessAdmin);

  function createDefaultComposeForm(overrides = {}) {
    return {
      sender_name: currentUser?.name || "Mail Archive Bot",
      sender_email: currentUser?.email || defaultAdminEmail,
      recipient_name: "", recipient_email: "", cc_list: "", bcc_list: "", subject: "",
      body: settingsForm.signature ? `\n\n${settingsForm.signature}` : "",
      folder_name: "Inbox",
      subject_key: "",
      email_key_id: "",
      project_id: "",
      approval_source_email_id: "",
      reply_source_email_id: "",
      reply_mode: "",
      manager_comments: "",
      ai_recommendations: "",
      draft_context_project_code: "",
      draft_context_project_name: "",
      draft_context_history_count: "",
      draft_context_references: "",
      draft_context_memory_count: "",
      draft_context_memory_references: "",
      draft_context_clause_count: "",
      draft_context_clause_references: "",
      priority: settingsForm.priority || "Normal",
      sensitivity: settingsForm.sensitivity || "Normal",
      read_receipt: Boolean(settingsForm.read_receipt),
      delivery_receipt: Boolean(settingsForm.delivery_receipt),
      recommendation: "", reminder_title: "", remind_at: "",
      ...overrides
    };
  }

  function appendRecipientsToField(fieldKey, rawValue, targetForm = form) {
    const existing = splitRecipientList(targetForm[fieldKey] || "");
    const seen = new Set(existing.map((item) => extractRecipientAddress(item)));
    const incoming = splitRecipientList(rawValue).map(normalizeRecipientToken).filter(Boolean);
    const next = [...existing];

    incoming.forEach((item) => {
      const normalized = extractRecipientAddress(item);
      if (!normalized.includes("@") || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      next.push(item);
    });

    return {
      ...targetForm,
      [fieldKey]: joinRecipientList(next)
    };
  }

  function commitComposeInput(targetForm = form) {
    if (!composeInput.field || !composeInput.text.trim()) {
      return targetForm;
    }

    const nextForm = appendRecipientsToField(composeInput.field, composeInput.text, targetForm);
    setComposeInput({ field: null, text: "", show: false });
    if (composeInput.field === "recipient_email" && toInputRef.current) toInputRef.current.value = "";
    if (composeInput.field === "cc_list" && ccInputRef.current) ccInputRef.current.value = "";
    if (composeInput.field === "bcc_list" && bccInputRef.current) bccInputRef.current.value = "";
    return nextForm;
  }

  function buildCurrentMailboxSnapshot(user = currentUser) {
    return {
      ...data,
      currentUser: user,
      settings: settingsForm || data.settings || null
    };
  }

  function openComposeView(overrides = null) {
    setCurrentView("compose");
    setActiveRibbonTab("home");
    const defaults = overrides || {};
    setForm(createDefaultComposeForm(defaults));
    setResponsePolicyGuard(null);
    setFiles([]);
    loadRecentContacts();
    if (!canArchive) { setSuccessMessage("You can open the compose window, but your current permissions do not allow sending or archiving."); setError(""); return; }
    setSuccessMessage(""); setError("");
  }

  function openRejectedRevision(email = selectedEmail) {
    if (!email) return;
    const revisionBody = `${email.body || ""}`;
    openComposeView({
      recipient_name: email.recipient_name || "",
      recipient_email: email.recipient_email || "",
      cc_list: email.cc_list || "",
      subject: email.subject || "",
      body: revisionBody,
      subject_key: email.subject_key || "",
      approval_source_email_id: email.id,
      manager_comments: email.manager_comments || email.rejection_reason || "",
      ai_recommendations: email.ai_recommendations || "",
      priority: email.priority || "Normal",
      sensitivity: email.sensitivity || "Normal",
      read_receipt: Boolean(email.read_receipt),
      delivery_receipt: Boolean(email.delivery_receipt),
      folder_name: "Drafts"
    });
    loadApprovalHistory(email.id);
    setSuccessMessage("Rejected email opened for revision.");
    setError("");
  }

  function prepareReplyDraft(mode = "reply") {
    if (!selectedEmail) return;
    const subjectPrefix = mode === "forward" ? "FW: " : "RE: ";
    const originalSubject = selectedEmail.subject || "(No subject)";
    const subject = originalSubject.toUpperCase().startsWith(subjectPrefix.trim()) ? originalSubject : `${subjectPrefix}${originalSubject}`;
    const originalDate = dayjs(selectedEmail.sent_at || selectedEmail.received_at).format("ddd DD/MM/YYYY HH:mm");
    const quotedBody = ["", "", "----- Original Message -----",
      `From: ${selectedEmail.sender_name || ""} <${selectedEmail.sender_email || ""}>`,
      `Sent: ${originalDate}`,
      `To: ${selectedEmail.recipient_email || currentUser?.email || ""}`,
      selectedEmail.cc_list ? `CC: ${selectedEmail.cc_list}` : "",
      `Subject: ${selectedEmail.subject || ""}`, "", selectedEmail.body || selectedEmail.preview || ""
    ].filter(Boolean).join("\n");
    const replyAllCc = [selectedEmail.cc_list, selectedEmail.recipient_email].filter(Boolean).join(", ").split(",").map(v => v.trim()).filter((v, i, a) => v && v !== currentUser?.email && a.indexOf(v) === i).join(", ");
    if (mode === "reply") { openComposeView({ recipient_name: selectedEmail.sender_name || "", recipient_email: selectedEmail.sender_email || "", subject, body: quotedBody, folder_name: "Drafts", priority: selectedEmail.priority || "Normal", project_id: selectedEmail.project_id || "", reply_source_email_id: selectedEmail.id, reply_mode: mode, draft_context_project_code: "", draft_context_project_name: "", draft_context_history_count: "", draft_context_references: "", draft_context_memory_count: "", draft_context_memory_references: "", draft_context_clause_count: "", draft_context_clause_references: "", ai_recommendations: "" }); setSuccessMessage("Reply opened successfully."); setError(""); return; }
    if (mode === "replyAll") { openComposeView({ recipient_name: selectedEmail.sender_name || "", recipient_email: selectedEmail.sender_email || "", cc_list: replyAllCc, subject, body: quotedBody, folder_name: "Drafts", priority: selectedEmail.priority || "Normal", project_id: selectedEmail.project_id || "", reply_source_email_id: selectedEmail.id, reply_mode: mode, draft_context_project_code: "", draft_context_project_name: "", draft_context_history_count: "", draft_context_references: "", draft_context_memory_count: "", draft_context_memory_references: "", draft_context_clause_count: "", draft_context_clause_references: "", ai_recommendations: "" }); setSuccessMessage("Reply All opened with recipients filled."); setError(""); return; }
    openComposeView({ subject, body: quotedBody, folder_name: "Drafts", priority: selectedEmail.priority || "Normal" });
    setSuccessMessage("Forward opened with original message content."); setError("");
  }

  function mergeSuggestedReplyBody(currentBody, suggestedReplyBody) {
    const nextReply = String(suggestedReplyBody || "").trim();
    if (!nextReply) {
      return currentBody;
    }
    const currentText = String(currentBody || "");
    const marker = "----- Original Message -----";
    const markerIndex = currentText.indexOf(marker);
    if (markerIndex === -1) {
      return nextReply;
    }
    const quotedBlock = currentText.slice(markerIndex).trim();
    return `${nextReply}\n\n${quotedBlock}`.trim();
  }

  function isResponsePolicyGuardStaleForDraft(draftSubject, draftBody) {
    if (!responsePolicyGuard) return true;
    return String(responsePolicyGuard.checked_subject || "") !== String(draftSubject || "")
      || String(responsePolicyGuard.checked_body || "") !== String(draftBody || "");
  }

  async function runResponsePolicyGuard({
    subjectOverride = null,
    bodyOverride = null,
    projectIdOverride = null,
    silent = false
  } = {}) {
    const replySourceId = Number(form.reply_source_email_id || 0);
    if (!replySourceId) {
      return null;
    }
    const draftSubject = String(subjectOverride ?? form.subject ?? "").trim();
    const draftBody = String(bodyOverride ?? form.body ?? "");
    setIsCheckingResponsePolicyGuard(true);
    if (!silent) {
      setError("");
      setSuccessMessage("");
    }
    try {
      const response = await apiFetch("/api/ai/reply-policy-guard", {
        method: "POST",
        body: {
          email_id: replySourceId,
          subject: draftSubject,
          draft_body: draftBody,
          project_id: projectIdOverride ?? form.project_id ?? ""
        }
      });
      const context = response.context || {};
      const guard = {
        ...(response.guard || {}),
        context,
        checked_subject: draftSubject,
        checked_body: draftBody
      };
      setResponsePolicyGuard(guard);
      setForm((prev) => ({
        ...prev,
        project_id: prev.project_id || context.project_id || "",
        draft_context_project_code: context.project_code || prev.draft_context_project_code || "",
        draft_context_project_name: context.project_name || prev.draft_context_project_name || "",
        draft_context_history_count: String(context.history_count || prev.draft_context_history_count || 0),
        draft_context_references: Array.isArray(context.references) ? context.references.join("\n") : (prev.draft_context_references || ""),
        draft_context_memory_count: String(context.contract_memory_count || prev.draft_context_memory_count || 0),
        draft_context_memory_references: Array.isArray(context.contract_memory_references) ? context.contract_memory_references.join("\n") : (prev.draft_context_memory_references || ""),
        draft_context_clause_count: String(context.contract_clause_count || prev.draft_context_clause_count || 0),
        draft_context_clause_references: Array.isArray(context.contract_clause_references) ? context.contract_clause_references.join("\n") : (prev.draft_context_clause_references || "")
      }));
      if (!silent) {
        const issueCount = Array.isArray(guard.issues) ? guard.issues.length : 0;
        const conflictCount = Array.isArray(guard.conflicts) ? guard.conflicts.length : 0;
        setSuccessMessage(
          issueCount || conflictCount
            ? `Policy Guard detected ${issueCount} issue(s) and ${conflictCount} clause conflict(s) to review.`
            : "Policy Guard did not detect contradictions in the current draft."
        );
      }
      return guard;
    } catch (e) {
      if (!silent) {
        setError(e.message);
      }
      throw e;
    } finally {
      setIsCheckingResponsePolicyGuard(false);
    }
  }

  async function handleGenerateReplyDraft() {
    const replySourceId = Number(form.reply_source_email_id || 0);
    if (!replySourceId) {
      setError("Reply source email is missing.");
      return;
    }
    setIsGeneratingReplyDraft(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await apiFetch("/api/ai/reply-draft", {
        method: "POST",
        body: {
          email_id: replySourceId,
          subject: form.subject || "",
          draft_body: form.body || "",
          mode: form.reply_mode || "reply",
          project_id: form.project_id || ""
        }
      });
      const draft = response.draft || {};
      const context = response.context || {};
      const nextSubject = draft.subject || form.subject;
      const nextBody = mergeSuggestedReplyBody(form.body, draft.reply_body || "");
      const nextProjectId = form.project_id || context.project_id || "";
      const guidance = [
        context.project_code ? `Project context: ${context.project_code}${context.project_name ? ` - ${context.project_name}` : ""}` : "",
        Number(context.history_count || 0) ? `Historical emails used: ${Number(context.history_count)}` : "Historical emails used: 0",
        Number(context.contract_memory_count || 0) ? `Contract memory snippets used: ${Number(context.contract_memory_count)}` : "Contract memory snippets used: 0",
        Number(context.contract_clause_count || 0) ? `Structured clauses used: ${Number(context.contract_clause_count)}` : "Structured clauses used: 0",
        ...(draft.guidance || [])
      ].filter(Boolean);
      setForm((prev) => ({
        ...prev,
        subject: nextSubject,
        body: nextBody,
        ai_recommendations: guidance.join("\n"),
        project_id: nextProjectId,
        draft_context_project_code: context.project_code || "",
        draft_context_project_name: context.project_name || "",
        draft_context_history_count: String(context.history_count || 0),
        draft_context_references: Array.isArray(context.references) ? context.references.join("\n") : "",
        draft_context_memory_count: String(context.contract_memory_count || 0),
        draft_context_memory_references: Array.isArray(context.contract_memory_references) ? context.contract_memory_references.join("\n") : "",
        draft_context_clause_count: String(context.contract_clause_count || 0),
        draft_context_clause_references: Array.isArray(context.contract_clause_references) ? context.contract_clause_references.join("\n") : ""
      }));
      await runResponsePolicyGuard({
        subjectOverride: nextSubject,
        bodyOverride: nextBody,
        projectIdOverride: nextProjectId,
        silent: true
      }).catch(() => null);
      setSuccessMessage(
        Number(context.history_count || 0)
          ? `AI reply draft generated using ${Number(context.history_count)} historical project email(s).`
          : "AI reply draft generated from the current email context."
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setIsGeneratingReplyDraft(false);
    }
  }

  async function applyRepairSuggestion(suggestion) {
    const safeSuggestion = String(suggestion?.suggested_text || "").trim();
    if (!safeSuggestion) {
      return;
    }
    const nextBody = mergeSuggestedReplyBody(form.body, safeSuggestion);
    setForm((prev) => ({
      ...prev,
      body: nextBody
    }));
    setSuccessMessage("Applied safe repair suggestion to the draft.");
    setError("");
    await runResponsePolicyGuard({
      bodyOverride: nextBody,
      subjectOverride: form.subject || "",
      projectIdOverride: form.project_id || "",
      silent: true
    }).catch(() => null);
  }

  async function applySafeRewrite() {
    const rewrittenBody = String(responsePolicyGuard?.safe_rewrite?.rewritten_body || "").trim();
    if (!rewrittenBody) {
      setError("No safe rewrite is available for the current draft.");
      return;
    }
    const nextBody = mergeSuggestedReplyBody(form.body, rewrittenBody);
    setForm((prev) => ({
      ...prev,
      body: nextBody
    }));
    setSuccessMessage("Applied one-click safe rewrite to the draft.");
    setError("");
    await runResponsePolicyGuard({
      bodyOverride: nextBody,
      subjectOverride: form.subject || "",
      projectIdOverride: form.project_id || "",
      silent: true
    }).catch(() => null);
  }

  async function handleRunResponsePolicyGuard() {
    try {
      await runResponsePolicyGuard();
    } catch {
      // Error state is handled inside runResponsePolicyGuard.
    }
  }

  function handleDownloadAllAttachments() {
    if (!selectedVisibleAttachments.length) return;
    selectedVisibleAttachments.forEach((attachment, index) => {
      window.setTimeout(() => {
        triggerAttachmentDownload(attachment.file_path, attachment.file_name);
      }, index * 180);
    });
    setSuccessMessage(`Started downloading ${selectedVisibleAttachments.length} attachment(s).`);
    setError("");
  }

  function syncReadingIframeHeight() {
    const frame = readingHtmlFrameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc?.body) return;
      const nextHeight = Math.min(
        Math.max(
          420,
          doc.documentElement?.scrollHeight || 0,
          doc.body.scrollHeight || 0,
          doc.body.offsetHeight || 0
        ),
        3000
      );
      const currentHeight = readingHtmlFrameHeightRef.current || 640;
      if (Math.abs(nextHeight - currentHeight) > 4) {
        readingHtmlFrameHeightRef.current = nextHeight + 8;
        setReadingHtmlFrameHeight(nextHeight + 8);
      }
    } catch {
      setReadingHtmlFrameHeight(640);
    }
  }

  function handleReadingFrameLoad() {
    syncReadingIframeHeight();

    if (readingHtmlFrameCleanupRef.current) {
      readingHtmlFrameCleanupRef.current();
      readingHtmlFrameCleanupRef.current = null;
    }

    const frame = readingHtmlFrameRef.current;
    if (!frame) {
      return;
    }

    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      const frameWindow = frame.contentWindow;
      if (!doc?.body || !frameWindow) {
        return;
      }

      let resizeTimeoutId = null;
      const handleResize = () => {
        if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
        resizeTimeoutId = window.setTimeout(handleResizeImmediate, 150);
      };
      const handleResizeImmediate = () => syncReadingIframeHeight();
      const handleClick = (event) => {
        const anchor = event.target?.closest?.("a[href]");
        if (!anchor) {
          return;
        }

        const rawHref = String(anchor.getAttribute("href") || "").trim();
        if (!rawHref) {
          event.preventDefault();
          return;
        }

        if (rawHref.startsWith("#")) {
          event.preventDefault();
          const target = doc.querySelector(rawHref);
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        const safeUrl = resolveEmailLinkUrl(rawHref);
        if (!safeUrl) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        window.open(safeUrl, "_blank", "noopener,noreferrer");
      };

      const imageElements = Array.from(doc.querySelectorAll("img"));
      imageElements.forEach((image) => {
        image.loading = "lazy";
        image.decoding = "async";
      });

      doc.addEventListener("click", handleClick);
      frameWindow.addEventListener("resize", handleResize);
      imageElements.forEach((image) => {
        image.addEventListener("load", handleResize);
        image.addEventListener("error", handleResize);
      });

      let mutationTimeoutId = null;
      const mutationObserver = new MutationObserver(() => {
        if (mutationTimeoutId) window.clearTimeout(mutationTimeoutId);
        mutationTimeoutId = window.setTimeout(handleResizeImmediate, 200);
      });
      mutationObserver.observe(doc.body, { childList: true, subtree: true, attributes: true });

      const delayedHeightSyncId = window.setTimeout(handleResize, 80);
      doc.fonts?.ready?.then(handleResize).catch(() => {});

      readingHtmlFrameCleanupRef.current = () => {
        window.clearTimeout(delayedHeightSyncId);
        if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
        if (mutationTimeoutId) window.clearTimeout(mutationTimeoutId);
        mutationObserver.disconnect();
        doc.removeEventListener("click", handleClick);
        frameWindow.removeEventListener("resize", handleResize);
        imageElements.forEach((image) => {
          image.removeEventListener("load", handleResize);
          image.removeEventListener("error", handleResize);
        });
      };
    } catch {
      setReadingHtmlFrameHeight(640);
    }
  }

  function onEmailClick(email) {
    setSelectedEmailId(email.id);
    if (!email.is_read) {
      apiFetch("/api/emails/read-state", { method: "PATCH", body: { email_ids: [email.id], is_read: true } }).then(() => {
        setData(prev => ({ ...prev, emails: prev.emails.map(e => e.id === email.id ? { ...e, is_read: true } : e) }));
      }).catch(() => {});
    }
  }

  async function handleMoreAction() {
    if (!selectedEmail) return;
    const newReadState = !selectedEmail.is_read;
    await apiFetch("/api/emails/read-state", { method: "PATCH", body: { email_ids: [selectedEmail.id], is_read: newReadState } });
    setData(prev => {
      const updatedEmails = prev.emails.map(e => e.id === selectedEmail.id ? { ...e, is_read: newReadState } : e);
      const updatedFolders = prev.folders.map(f => {
        if (f.name === selectedEmail.folder_name) {
          return { ...f, unread_count: newReadState ? Math.max((f.unread_count || 0) - 1, 0) : (f.unread_count || 0) + 1 };
        }
        return f;
      });
      return { ...prev, emails: updatedEmails, folders: updatedFolders };
    });
    setSuccessMessage(newReadState ? "Marked as read." : "Marked as unread."); setError("");
  }

  function handleRibbonTabChange(tab) {
    setActiveRibbonTab(tab);
    setCurrentView("mail");
    if (tab === "view") { setShowAdvancedSearch(true); setSuccessMessage("View tab opened with advanced search tools."); setError(""); return; }
    if (tab === "help") { setSuccessMessage("Help: Use Scope to search all folders, CSV/Excel to export results, and New Message to compose."); setError(""); return; }
    setSuccessMessage("");
  }

  async function apiFetch(url, options = {}, activeToken = token) {
    const headers = new Headers(options.headers || {});
    if (activeToken) headers.set("Authorization", `Bearer ${activeToken}`);
    const request = { ...options, headers };
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) { headers.set("Content-Type", "application/json"); request.body = JSON.stringify(options.body); }
    let response;
    try {
      response = await fetch(url, request);
    } catch (fetchError) {
      throw fetchError;
    }
    if (response.status === 401) {
      localStorage.removeItem("emailarray_token"); setToken(""); setCurrentUser(null);
      throw new Error("__SESSION_EXPIRED__");
    }
    if (!response.ok) { let body = {}; try { body = await response.json(); } catch {} throw new Error(body.error || "Request failed."); }
    return response.json();
  }

  async function loadBootstrap(activeToken = token) {
    setIsLoading(true);
    try {
      const payload = await apiFetch("/api/bootstrap", {}, activeToken);
      if (!payload.currentUser) { throw new Error("User session expired. Please log in again."); }
      setData(payload);
      setCurrentUser(payload.currentUser);
      if (payload.settings) {
        const savedWebmailUrl = localStorage.getItem("emailarray_webmail_url");
        setSettingsForm({ ...payload.settings, webmail_url: savedWebmailUrl || payload.settings.webmail_url || "" });
      }
      const initialFolder = payload.folders.find(f => f.name === selectedFolder)?.name || payload.folders[0]?.name || "Inbox";
      setSelectedFolder(initialFolder);
      const preferredEmail = payload.emails.find(e => e.id === selectedEmailId) || payload.emails.find(e => e.folder_name === initialFolder) || payload.emails[0] || null;
      setSelectedEmailId(preferredEmail?.id ?? null);
      setSelectedEmailIds(prev => prev.filter(id => payload.emails.some(e => e.id === id)));
      loadEmailAccounts();
      loadEmailKeys();
      loadProjects();
      if (payload.emailKeys) setEmailKeys(payload.emailKeys);
      if (payload.projects) setProjects(payload.projects);
      setUnclassifiedCount(payload.unclassifiedCount || 0);
      setTaskStats(payload.taskStats || {});
      const persistedUser = {
        id: payload.currentUser.id || null,
        email: payload.currentUser.email || "",
        name: payload.currentUser.name || "",
        role: payload.currentUser.role || ""
      };
      localStorage.setItem(lastUserStorageKey, JSON.stringify(persistedUser));
      setLastKnownUser(persistedUser);
      setError(""); setSuccessMessage("");
    } catch (loadError) {
      if (loadError.message === "__SESSION_EXPIRED__") {
        setSuccessMessage("Your session has expired. Please log in again.");
        return;
      }
      const fallbackUser = currentUser || lastKnownUser || safeJsonParse(localStorage.getItem(lastUserStorageKey), null);
      if (fallbackUser) {
        try {
          const cachedSnapshot = await readMailboxSnapshotFromDevice(fallbackUser);
          if (cachedSnapshot?.currentUser) {
            setData(cachedSnapshot);
            setCurrentUser(cachedSnapshot.currentUser);
            if (cachedSnapshot.settings) setSettingsForm(cachedSnapshot.settings);
            const initialFolder = cachedSnapshot.folders.find(f => f.name === selectedFolder)?.name || cachedSnapshot.folders[0]?.name || "Inbox";
            setSelectedFolder(initialFolder);
            const preferredEmail = cachedSnapshot.emails.find(e => e.id === selectedEmailId) || cachedSnapshot.emails.find(e => e.folder_name === initialFolder) || cachedSnapshot.emails[0] || null;
            setSelectedEmailId(preferredEmail?.id ?? null);
            setSelectedEmailIds(prev => prev.filter(id => cachedSnapshot.emails.some(e => e.id === id)));
            setError("تعذر الاتصال بقاعدة بيانات السيرفر الآن. تم تحميل آخر نسخة بريد محلية محفوظة على هذا الجهاز.");
            return;
          }
        } catch {}
      }
      localStorage.removeItem("emailarray_token"); localStorage.removeItem("emailarray_impersonated_by"); setToken(""); setCurrentUser(null); setData(emptyBootstrap);
      setError(loadError.message);
    } finally { setIsLoading(false); }
  }

  async function loadDeviceCacheInfo(user = currentUser || lastKnownUser) {
    if (!user?.email) {
      setDeviceCacheInfo(null);
      return;
    }

    setIsRefreshingDeviceCache(true);
    try {
      const entry = await readMailboxCacheEntryFromDevice(user);
      setDeviceCacheInfo(entry ? {
        cacheKey: entry.id,
        savedAt: entry.saved_at || null,
        emailCount: Array.isArray(entry.snapshot?.emails) ? entry.snapshot.emails.length : 0,
        folderCount: Array.isArray(entry.snapshot?.folders) ? entry.snapshot.folders.length : 0,
        attachmentCount: Array.isArray(entry.snapshot?.attachments) ? entry.snapshot.attachments.length : 0,
        userEmail: entry.user?.email || user.email || ""
      } : null);
    } catch {
      setDeviceCacheInfo(null);
    } finally {
      setIsRefreshingDeviceCache(false);
    }
  }

  async function handleSyncLocalCopyNow() {
    if (!currentUser?.email) return;
    setIsSyncingDeviceCache(true);
    setError("");
    setSuccessMessage("");
    try {
      await saveMailboxSnapshotToDevice(currentUser, buildCurrentMailboxSnapshot());
      await loadDeviceCacheInfo(currentUser);
      setSuccessMessage("Local device copy synchronized successfully.");
    } catch (e) {
      setError(e.message || "Unable to sync local device copy.");
    } finally {
      setIsSyncingDeviceCache(false);
    }
  }

  async function handleClearDeviceCache() {
    if (!currentUser?.email) return;
    if (!window.confirm("Clear the local mailbox copy stored on this device for the current employee?")) {
      return;
    }

    setIsClearingDeviceCache(true);
    setError("");
    setSuccessMessage("");
    try {
      await clearMailboxSnapshotFromDevice(currentUser);
      setDeviceCacheInfo(null);
      setSuccessMessage("Local device cache cleared for this employee.");
    } catch (e) {
      setError(e.message || "Unable to clear local device cache.");
    } finally {
      setIsClearingDeviceCache(false);
    }
  }

  async function loadAdminSummary() {
    if (!canAccessAdmin) return;
    try { const s = await apiFetch("/api/admin/summary"); setAdminSummary(s); } catch (e) { setError(e.message); }
  }

  async function loadEmployees() {
    try { const r = await apiFetch("/api/admin/employees"); setEmployees(r.employees || []); } catch (e) { setError(e.message); }
  }

  async function runAdminMailTests() {
    setIsRunningAdminMailTests(true); setError(""); setSuccessMessage("");
    try {
      const r = await apiFetch("/api/admin/mail-tests/run", { method: "POST" });
      setAdminMailTests(r);
      setSuccessMessage(`Mail tests completed. Users: ${Number(r.summary?.total_users || 0)}, ok: ${Number(r.summary?.ok_users || 0)}, failed: ${Number(r.summary?.failed_users || 0)}, missing settings: ${Number(r.summary?.missing_settings_users || 0)}.`);
    } catch (e) { setError(e.message); } finally { setIsRunningAdminMailTests(false); }
  }

  async function loadRecentContacts() {
    try { const r = await apiFetch("/api/recent-contacts"); setRecentContacts(r.contacts || []); } catch (e) { /* ignore */ }
  }

  function renderChipEmailInput(fieldKey, placeholder, inputRef) {
    const value = form[fieldKey] || "";
    const isActive = composeInput.field === fieldKey;
    const inputVal = isActive ? composeInput.text : "";
    const selectedEmails = splitRecipientList(value);
    const selectedSet = new Set(selectedEmails.map((item) => extractRecipientAddress(item)));
    const filtered = recentContacts.filter(c => {
      const q = inputVal.toLowerCase();
      if (selectedSet.has(extractRecipientAddress(c.contact_email || ""))) return false;
      if (!q) return true;
      return c.contact_email.toLowerCase().includes(q) || (c.contact_name || "").toLowerCase().includes(q);
    }).sort((left, right) => {
      const leftScore = scoreRecentContactMatch(left, inputVal);
      const rightScore = scoreRecentContactMatch(right, inputVal);

      if (rightScore.exactPrefix !== leftScore.exactPrefix) return rightScore.exactPrefix - leftScore.exactPrefix;
      if (rightScore.labelPrefix !== leftScore.labelPrefix) return rightScore.labelPrefix - leftScore.labelPrefix;
      if (rightScore.contains !== leftScore.contains) return rightScore.contains - leftScore.contains;
      if (leftScore.position !== rightScore.position) return leftScore.position - rightScore.position;
      if (rightScore.useCount !== leftScore.useCount) return rightScore.useCount - leftScore.useCount;
      if (rightScore.lastUsedAt !== leftScore.lastUsedAt) return rightScore.lastUsedAt - leftScore.lastUsedAt;

      return formatRecentContactLabel(left).localeCompare(formatRecentContactLabel(right));
    });

    function addEmailFromInput(val) {
      const sourceValue = normalizeRecipientToken(val || composeInput.text || (inputRef.current ? inputRef.current.value : ""));
      if (!sourceValue) return;
      setForm((prev) => appendRecipientsToField(fieldKey, sourceValue, prev));
      if (inputRef.current) inputRef.current.value = "";
      setComposeInput({ field: fieldKey, text: "", show: false });
    }

    function pickSuggestion(contact) {
      const formattedValue = formatRecentContactLabel(contact);
      setForm((prev) => appendRecipientsToField(fieldKey, formattedValue, prev));
      if (inputRef.current) inputRef.current.value = "";
      setComposeInput({ field: fieldKey, text: "", show: false });
    }

    function openRecipientSuggestions() {
      if (!recentContacts.length) {
        loadRecentContacts();
      }
      setComposeInput((prev) => ({
        field: fieldKey,
        text: prev.field === fieldKey ? prev.text : "",
        show: true
      }));
    }

    return (
      <div style={{ flex: 1, position: "relative" }}>
        <div
          onMouseDown={(e) => {
            if (e.target.closest("button")) {
              return;
            }
            e.preventDefault();
            inputRef.current?.focus();
            openRecipientSuggestions();
          }}
          style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", minHeight: 32, background: "#fff", cursor: "text" }}
        >
          {selectedEmails.length ? selectedEmails.map((email, i) => {
            if (!email) return null;
            const displayName = extractRecipientDisplayName(email);
            const displayAddress = extractRecipientAddress(email);
            const chipLabel = displayName || displayAddress || email;
            const letter = (chipLabel[0] || "?").toUpperCase();
            const avatarStyle = getRecipientAvatarStyle(chipLabel);
            return (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#e8f0fe", border: "1px solid #b8d4fe", borderRadius: 12, padding: "2px 8px", fontSize: 12 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", ...avatarStyle, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600 }}>{letter}</span>
                <span title={email}>{displayName ? `${displayName} <${displayAddress}>` : email}</span>
                <button
                  type="button"
                  onClick={() => {
                    const parts = selectedEmails.filter((_, j) => j !== i);
                    setForm(prev => ({ ...prev, [fieldKey]: joinRecipientList(parts) }));
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#999", padding: 0, lineHeight: 1 }}
                >
                  &times;
                </button>
              </span>
            );
          }) : null}
          <input
            ref={inputRef}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={isActive ? composeInput.text : ""}
            onChange={e => {
              const nextValue = e.target.value;
              const parts = splitRecipientList(nextValue);
              if (parts.length > 1 || /[;,]\s*$/.test(nextValue)) {
                const pendingValue = /[;,]\s*$/.test(nextValue) ? parts.join(", ") : parts.slice(0, -1).join(", ");
                if (pendingValue) {
                  setForm((prev) => appendRecipientsToField(fieldKey, pendingValue, prev));
                }
                setComposeInput({
                  field: fieldKey,
                  text: /[;,]\s*$/.test(nextValue) ? "" : parts[parts.length - 1] || "",
                  show: true
                });
                return;
              }
              setComposeInput({ field: fieldKey, text: nextValue, show: true });
            }}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); addEmailFromInput(); }
              if (e.key === "Backspace" && !composeInput.text && selectedEmails.length) {
                e.preventDefault();
                const parts = selectedEmails.slice(0, -1);
                setForm(prev => ({ ...prev, [fieldKey]: joinRecipientList(parts) }));
              }
              if (e.key === "Escape") setComposeInput(prev => ({ ...prev, show: false }));
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const items = e.target.parentElement.parentElement.querySelectorAll(".autocomplete-item");
                if (!items.length) return;
                let idx = Array.from(items).indexOf(document.activeElement);
                idx = e.key === "ArrowDown" ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
                if (items[idx]) items[idx].focus();
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData?.getData("text") || "";
              if (/[,\n;]+/.test(pasted)) {
                e.preventDefault();
                setForm((prev) => appendRecipientsToField(fieldKey, pasted, prev));
                setComposeInput({ field: fieldKey, text: "", show: false });
              }
            }}
            onBlur={() => {
              const pendingValue = composeInput.field === fieldKey ? composeInput.text : "";
              if (pendingValue.trim()) {
                addEmailFromInput(pendingValue);
              }
              setTimeout(() => setComposeInput(prev => ({ ...prev, show: false })), 200);
            }}
            onFocus={() => openRecipientSuggestions()}
            placeholder={value ? "" : placeholder}
            style={{ border: "none", outline: "none", flex: 1, minWidth: 120, fontSize: 13, padding: "2px 0" }}
          />
        </div>
        {composeInput.show && isActive && filtered.length > 0 ? (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "#fff", border: "1px solid #ddd", borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", maxHeight: 200, overflowY: "auto", marginTop: 2 }}>
            {filtered.slice(0, 8).map((c, i) => {
              const outlookLabel = formatRecentContactLabel(c);
              const letter = (c.contact_name?.[0] || c.contact_email?.[0] || "?").toUpperCase();
              const avatarStyle = getRecipientAvatarStyle(outlookLabel);
              return (
                <div key={i} className="autocomplete-item" tabIndex={0} onClick={() => pickSuggestion(c)} onKeyDown={e => { if (e.key === "Enter") pickSuggestion(c); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", fontSize: 13, borderBottom: i < filtered.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", ...avatarStyle, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{letter}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{outlookLabel}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      Used {c.use_count || 0} time(s){c.last_used_at ? ` • ${dayjs(c.last_used_at).format("MMM D, HH:mm")}` : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "#0f6cbd", fontWeight: 600 }}>Pick</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  async function loadEmailTrailData() {
    setIsLoadingTrail(true);
    try {
      const params = new URLSearchParams();
      Object.entries(emailTrailFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const r = await apiFetch(`/api/admin/email-trail?${params.toString()}`);
      setEmailTrail(r.rows || []);
      setEmailTrailTotal(r.total || 0);
    } catch (e) { setError(e.message); } finally { setIsLoadingTrail(false); }
  }

  async function loadArchives() {
    try { const r = await apiFetch("/api/admin/archives"); setArchives(r.archives || []); } catch (e) { setError(e.message); }
  }

  async function loadArchiveExplorer(nextFilters = null) {
    setIsLoadingArchiveExplorer(true);
    try {
      const effectiveFilters = nextFilters ? { ...archiveExplorerFilters, ...nextFilters } : archiveExplorerFilters;
      const params = new URLSearchParams();
      Object.entries(effectiveFilters).forEach(([key, value]) => {
        if (value !== "" && value !== null && value !== undefined) {
          params.set(key, String(value));
        }
      });
      const queryString = params.toString();
      const response = await apiFetch(`/api/admin/archive-explorer${queryString ? `?${queryString}` : ""}`);
      setArchiveExplorerData({
        totals: response.totals || { registry: 0, content_archive: 0, tracking_tasks: 0 },
        email_registry: response.email_registry || [],
        email_content_archive: response.email_content_archive || [],
        tracking_tasks: response.tracking_tasks || []
      });
      setArchiveExplorerFilters((prev) => ({
        ...prev,
        ...(response.filters || effectiveFilters)
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoadingArchiveExplorer(false);
    }
  }

  async function runArchiveBackfill(nextOptions = null) {
    setIsRunningArchiveBackfill(true);
    setError("");
    setSuccessMessage("");
    try {
      const effectiveOptions = nextOptions ? { ...archiveBackfillForm, ...nextOptions } : archiveBackfillForm;
      const response = await apiFetch("/api/admin/ai-backfill/reanalyze", {
        method: "POST",
        body: {
          limit: Number(effectiveOptions.limit || 0) || null,
          includeSent: Boolean(effectiveOptions.includeSent),
          force: Boolean(effectiveOptions.force)
        }
      });
      setArchiveBackfillJob(response.job || null);
      setArchiveBackfillSummary(response.job?.summary || null);
      setArchiveBackfillForm((prev) => ({ ...prev, ...effectiveOptions }));
      syncArchiveBackfillHistoryJob(response.job || null);
    } catch (e) {
      setError(e.message);
      setIsRunningArchiveBackfill(false);
    }
  }

  async function pollArchiveBackfillJob(jobId) {
    try {
      const response = await apiFetch(`/api/admin/ai-backfill/reanalyze/${jobId}`);
      const job = response.job || null;
      setArchiveBackfillJob(job);
      setArchiveBackfillSummary(job?.summary || null);
      syncArchiveBackfillHistoryJob(job);

      if (job?.status === "completed") {
        setIsRunningArchiveBackfill(false);
        setIsCancellingArchiveBackfill(false);
        setIsRetryingArchiveBackfill(false);
        setSuccessMessage(
          `Backfill completed. Scanned: ${Number(job.summary?.scanned || 0)}, analyzed: ${Number(job.summary?.analyzed || 0)}, created: ${Number(job.summary?.tasks_created || 0)}, updated: ${Number(job.summary?.tasks_updated || 0)}, errors: ${Number(job.summary?.errors || 0)}.`
        );
        if (adminTab === "archives") {
          loadArchiveExplorer();
          loadArchives();
          loadArchiveBackfillHistory();
        }
      } else if (job?.status === "cancelled") {
        setIsRunningArchiveBackfill(false);
        setIsCancellingArchiveBackfill(false);
        setIsRetryingArchiveBackfill(false);
        setSuccessMessage(
          `Backfill cancelled. Processed: ${Number(job.summary?.processed || 0)} / ${Number(job.summary?.scanned || 0)}.`
        );
      } else if (job?.status === "failed") {
        setIsRunningArchiveBackfill(false);
        setIsCancellingArchiveBackfill(false);
        setIsRetryingArchiveBackfill(false);
        setError(job?.summary?.error || "AI backfill job failed.");
      }
    } catch (e) {
      setIsRunningArchiveBackfill(false);
      setIsCancellingArchiveBackfill(false);
      setIsRetryingArchiveBackfill(false);
      setError(e.message);
    }
  }

  async function cancelArchiveBackfillJob() {
    if (!archiveBackfillJob?.job_id) return;
    setIsCancellingArchiveBackfill(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await apiFetch(`/api/admin/ai-backfill/reanalyze/${archiveBackfillJob.job_id}/cancel`, {
        method: "POST"
      });
      setArchiveBackfillJob(response.job || archiveBackfillJob);
      syncArchiveBackfillHistoryJob(response.job || archiveBackfillJob);
      setSuccessMessage("Cancellation requested. The current job will stop after the current item.");
    } catch (e) {
      setError(e.message);
      setIsCancellingArchiveBackfill(false);
    }
  }

  async function retryFailedArchiveBackfillItems() {
    if (!archiveBackfillJob?.job_id) return;
    setIsRetryingArchiveBackfill(true);
    setIsRunningArchiveBackfill(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await apiFetch(`/api/admin/ai-backfill/reanalyze/${archiveBackfillJob.job_id}/retry-failed`, {
        method: "POST",
        body: { force: true }
      });
      setArchiveBackfillJob(response.job || null);
      setArchiveBackfillSummary(response.job?.summary || null);
      syncArchiveBackfillHistoryJob(response.job || null);
      setSuccessMessage("Retry job started for failed items.");
    } catch (e) {
      setError(e.message);
      setIsRunningArchiveBackfill(false);
      setIsRetryingArchiveBackfill(false);
    }
  }

  useEffect(() => {
    if (!archiveBackfillJob?.job_id || !isRunningArchiveBackfill) {
      return undefined;
    }

    const handle = window.setTimeout(() => {
      pollArchiveBackfillJob(archiveBackfillJob.job_id);
    }, 1200);

    return () => window.clearTimeout(handle);
  }, [archiveBackfillJob?.job_id, archiveBackfillJob?.status, isRunningArchiveBackfill]);

  useEffect(() => {
    if (archiveBackfillJob?.status === "queued" || archiveBackfillJob?.status === "running") {
      setIsRunningArchiveBackfill(true);
    }
  }, [archiveBackfillJob?.status]);

  useEffect(() => {
    if (adminTab !== "archives" || !archiveBackfillJob?.job_id || !isRunningArchiveBackfill) {
      return;
    }
    pollArchiveBackfillJob(archiveBackfillJob.job_id);
  }, [adminTab]);

  function syncArchiveBackfillHistoryJob(job) {
    if (!job?.job_id) return;
    setArchiveBackfillHistory((prev) => {
      const filtered = prev.filter((item) => item.job_id !== job.job_id);
      return [job, ...filtered].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()).slice(0, 20);
    });
  }

  async function loadArchiveBackfillHistory() {
    setIsLoadingArchiveBackfillHistory(true);
    try {
      const response = await apiFetch("/api/admin/ai-backfill/reanalyze?limit=20");
      setArchiveBackfillHistory(response.jobs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoadingArchiveBackfillHistory(false);
    }
  }

  useEffect(() => {
    const validTaskIds = new Set(
      (archiveExplorerData.tracking_tasks || [])
        .map((row) => Number(row.task_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setSelectedArchiveTrackingTaskIds((prev) => prev.filter((id) => validTaskIds.has(id)));
  }, [archiveExplorerData.tracking_tasks]);

  function openArchiveBackfillHistoryJob(job) {
    if (!job?.job_id) return;
    setArchiveBackfillJob(job);
    setArchiveBackfillSummary(job.summary || null);
    setArchiveBackfillDetailsJob(job);
    setArchiveBackfillDetailsSearch("");
    setArchiveBackfillDetailsFailedOnly(false);
    setIsArchiveBackfillDetailsOpen(true);
    if (job.status === "queued" || job.status === "running") {
      setIsRunningArchiveBackfill(true);
    }
  }

  function openArchiveBackfillEmailById(emailId) {
    const normalizedId = Number(emailId);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      setError("Email ID is missing for this row.");
      setSuccessMessage("");
      return;
    }
    const targetEmail = data.emails.find((item) => item.id === normalizedId)
      || archiveExplorerData.email_registry.find((item) => Number(item.email_id) === normalizedId)
      || null;
    setCurrentView("mail");
    setSmartFolder(null);
    if (targetEmail?.folder_name) {
      setSelectedFolder(targetEmail.folder_name);
    }
    setSelectedEmailId(normalizedId);
    setIsArchiveBackfillDetailsOpen(false);
    setSuccessMessage(`Opened email ${normalizedId}.`);
    setError("");
  }

  function focusArchiveTrackingTasksByEmailId(emailId) {
    const normalizedId = Number(emailId);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      setError("Email ID is missing for this row.");
      setSuccessMessage("");
      return;
    }
    setCurrentView("admin");
    setAdminTab("archives");
    setArchiveExplorerFocusEmailId(normalizedId);
    setIsArchiveBackfillDetailsOpen(false);
    loadArchiveExplorer();
    setSuccessMessage(`Focused tracking tasks for email ${normalizedId}.`);
    setError("");
  }

  async function refreshTaskViewsAfterArchiveAction() {
    await loadArchiveExplorer();
    if (smartFolder === "tasks" || smartFolder === "tasks-overdue" || smartFolder === "tasks-due-soon") {
      await loadSmartFolder(smartFolder);
    }
  }

  async function openTrackingTaskFromArchive(row) {
    const taskId = Number(row?.existing_task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setError("Task ID is missing for this row.");
      setSuccessMessage("");
      return;
    }
    setActiveTrackingTaskActionKey(`open:${taskId}`);
    setError("");
    setSuccessMessage("");
    try {
      setSmartFolder("tasks");
      setSelectedFolder(null);
      setCurrentView("mail");
      await loadSmartFolder("tasks");
      setSelectedEmailId(taskId);
      setIsArchiveBackfillDetailsOpen(false);
      setSuccessMessage(`Opened task ${taskId}.`);
    } finally {
      setActiveTrackingTaskActionKey("");
    }
  }

  async function markArchiveTrackingTaskDone(row) {
    const taskId = Number(row?.existing_task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setError("Task ID is missing for this row.");
      setSuccessMessage("");
      return;
    }
    setActiveTrackingTaskActionKey(`done:${taskId}`);
    setError("");
    setSuccessMessage("");
    try {
      await apiFetch(`/api/tasks/${taskId}/complete`, { method: "POST" });
      await refreshTaskViewsAfterArchiveAction();
      setSuccessMessage(`Task ${taskId} marked as done.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setActiveTrackingTaskActionKey("");
    }
  }

  async function assignArchiveTrackingTask(row, nextAssignedTo) {
    const taskId = Number(row?.existing_task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setError("Task ID is missing for this row.");
      setSuccessMessage("");
      return;
    }
    const normalizedAssignedTo = nextAssignedTo === "" ? null : Number(nextAssignedTo);
    if (normalizedAssignedTo !== null && (!Number.isInteger(normalizedAssignedTo) || normalizedAssignedTo <= 0)) {
      setError("Assigned user is invalid.");
      setSuccessMessage("");
      return;
    }
    setActiveTrackingTaskActionKey(`assign:${taskId}`);
    setError("");
    setSuccessMessage("");
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        body: { assigned_to: normalizedAssignedTo }
      });
      await refreshTaskViewsAfterArchiveAction();
      const assignedEmployee = employees.find((employee) => Number(employee.id) === normalizedAssignedTo);
      setSuccessMessage(
        normalizedAssignedTo
          ? `Task ${taskId} assigned to ${assignedEmployee?.name || "selected employee"}.`
          : `Task ${taskId} unassigned.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setActiveTrackingTaskActionKey("");
    }
  }

  function openRelatedEmailFromTrackingTask(row) {
    openArchiveBackfillEmailById(row?.email_id);
  }

  function toggleArchiveTrackingTaskSelection(taskId, isSelected) {
    const normalizedTaskId = Number(taskId);
    if (!Number.isInteger(normalizedTaskId) || normalizedTaskId <= 0) {
      return;
    }
    setSelectedArchiveTrackingTaskIds((prev) => {
      if (isSelected) {
        return prev.includes(normalizedTaskId) ? prev : [...prev, normalizedTaskId];
      }
      return prev.filter((id) => id !== normalizedTaskId);
    });
  }

  function toggleAllArchiveTrackingTaskSelections(rows, isSelected) {
    const rowIds = (Array.isArray(rows) ? rows : [])
      .map((row) => Number(row?.task_id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!rowIds.length) {
      setSelectedArchiveTrackingTaskIds([]);
      return;
    }
    setSelectedArchiveTrackingTaskIds((prev) => {
      if (isSelected) {
        return Array.from(new Set([...prev, ...rowIds]));
      }
      return prev.filter((id) => !rowIds.includes(id));
    });
  }

  async function markSelectedArchiveTrackingTasksDone() {
    const selectedRows = archiveExplorerData.tracking_tasks.filter((row) => selectedArchiveTrackingTaskIds.includes(Number(row.task_id)));
    const taskIds = Array.from(new Set(
      selectedRows
        .map((row) => Number(row.existing_task_id))
        .filter((id) => Number.isInteger(id) && id > 0 && String(selectedRows.find((row) => Number(row.existing_task_id) === id)?.status || "").toLowerCase() !== "completed")
    ));
    if (!taskIds.length) {
      setError("No eligible tasks selected.");
      setSuccessMessage("");
      return;
    }
    setActiveBulkTrackingAction("done");
    setError("");
    setSuccessMessage("");
    try {
      await Promise.all(taskIds.map((taskId) => apiFetch(`/api/tasks/${taskId}/complete`, { method: "POST" })));
      await refreshTaskViewsAfterArchiveAction();
      setSelectedArchiveTrackingTaskIds([]);
      setSuccessMessage(`Marked ${taskIds.length} selected task(s) as done.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setActiveBulkTrackingAction("");
    }
  }

  async function assignSelectedArchiveTrackingTasks() {
    const normalizedAssignedTo = bulkArchiveTrackingAssignedTo === "" ? null : Number(bulkArchiveTrackingAssignedTo);
    if (normalizedAssignedTo !== null && (!Number.isInteger(normalizedAssignedTo) || normalizedAssignedTo <= 0)) {
      setError("Assigned user is invalid.");
      setSuccessMessage("");
      return;
    }
    const taskIds = Array.from(new Set(
      archiveExplorerData.tracking_tasks
        .filter((row) => selectedArchiveTrackingTaskIds.includes(Number(row.task_id)))
        .map((row) => Number(row.existing_task_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ));
    if (!taskIds.length) {
      setError("No eligible tasks selected.");
      setSuccessMessage("");
      return;
    }
    setActiveBulkTrackingAction("assign");
    setError("");
    setSuccessMessage("");
    try {
      await Promise.all(taskIds.map((taskId) => apiFetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        body: { assigned_to: normalizedAssignedTo }
      })));
      await refreshTaskViewsAfterArchiveAction();
      setSelectedArchiveTrackingTaskIds([]);
      const assignedEmployee = employees.find((employee) => Number(employee.id) === normalizedAssignedTo);
      setSuccessMessage(
        normalizedAssignedTo
          ? `Assigned ${taskIds.length} selected task(s) to ${assignedEmployee?.name || "selected employee"}.`
          : `Unassigned ${taskIds.length} selected task(s).`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setActiveBulkTrackingAction("");
    }
  }

  function exportSelectedArchiveTrackingTasks() {
    const selectedRows = archiveExplorerData.tracking_tasks.filter((row) => selectedArchiveTrackingTaskIds.includes(Number(row.task_id)));
    if (!selectedRows.length) {
      setError("No selected tracking tasks to export.");
      setSuccessMessage("");
      return;
    }
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Task ID", "Existing Task ID", "Email ID", "Title", "Task Type", "Status", "Priority", "Assigned To", "Project Code", "Serial Number", "Thread ID", "Due Date"].join(","),
      ...selectedRows.map((row) => ([
        escapeCsv(row.task_id),
        escapeCsv(row.existing_task_id),
        escapeCsv(row.email_id),
        escapeCsv(row.source_task_title || row.email_subject || ""),
        escapeCsv(row.task_type || ""),
        escapeCsv(row.status || ""),
        escapeCsv(row.priority || ""),
        escapeCsv(row.assigned_to_name || ""),
        escapeCsv(row.project_code || ""),
        escapeCsv(row.serial_number || ""),
        escapeCsv(row.thread_id || ""),
        escapeCsv(row.due_date || "")
      ].join(",")))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tracking-tasks-selected-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setSuccessMessage(`Exported ${selectedRows.length} selected tracking task(s).`);
    setError("");
  }

  function closeArchiveBackfillDetailsDrawer() {
    setIsArchiveBackfillDetailsOpen(false);
  }

  function getArchiveBackfillDetailRows(job, search = "", failedOnly = false) {
    let rows = Array.isArray(job?.summary?.items) ? job.summary.items : [];
    if (failedOnly) {
      rows = rows.filter((item) => item.status === "error");
    }
    const normalizedSearch = String(search || "").trim().toLowerCase();
    if (!normalizedSearch) {
      return rows;
    }
    return rows.filter((item) => {
      const haystack = [
        item.email_id,
        item.subject,
        item.status,
        item.category,
        item.error
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      return haystack.includes(normalizedSearch);
    });
  }

  async function retryFailedArchiveBackfillItemsForJob(jobId) {
    if (!jobId) return;
    setIsRetryingArchiveBackfill(true);
    setIsRunningArchiveBackfill(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await apiFetch(`/api/admin/ai-backfill/reanalyze/${jobId}/retry-failed`, {
        method: "POST",
        body: { force: true }
      });
      setArchiveBackfillJob(response.job || null);
      setArchiveBackfillSummary(response.job?.summary || null);
      syncArchiveBackfillHistoryJob(response.job || null);
      setSuccessMessage("Retry job started for failed items.");
    } catch (e) {
      setError(e.message);
      setIsRunningArchiveBackfill(false);
      setIsRetryingArchiveBackfill(false);
    }
  }

  function exportArchiveBackfillSummary(job) {
    if (!job?.job_id) return;
    const payload = JSON.stringify(job, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-backfill-summary-${job.job_id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setSuccessMessage(`Exported summary for job ${job.job_id}.`);
  }

  async function copyArchiveBackfillErrors(job, search = "", failedOnly = false) {
    const rows = getArchiveBackfillDetailRows(job, search, failedOnly).filter((item) => item.status === "error");
    if (!rows.length) {
      setError("No error rows available to copy.");
      setSuccessMessage("");
      return;
    }
    const payload = rows.map((item) => {
      return `Email ID: ${item.email_id || "-"} | Subject: ${item.subject || "-"} | Error: ${item.error || "-"}`;
    }).join("\n");
    await copyTextToClipboard(payload, `Copied ${rows.length} error row(s) to clipboard.`);
  }

  function exportArchiveBackfillDetailsCsv(job, search = "", failedOnly = false) {
    const rows = getArchiveBackfillDetailRows(job, search, failedOnly);
    if (!rows.length) {
      setError("No detail rows available to export.");
      setSuccessMessage("");
      return;
    }
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Email ID", "Subject", "Status", "Category", "Created", "Updated", "Skipped", "Error"].join(","),
      ...rows.map((item) => ([
        escapeCsv(item.email_id || ""),
        escapeCsv(item.subject || ""),
        escapeCsv(item.status || ""),
        escapeCsv(item.category || ""),
        escapeCsv(item.created || 0),
        escapeCsv(item.updated || 0),
        escapeCsv(item.skipped || 0),
        escapeCsv(item.error || "")
      ].join(",")))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-backfill-details-${job?.job_id || "job"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setSuccessMessage(`Exported ${rows.length} detail row(s) to CSV.`);
  }

  async function loadSmartFolder(type) {
    try {
      if (type === "unclassified") {
        const r = await apiFetch("/api/unclassified");
        setSmartFolderData(prev => ({ ...prev, unclassified: r.emails || [] }));
      } else if (type === "tasks") {
        const r = await apiFetch("/api/tasks");
        setSmartFolderData(prev => ({ ...prev, tasks: r.tasks || [] }));
      } else if (type === "tasks-overdue") {
        const r = await apiFetch("/api/tasks?status=pending");
        setSmartFolderData(prev => ({ ...prev, tasksOverdue: (r.tasks || []).filter(t => t.due_date && new Date(t.due_date) < new Date()) }));
      } else if (type === "tasks-due-soon") {
        const r = await apiFetch("/api/tasks?status=pending");
        const now = new Date();
        const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        setSmartFolderData(prev => ({ ...prev, tasksDueSoon: (r.tasks || []).filter(t => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= in48h) }));
      } else if (type.startsWith("project-")) {
        const projectId = type.replace("project-", "");
        const r = await apiFetch(`/api/projects/${projectId}/emails`);
        setSmartFolderData(prev => ({ ...prev, [`project-${projectId}`]: r.emails || [] }));
      } else {
        const r = await apiFetch(`/api/smart/${type}`);
        setSmartFolderData(prev => ({ ...prev, [type === "ai-tasks" ? "aiTasks" : type]: r.emails || [] }));
      }
    } catch (e) { setError(e.message); }
  }

  function handleSmartFolderClick(type) {
    setSmartFolder(type);
    setSelectedFolder(null);
    setCurrentView("mail");
    loadSmartFolder(type);
  }

  async function handleUnsnoozeEmail(emailId) {
    try {
      await apiFetch(`/api/emails/${emailId}/unsnooze`, { method: "PUT" });
      loadSmartFolder("snoozed");
    } catch (e) { setError(e.message); }
  }

  async function handleCancelScheduleEmail(emailId) {
    try {
      await apiFetch(`/api/emails/${emailId}/cancel-schedule`, { method: "PUT" });
      loadSmartFolder("scheduled");
    } catch (e) { setError(e.message); }
  }

  async function handleClassifyEmail(emailId, projectId, keyId) {
    try {
      await apiFetch(`/api/unclassified/${emailId}/classify`, {
        method: "POST",
        body: { project_id: projectId || null, email_key_id: keyId || null }
      });
      setUnclassifiedCount(prev => Math.max(0, prev - 1));
      loadSmartFolder("unclassified");
      loadBootstrap();
      setSuccessMessage("Email classified successfully.");
    } catch (e) { setError(e.message); }
  }

  async function loadArchiveStats() {
    try {
      const r = await apiFetch("/api/archive/stats");
      setArchiveStats(r);
    } catch (e) { setError(e.message); }
  }

  async function searchArchive(q) {
    if (!q.trim()) { setArchiveResults([]); return; }
    try {
      const r = await apiFetch(`/api/archive/search?q=${encodeURIComponent(q)}`);
      setArchiveResults(r.emails || []);
    } catch (e) { setError(e.message); }
  }

  async function loadArchiveThread(serial) {
    try {
      const r = await apiFetch(`/api/archive/thread/${encodeURIComponent(serial)}`);
      setArchiveThread(r.thread || []);
    } catch (e) { setError(e.message); }
  }

  async function loadEmailAccounts() {
    try {
      const r = await apiFetch("/api/accounts");
      setEmailAccounts(r.accounts || []);
      const defaultAccount = (r.accounts || []).find(a => a.is_default) || (r.accounts || [])[0];
      if (defaultAccount && !activeAccountId) setActiveAccountId(defaultAccount.id);
    } catch (e) { setError(e.message); }
  }

  async function loadEmailKeys() {
    try {
      const r = await apiFetch("/api/keys");
      setEmailKeys(r.keys || []);
    } catch (e) { /* keys optional */ }
  }

  async function loadProjects() {
    try {
      const r = await apiFetch("/api/projects");
      setProjects(r.projects || []);
    } catch (e) { /* projects optional */ }
  }

  async function addNewAccount() {
    try {
      await apiFetch("/api/accounts", { method: "POST", body: newAccountForm });
      await loadEmailAccounts();
      setShowAddAccountForm(false);
      setNewAccountForm({
        email_address: "", display_name: "",
        smtp_host: "", smtp_port: 587, smtp_ssl: true, smtp_username: "", smtp_password: "",
        imap_host: "", imap_port: 993, imap_ssl: true, imap_username: "", imap_password: "",
        pop3_host: "", pop3_port: 995, pop3_ssl: true, pop3_username: "", pop3_password: "",
        signature_text: ""
      });
      setSuccessMessage("Email account added successfully.");
    } catch (e) { setError(e.message); }
  }

  async function deleteEmailAccountById(accountId) {
    if (!window.confirm("Are you sure you want to delete this email account?")) return;
    try {
      await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      await loadEmailAccounts();
      setSuccessMessage("Email account deleted.");
    } catch (e) { setError(e.message); }
  }

  async function setDefaultAccount(accountId) {
    try {
      await apiFetch(`/api/accounts/${accountId}/default`, { method: "PUT" });
      await loadEmailAccounts();
      setSuccessMessage("Default account updated.");
    } catch (e) { setError(e.message); }
  }

  async function switchAccount(accountId) {
    setActiveAccountId(accountId);
    setShowAccountSwitcher(false);
    await bootstrap(true);
  }

  async function addEmailAccount(accountData) {
    try {
      await apiFetch("/api/accounts", { method: "POST", body: JSON.stringify(accountData) });
      await loadEmailAccounts();
    } catch (e) { setError(e.message); }
  }

  async function deleteEmailAccountById(accountId) {
    try {
      await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      if (activeAccountId === accountId) setActiveAccountId(null);
      await loadEmailAccounts();
    } catch (e) { setError(e.message); }
  }

  async function setDefaultAccount(accountId) {
    try {
      await apiFetch(`/api/accounts/${accountId}/default`, { method: "PUT" });
      setActiveAccountId(accountId);
      await loadEmailAccounts();
    } catch (e) { setError(e.message); }
  }

  async function loadPendingApprovals() {
    setIsLoadingApprovals(true);
    try { const r = await apiFetch("/api/approvals/pending"); setPendingApprovals(r.pending || []); } catch (e) { setError(e.message); }
    finally { setIsLoadingApprovals(false); }
  }

  async function loadApprovalHistory(emailId = selectedEmail?.id) {
    if (!emailId) {
      setApprovalHistory([]);
      setApprovalHistoryEmailId(null);
      return;
    }
    setIsLoadingApprovalHistory(true);
    try {
      const r = await apiFetch(`/api/approvals/${emailId}/history`);
      setApprovalHistory(r.history || []);
      setApprovalHistoryEmailId(emailId);
    } catch (e) {
      setApprovalHistory([]);
      setApprovalHistoryEmailId(emailId);
      setError(e.message);
    } finally {
      setIsLoadingApprovalHistory(false);
    }
  }

  async function openApprovalHistoryDrawer(emailOrId = selectedEmail) {
    const resolvedId = typeof emailOrId === "object" ? Number(emailOrId?.id || 0) : Number(emailOrId || 0);
    if (!resolvedId) return;
    setApprovalDrawerEmailId(resolvedId);
    setIsApprovalDrawerOpen(true);
    await loadApprovalHistory(resolvedId);
  }

  function closeApprovalHistoryDrawer() {
    setIsApprovalDrawerOpen(false);
  }

  function closeDialog(clearPendingAction = false) {
    setDialog(null);
    if (clearPendingAction) {
      setPendingQueryAction(null);
    }
  }

  async function copyTextToClipboard(value, successText) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value || ""));
        setSuccessMessage(successText || "Copied to clipboard.");
        setError("");
        return;
      }
      throw new Error("Clipboard is not available.");
    } catch (e) {
      setError(e.message || "Unable to copy to clipboard.");
      setSuccessMessage("");
    }
  }

  async function loadApprovalActionLinks(emailId, forceRefresh = false) {
    const normalizedId = Number(emailId || 0);
    if (!normalizedId) return null;
    if (!forceRefresh && approvalActionLinksByEmail[normalizedId]) {
      return approvalActionLinksByEmail[normalizedId];
    }
    try {
      const r = await apiFetch(`/api/approvals/${normalizedId}/action-links`);
      const actionLinks = r.action_links || null;
      if (actionLinks) {
        setApprovalActionLinksByEmail((prev) => ({ ...prev, [normalizedId]: actionLinks }));
      }
      return actionLinks;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }

  async function ensureApprovalActionLinks(emailId = approvalDrawerEmailId || selectedEmail?.id) {
    const normalizedId = Number(emailId || 0);
    if (!normalizedId) return null;
    return approvalActionLinksByEmail[normalizedId] || await loadApprovalActionLinks(normalizedId);
  }

  async function revokeApprovalActionLinks(emailId, reason = "Links revoked from manager view.") {
    const normalizedId = Number(emailId || 0);
    if (!normalizedId) return null;
    const r = await apiFetch(`/api/approvals/${normalizedId}/action-links/revoke`, {
      method: "POST",
      body: { reason }
    });
    setApprovalActionLinksByEmail((prev) => {
      const next = { ...prev };
      delete next[normalizedId];
      return next;
    });
    return r;
  }

  async function handleApprovalQueryAction(token, managerComments = "") {
    if (!token) {
      throw new Error("Approval action token is missing.");
    }
    return apiFetch("/api/approval-actions/execute", {
      method: "POST",
      body: {
        token,
        manager_comments: managerComments
      }
    }, "");
  }

  function openApprovalActionDialog(action, emailId, token, defaultComments = "") {
    const label = action === "approve" ? "Approve Email" : "Reject Email";
    const existingEmail = pendingApprovals.find((item) => Number(item.id) === Number(emailId))
      || data.emails.find((item) => Number(item.id) === Number(emailId))
      || selectedEmail;
    let draftComments = defaultComments || "";
    setDialog({
      title: label,
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#555" }}>
            {action === "approve"
              ? "This approval link requested a secure approval confirmation inside the app."
              : "This rejection link requested a secure rejection confirmation inside the app."}
          </div>
          {existingEmail ? (
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.5 }}>
              <strong>{existingEmail.subject}</strong>
              <div>Serial: {existingEmail.serial || `Email #${existingEmail.id}`}</div>
            </div>
          ) : null}
          <textarea
            rows={4}
            defaultValue={draftComments}
            placeholder={action === "approve" ? "Optional manager comments" : "Required rejection comments"}
            onChange={(e) => {
              draftComments = e.target.value;
            }}
          />
        </div>
      ),
      actions: [
        { label: "Cancel", onClick: () => { setDialog(null); setPendingQueryAction(null); }, style: "secondary" },
        {
          label: action === "approve" ? "Confirm Approval" : "Confirm Rejection",
          style: action === "approve" ? "primary" : "danger",
          onClick: async () => {
            if (action === "reject" && !String(draftComments || "").trim()) {
              setError("Manager comments are required before rejecting an email.");
              return;
            }
            try {
              const result = await handleApprovalQueryAction(token, draftComments);
              setSuccessMessage(result.message || (action === "approve" ? "Email approved." : "Email rejected."));
              setError("");
              setDialog(null);
              setPendingQueryAction(null);
              await loadPendingApprovals();
              await loadBootstrap();
              if (emailId) {
                await loadApprovalHistory(emailId);
              }
              if (typeof window !== "undefined") {
                const params = new URLSearchParams(window.location.search);
                params.delete("action");
                params.delete("token");
                const nextSearch = params.toString();
                window.history.replaceState({}, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
              }
            } catch (e) {
              setError(e.message || "Unable to execute approval action.");
            }
          }
        }
      ]
    });
  }

  async function handleApproveEmail(emailId, managerComments = "") {
    try {
      await apiFetch(`/api/approvals/${emailId}/approve`, { method: "POST", body: { manager_comments: managerComments } });
      setSuccessMessage("Email approved.");
      setManagerDecisionNotes(prev => ({ ...prev, [emailId]: "" }));
      await loadPendingApprovals();
      await loadBootstrap();
      if (selectedEmail?.id === emailId) {
        await loadApprovalHistory(emailId);
      }
    } catch (e) { setError(e.message); }
  }

  async function handleRejectEmail(emailId, reason = "") {
    try {
      await apiFetch(`/api/approvals/${emailId}/reject`, { method: "POST", body: { reason: reason || "Rejected without comments" } });
      setSuccessMessage("Email rejected. Employee notified.");
      setManagerDecisionNotes(prev => ({ ...prev, [emailId]: "" }));
      await loadPendingApprovals();
      await loadBootstrap();
      if (selectedEmail?.id === emailId) {
        await loadApprovalHistory(emailId);
      }
    } catch (e) { setError(e.message); }
  }

  async function loadAnalytics() {
    try { const r = await apiFetch("/api/admin/analytics"); setAnalytics(r); } catch (e) { setError(e.message); }
  }

  async function loadApprovalAnalytics() {
    try {
      const r = await apiFetch("/api/admin/approval-analytics");
      setApprovalAnalytics(r);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { if (token) { loadBootstrap(token); } else { setIsLoading(false); } }, [token]);
  useEffect(() => {
    if (!currentUser?.email) return;
    const snapshot = {
      ...data,
      currentUser,
      settings: settingsForm || data.settings || null
    };
    const saveTimer = setTimeout(() => {
      saveMailboxSnapshotToDevice(currentUser, snapshot).catch(() => {});
      localStorage.setItem(lastUserStorageKey, JSON.stringify({
        id: currentUser.id || null,
        email: currentUser.email || "",
        name: currentUser.name || "",
        role: currentUser.role || ""
      }));
    }, 300);
    return () => clearTimeout(saveTimer);
  }, [currentUser, data, settingsForm]);
  useEffect(() => {
    if (currentView === "admin" && token && canAccessAdmin) {
      loadAdminSummary();
      if (adminTab === "overview") loadAnalytics();
      if (adminTab === "employees") loadEmployees();
      if (adminTab === "trail") loadEmailTrailData();
      if (adminTab === "archives") { loadArchives(); loadArchiveExplorer(); loadArchiveBackfillHistory(); }
      if (adminTab === "approval") loadApprovalAnalytics();
      if (adminTab === "mail-tests" && !adminMailTests) runAdminMailTests();
    }
  }, [currentView, token, canAccessAdmin, adminTab]);
  useEffect(() => { if (currentView === "approvals" && token) { loadPendingApprovals(); } }, [currentView, token]);
  useEffect(() => {
    if (currentView !== "approvals" || !pendingApprovals.length) return;
    pendingApprovals.slice(0, 6).forEach((email) => {
      if (!approvalActionLinksByEmail[email.id]) {
        loadApprovalActionLinks(email.id, true);
      }
    });
  }, [currentView, pendingApprovals, approvalActionLinksByEmail]);
  useEffect(() => {
    if (currentView !== "approvals" || !token) return;
    const interval = setInterval(() => { loadPendingApprovals(); }, 15000);
    return () => clearInterval(interval);
  }, [currentView, token]);
  useEffect(() => {
    if (currentView !== "approvals") return;
    const interval = setInterval(() => setApprovalClock(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [currentView]);
  useEffect(() => { if (currentView === "settings" && token) loadMailServiceStatus(); }, [currentView, token]);
  useEffect(() => { if (currentView === "settings" && token && (currentUser || lastKnownUser)) loadDeviceCacheInfo(currentUser || lastKnownUser); }, [currentView, token, currentUser, lastKnownUser, data.emails.length, data.attachments.length, data.folders.length]);

  // Auto-refresh emails every 60 seconds + browser notification for new emails
  useEffect(() => {
    if (!token) return;
    const prevEmailIdsRef = { current: new Set(data.emails.map(e => e.id)) };

    const interval = setInterval(async () => {
      try {
        const prevIds = prevEmailIdsRef.current;
        const payload = await apiFetch("/api/bootstrap", {}, token);
        if (!payload?.emails) return;

        const newEmails = payload.emails.filter(e => !prevIds.has(e.id));

        if (newEmails.length > 0 && prevIds.size > 0) {
          const newUnread = newEmails.filter(e => !e.is_read);

          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            newUnread.forEach(email => {
              new Notification("New Email", {
                body: `${email.sender_name || email.sender_email}\n${email.subject}`,
                icon: "/logo.gif",
                tag: `email-${email.id}`
              });
            });
          }

          if (newUnread.length > 0) {
            setSuccessMessage(`${newUnread.length} new email(s) received`);
          }
        }

        prevEmailIdsRef.current = new Set(payload.emails.map(e => e.id));
        setData(payload);
      } catch (e) { /* silent */ }
    }, 60000);

    return () => clearInterval(interval);
  }, [token]);
  useEffect(() => { if (!canAccessAdmin && currentView === "admin") setCurrentView("mail"); }, [canAccessAdmin, currentView]);
  useEffect(() => { setSelectedEmailIds([]); }, [selectedFolder]);
  useEffect(() => { localStorage.setItem(savedFiltersStorageKey, JSON.stringify(savedFilters)); }, [savedFilters]);
  useEffect(() => {
    if (!token || !currentUser) return;
    if (!canAccessAdmin) {
      setEmployees([]);
      return;
    }
    loadEmployees();
  }, [token, currentUser, canAccessAdmin]);
  useEffect(() => {
    if (!token || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const requestedEmailId = Number(params.get("email") || 0);
    const requestedPanel = params.get("panel");
    const requestedAction = params.get("action");
    const requestedToken = params.get("token");
    if (requestedView === "approvals") {
      setCurrentView("approvals");
      if (requestedEmailId) {
        setSelectedEmailId(requestedEmailId);
        if (requestedPanel === "history") {
          openApprovalHistoryDrawer(requestedEmailId);
        }
        if (requestedAction && requestedToken) {
          setPendingQueryAction({
            action: requestedAction,
            token: requestedToken,
            emailId: requestedEmailId
          });
        }
      }
    }
  }, [token]);
  useEffect(() => {
    if (!pendingQueryAction || dialog) return;
    const noteSeed = managerDecisionNotes[pendingQueryAction.emailId] || "";
    openApprovalActionDialog(
      pendingQueryAction.action,
      pendingQueryAction.emailId,
      pendingQueryAction.token,
      noteSeed
    );
  }, [pendingQueryAction, dialog, managerDecisionNotes]);

  const scopedEmails = useMemo(() => {
    if (smartFolder) {
      if (smartFolder === "scheduled") return smartFolderData.scheduled;
      if (smartFolder === "snoozed") return smartFolderData.snoozed;
      if (smartFolder === "ai-tasks") return smartFolderData.aiTasks;
      if (smartFolder === "unclassified") return smartFolderData.unclassified || [];
      if (smartFolder === "tasks") return (smartFolderData.tasks || []).map(t => ({ ...t, _isTask: true, subject: t.title, folder_name: "Tasks" }));
      if (smartFolder === "tasks-overdue") return (smartFolderData.tasksOverdue || []).map(t => ({ ...t, _isTask: true, subject: t.title, folder_name: "Tasks" }));
      if (smartFolder === "tasks-due-soon") return (smartFolderData.tasksDueSoon || []).map(t => ({ ...t, _isTask: true, subject: t.title, folder_name: "Tasks" }));
      if (smartFolder.startsWith("project-")) {
        const projectId = smartFolder.replace("project-", "");
        return smartFolderData[`project-${projectId}`] || [];
      }
      return [];
    }
    return searchScope === "All" ? data.emails : data.emails.filter(e => e.folder_name === selectedFolder);
  }, [data.emails, searchScope, selectedFolder, smartFolder, smartFolderData]);

  const filteredEmails = useMemo(() => {
    const nSearch = searchQuery.trim().toLowerCase();
    const nFrom = advancedSearch.from.trim().toLowerCase();
    const nTo = advancedSearch.to.trim().toLowerCase();
    const nSubj = advancedSearch.subject.trim().toLowerCase();
    const fDate = advancedSearch.dateFrom ? dayjs(advancedSearch.dateFrom).startOf("day") : null;
    const tDate = advancedSearch.dateTo ? dayjs(advancedSearch.dateTo).endOf("day") : null;
    const filtered = scopedEmails.filter(e => {
      const vs = e.recalled ? "Recalled" : e.folder_name === "Outbox" && e.queue_last_error ? "Failed" : e.folder_name === "Outbox" ? "Queued" : e.status === "Sent" || e.folder_name === "Sent" ? "Sent" : e.status;
      const matchSearch = !nSearch || [e.subject, e.preview, e.body, e.sender_name, e.sender_email, e.recipient_email, e.serial].filter(Boolean).some(v => String(v).toLowerCase().includes(nSearch));
      const matchFrom = !nFrom || [e.sender_name, e.sender_email].filter(Boolean).some(v => String(v).toLowerCase().includes(nFrom));
      const matchTo = !nTo || [e.recipient_name, e.recipient_email, e.cc_list].filter(Boolean).some(v => String(v).toLowerCase().includes(nTo));
      const matchSubject = !nSubj || String(e.subject || "").toLowerCase().includes(nSubj);
      const ed = dayjs(e.sent_at || e.received_at);
      const matchDate = (!fDate || ed.isAfter(fDate) || ed.isSame(fDate)) && (!tDate || ed.isBefore(tDate) || ed.isSame(tDate));
      const matchFilter = activeFilter === "All" || (activeFilter === "Unread" && !e.is_read) || (activeFilter === "Sent" && vs === "Sent") || (activeFilter === "Queued" && vs === "Queued") || (activeFilter === "Failed" && vs === "Failed") || (activeFilter === "Attachments" && e.has_attachments);
      return matchSearch && matchFrom && matchTo && matchSubject && matchDate && matchFilter;
    });
    const rank = { High: 3, Normal: 2, Low: 1 };
    return [...filtered].sort((a, b) => {
      if (sortBy === "Sender") return String(a.sender_name || "").localeCompare(String(b.sender_name || ""));
      if (sortBy === "Subject") return String(a.subject || "").localeCompare(String(b.subject || ""));
      if (sortBy === "Priority") return (rank[b.priority] || 0) - (rank[a.priority] || 0);
      return new Date(b.sent_at || b.received_at).getTime() - new Date(a.sent_at || a.received_at).getTime();
    });
  }, [scopedEmails, searchQuery, searchScope, activeFilter, sortBy, advancedSearch]);

  const highlightTerms = useMemo(() => [searchQuery, advancedSearch.from, advancedSearch.to, advancedSearch.subject].map(t => t.trim()).filter(Boolean), [searchQuery, advancedSearch.from, advancedSearch.to, advancedSearch.subject]);

  const selectedEmail = filteredEmails.find(e => e.id === selectedEmailId) || data.emails.find(e => e.id === selectedEmailId) || filteredEmails[0] || null;
  useEffect(() => {
    if (!token || !currentUser?.email) return;
  }, [token, currentUser?.email, selectedFolder, activeFilter, searchScope, searchQuery, filteredEmails, data.emails, selectedEmail?.id]);

  useEffect(() => {
    if (!selectedEmail?.id) {
      setApprovalHistory([]);
      setApprovalHistoryEmailId(null);
      return;
    }
    if (selectedEmail.approval_status && selectedEmail.approval_status !== "none") {
      loadApprovalHistory(selectedEmail.id);
      return;
    }
    if (selectedEmail.approval_root_id || selectedEmail.version_number > 1 || selectedEmail.subject_key) {
      loadApprovalHistory(selectedEmail.id);
      return;
    }
    setApprovalHistory([]);
    setApprovalHistoryEmailId(null);
  }, [selectedEmail?.id, selectedEmail?.approval_status, selectedEmail?.approval_root_id, selectedEmail?.version_number, selectedEmail?.subject_key]);
  useEffect(() => {
    if (approvalDrawerEmailId && isApprovalDrawerOpen && !approvalActionLinksByEmail[approvalDrawerEmailId]) {
      loadApprovalActionLinks(approvalDrawerEmailId, true);
    }
  }, [approvalDrawerEmailId, isApprovalDrawerOpen, approvalActionLinksByEmail]);

  useEffect(() => { if (selectedEmail?.folder_name && selectedEmail.folder_name !== moveTarget) setMoveTarget(selectedEmail.folder_name === "Inbox" ? "Deleted" : "Inbox"); }, [selectedEmail?.folder_name]);

  useEffect(() => {
    setCalendarEvent(null);
    if (!selectedEmail) return;

    const emailAttachments = data.attachments.filter(a => a.email_id === selectedEmail.id);

    const calendarAtt = emailAttachments.find(a => {
      const mime = String(a.mime_type || "").toLowerCase();
      const fname = String(a.file_name || "").toLowerCase();
      return mime === "text/calendar" || mime === "text/x-vcalendar" || mime === "application/ics" || fname.endsWith(".ics") || fname.endsWith(".vcf");
    });

    if (calendarAtt) {
      const fileUrl = calendarAtt.file_path || `/uploads/${calendarAtt.file_name}`;
      fetch(fileUrl).then(r => r.ok ? r.text() : "").then(text => {
        if (text && text.includes("BEGIN:VEVENT")) {
          setCalendarEvent(parseIcsContent(text));
        }
      }).catch(() => {});
      return;
    }

    const htmlBody = selectedEmail.body || "";
    if (htmlBody.includes("BEGIN:VCALENDAR") || htmlBody.includes("BEGIN:VEVENT")) {
      const icsMatch = htmlBody.match(/BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
      if (icsMatch) {
        const parsed = parseIcsContent(icsMatch[0]);
        if (parsed) setCalendarEvent(parsed);
        return;
      }
    }

    const textBody = (selectedEmail.body || "").replace(/<[^>]+>/g, "");
    if (textBody.includes("Starts at:") || textBody.includes("DTSTART")) {
      const getField = (label) => {
        const m = textBody.match(new RegExp(label + "\\s*:\\s*(.+?)(?:\\n|$)"));
        return m ? m[1].trim() : "";
      };
      const summary = getField("Subject");
      const location = getField("Location");
      const start = getField("Starts at") || getField("Starts");
      const end = getField("Ends at") || getField("Ends");
      const status = getField("Status");
      const desc = getField("Description");
      const organizer = getField("Calendar");
      if (summary || start) {
        const attendeesMatch = textBody.match(/Attendees?\s*:\s*([^\n]+)/i);
        const attendees = [];
        if (attendeesMatch) {
          attendeesMatch[1].split(/[,;]/).forEach(e => {
            const clean = e.trim();
            if (clean) attendees.push({ name: clean, email: clean, role: "REQ-PARTICIPANT", rsvp: false });
          });
        }
        setCalendarEvent({ summary, location, description: desc, start, end, status, organizer, attendees, isAllDay: false, timezone: "" });
      }
    }
  }, [selectedEmail?.id, selectedEmail?.body, data.attachments]);

  const allFilteredSelected = useMemo(() => filteredEmails.length > 0 && filteredEmails.every(e => selectedEmailIds.includes(e.id)), [filteredEmails, selectedEmailIds]);
  const actionableEmailIds = useMemo(() => selectedEmailIds.length ? selectedEmailIds : (selectedEmail?.id ? [selectedEmail.id] : []), [selectedEmailIds, selectedEmail]);
  const selectedEmailVisualStatus = useMemo(() => { if (!selectedEmail) return ""; if (selectedEmail.recalled) return "Recalled"; if (selectedEmail.folder_name === "Outbox" && selectedEmail.queue_last_error) return "Failed"; if (selectedEmail.folder_name === "Outbox") return "Queued"; if (selectedEmail.status === "Sent" || selectedEmail.folder_name === "Sent") return "Sent"; return selectedEmail.status || ""; }, [selectedEmail]);
  const selectedFolderMeta = useMemo(() => data.folders.find(f => f.name === selectedFolder) || null, [data.folders, selectedFolder]);

  const resultSummary = useMemo(() => {
    const baseCount = scopedEmails.length;
    return { scopeLabel: smartFolder ? smartFolder.charAt(0).toUpperCase() + smartFolder.slice(1).replace("-", " ") : (searchScope === "All" ? "All folders" : selectedFolder), totalMatches: filteredEmails.length, baseCount, unreadCount: filteredEmails.filter(e => !e.is_read).length, attachmentsCount: filteredEmails.filter(e => e.has_attachments).length };
  }, [scopedEmails, filteredEmails, searchScope, selectedFolder, smartFolder]);

  const selectedAttachments = useMemo(() => data.attachments.filter(a => a.email_id === selectedEmail?.id), [data.attachments, selectedEmail]);
  const selectedVisibleAttachments = useMemo(
    () => selectedAttachments.filter((attachment) => !normalizeBooleanFlag(attachment.is_inline, false)),
    [selectedAttachments]
  );
  const selectedVisibleAttachmentCards = useMemo(
    () => selectedVisibleAttachments.map((attachment) => ({
      ...attachment,
      previewMeta: getAttachmentPreviewMeta(attachment),
      sizeLabel: formatAttachmentSize(attachment.file_size)
    })),
    [selectedVisibleAttachments]
  );
  const selectedRecommendations = useMemo(() => data.recommendations.filter(r => r.email_id === selectedEmail?.id), [data.recommendations, selectedEmail]);
  const selectedReminders = useMemo(() => data.reminders.filter(r => r.email_id === selectedEmail?.id), [data.reminders, selectedEmail]);
  const selectedEmailHtmlDocument = useMemo(() => {
    if (!selectedEmail?.body_html) {
      return "";
    }
    return buildEmailHtmlDocument(selectedEmail.body_html);
  }, [selectedEmail?.body_html]);
  useEffect(() => {
    if (readingHtmlFrameCleanupRef.current) {
      readingHtmlFrameCleanupRef.current();
      readingHtmlFrameCleanupRef.current = null;
    }
    setReadingHtmlFrameHeight(640);
  }, [selectedEmail?.id, selectedEmailHtmlDocument]);
  useEffect(() => () => {
    if (readingHtmlFrameCleanupRef.current) {
      readingHtmlFrameCleanupRef.current();
      readingHtmlFrameCleanupRef.current = null;
    }
  }, []);
  const composeSourceEmail = useMemo(() => {
    const sourceId = Number(form.approval_source_email_id || 0);
    return data.emails.find(e => e.id === sourceId) || null;
  }, [data.emails, form.approval_source_email_id]);
  const composeReplySourceEmail = useMemo(() => {
    const replySourceId = Number(form.reply_source_email_id || 0);
    return data.emails.find(e => e.id === replySourceId) || null;
  }, [data.emails, form.reply_source_email_id]);
  const displayedApprovalHistory = useMemo(() => {
    if (composeSourceEmail?.id && approvalHistoryEmailId === composeSourceEmail.id) {
      return approvalHistory;
    }
    if (selectedEmail?.id && approvalHistoryEmailId === selectedEmail.id) {
      return approvalHistory;
    }
    if (approvalDrawerEmailId && approvalHistoryEmailId === approvalDrawerEmailId) {
      return approvalHistory;
    }
    return [];
  }, [approvalHistory, approvalHistoryEmailId, composeSourceEmail?.id, selectedEmail?.id, approvalDrawerEmailId]);
  const approvalConversationItems = useMemo(
    () => buildApprovalConversationItems(displayedApprovalHistory),
    [displayedApprovalHistory]
  );
  const composeAiRecommendations = useMemo(
    () => String(form.ai_recommendations || "").split("\n").map(v => v.trim()).filter(Boolean),
    [form.ai_recommendations]
  );
  const draftAssistantMeta = useMemo(() => ({
    projectCode: String(form.draft_context_project_code || "").trim(),
    projectName: String(form.draft_context_project_name || "").trim(),
    historyCount: Number(form.draft_context_history_count || 0),
    references: String(form.draft_context_references || "").split("\n").map(v => v.trim()).filter(Boolean),
    contractMemoryCount: Number(form.draft_context_memory_count || 0),
    contractMemoryReferences: String(form.draft_context_memory_references || "").split("\n").map(v => v.trim()).filter(Boolean),
    contractClauseCount: Number(form.draft_context_clause_count || 0),
    contractClauseReferences: String(form.draft_context_clause_references || "").split("\n").map(v => v.trim()).filter(Boolean)
  }), [form.draft_context_clause_count, form.draft_context_clause_references, form.draft_context_history_count, form.draft_context_memory_count, form.draft_context_memory_references, form.draft_context_project_code, form.draft_context_project_name, form.draft_context_references]);
  const isResponsePolicyGuardStale = useMemo(
    () => isResponsePolicyGuardStaleForDraft(form.subject, form.body),
    [responsePolicyGuard, form.subject, form.body]
  );
  const approvalDrawerEmail = useMemo(() => {
    if (!approvalDrawerEmailId) return null;
    return pendingApprovals.find(e => e.id === approvalDrawerEmailId)
      || data.emails.find(e => e.id === approvalDrawerEmailId)
      || (selectedEmail?.id === approvalDrawerEmailId ? selectedEmail : null)
      || null;
  }, [approvalDrawerEmailId, pendingApprovals, data.emails, selectedEmail]);
  const filteredPendingApprovals = useMemo(
    () => pendingApprovals.filter((email) => !showHighRiskOnly || ["high", "critical"].includes(normalizeRiskLevel(email.risk_level))),
    [pendingApprovals, showHighRiskOnly]
  );
  const nextReminderCountdown = useMemo(
    () => formatApprovalReminderCountdown(approvalClock),
    [approvalClock]
  );
  const revisionPhrases = useMemo(() => {
    const rawComments = String(form.manager_comments || "");
    const quoted = [...rawComments.matchAll(/"([^"]+)"|'([^']+)'/g)]
      .map((match) => (match[1] || match[2] || "").trim())
      .filter((phrase) => phrase.length >= 4);
    const segmented = rawComments
      .split(/\n+|[.;]+|\s+-\s+|:\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4 && /\s/.test(part));
    const fallbackWords = rawComments
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 5);
    return [...new Set([...quoted, ...segmented, ...fallbackWords])].slice(0, 12);
  }, [form.manager_comments]);
  const highlightedRevisionBlocks = useMemo(() => {
    const blocks = String(form.body || "")
      .split(/\n{2,}/)
      .map((text) => text.trim())
      .filter(Boolean);
    if (!blocks.length) return [];
    return blocks.map((text) => {
      const lower = text.toLowerCase();
      const matches = revisionPhrases.filter((phrase) => lower.includes(String(phrase).toLowerCase()));
      return {
        text,
        matches,
        isRejected: matches.length > 0
      };
    });
  }, [form.body, revisionPhrases]);
  const revisionMatchedBlockCount = useMemo(
    () => highlightedRevisionBlocks.filter((block) => block.isRejected).length,
    [highlightedRevisionBlocks]
  );
  const approvalActionLinks = useMemo(() => {
    const targetId = approvalDrawerEmail?.id || selectedEmail?.id || 0;
    return targetId ? (approvalActionLinksByEmail[targetId] || null) : null;
  }, [approvalActionLinksByEmail, approvalDrawerEmail?.id, selectedEmail?.id]);
  const storageStatusCards = useMemo(() => ([
    {
      label: "Server Emails",
      value: data.emails.length,
      note: "Primary source for analysis"
    },
    {
      label: "Device Cache",
      value: deviceCacheInfo?.emailCount ?? 0,
      note: deviceCacheInfo?.savedAt ? `Last sync ${dayjs(deviceCacheInfo.savedAt).format("YYYY-MM-DD HH:mm")}` : "No local copy yet"
    },
    {
      label: "Folders",
      value: data.folders.length,
      note: deviceCacheInfo?.folderCount ? `${deviceCacheInfo.folderCount} cached locally` : "Waiting for first local sync"
    }
  ]), [data.emails.length, data.folders.length, deviceCacheInfo]);

  const monthlyCalendar = useMemo(() => {
    const start = calDate.startOf("month").startOf("week");
    return Array.from({ length: 42 }, (_, i) => {
      const d = start.add(i, "day");
      return { date: d, events: data.calendar.filter(ev => dayjs(ev.starts_at).format("YYYY-MM-DD") === d.format("YYYY-MM-DD")) };
    });
  }, [data.calendar, calDate]);

  const weeklyCalendar = useMemo(() => {
    const start = calDate.startOf("week");
    return Array.from({ length: 7 }, (_, i) => {
      const d = start.add(i, "day");
      return { date: d, events: data.calendar.filter(ev => dayjs(ev.starts_at).format("YYYY-MM-DD") === d.format("YYYY-MM-DD")) };
    });
  }, [data.calendar, calDate]);

  const dashboardStats = useMemo(() => {
    const total = data.emails.length;
    return [
      { label: "Archived Emails", value: total },
      { label: "High Priority", value: data.emails.filter(e => e.priority === "High").length },
      { label: "Attachments", value: data.emails.filter(e => e.has_attachments).length },
      { label: "Action Required", value: data.emails.filter(e => e.status === "Action Required").length }
    ];
  }, [data.emails]);

  function highlightText(text, terms, fallback = "") {
    const raw = String(text ?? fallback ?? "");
    return renderHighlightedTextSegments(raw, terms);
  }
  function highlightReviewPhrases(text, phrases) {
    const raw = String(text || "");
    const nt = [...new Set((phrases || []).map((phrase) => String(phrase).trim()).filter(Boolean))];
    if (!nt.length || !raw) return raw;
    const re = new RegExp(`(${nt.map(escapeRegExp).join("|")})`, "gi");
    return raw.split(re).map((p, i) => nt.some(t => p.toLowerCase() === t.toLowerCase())
      ? <mark key={`${p}-${i}`} className="o365-review-mark">{p}</mark>
      : <Fragment key={`${p}-${i}`}>{p}</Fragment>);
  }
  function renderInlineReviewOverlay(text, phrases) {
    const raw = String(text || "");
    if (!raw) {
      return <span className="o365-compose-overlay-placeholder">Type your message here</span>;
    }
    const nt = [...new Set((phrases || []).map((phrase) => String(phrase).trim()).filter(Boolean))];
    if (!nt.length) {
      return raw;
    }
    const re = new RegExp(`(${nt.map(escapeRegExp).join("|")})`, "gi");
    return raw.split(re).map((part, index) =>
      nt.some((phrase) => part.toLowerCase() === phrase.toLowerCase())
        ? <mark key={`${part}-${index}`} className="o365-review-mark inline">{part}</mark>
        : <Fragment key={`${part}-${index}`}>{part}</Fragment>
    );
  }
  function handleComposeBodyScroll(event) {
    setComposeReviewScroll({
      top: event.currentTarget.scrollTop,
      left: event.currentTarget.scrollLeft
    });
  }
  function resetAdvancedSearch() { setAdvancedSearch({ from: "", to: "", subject: "", dateFrom: "", dateTo: "" }); }

  function saveCurrentFilter() {
    const trimmed = savedFilterName.trim();
    if (!trimmed) { setError("Enter a name to save the current filter."); return; }
    setSavedFilters(p => [...p.filter(f => f.name !== trimmed), { id: Date.now(), name: trimmed, searchQuery, searchScope, activeFilter, sortBy, advancedSearch }]);
    setSavedFilterName(""); setSuccessMessage(`Saved filter "${trimmed}".`); setError("");
  }
  function applySavedFilter(f) {
    setSearchQuery(f.searchQuery || ""); setSearchScope(f.searchScope || "Current");
    setActiveFilter(f.activeFilter || "All"); setSortBy(f.sortBy || "Date");
    setAdvancedSearch(f.advancedSearch || { from: "", to: "", subject: "", dateFrom: "", dateTo: "" });
    setShowAdvancedSearch(true); setSuccessMessage(`Applied saved filter "${f.name}".`); setError("");
  }
  function deleteSavedFilter(id) { setSavedFilters(p => p.filter(f => f.id !== id)); }

  async function exportSearchResults(format) {
    if (!filteredEmails.length) { setError("No search results available to export."); setSuccessMessage(""); return; }
    const rows = filteredEmails.map(e => ({ Folder: e.folder_name, From: e.sender_name, FromEmail: e.sender_email, To: e.recipient_email, CC: e.cc_list || "", BCC: e.bcc_list || "", Subject: e.subject, Priority: e.priority, Status: e.recalled ? "Recalled" : e.folder_name === "Outbox" && e.queue_last_error ? "Failed" : e.folder_name === "Outbox" ? "Queued" : e.status === "Sent" || e.folder_name === "Sent" ? "Sent" : e.status, Serial: e.serial, Date: dayjs(e.sent_at || e.received_at).format("YYYY-MM-DD HH:mm:ss"), HasAttachments: e.has_attachments ? "Yes" : "No", Preview: e.preview }));
    const stamp = dayjs().format("YYYYMMDD-HHmmss");
    if (format === "csv") {
      const headers = Object.keys(rows[0] || {});
      const csv = [
        headers.map(escapeCsvCell).join(","),
        ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","))
      ].join("\r\n");
      const b = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = `email-search-results-${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(u);
      setSuccessMessage("Exported search results to CSV.");
      setError("");
      return;
    }
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb, ws, "Search Results"); XLSX.writeFile(wb, `email-search-results-${stamp}.xlsx`); setSuccessMessage("Exported search results to Excel."); setError("");
  }

  async function handleLogin(event) {
    event.preventDefault(); setAuthLoading(true); setError("");
    try {
      const session = await apiFetch("/api/auth/login", { method: "POST", body: authForm }, "");
      localStorage.setItem("emailarray_token", session.token);
      localStorage.setItem(lastUserStorageKey, JSON.stringify({
        id: session.user?.id || null,
        email: session.user?.email || authForm.email || "",
        name: session.user?.name || "",
        role: session.user?.role || ""
      }));
      setLastKnownUser({
        id: session.user?.id || null,
        email: session.user?.email || authForm.email || "",
        name: session.user?.name || "",
        role: session.user?.role || ""
      });
      setCurrentUser(session.user); setToken(session.token); setCurrentView("mail");
      if (Notification && Notification.permission === "default") {
        Notification.requestPermission();
      }
      const imp = session.impersonated_by || null;
      setImpersonatedBy(imp);
      if (imp) localStorage.setItem("emailarray_impersonated_by", JSON.stringify(imp));
      else localStorage.removeItem("emailarray_impersonated_by");
    } catch (e) { setError(e.message); } finally { setAuthLoading(false); }
  }

  function handleLogout() {
    localStorage.removeItem("emailarray_token"); localStorage.removeItem("emailarray_impersonated_by");
    setToken(""); setCurrentUser(null);
    setAdminSummary(null); setCurrentView("mail"); setSelectedEmailId(null); setError(""); setSuccessMessage("");
    setImpersonatedBy(null);
  }

  async function handleSubmit(event) {
    event.preventDefault(); setIsSubmitting(true); setError("");
    const resolvedForm = commitComposeInput(form);
    setForm(resolvedForm);
    const payload = new FormData();
    Object.entries(resolvedForm).forEach(([k, v]) => payload.append(k, v));
    files.forEach(f => payload.append("attachments", f));
    try {
      await apiFetch("/api/emails", { method: "POST", body: payload }, token);
      await loadBootstrap(); setForm(createDefaultComposeForm()); setFiles([]);
      setSuccessMessage("Email saved to Drafts.");
    } catch (e) { setError(e.message); } finally { setIsSubmitting(false); }
  }

  async function handleSendEmail() {
    setIsSendingEmail(true); setError(""); setSuccessMessage("");
    if (requiresManagerApproval && !currentUser?.manager_id) {
      setError("No approval manager is assigned to your account. Ask the admin to assign one from Admin > Employees.");
      setIsSendingEmail(false);
      return;
    }
    const resolvedForm = commitComposeInput(form);
    const activeAccount = emailAccounts.find(a => a.id === activeAccountId) || emailAccounts[0];
    const currentUserId = Number(currentUser?.id || 0);
    let safeRewriteApprovalLockToUse = null;
    if (activeAccount?.signature_text && resolvedForm.body && !resolvedForm.body.includes(activeAccount.signature_text)) {
      resolvedForm.body = resolvedForm.body + "\n\n" + activeAccount.signature_text;
    }
    if (resolvedForm.email_key_id && resolvedForm.subject) {
      const selectedKey = emailKeys.find(k => k.id === Number(resolvedForm.email_key_id));
      if (selectedKey) {
        const yy = String(new Date().getFullYear()).slice(-2);
        resolvedForm.subject = `${selectedKey.key_code}:${yy}/${resolvedForm.subject}`;
      }
    }
    const replySourceId = Number(resolvedForm.reply_source_email_id || 0);
    if (replySourceId) {
      let guardToUse = responsePolicyGuard;
      if (isResponsePolicyGuardStaleForDraft(resolvedForm.subject, resolvedForm.body)) {
        try {
          guardToUse = await runResponsePolicyGuard({
            subjectOverride: resolvedForm.subject,
            bodyOverride: resolvedForm.body,
            projectIdOverride: resolvedForm.project_id || "",
            silent: true
          });
        } catch (guardError) {
          setError(guardError.message);
          setIsSendingEmail(false);
          return;
        }
      }
      const approvalLock = guardToUse?.approval_lock || null;
      const isApprovalLockBlocking = Boolean(
        approvalLock?.required
        && Number(approvalLock?.approver_id || 0)
        && Number(approvalLock?.approver_id || 0) !== currentUserId
      );
      if (isApprovalLockBlocking) {
        const safeRewriteBody = String(guardToUse?.safe_rewrite?.rewritten_body || "").trim();
        if (!approvalLock?.can_submit_for_approval || !approvalLock?.approver_id) {
          setError(approvalLock?.summary || "This sensitive safe rewrite requires an assigned approver before it can be submitted.");
          setIsSendingEmail(false);
          return;
        }
        if (!safeRewriteBody) {
          setError("No approved safe rewrite body is available for submission.");
          setIsSendingEmail(false);
          return;
        }
        resolvedForm.body = mergeSuggestedReplyBody(resolvedForm.body, safeRewriteBody);
        if (activeAccount?.signature_text && resolvedForm.body && !resolvedForm.body.includes(activeAccount.signature_text)) {
          resolvedForm.body = resolvedForm.body + "\n\n" + activeAccount.signature_text;
        }
        safeRewriteApprovalLockToUse = approvalLock;
      }
      const hasSevereRisk = ["high", "critical"].includes(String(guardToUse?.severity || "").toLowerCase())
        || String(guardToUse?.verdict || "").toLowerCase() === "blocked";
      if (hasSevereRisk && !safeRewriteApprovalLockToUse) {
        const proceed = window.confirm(
          `${guardToUse?.summary || "Policy Guard detected significant risks in this reply."}\n\nDo you want to send anyway?`
        );
        if (!proceed) {
          setError("Send cancelled until the Response Policy Guard warnings are reviewed.");
          setIsSendingEmail(false);
          return;
        }
      }
    }
    setForm(resolvedForm);
    const payload = new FormData();
    Object.entries(resolvedForm).forEach(([k, v]) => payload.append(k, v));
    files.forEach(f => payload.append("attachments", f));
    if (currentUser?.id) payload.append("user_id", currentUser.id);
    if (activeAccountId) payload.append("account_id", activeAccountId);
    if (safeRewriteApprovalLockToUse?.required && safeRewriteApprovalLockToUse?.approver_id) {
      payload.append("force_manager_approval", "true");
      payload.append("forced_manager_id", String(safeRewriteApprovalLockToUse.approver_id));
    }
    try {
      const approvalSourceId = Number(resolvedForm.approval_source_email_id || 0);
      const targetUrl = approvalSourceId ? `/api/approvals/${approvalSourceId}/resubmit` : "/api/mail/send";
      const response = await apiFetch(targetUrl, { method: "POST", body: payload }, token);
      if (response.pending_approval) {
        setForm(createDefaultComposeForm()); setFiles([]);
        await loadBootstrap();
        loadRecentContacts();
        setSuccessMessage(
          safeRewriteApprovalLockToUse
            ? (response.serial
              ? `Sensitive safe rewrite ${response.serial} submitted for approval before apply/send.`
              : "Sensitive safe rewrite submitted for approval before apply/send.")
            : (response.serial
              ? `Email ${response.serial} submitted for manager approval.`
              : "Email submitted for manager approval.")
        );
        return;
      }
      await loadBootstrap();
      setForm(createDefaultComposeForm()); setFiles([]);
      loadRecentContacts();
      // Undo Send: show undo bar for 10 seconds
      if (!response.queued) {
        setUndoState({ email: response.archived, timer: 10 });
        setSuccessMessage("Email sent. You can undo within 10 seconds.");
      } else {
        setSuccessMessage("SMTP failed, queued in Outbox for retry.");
      }
      await loadMailServiceStatus();
    } catch (e) { setError(e.message); } finally { setIsSendingEmail(false); }
  }

  // Undo Send timer
  useEffect(() => {
    if (!undoState) return;
    if (undoState.timer <= 0) { setUndoState(null); return; }
    const id = setTimeout(() => { setUndoState(prev => prev ? { ...prev, timer: prev.timer - 1 } : null); }, 1000);
    return () => clearTimeout(id);
  }, [undoState]);

  async function handleUndoSend() {
    if (!undoState?.email) return;
    try {
      await apiFetch(`/api/emails/${undoState.email.id}/recall`, { method: "POST" });
      await loadBootstrap();
      setUndoState(null);
      setSuccessMessage("Send undone. Email moved to Deleted Items.");
    } catch (e) { setError(e.message); }
  }

  async function handleSaveSettings(event) {
    event.preventDefault(); setIsSavingSettings(true); setError(""); setSuccessMessage("");
    try {
      const response = await apiFetch("/api/settings", { method: "PUT", body: settingsForm });
      setSettingsForm(response.settings);
      setMailServiceStatus(response.status || null);
      setSuccessMessage(response.apply_error ? "Settings saved. Apply is still required for mail service." : "Settings saved successfully.");
      localStorage.setItem("emailarray_webmail_url", settingsForm.webmail_url || "");
      await loadBootstrap();
    } catch (e) { setError(e.message); } finally { setIsSavingSettings(false); }
  }

  async function loadMailServiceStatus() {
    try { const r = await apiFetch("/api/settings/status"); setMailServiceStatus(r.status); } catch (e) { setError(e.message); }
  }

  async function handleTestSettings() {
    setIsTestingSettings(true); setError(""); setSuccessMessage("");
    try { const r = await apiFetch("/api/settings/test", { method: "POST", body: settingsForm }); setTestResult(r.result); if (r.result.ok) setSuccessMessage("Connection test succeeded."); else setError("Connection test failed."); await loadMailServiceStatus(); } catch (e) { setError(e.message); } finally { setIsTestingSettings(false); }
  }

  async function handleApplySettings() {
    setIsApplyingSettings(true); setError(""); setSuccessMessage("");
    try {
      await apiFetch("/api/settings", { method: "PUT", body: settingsForm });
      const r = await apiFetch("/api/settings/apply", { method: "POST" });
      setMailServiceStatus(r.status); setSuccessMessage("Mail service settings applied successfully.");
      await loadBootstrap();
    } catch (e) { setError(e.message); } finally { setIsApplyingSettings(false); }
  }

  async function handleRunCycle() {
    setIsRunningCycle(true); setError(""); setSuccessMessage("");
    try {
      const r = await apiFetch("/api/settings/run-cycle", { method: "POST" });
      setMailServiceStatus(r.status);
      await loadBootstrap();
      const p = await apiFetch("/api/approvals/pending");
      const pending = p.pending || [];
      setPendingApprovals(pending);
      const sentCount = Number(r?.result?.sent || 0);
      const receivedCount = Number(r?.result?.received || 0);
      const skippedCount = Number(r?.result?.skipped || 0);
      let cycleSummary = `Cycle completed. Sent ${sentCount}, received ${receivedCount}, skipped ${skippedCount}. Pending approvals: ${pending.length}.`;

      if (!receivedCount && skippedCount > 0) {
        cycleSummary = `No new emails to sync. ${skippedCount} server message(s) were already synced earlier. Pending approvals: ${pending.length}.`;
      } else if (!receivedCount && !skippedCount) {
        cycleSummary = `No emails were found on the server for this sync cycle. Pending approvals: ${pending.length}.`;
      }

      setSuccessMessage(cycleSummary);
    } catch (e) {
      setError(e.message);
    } finally { setIsRunningCycle(false); }
  }

  async function handleRunFullMailSync() {
    setIsRunningFullMailSync(true); setError(""); setSuccessMessage("");
    try {
      const r = await apiFetch("/api/admin/mail-sync/run-all", { method: "POST" });
      setMailServiceStatus(r.status || null);
      setFullMailSyncSummary(r.summary || null);
      await loadBootstrap();
      await loadAdminSummary();
      if (adminTab === "overview") {
        await loadAnalytics();
      }
      const totals = r.summary?.totals || {};
      setSuccessMessage(`Full mail sync completed. Accounts: ${Number(totals.accounts || 0)}, received: ${Number(totals.received || 0)}, sent: ${Number(totals.sent || 0)}, skipped: ${Number(totals.skipped || 0)}.`);
    } catch (e) { setError(e.message); } finally { setIsRunningFullMailSync(false); }
  }

  function handleRefreshAdminDashboard() {
    loadAdminSummary();
    if (adminTab === "overview") loadAnalytics();
    if (adminTab === "employees") loadEmployees();
    if (adminTab === "trail") loadEmailTrailData();
    if (adminTab === "archives") { loadArchives(); loadArchiveExplorer(); loadArchiveBackfillHistory(); }
    if (adminTab === "approval") loadApprovalAnalytics();
    if (adminTab === "mail-tests") runAdminMailTests();
  }

  async function handleQuickCreateManager() {
    if (!managerQuickForm.name || !managerQuickForm.email) { setError("Name and email required."); return; }
    setIsSavingEmployee(true);
    try {
      const autoPwd = Math.random().toString(36).slice(2, 10) + "1!";
      const r = await apiFetch("/api/admin/employees", { method: "POST", body: { ...managerQuickForm, password: autoPwd } });
      setEmployeeForm({ ...employeeForm, manager_id: r.employee.id });
      setManagerQuickForm({ name: "", email: "", password: "", role: "Admin" });
      setShowManagerQuickForm(false);
      setSuccessMessage("Manager created and selected.");
      await loadEmployees();
    } catch (e) { setError(e.message); } finally { setIsSavingEmployee(false); }
  }

  async function handleSaveEmployee() {
    setIsSavingEmployee(true); setError(""); setSuccessMessage("");
    try {
      if (editingEmployeeId) {
        const body = { ...employeeForm };
        if (!body.password) delete body.password;
        await apiFetch(`/api/admin/employees/${editingEmployeeId}`, { method: "PUT", body });
        setSuccessMessage("Employee updated.");
      } else {
        if (!employeeForm.name || !employeeForm.email || !employeeForm.password) { setError("Name, email, and password required."); setIsSavingEmployee(false); return; }
        await apiFetch("/api/admin/employees", { method: "POST", body: employeeForm });
        setSuccessMessage("Employee created.");
      }
      setEditingEmployeeId(null); setEmployeeForm(createEmptyEmployeeForm());
      await loadEmployees();
    } catch (e) { setError(e.message); } finally { setIsSavingEmployee(false); }
  }

  async function handleDeleteEmployee(emp) {
    if (!window.confirm(`Delete ${emp.name}?`)) return;
    try {
      await apiFetch(`/api/admin/employees/${emp.id}`, { method: "DELETE" });
      setSuccessMessage("Employee deleted.");
      await loadEmployees();
    } catch (e) { setError(e.message); }
  }

  function handleExportEmailTrailCsv() {
    const csv = [["ID", "Serial", "Subject", "Sender", "Recipient", "Folder", "Employee", "Date", "Priority", "Status"].join(","), ...emailTrail.map((row) => [row.id, row.serial, `"${row.subject}"`, row.sender_email, row.recipient_email, row.folder_name, row.employee_name || "", row.received_at, row.priority, row.status].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "email-trail.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCreateArchive() {
    if (!archiveForm.email_ids.length) { setError("Enter at least one email ID."); return; }
    setIsCreatingArchive(true); setError(""); setSuccessMessage("");
    try {
      await apiFetch("/api/admin/archives", { method: "POST", body: archiveForm });
      setSuccessMessage("Archive created and emails serialized.");
      setArchiveForm({ employee_id: "", email_ids: [], notes: "" });
      await loadArchives(); if (canAccessAdmin) await loadAdminSummary();
    } catch (e) { setError(e.message); } finally { setIsCreatingArchive(false); }
  }

  async function handleRecallEmail() {
    if (!selectedEmail) return; setError(""); setSuccessMessage("");
    try { await apiFetch(`/api/emails/${selectedEmail.id}/recall`, { method: "POST" }); await loadBootstrap(); setSuccessMessage("Email recalled successfully. Message moved to Deleted Items."); } catch (e) { setError(e.message); }
  }

  async function handleRetryEmail() {
    if (!selectedEmail) return;
    setIsRetryingEmail(true); setError(""); setSuccessMessage("");
    try { const r = await apiFetch(`/api/emails/${selectedEmail.id}/retry`, { method: "POST" }); await loadBootstrap(); await loadMailServiceStatus(); setSelectedFolder(r.queued ? "Outbox" : "Sent"); setSuccessMessage(r.queued ? "Retry failed, remains in Outbox." : "Retry succeeded, moved to Sent."); } catch (e) { setError(e.message); } finally { setIsRetryingEmail(false); }
  }

  async function handleMoveEmail() {
    if (!selectedEmail || !moveTarget) return;
    setIsMovingEmail(true); setError(""); setSuccessMessage("");
    try { const r = await apiFetch(`/api/emails/${selectedEmail.id}/move`, { method: "PUT", body: { folder_name: moveTarget } }); await loadBootstrap(); setSelectedFolder(r.email.folder_name || moveTarget); setSelectedEmailId(r.email.id); setSuccessMessage(`Email moved to ${moveTarget}.`); } catch (e) { setError(e.message); } finally { setIsMovingEmail(false); }
  }

  function toggleEmailSelection(id) { setSelectedEmailIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }
  function toggleSelectAllFiltered() {
    if (allFilteredSelected) { setSelectedEmailIds(p => p.filter(id => !filteredEmails.some(e => e.id === id))); return; }
    setSelectedEmailIds(p => [...new Set([...p, ...filteredEmails.map(e => e.id)])]);
  }

  async function handleSetReadState(isRead) {
    if (!actionableEmailIds.length) return;
    setError(""); setSuccessMessage("");
    try { await apiFetch("/api/emails/read-state", { method: "PATCH", body: { email_ids: actionableEmailIds, is_read: isRead } }); await loadBootstrap(); setSuccessMessage(isRead ? "Marked as read." : "Marked as unread."); } catch (e) { setError(e.message); }
  }

  async function handleBulkMove() {
    if (!selectedEmailIds.length || !bulkMoveTarget) return;
    setIsMovingEmail(true); setError(""); setSuccessMessage("");
    try { await apiFetch("/api/emails/bulk/move", { method: "PUT", body: { email_ids: selectedEmailIds, folder_name: bulkMoveTarget } }); await loadBootstrap(); setSelectedEmailIds([]); setSelectedFolder(bulkMoveTarget); setSuccessMessage(`Moved ${selectedEmailIds.length} emails.`); } catch (e) { setError(e.message); } finally { setIsMovingEmail(false); }
  }

  async function handleDeletePermanently(targetIds = actionableEmailIds) {
    if (!targetIds.length) return;
    setError(""); setSuccessMessage("");
    try { await apiFetch("/api/emails", { method: "DELETE", body: { email_ids: targetIds } }); await loadBootstrap(); setSelectedEmailIds([]); setSuccessMessage(`Deleted ${targetIds.length} email(s) permanently.`); } catch (e) { setError(e.message); }
  }

  async function handleDeleteAction(targetIds = actionableEmailIds) {
    if (!targetIds.length) { setError("Select an email first."); setSuccessMessage(""); return; }
    const targets = targetIds.map(id => data.emails.find(e => e.id === id)).filter(Boolean);
    if (targets.every(e => e.folder_name === "Deleted")) { await handleDeletePermanently(targetIds); return; }
    setIsMovingEmail(true); setError(""); setSuccessMessage("");
    try {
      if (targetIds.length === 1) await apiFetch(`/api/emails/${targetIds[0]}/move`, { method: "PUT", body: { folder_name: "Deleted" } });
      else await apiFetch("/api/emails/bulk/move", { method: "PUT", body: { email_ids: targetIds, folder_name: "Deleted" } });
      await loadBootstrap(); setSelectedEmailIds([]); setSelectedEmailId(null); setSelectedFolder("Deleted");
      setSuccessMessage(`Moved ${targetIds.length} email(s) to Deleted Items.`);
    } catch (e) { setError(e.message); } finally { setIsMovingEmail(false); }
  }

  function openCalendarView() { setCurrentView("calendar"); setActiveRibbonTab("home"); setError(""); setSuccessMessage(""); }
  async function handleExportAction(format) { if (!filteredEmails.length) { setError("No results to export."); return; } await exportSearchResults(format); }

  function getPriorityColor(p) {
    if (p === "High") return "#d13438";
    if (p === "Low") return "#666";
    return "#333";
  }
  function getPriorityLabel(p) {
    if (p === "High") return "!!";
    if (p === "Low") return "\\/";
    return "";
  }

  // ===== AUTH PAGE =====
  if (!token) {
    return (
      <div className="go-login">
        <div className="go-login-header">
          <div className="go-login-logo" style={{backgroundImage:"url('https://d1v3calcp683kw.cloudfront.net/admins/images/m.safadi/blf.2cb3ab1130dd.png')"}}></div>
        </div>
        <div className="go-login-body">
          <div className="go-login-box">
            <h2>Sign in to TECHNO Group</h2>
            <p className="go-login-subtitle">Choose an account to continue</p>
            {error ? <div className="go-login-error">{error}</div> : null}
            <form onSubmit={handleLogin} className="go-login-form">
              <div className="go-login-field">
                <label>Email address</label>
                <input type="email" value={authForm.email} onChange={e => setAuthForm({...authForm,email:e.target.value})} placeholder="name@techno-grp.com" required autoFocus />
              </div>
              <div className="go-login-field">
                <label>Password</label>
                <input type="password" value={authForm.password} onChange={e => setAuthForm({...authForm,password:e.target.value})} placeholder="Enter your password" required />
              </div>
              <button type="submit" className="go-login-btn" disabled={authLoading}>{authLoading ? "Signing in..." : "Sign In"}</button>
            </form>
            <div className="go-login-footer">
              <span>This system is for <strong>TECHNO Group</strong> employees only.</span>
            </div>
          </div>
          <div className="go-login-modules">
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#e85d3a"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
              <span>Address book</span>
            </div>
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#e74c3c"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
              <span>Calendar</span>
            </div>
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#f39c12"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
              <span>E-mail</span>
            </div>
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#95a5a6"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
              <span>EasyMeet</span>
            </div>
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#f1c40f"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
              <span>Files</span>
            </div>
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#3498db"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
              <span>Notes</span>
            </div>
            <div className="go-module-icon">
              <div className="go-module-img" style={{background:"#2ecc71"}}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
              <span>Tasks</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="o365-loading">Loading mailbox and permissions...</div>;

  // ===== RIBBON CONTENT =====
  function renderRibbonContent() {
    return (
      <div className="o365-ribbon-content">
        <div className="o365-ribbon-group">
          <button className="o365-ribbon-btn o365-ribbon-primary" onClick={openComposeView}>
            <Plus size={20} /><span className="o365-ribbon-btn-label">New Email</span>
          </button>
        </div>
        <div className="o365-ribbon-group">
          <button className="o365-ribbon-btn" onClick={handleRunCycle} disabled={isRunningCycle}><RefreshCw size={20} /><span className="o365-ribbon-btn-label">{isRunningCycle ? "Working..." : "Send/Receive"}</span></button>
          <button className="o365-ribbon-btn" onClick={() => { if (selectedEmail) handleDeleteAction([selectedEmail.id]); }} disabled={!selectedEmail}><Trash2 size={20} /><span className="o365-ribbon-btn-label">Delete</span></button>
          {selectedFolder === "Deleted" ? <button className="o365-ribbon-btn" onClick={async () => { if (!window.confirm("Empty Deleted Items forever?")) return; try { await apiFetch("/api/emails/empty-trash", {method:"POST"}); await loadBootstrap(); setSuccessMessage("Trash emptied."); } catch (e) { setError(e.message); } }}><Trash2 size={20} /><span className="o365-ribbon-btn-label">Empty Trash</span></button> : null}
          <button className="o365-ribbon-btn" onClick={() => { if (selectedEmail) handleSetReadState(!selectedEmail.is_read); }} disabled={!selectedEmail}><Mail size={20} /><span className="o365-ribbon-btn-label">{selectedEmail?.is_read ? "Unread" : "Read"}</span></button>
          <button className="o365-ribbon-btn" onClick={async () => { const ids = filteredEmails.filter(e => !e.is_read).map(e => e.id); if (!ids.length) { setSuccessMessage("All emails are already read."); return; } await apiFetch("/api/emails/read-state", { method: "PATCH", body: { email_ids: ids, is_read: true } }); await loadBootstrap(); setSuccessMessage(`Marked ${ids.length} email(s) as read.`); }} disabled={!filteredEmails.some(e => !e.is_read)}><Mail size={20} /><span className="o365-ribbon-btn-label">Read All</span></button>
          <button className="o365-ribbon-btn" onClick={async () => { const ids = filteredEmails.filter(e => e.is_read).map(e => e.id); if (!ids.length) { setSuccessMessage("All emails are already unread."); return; } await apiFetch("/api/emails/read-state", { method: "PATCH", body: { email_ids: ids, is_read: false } }); await loadBootstrap(); setSuccessMessage(`Marked ${ids.length} email(s) as unread.`); }} disabled={!filteredEmails.some(e => e.is_read)}><Mail size={20} /><span className="o365-ribbon-btn-label">Unread All</span></button>
        </div>
        <div className="o365-ribbon-group">
          <button className="o365-ribbon-btn" onClick={() => prepareReplyDraft("reply")} disabled={!selectedEmail}><Reply size={20} /><span className="o365-ribbon-btn-label">Reply</span></button>
          <button className="o365-ribbon-btn" onClick={() => prepareReplyDraft("replyAll")} disabled={!selectedEmail}><ReplyAll size={20} /><span className="o365-ribbon-btn-label">Reply All</span></button>
          <button className="o365-ribbon-btn" onClick={() => prepareReplyDraft("forward")} disabled={!selectedEmail}><Forward size={20} /><span className="o365-ribbon-btn-label">Forward</span></button>
        </div>
        <div className="o365-ribbon-group">
          <button className="o365-ribbon-btn" onClick={openCalendarView}><CalendarDays size={20} /><span className="o365-ribbon-btn-label">Calendar</span></button>
          <button className="o365-ribbon-btn" onClick={() => { setCurrentView("settings"); setSettingsTab("account"); }}><Settings size={20} /><span className="o365-ribbon-btn-label">Settings</span></button>
          {canAccessAdmin ? <button className="o365-ribbon-btn" onClick={() => setCurrentView("admin")}><LayoutDashboard size={20} /><span className="o365-ribbon-btn-label">Admin</span></button> : null}
        </div>
        <div className="o365-ribbon-group">
          <button className="o365-ribbon-btn" onClick={() => handleExportAction("csv")} disabled={!filteredEmails.length}><Download size={20} /><span className="o365-ribbon-btn-label">CSV</span></button>
          <button className="o365-ribbon-btn" onClick={() => handleExportAction("xlsx")} disabled={!filteredEmails.length}><Download size={20} /><span className="o365-ribbon-btn-label">Excel</span></button>
        </div>
        <div className="o365-ribbon-group">
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555" }}>
            Scope: <select value={searchScope} onChange={e => setSearchScope(e.target.value)} style={{ width: 100, padding: "2px 4px", fontSize: 11 }}>
              <option value="Current">Current</option><option value="All">All folders</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555" }}>
            Sort: <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 110, padding: "2px 4px", fontSize: 11 }}>
              <option value="Date">Date</option><option value="Sender">Sender</option><option value="Subject">Subject</option><option value="Priority">Priority</option>
            </select>
          </label>
        </div>
      </div>
    );
  }

  // ===== CALENDAR VIEW =====
  function renderCalendar() {
    const currentCells = calView === "week" ? weeklyCalendar : monthlyCalendar;
    const navTitle = calView === "week" ? calDate.format("MMM D, YYYY") : calDate.format("MMMM YYYY");

    return (
      <div className="o365-calendar">
        <div className="o365-cal-sidebar">
          <div className="o365-settings-section">
            <h3 style={{ border: "none", padding: "8px 0" }}>Calendar</h3>
            <div className="o365-settings-body" style={{ padding: 8 }}>
              <button className="o365-ribbon-btn o365-ribbon-primary" onClick={openCalendarView} style={{ marginBottom: 8, width: "100%", padding: "6px" }}>
                <Plus size={16} /> New Event
              </button>
              <h4 style={{ fontSize: 12, margin: "8px 0", color: "#666" }}>Upcoming</h4>
              {data.reminders.length ? data.reminders.slice(0, 5).map(r => (
                <div key={r.id} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid #eee" }}>
                  <strong>{r.title}</strong><br />
                  <span style={{ color: "#666" }}>{dayjs(r.remind_at).format("MMM D, HH:mm")}</span>
                </div>
              )) : <div style={{ fontSize: 11, color: "#999" }}>No upcoming events</div>}
            </div>
          </div>
        </div>
        <div className="o365-cal-main">
          <div className="o365-cal-nav">
            <button onClick={() => setCalDate(dayjs())}>Today</button>
            <button onClick={() => setCalDate(d => d.subtract(1, calView === "week" ? "week" : "month"))}><ChevronLeft size={16} /></button>
            <button onClick={() => setCalDate(d => d.add(1, calView === "week" ? "week" : "month"))}><ChevronRight size={16} /></button>
            <h2>{navTitle}</h2>
            <div className="o365-cal-view-options">
              <button className={calView === "month" ? "active" : ""} onClick={() => setCalView("month")}>Month</button>
              <button className={calView === "week" ? "active" : ""} onClick={() => setCalView("week")}>Week</button>
              <button className={calView === "day" ? "active" : ""} onClick={() => setCalView("day")}>Day</button>
            </div>
            <button style={{ marginLeft: "auto" }} onClick={() => setCurrentView("mail")}>Back to Mail</button>
          </div>
          {calView === "day" ? (
            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 300, marginBottom: 12 }}>{calDate.format("dddd, MMMM D, YYYY")}</h3>
              {data.calendar.filter(ev => dayjs(ev.starts_at).format("YYYY-MM-DD") === calDate.format("YYYY-MM-DD")).length ? data.calendar.filter(ev => dayjs(ev.starts_at).format("YYYY-MM-DD") === calDate.format("YYYY-MM-DD")).map(ev => (
                <div key={ev.id} style={{ padding: "8px 12px", background: "#deecf9", marginBottom: 4, borderLeft: "3px solid #243A80", fontSize: 12 }}>
                  <strong>{ev.title}</strong> {dayjs(ev.starts_at).format("HH:mm")} - {dayjs(ev.ends_at).format("HH:mm")}
                  {ev.location ? <span style={{ color: "#666", marginLeft: 8 }}>{ev.location}</span> : null}
                </div>
              )) : <div style={{ fontSize: 12, color: "#999" }}>No events for this day.</div>}
            </div>
          ) : (
            <div className="o365-cal-grid">
              {weekdayLabels.map(d => <div key={d} style={{ padding: 6, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#555", background: "#f5f5f5" }}>{d}</div>)}
              {currentCells.map(cell => (
                <div key={cell.date.toString()} className={`o365-cal-cell ${cell.date.month() !== calDate.month() ? "other-month" : ""} ${cell.date.format("YYYY-MM-DD") === dayjs().format("YYYY-MM-DD") ? "today" : ""}`}
                  onClick={() => { setCalDate(cell.date); setCalView("day"); }}>
                  <div className="o365-cal-day-num">{cell.date.date()}</div>
                  {cell.events.slice(0, 3).map(ev => <div key={ev.id} className="o365-cal-event">{ev.title}</div>)}
                  {cell.events.length > 3 ? <div style={{ fontSize: 10, color: "#666" }}>+{cell.events.length - 3} more</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== SETTINGS VIEW =====
  function renderSettings() {
    return (
      <div className="o365-settings">
        <div className="o365-settings-nav">
          {settingsTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={`o365-settings-nav-item ${settingsTab === tab.id ? "active" : ""}`} onClick={() => setSettingsTab(tab.id)}>
                <Icon size={16} /><span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className="o365-settings-content">
          <h2>{settingsForm.company_name || "TECHNO GROUP"} Settings</h2>

          <div className="go-modules-bar">
            <div className="go-modules-search">
              <input placeholder="Module name..." />
            </div>
            <div className="go-modules-grid">
              <div className="go-module-item" onClick={() => setSettingsTab("account")}>
                <div className="go-module-icon-box" style={{background:"#e85d3a"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <span>Address book</span>
              </div>
              <div className="go-module-item" onClick={() => setCurrentView("calendar")}>
                <div className="go-module-icon-box" style={{background:"#e74c3c"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <span>Calendar</span>
              </div>
              <div className="go-module-item" onClick={() => setCurrentView("mail")}>
                <div className="go-module-icon-box" style={{background:"#f39c12"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </div>
                <span>E-mail</span>
              </div>
              <div className="go-module-item">
                <div className="go-module-icon-box" style={{background:"#95a5a6"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <span>EasyMeet</span>
              </div>
              <div className="go-module-item">
                <div className="go-module-icon-box" style={{background:"#f1c40f"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </div>
                <span>Files</span>
              </div>
              <div className="go-module-item">
                <div className="go-module-icon-box" style={{background:"#3498db"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <span>Notes</span>
              </div>
              <div className="go-module-item" onClick={() => setSettingsTab("tasks")}>
                <div className="go-module-icon-box" style={{background:"#2ecc71"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </div>
                <span>Tasks</span>
              </div>
              <div className="go-module-item">
                <div className="go-module-icon-box" style={{background:"#7c3aed"}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <span>Zulip</span>
              </div>
            </div>
          </div>

          {settingsTab === "account" && (
            <>
              {mailServiceStatus && (
                <div className="o365-settings-section">
                  <h3>Mail Service Status</h3>
                  <div className="o365-settings-body" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    <div className="o365-admin-card"><strong>{mailServiceStatus?.configured ? "Yes" : "No"}</strong><span>Configured</span></div>
                    <div className="o365-admin-card"><strong>{mailServiceStatus?.schedulerRunning ? "Running" : "Stopped"}</strong><span>Scheduler</span></div>
                    <div className="o365-admin-card"><strong>{mailServiceStatus?.auto_send_receive_minutes || settingsForm.auto_send_receive_minutes} min</strong><span>Cycle</span></div>
                  </div>
                </div>
              )}
              <div className="o365-settings-section">
                <h3>Storage Status</h3>
                <div className="o365-settings-body">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {storageStatusCards.map((card) => (
                      <div key={card.label} className="o365-admin-card">
                        <strong>{card.value}</strong>
                        <span>{card.label}</span>
                        <small style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{card.note}</small>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #e1e1e1", borderRadius: 6, background: "#fafafa", fontSize: 12, color: "#555" }}>
                    <div><strong>Server Database:</strong> stores the official mailbox used later for reporting, analytics, and archive operations.</div>
                    <div style={{ marginTop: 4 }}><strong>This Device:</strong> stores the latest local mailbox copy for <strong>{currentUser?.email || lastKnownUser?.email || "current user"}</strong>.</div>
                    <div style={{ marginTop: 4 }}><strong>Cache Key:</strong> {deviceCacheInfo?.cacheKey || getMailboxCacheKey(currentUser || lastKnownUser) || "Not available"}</div>
                    <div style={{ marginTop: 4 }}><strong>Attachments Cached:</strong> {deviceCacheInfo?.attachmentCount ?? 0}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <button type="button" onClick={() => loadDeviceCacheInfo(currentUser || lastKnownUser)} disabled={isRefreshingDeviceCache}>
                      <RefreshCw size={14} />{isRefreshingDeviceCache ? "Refreshing..." : "Refresh Cache Status"}
                    </button>
                    <button type="button" onClick={handleSyncLocalCopyNow} disabled={isSyncingDeviceCache || !currentUser?.email}>
                      <Download size={14} />{isSyncingDeviceCache ? "Syncing..." : "Sync Local Copy Now"}
                    </button>
                    <button type="button" onClick={handleClearDeviceCache} disabled={isClearingDeviceCache || !currentUser?.email}>
                      <Trash2 size={14} />{isClearingDeviceCache ? "Clearing..." : "Clear Device Cache"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="o365-settings-section">
                <h3>Account Information</h3>
                <div className="o365-settings-body">
                  <div className="o365-setting-row"><label>Company Name</label><input value={settingsForm.company_name} onChange={e => setSettingsForm({ ...settingsForm, company_name: e.target.value })} /></div>
                  <div className="o365-setting-row"><label>Display Name</label><input value={settingsForm.display_name} onChange={e => setSettingsForm({ ...settingsForm, display_name: e.target.value })} /></div>
                  <div className="o365-setting-row"><label>Email Address</label><input type="email" value={settingsForm.email_address} onChange={e => setSettingsForm({ ...settingsForm, email_address: e.target.value })} /></div>
                  <div className="o365-setting-row"><label>Account Type</label><select value={settingsForm.account_type} onChange={e => setSettingsForm((prev) => ({ ...prev, account_type: e.target.value, incoming_port: e.target.value === "IMAP" ? 993 : e.target.value === "GRAPH" ? 993 : 995, incoming_ssl: true, inbox_folder_name: prev.inbox_folder_name || "Inbox", sent_folder_name: prev.sent_folder_name || "Sent", graph_mailbox_user: prev.graph_mailbox_user || prev.email_address || "" }))}><option>POP3</option><option>IMAP</option><option>GRAPH</option></select></div>
                  <div className="o365-setting-row"><label>Username</label><input value={settingsForm.username} onChange={e => setSettingsForm({ ...settingsForm, username: e.target.value })} /></div>
                  <div className="o365-setting-row"><label>Password</label><input type="password" value={settingsForm.password} onChange={e => setSettingsForm({ ...settingsForm, password: e.target.value })} /></div>
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.remember_password)} onChange={e => setSettingsForm({ ...settingsForm, remember_password: e.target.checked })} /> Remember password</div>
                </div>
              </div>
              <div className="o365-settings-section">
                <h3>Webmail Integration</h3>
                <div className="o365-settings-body">
                  <div className="o365-setting-row"><label>Webmail URL</label><input value={settingsForm.webmail_url} onChange={e => setSettingsForm({ ...settingsForm, webmail_url: e.target.value })} placeholder="https://example.w.emailarray.com/#email" /></div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>A webmail button will appear in the top banner for quick access.</div>
                </div>
              </div>
            </>
          )}

          {settingsTab === "servers" && (
            <div className="o365-settings-section">
              <h3>Server Information</h3>
              <div className="o365-settings-body">
                {settingsForm.account_type === "GRAPH" ? (
                  <>
                    <div className="o365-setting-row"><label>Graph Tenant ID</label><input value={settingsForm.graph_tenant_id || ""} onChange={e => setSettingsForm({ ...settingsForm, graph_tenant_id: e.target.value })} /></div>
                    <div className="o365-setting-row"><label>Graph Client ID</label><input value={settingsForm.graph_client_id || ""} onChange={e => setSettingsForm({ ...settingsForm, graph_client_id: e.target.value })} /></div>
                    <div className="o365-setting-row"><label>Graph Client Secret</label><input type="password" value={settingsForm.graph_client_secret || ""} onChange={e => setSettingsForm({ ...settingsForm, graph_client_secret: e.target.value })} /></div>
                    <div className="o365-setting-row"><label>Graph Mailbox User</label><input value={settingsForm.graph_mailbox_user || ""} onChange={e => setSettingsForm({ ...settingsForm, graph_mailbox_user: e.target.value })} /></div>
                  </>
                ) : (
                  <>
                    <div className="o365-setting-row"><label>Incoming Server</label><input value={settingsForm.incoming_server} onChange={e => setSettingsForm({ ...settingsForm, incoming_server: e.target.value })} /></div>
                    <div className="o365-setting-row"><label>Incoming Port</label><input type="number" value={settingsForm.incoming_port} onChange={e => setSettingsForm({ ...settingsForm, incoming_port: Number(e.target.value) })} /></div>
                    <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.incoming_ssl)} onChange={e => setSettingsForm({ ...settingsForm, incoming_ssl: e.target.checked })} /> This server requires an encrypted connection (SSL/TLS)</div>
                  </>
                )}
                <div className="o365-setting-row"><label>Inbox Folder Name</label><input value={settingsForm.inbox_folder_name || ""} onChange={e => setSettingsForm({ ...settingsForm, inbox_folder_name: e.target.value })} /></div>
                <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.sync_sent_items)} onChange={e => setSettingsForm({ ...settingsForm, sync_sent_items: e.target.checked })} /> Sync Sent / Sent Items from remote mailbox</div>
                {settingsForm.sync_sent_items ? (
                  <div className="o365-setting-row"><label>Sent Folder Name</label><input value={settingsForm.sent_folder_name || ""} onChange={e => setSettingsForm({ ...settingsForm, sent_folder_name: e.target.value })} /></div>
                ) : null}
                <div className="o365-setting-row"><label>Outgoing Server (SMTP)</label><input value={settingsForm.outgoing_server} onChange={e => setSettingsForm({ ...settingsForm, outgoing_server: e.target.value })} /></div>
                <div className="o365-setting-row"><label>Outgoing Port</label><input type="number" value={settingsForm.outgoing_port} onChange={e => setSettingsForm({ ...settingsForm, outgoing_port: Number(e.target.value) })} /></div>
                <div className="o365-setting-row"><label>Outgoing Encryption</label><select value={settingsForm.outgoing_encryption} onChange={e => setSettingsForm({ ...settingsForm, outgoing_encryption: e.target.value })}><option>SSL/TLS</option><option>STARTTLS</option><option>None</option></select></div>
              </div>
              <h3 style={{ marginTop: 16 }}>Outgoing Server</h3>
              <div className="o365-settings-body">
                <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.smtp_auth_required)} onChange={e => setSettingsForm({ ...settingsForm, smtp_auth_required: e.target.checked })} /> My outgoing server (SMTP) requires authentication</div>
                {settingsForm.smtp_auth_required && (
                  <div style={{ marginLeft: 24, marginTop: 8 }}>
                    <div className="o365-setting-check"><input type="radio" name="smtp_auth_mode" checked={Boolean(settingsForm.smtp_same_as_incoming)} onChange={() => setSettingsForm({ ...settingsForm, smtp_same_as_incoming: true })} /> Use same settings as my incoming mail server</div>
                    <div className="o365-setting-check" style={{ marginTop: 4 }}><input type="radio" name="smtp_auth_mode" checked={!settingsForm.smtp_same_as_incoming} onChange={() => setSettingsForm({ ...settingsForm, smtp_same_as_incoming: false })} /> Log on using</div>
                    {!settingsForm.smtp_same_as_incoming && (
                      <div style={{ marginLeft: 24, marginTop: 8 }}>
                        <div className="o365-setting-row"><label>User Name</label><input value={settingsForm.username} onChange={e => setSettingsForm({ ...settingsForm, username: e.target.value })} /></div>
                        <div className="o365-setting-row"><label>Password</label><input type="password" value={settingsForm.password} onChange={e => setSettingsForm({ ...settingsForm, password: e.target.value })} /></div>
                        <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.remember_password)} onChange={e => setSettingsForm({ ...settingsForm, remember_password: e.target.checked })} /> Remember password</div>
                        <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.require_spa)} onChange={e => setSettingsForm({ ...settingsForm, require_spa: e.target.checked })} /> Require Secure Password Authentication (SPA)</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {settingsTab === "security" && (
            <>
              <div className="o365-settings-section">
                <h3>Security Options</h3>
                <div className="o365-settings-body">
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.smtp_same_as_incoming)} onChange={e => setSettingsForm({ ...settingsForm, smtp_same_as_incoming: e.target.checked })} /> Use same credentials for SMTP</div>
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.require_spa)} onChange={e => setSettingsForm({ ...settingsForm, require_spa: e.target.checked })} /> Require Secure Password Authentication (SPA)</div>
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.leave_copy_on_server)} onChange={e => setSettingsForm({ ...settingsForm, leave_copy_on_server: e.target.checked })} /> Leave a copy of messages on the server</div>
                  <div className="o365-setting-row"><label>Remove from server after (days)</label><input type="number" min="1" value={settingsForm.remove_after_days} onChange={e => setSettingsForm({ ...settingsForm, remove_after_days: e.target.value })} /></div>
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.remove_when_deleted)} onChange={e => setSettingsForm({ ...settingsForm, remove_when_deleted: e.target.checked })} /> Remove from server when deleted from Deleted Items</div>
                </div>
              </div>
              <div className="o365-settings-section">
                <h3>Email Security</h3>
                <div className="o365-settings-body">
                  <div className="o365-setting-row"><label>Default Sensitivity</label><select value={settingsForm.sensitivity} onChange={e => setSettingsForm({ ...settingsForm, sensitivity: e.target.value })}>{sensitivityOpts.map(o => <option key={o}>{o}</option>)}</select></div>
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.read_receipt)} onChange={e => setSettingsForm({ ...settingsForm, read_receipt: e.target.checked })} /> Request read receipt by default</div>
                  <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.delivery_receipt)} onChange={e => setSettingsForm({ ...settingsForm, delivery_receipt: e.target.checked })} /> Request delivery receipt by default</div>
                </div>
              </div>
            </>
          )}

          {settingsTab === "accounts" && (
            <div className="o365-settings-section">
              <h3>Email Accounts</h3>
              <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Manage your email accounts. Each account can have its own SMTP/IMAP settings and signature.</p>
              {emailAccounts.map(account => (
                <div key={account.id} style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 12, background: activeAccountId === account.id ? "#f8f9ff" : "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: activeAccountId === account.id ? "var(--c-primary)" : "#e0e0e0", color: activeAccountId === account.id ? "#fff" : "#666", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700 }}>
                        {(account.display_name || account.email_address || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{account.display_name || account.email_address}</div>
                        <div style={{ fontSize: 12, color: "#888" }}>{account.email_address}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {account.is_default ? <span style={{ fontSize: 10, background: "#e6f4e6", color: "#107c10", padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>DEFAULT</span> : null}
                      <button onClick={() => setDefaultAccount(account.id)} style={{ padding: "4px 10px", fontSize: 11, border: "1px solid #ddd", borderRadius: 4, background: "#fff", cursor: "pointer" }}>Set Default</button>
                      <button onClick={() => deleteEmailAccountById(account.id)} style={{ padding: "4px 10px", fontSize: 11, border: "1px solid #f44336", borderRadius: 4, background: "#fff", color: "#f44336", cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: "#555" }}>
                    <div>SMTP: {account.smtp_host || "Not configured"}:{account.smtp_port || 587}</div>
                    <div>IMAP: {account.imap_host || "Not configured"}:{account.imap_port || 993}</div>
                  </div>
                  {account.signature_text ? (
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "#f5f5f5", borderRadius: 4, fontSize: 11, color: "#555" }}>
                      <strong>Signature:</strong> {account.signature_text.substring(0, 80)}...
                    </div>
                  ) : null}
                </div>
              ))}
              <button onClick={() => setShowAddAccountForm(true)} style={{ padding: "8px 16px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Add New Account</button>

              {showAddAccountForm && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                  <div style={{ background: "#fff", borderRadius: 8, width: "100%", maxWidth: 500, maxHeight: "90vh", overflow: "auto", padding: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <h3 style={{ margin: 0 }}>Add Email Account</h3>
                      <button onClick={() => setShowAddAccountForm(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#666" }}>&times;</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>Email Address *</label>
                          <input type="email" value={newAccountForm.email_address} onChange={e => setNewAccountForm({...newAccountForm, email_address: e.target.value})} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} required />
                        </div>
                        <div>
                          <label style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>Display Name</label>
                          <input type="text" value={newAccountForm.display_name} onChange={e => setNewAccountForm({...newAccountForm, display_name: e.target.value})} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                        </div>
                      </div>

                      <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>SMTP (Outgoing)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                          <input placeholder="smtp.example.com" value={newAccountForm.smtp_host} onChange={e => setNewAccountForm({...newAccountForm, smtp_host: e.target.value})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                          <input placeholder="587" value={newAccountForm.smtp_port} onChange={e => setNewAccountForm({...newAccountForm, smtp_port: Number(e.target.value)})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><input type="checkbox" checked={newAccountForm.smtp_ssl} onChange={e => setNewAccountForm({...newAccountForm, smtp_ssl: e.target.checked})} /> SSL</label>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                          <input placeholder="SMTP Username" value={newAccountForm.smtp_username} onChange={e => setNewAccountForm({...newAccountForm, smtp_username: e.target.value})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                          <input placeholder="SMTP Password" type="password" value={newAccountForm.smtp_password} onChange={e => setNewAccountForm({...newAccountForm, smtp_password: e.target.value})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                        </div>
                      </div>

                      <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>IMAP (Incoming)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                          <input placeholder="imap.example.com" value={newAccountForm.imap_host} onChange={e => setNewAccountForm({...newAccountForm, imap_host: e.target.value})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                          <input placeholder="993" value={newAccountForm.imap_port} onChange={e => setNewAccountForm({...newAccountForm, imap_port: Number(e.target.value)})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><input type="checkbox" checked={newAccountForm.imap_ssl} onChange={e => setNewAccountForm({...newAccountForm, imap_ssl: e.target.checked})} /> SSL</label>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                          <input placeholder="IMAP Username" value={newAccountForm.imap_username} onChange={e => setNewAccountForm({...newAccountForm, imap_username: e.target.value})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                          <input placeholder="IMAP Password" type="password" value={newAccountForm.imap_password} onChange={e => setNewAccountForm({...newAccountForm, imap_password: e.target.value})} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }} />
                        </div>
                      </div>

                      <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>Signature (Optional)</div>
                        <textarea placeholder="Your email signature..." value={newAccountForm.signature_text} onChange={e => setNewAccountForm({...newAccountForm, signature_text: e.target.value})} rows={3} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, resize: "vertical" }} />
                      </div>

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                        <button onClick={() => setShowAddAccountForm(false)} style={{ padding: "8px 16px", border: "1px solid #ddd", borderRadius: 4, background: "#fff", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                        <button onClick={addNewAccount} disabled={!newAccountForm.email_address} style={{ padding: "8px 16px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add Account</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {settingsTab === "signature" && (
            <div className="o365-settings-section">
              <h3>Email Signature</h3>
              <div className="o365-settings-body">
                <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>Your signature will be automatically added to new emails you compose.</p>
                <textarea value={settingsForm.signature} onChange={e => setSettingsForm({ ...settingsForm, signature: e.target.value })} rows={6} style={{ width: "100%", padding: "8px 12px", fontSize: 12, border: "1px solid #e1e1e1", fontFamily: "Segoe UI,Tahoma,sans-serif", resize: "vertical" }} />
                <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Preview:</div>
                <div style={{ padding: "12px 16px", border: "1px solid #e1e1e1", background: "#fafafa", marginTop: 4, fontSize: 12, whiteSpace: "pre-wrap" }}>{settingsForm.signature || "(No signature set)"}</div>
              </div>
            </div>
          )}

          {settingsTab === "compose" && (
            <div className="o365-settings-section">
              <h3>Compose Options</h3>
              <div className="o365-settings-body">
                <div className="o365-setting-row"><label>Auto Send/Receive (minutes)</label><input type="number" min="1" value={settingsForm.auto_send_receive_minutes} onChange={e => setSettingsForm({ ...settingsForm, auto_send_receive_minutes: e.target.value })} /></div>
                <div className="o365-setting-row"><label>Default Priority</label><select value={settingsForm.priority || "Normal"} onChange={e => setSettingsForm({ ...settingsForm, priority: e.target.value })}><option>Low</option><option>Normal</option><option>High</option></select></div>
                <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.read_receipt)} onChange={e => setSettingsForm({ ...settingsForm, read_receipt: e.target.checked })} /> Always request read receipt</div>
                <div className="o365-setting-check"><input type="checkbox" checked={Boolean(settingsForm.delivery_receipt)} onChange={e => setSettingsForm({ ...settingsForm, delivery_receipt: e.target.checked })} /> Always request delivery receipt</div>
              </div>
            </div>
          )}

          {settingsTab === "spell" && (
            <div className="o365-settings-section">
              <h3>Spell Check & Grammar</h3>
              <div className="o365-settings-body">
                <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>Configure spell check and grammar options for email composition.</p>
                <div className="o365-setting-check"><input type="checkbox" defaultChecked /> Check spelling as you type</div>
                <div className="o365-setting-check"><input type="checkbox" defaultChecked /> Check grammar with spelling</div>
                <div className="o365-setting-check"><input type="checkbox" /> Ignore words in UPPERCASE</div>
                <div className="o365-setting-check"><input type="checkbox" defaultChecked /> Ignore Internet and file addresses</div>
                <div className="o365-setting-row"><label>Dictionary Language</label><select><option>English (United States)</option><option>English (United Kingdom)</option><option>Arabic (Saudi Arabia)</option><option>French (France)</option></select></div>
              </div>
            </div>
          )}

          {settingsTab === "language" && (
            <div className="o365-settings-section">
              <h3>Language & Region</h3>
              <div className="o365-settings-body">
                <div className="o365-setting-row"><label>Display Language</label><select><option>English</option><option>Arabic (العربية)</option><option>French</option><option>Spanish</option></select></div>
                <div className="o365-setting-row"><label>Date Format</label><select><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></div>
                <div className="o365-setting-row"><label>Time Format</label><select><option>12-hour (AM/PM)</option><option>24-hour</option></select></div>
                <div className="o365-setting-row"><label>First day of week</label><select><option>Sunday</option><option>Monday</option><option>Saturday</option></select></div>
              </div>
            </div>
          )}

          {settingsTab === "addins" && (
            <div className="o365-settings-section">
              <h3>Add-ins</h3>
              <div className="o365-settings-body">
                <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>Manage your Office Add-ins and custom extensions.</p>
                <div style={{ padding: 16, textAlign: "center", border: "2px dashed #e1e1e1", borderRadius: 4 }}>
                  <Wrench size={32} color="#999" />
                  <p style={{ fontSize: 12, color: "#999", marginTop: 8 }}>No add-ins installed yet. Add-ins allow you to extend the functionality of Outlook.</p>
                  <button className="o365-auth-btn" style={{ padding: "6px 16px", marginTop: 8 }}>Get Add-ins</button>
                </div>
              </div>
            </div>
          )}

          <div className="o365-settings-actions">
            {settingsTab === "servers" ? (
              <>
                <button type="button" onClick={handleRunCycle} disabled={isRunningCycle}><RefreshCw size={14} />{isRunningCycle ? "Running..." : "Send/Receive"}</button>
                <button type="button" onClick={handleTestSettings} disabled={isTestingSettings}>{isTestingSettings ? "Testing..." : "Test"}</button>
                <button type="button" onClick={handleApplySettings} disabled={isApplyingSettings}>{isApplyingSettings ? "Applying..." : "Apply"}</button>
              </>
            ) : null}
            <button onClick={() => setCurrentView("mail")}>Back to Mail</button>
            <button className="primary" onClick={handleSaveSettings} disabled={isSavingSettings}><Check size={14} />{isSavingSettings ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== APPROVALS VIEW =====
  function renderApprovals() {
    return (
      <div style={{ padding: "20px 24px", height: "100%", display: "flex", flexDirection: "column", background: "#f0f2f5" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 400, color: "#1a1a1a" }}>Pending Approvals {filteredPendingApprovals.length > 0 && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--c-primary)" }}>({filteredPendingApprovals.length})</span>}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>Review and approve or reject emails sent by your team members</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, background: "#fff", border: "1px solid #d9d9d9", fontSize: 12, color: "#555" }}>
              <ClockIcon size={14} style={{ color: "var(--c-primary)" }} />
              <span>Next Reminder: <strong>{nextReminderCountdown.slotLabel}</strong></span>
              <span style={{ color: "#888" }}>in {nextReminderCountdown.label}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowHighRiskOnly((prev) => !prev)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                padding: "8px 14px",
                background: showHighRiskOnly ? "#fff4ce" : "#fff",
                color: showHighRiskOnly ? "#8a6100" : "#444",
                border: `1px solid ${showHighRiskOnly ? "#f5d77b" : "#d9d9d9"}`,
                borderRadius: 999,
                cursor: "pointer",
                fontWeight: 600
              }}
            >
              <Filter size={14} />
              {showHighRiskOnly ? "High Risk Only" : "All Risks"}
            </button>
            <button onClick={loadPendingApprovals} disabled={isLoadingApprovals} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 16px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
              <RefreshCw size={14} />{isLoadingApprovals ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {filteredPendingApprovals.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "#888" }}>
              <CheckCircle size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div style={{ fontSize: 16, fontWeight: 500 }}>{showHighRiskOnly ? "No high-risk approvals right now." : "All caught up!"}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{showHighRiskOnly ? "Try switching back to all approvals." : "No pending emails require your approval."}</div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredPendingApprovals.map(email => (
              <div key={email.id} style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", maxHeight: "70vh" }}>
                {/* Employee + Manager Bar */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f8f9fa", borderBottom: "1px solid #e1e1e1", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <span style={{ color: "#555" }}><Users size={14} style={{ marginRight: 4, verticalAlign: "middle" }} /> Employee: <strong>{email.employee_name}</strong> <span style={{ color: "#888" }}>({email.employee_email})</span>{email.employee_department ? <span style={{ color: "#888" }}> — {email.employee_department}</span> : ""}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <span style={{ color: "#555" }}><Star size={14} style={{ marginRight: 4, verticalAlign: "middle" }} /> Manager: <strong>{email.manager_name || currentUser?.name}</strong> <span style={{ color: "#888" }}>({email.manager_email || currentUser?.email})</span></span>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>{email.subject}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12, color: "#666" }}>
                        <span><span style={{ color: "#999" }}>Serial:</span> {email.serial}</span>
                        <span><span style={{ color: "#999" }}>Version:</span> REV{String(email.version_number || 1).padStart(2, "0")}</span>
                        {email.subject_key ? <span><span style={{ color: "#999" }}>Subject Key:</span> {email.subject_key}</span> : null}
                        <span><span style={{ color: "#999" }}>To:</span> {email.recipient_name || email.recipient_email}{email.recipient_name && email.recipient_email ? ` <${email.recipient_email}>` : ""}</span>
                        {email.cc_list ? <span><span style={{ color: "#999" }}>CC:</span> {email.cc_list}</span> : null}
                        <span><span style={{ color: "#999" }}>Priority:</span> <span style={{ color: email.priority === "High" ? "#d13438" : email.priority === "Low" ? "#107c10" : "#666", fontWeight: email.priority === "High" ? 600 : 400 }}>{email.priority}</span></span>
                        <span>
                          <span style={{ color: "#999" }}>Risk:</span>{" "}
                          <span style={{ ...getRiskBadgeStyle(email.risk_level), borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
                            {String(email.risk_level || "low").toUpperCase()}
                          </span>
                        </span>
                        <span><span style={{ color: "#999" }}>Reminders:</span> {Number(email.reminder_count || 0)}</span>
                        {email.last_reminder_at ? <span><span style={{ color: "#999" }}>Last Reminder:</span> {dayjs(email.last_reminder_at).format("MMM D, HH:mm")}</span> : null}
                        <span><span style={{ color: "#999" }}>Date:</span> {new Date(email.received_at).toLocaleString()}</span>
                        {email.has_attachments ? <span style={{ color: "var(--c-primary)" }}><Paperclip size={12} style={{ marginRight: 2, verticalAlign: "middle" }} /> Attachments</span> : null}
                      </div>
                      {formatRiskFlags(email.risk_flags) ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                          <span style={{ color: "#999" }}>Flags:</span> {formatRiskFlags(email.risk_flags)}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Attachments before body (Outlook-style) */}
                  {data.attachments.filter((attachment) => attachment.email_id === email.id && !normalizeBooleanFlag(attachment.is_inline, false)).length ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                      {data.attachments
                        .filter((attachment) => attachment.email_id === email.id && !normalizeBooleanFlag(attachment.is_inline, false))
                        .map((attachment) => {
                          const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(attachment.file_name);
                          return (
                            <a key={attachment.id} href={attachment.file_path} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid #e0e0e0", borderRadius: 6, background: "#fff", textDecoration: "none", color: "#333", fontSize: 12, minWidth: 160, maxWidth: 260 }}>
                              {isImage ? (
                                <img src={attachment.file_path} alt={attachment.file_name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, border: "1px solid #eee" }} />
                              ) : (
                                <div style={{ width: 48, height: 48, borderRadius: 4, background: "var(--c-primary-tp)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-primary)", flexShrink: 0 }}>
                                  <Paperclip size={20} />
                                </div>
                              )}
                              <div style={{ overflow: "hidden" }}>
                                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{attachment.file_name}</div>
                                <div style={{ color: "#888", fontSize: 11 }}>{formatAttachmentSize(attachment.file_size)}</div>
                              </div>
                            </a>
                          );
                        })}
                    </div>
                  ) : null}
                  {/* Body */}
                  <div style={{ fontSize: 13, color: "#333", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto", background: "#f7f8fa", padding: "10px 12px", borderRadius: 6, border: "1px solid #e8e8e8", marginBottom: 12 }}>
                    {email.body}
                  </div>
                  {(email.ai_recommendations || email.ai_sentiment || email.ai_tone_score) ? (
                    <div className="o365-approval-panel">
                      <div className="o365-approval-panel-title">Draft Review</div>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
                        <strong>Sentiment:</strong> {email.ai_sentiment || "Unknown"} | <strong>Tone Score:</strong> {email.ai_tone_score || 0}/100 | <strong>Engine:</strong> {String(email.ai_provider || "rules").toUpperCase()}
                      </div>
                      <div style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "#666" }}>
                        {email.ai_recommendations || "No AI recommendations for this draft."}
                      </div>
                    </div>
                  ) : null}
                  <div className="o365-approval-panel">
                    <div className="o365-approval-panel-title">Manager Comments</div>
                    <textarea
                      rows={3}
                      value={managerDecisionNotes[email.id] || ""}
                      onChange={(e) => setManagerDecisionNotes(prev => ({ ...prev, [email.id]: e.target.value }))}
                      placeholder="Write approval guidance or rejection feedback for the employee."
                      style={{ width: "100%", resize: "vertical" }}
                    />
                  </div>
                  <div className="o365-approval-panel">
                    <div className="o365-approval-panel-title">Telegram-Ready Action Links</div>
                    <div className="o365-approval-link-list">
                      <button type="button" onClick={async () => {
                        const links = await ensureApprovalActionLinks(email.id);
                        if (links?.approve_url) await copyTextToClipboard(links.approve_url, "Approve link copied.");
                      }}>
                        <Copy size={13} /> Copy Approve Link
                      </button>
                      <button type="button" onClick={async () => {
                        const links = await ensureApprovalActionLinks(email.id);
                        if (links?.reject_url) await copyTextToClipboard(links.reject_url, "Reject link copied.");
                      }}>
                        <Copy size={13} /> Copy Reject Link
                      </button>
                      <button type="button" onClick={async () => {
                        const links = await ensureApprovalActionLinks(email.id);
                        if (links?.telegram_share_url) {
                          window.open(links.telegram_share_url, "_blank", "noopener,noreferrer");
                        }
                      }}>
                        <MessageCircle size={13} /> Share to Telegram
                      </button>
                      <button type="button" onClick={async () => {
                        await revokeApprovalActionLinks(email.id);
                        setSuccessMessage("Approval links revoked.");
                        setError("");
                      }}>
                        <X size={13} /> Revoke Links
                      </button>
                    </div>
                    {approvalActionLinksByEmail[email.id] ? (
                      <div style={{ marginTop: 10, fontSize: 12, color: "#555", lineHeight: 1.6 }}>
                        <div><strong>Approve Expires:</strong> {dayjs(approvalActionLinksByEmail[email.id].approve_expires_at).format("YYYY-MM-DD HH:mm")}</div>
                        <div><strong>Reject Expires:</strong> {dayjs(approvalActionLinksByEmail[email.id].reject_expires_at).format("YYYY-MM-DD HH:mm")}</div>
                        <div><strong>Telegram Target:</strong> {approvalActionLinksByEmail[email.id].telegram_chat_id || "Not mapped yet"}</div>
                      </div>
                    ) : null}
                  </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid #f0f0f0", padding: "12px 16px", background: "#fff" }}>
                    <button onClick={() => openApprovalHistoryDrawer(email)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", background: "#fff", color: "var(--c-primary)", border: "1px solid var(--c-primary)", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                      <ClockIcon size={14} /> History Drawer
                    </button>
                    <button onClick={() => handleRejectEmail(email.id, managerDecisionNotes[email.id] || "")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", background: "#fff", color: "#d13438", border: "1px solid #d13438", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                      <X size={14} /> Reject
                    </button>
                    <button onClick={() => handleApproveEmail(email.id, managerDecisionNotes[email.id] || "")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", background: "#107c10", color: "#fff", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                      <Check size={14} /> Approve
                    </button>
                  </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===== COMPOSE VIEW =====
  function renderCompose() {
    return (
      <Suspense fallback={<div className="o365-compose"><div className="o365-loading">Loading compose view...</div></div>}>
        <MailComposeView
          isSendingEmail={isSendingEmail}
          handleSendEmail={handleSendEmail}
          isSubmitting={isSubmitting}
          canArchive={canArchive}
          setCurrentView={setCurrentView}
          form={form}
          setForm={setForm}
          sensitivityOpts={sensitivityOpts}
          files={files}
          setFiles={setFiles}
          showBcc={showBcc}
          setShowBcc={setShowBcc}
          requiresManagerApproval={requiresManagerApproval}
          currentUser={currentUser}
          composeSourceEmail={composeSourceEmail}
          composeReplySourceEmail={composeReplySourceEmail}
          composeAiRecommendations={composeAiRecommendations}
          isGeneratingReplyDraft={isGeneratingReplyDraft}
          handleGenerateReplyDraft={handleGenerateReplyDraft}
          draftAssistantMeta={draftAssistantMeta}
          responsePolicyGuard={responsePolicyGuard}
          isCheckingResponsePolicyGuard={isCheckingResponsePolicyGuard}
          isResponsePolicyGuardStale={isResponsePolicyGuardStale}
          handleRunResponsePolicyGuard={handleRunResponsePolicyGuard}
          handleApplyRepairSuggestion={applyRepairSuggestion}
          handleApplySafeRewrite={applySafeRewrite}
          handleSubmit={handleSubmit}
          showFrom={showFrom}
          renderChipEmailInput={renderChipEmailInput}
          toInputRef={toInputRef}
          ccInputRef={ccInputRef}
          bccInputRef={bccInputRef}
          revisionMatchedBlockCount={revisionMatchedBlockCount}
          composeReviewScroll={composeReviewScroll}
          revisionPhrases={revisionPhrases}
          renderInlineReviewOverlay={renderInlineReviewOverlay}
          composeTextareaRef={composeTextareaRef}
          handleComposeBodyScroll={handleComposeBodyScroll}
          highlightedRevisionBlocks={highlightedRevisionBlocks}
          highlightReviewPhrases={highlightReviewPhrases}
          displayedApprovalHistory={displayedApprovalHistory}
          isLoadingApprovalHistory={isLoadingApprovalHistory}
          approvalConversationItems={approvalConversationItems}
          getApprovalConversationBadgeClass={getApprovalConversationBadgeClass}
          emailAccounts={emailAccounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
          emailKeys={emailKeys}
          projects={projects}
        />
      </Suspense>
    );
  }

  // ===== MAIN APP =====
  return (
    <div className="o365-app">
      {/* Undo Send bar */}
      {undoState ? (
        <div className="o365-undo-bar">
          <Check size={16} /> Your message has been sent.
          <button onClick={handleUndoSend}>Undo</button>
          <span className="timer">{undoState.timer}s</span>
        </div>
      ) : null}

      {/* TOP BANNER */}
      <div className="o365-banner">
        <div className="o365-banner-left">
          <img className="o365-app-logo" src={settingsForm.logo_url || publicInfo.logo_url || "https://d1v3calcp683kw.cloudfront.net/admins/images/m.safadi/blf.2cb3ab1130dd.png"} alt="Logo" />
          <div className="o365-banner-tabs">
            <button className={`o365-banner-tab ${currentView === "mail" ? "active" : ""}`} onClick={() => setCurrentView("mail")}><Mail size={15} /> E-mail</button>
            <button className={`o365-banner-tab ${currentView === "archive" ? "active" : ""}`} onClick={() => { setCurrentView("archive"); setArchiveSearch(""); setArchiveResults([]); loadArchiveStats(); }}><Bookmark size={15} /> Archive</button>
            <button className={`o365-banner-tab ${currentView === "calendar" ? "active" : ""}`} onClick={() => openCalendarView()}><CalendarDays size={15} /> Calendar</button>
            <button className={`o365-banner-tab`} title="Address book"><Users size={15} /> Address book</button>
            <button className={`o365-banner-tab`} title="Tasks"><List size={15} /> Tasks</button>
            <button className={`o365-banner-tab`} title="Notes"><FileText size={15} /> Notes</button>
            <button className={`o365-banner-tab`} title="Files"><Grid3X3 size={15} /> Files</button>
            {canAccessAdmin ? <button className={`o365-banner-tab ${currentView === "admin" ? "active" : ""}`} onClick={() => setCurrentView("admin")}><LayoutDashboard size={15} /> Admin</button> : null}
          </div>
        </div>
        <div className="o365-banner-right">
          <div className="o365-search-box">
            <Search size={14} />
            <input placeholder="Search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <Suspense fallback={<div className="notif-bell-wrapper"><Bell size={20} /></div>}>
            <NotificationPanel
              calendarEvents={data.calendar}
              pendingApprovals={pendingApprovals}
              currentUser={currentUser}
              onSelectEvent={() => openCalendarView()}
              onSelectEmail={() => { setCurrentView("approvals"); loadPendingApprovals(); }}
              onNavigate={(url) => {
                if (url.startsWith("/email/")) {
                  const eid = parseInt(url.split("/email/")[1]);
                  if (eid) { setSelectedEmailId(eid); setCurrentView("mail"); }
                } else if (url.startsWith("/tasks/")) {
                  setCurrentView("tasks");
                } else if (url.startsWith("/projects")) {
                  setCurrentView("projects");
                } else {
                  setCurrentView("mail");
                }
              }}
            />
          </Suspense>
          <button className="o365-app-btn" title="Settings" onClick={() => { setCurrentView("settings"); setSettingsTab("account"); }}><Settings size={20} /></button>
          <div style={{ position: "relative" }}>
            <div className="o365-banner-user" onClick={() => { setShowAccountSwitcher(!showAccountSwitcher); loadEmailAccounts(); }} title="Switch account">
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #1a237e 0%, #283593 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {(currentUser?.name || "U").split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase()}
              </div>
            </div>
            {showAccountSwitcher && (
              <div style={{ position: "absolute", top: "100%", right: 0, width: 320, background: "#fff", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", zIndex: 9999, padding: "12px 0", marginTop: 4 }}>
                <div style={{ padding: "8px 16px", borderBottom: "1px solid #eee", fontSize: 13, fontWeight: 700, color: "#333" }}>Email Accounts</div>
                {emailAccounts.map(account => (
                  <div key={account.id} style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: activeAccountId === account.id ? "#e8f0fe" : "transparent", borderBottom: "1px solid #f5f5f5" }} onClick={() => switchAccount(account.id)}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: activeAccountId === account.id ? "var(--c-primary)" : "#e0e0e0", color: activeAccountId === account.id ? "#fff" : "#666", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                      {(account.display_name || account.email_address || "?")[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.display_name || account.email_address}</div>
                      <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.email_address}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {account.is_default ? <span style={{ fontSize: 9, background: "#e6f4e6", color: "#107c10", padding: "2px 6px", borderRadius: 3, fontWeight: 600 }}>DEFAULT</span> : null}
                      {activeAccountId === account.id ? <span style={{ fontSize: 9, background: "#e8f0fe", color: "var(--c-primary)", padding: "2px 6px", borderRadius: 3, fontWeight: 600 }}>ACTIVE</span> : null}
                    </div>
                  </div>
                ))}
                <div style={{ padding: "8px 16px", borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
                  <button onClick={() => { setShowAccountSwitcher(false); setShowAddAccountForm(true); }} style={{ flex: 1, padding: "8px 12px", background: "var(--c-primary)", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#fff" }}>+ Add Account</button>
                  <button onClick={() => { setShowAccountSwitcher(false); setCurrentView("settings"); setSettingsTab("accounts"); }} style={{ flex: 1, padding: "8px 12px", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#333" }}>Manage</button>
                  <button onClick={handleLogout} style={{ padding: "8px 12px", background: "#fff", border: "1px solid #f44336", borderRadius: 6, fontSize: 12, cursor: "pointer", color: "#f44336", fontWeight: 600 }}>Sign Out</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIBBON */}
      {currentView === "mail" ? (
        <div className="o365-ribbon">
          <div className="o365-ribbon-tabs">
            <button className={`o365-ribbon-tab ${activeRibbonTab === "home" ? "active" : ""}`} onClick={() => { setActiveRibbonTab("home"); handleRibbonTabChange("home"); }}>Home</button>
            <button className={`o365-ribbon-tab ${activeRibbonTab === "send" ? "active" : ""}`} onClick={() => { setActiveRibbonTab("send"); handleRibbonTabChange("home"); }}>Send / Receive</button>
            <button className={`o365-ribbon-tab ${activeRibbonTab === "folder" ? "active" : ""}`} onClick={() => { setActiveRibbonTab("folder"); handleRibbonTabChange("home"); }}>Folder</button>
            <button className={`o365-ribbon-tab ${activeRibbonTab === "view" ? "active" : ""}`} onClick={() => { setActiveRibbonTab("view"); handleRibbonTabChange("view"); }}>View</button>
            <button className={`o365-ribbon-tab ${activeRibbonTab === "help" ? "active" : ""}`} onClick={() => { setActiveRibbonTab("help"); handleRibbonTabChange("help"); }}>Help</button>
          </div>
          {activeRibbonTab === "home" ? renderRibbonContent() : null}
          {activeRibbonTab === "send" ? (
            <div className="o365-ribbon-content">
              <div className="o365-ribbon-group">
                <button className="o365-ribbon-btn" onClick={handleRunCycle} disabled={isRunningCycle}><RefreshCw size={20} /><span className="o365-ribbon-btn-label">{isRunningCycle ? "Working..." : "Send/Receive All"}</span></button>
                <button className="o365-ribbon-btn" onClick={() => setDialog({ title: "Send/Receive Progress", body: <div style={{ fontSize: 12, color: "#666" }}>Send/Receive in progress...</div> })}><RefreshCw size={20} /><span className="o365-ribbon-btn-label">Show Progress</span></button>
              </div>
              <div className="o365-ribbon-group">
                <button className="o365-ribbon-btn" onClick={handleRunCycle} disabled={isRunningCycle}><RefreshCw size={20} /><span className="o365-ribbon-btn-label">{isRunningCycle ? "Working..." : "Send All"}</span></button>
                <button className="o365-ribbon-btn" onClick={handleRunCycle} disabled={isRunningCycle}><Download size={20} /><span className="o365-ribbon-btn-label">{isRunningCycle ? "Working..." : "Receive All"}</span></button>
              </div>
            </div>
          ) : null}
          {activeRibbonTab === "folder" ? (
            <div className="o365-ribbon-content">
              <div className="o365-ribbon-group">
                <button className="o365-ribbon-btn" onClick={() => { if (selectedEmail) handleMoveEmail(); }} disabled={!selectedEmail}><Trash2 size={20} /><span className="o365-ribbon-btn-label">Move</span></button>
                <button className="o365-ribbon-btn" onClick={() => setDialog({ title: "New Folder", body: <div><label style={{ fontSize: 12 }}>Folder name: <input style={{ width: "100%", marginTop: 4 }} placeholder="Enter folder name" /></label></div> })}><Plus size={20} /><span className="o365-ribbon-btn-label">New Folder</span></button>
              </div>
              <div className="o365-ribbon-group">
                <button className="o365-ribbon-btn" onClick={() => handleDeletePermanently()} disabled={!actionableEmailIds.length}><Trash2 size={20} /><span className="o365-ribbon-btn-label">Delete All</span></button>
                <button className="o365-ribbon-btn" onClick={() => { if (selectedEmail) { setMoveTarget("Inbox"); handleMoveEmail(); } }} disabled={!selectedEmail}><Archive size={20} /><span className="o365-ribbon-btn-label">Archive</span></button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Impersonation Banner */}
      {impersonatedBy ? (
        <div style={{ background: "#fff3cd", borderBottom: "2px solid #ffc107", padding: "6px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "#856404" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Impersonating</span>
            <strong>{currentUser?.name || currentUser?.email}</strong>
            <span style={{ color: "#666" }}>— logged in via {impersonatedBy.name} ({impersonatedBy.email})</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value=""
              onChange={async (e) => {
                const targetEmail = e.target.value;
                if (!targetEmail) return;
                try {
                  const session = await apiFetch("/api/auth/login", {
                    method: "POST",
                    body: { email: targetEmail, password: authForm.password }
                  }, "");
                  localStorage.setItem("emailarray_token", session.token);
                  setCurrentUser(session.user); setToken(session.token);
                  if (Notification && Notification.permission === "default") {
                    Notification.requestPermission();
                  }
                  setImpersonatedBy(session.impersonated_by || null);
                  setCurrentView("mail"); setSelectedEmailId(null);
                  setSuccessMessage(`Switched to ${session.user?.name || targetEmail}`);
                } catch (e) { setError(e.message); }
              }}
              style={{ fontSize: 12, padding: "2px 4px", border: "1px solid #ccc", borderRadius: 3 }}
            >
              <option value="">Switch account...</option>
              {[currentUser, ...employees].filter(Boolean).map(u => (
                <option key={u.email || u.id} value={u.email}>{u.name || u.email} ({u.email})</option>
              ))}
            </select>
            <button
              onClick={handleLogout}
              style={{ fontSize: 12, padding: "2px 8px", background: "#dc3545", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
            >
              Exit Impersonation
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="o365-error">{error}</div> : null}
      {successMessage ? <div className="o365-success">{successMessage}</div> : null}

      {currentView === "mail" && (
        <div className="o365-main">
          {/* FOLDER PANE */}
          <div className="o365-folders">
            <div className="o365-folders-header">
              <span>Folders</span>
            </div>
            <div style={{ padding: "4px 12px 12px" }}>
              <button onClick={openComposeView} style={{ width: "100%", padding: "10px 20px", background: "linear-gradient(135deg, #1a237e 0%, #283593 100%)", color: "#fff", border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", letterSpacing: "0.3px", boxShadow: "0 3px 12px rgba(26,35,126,0.3)", transition: "all 0.2s ease" }}>
                <Pen size={15} /> Compose <ChevronDown size={14} />
              </button>
            </div>
            <div className="o365-folder-list">
              {emailAccounts.length > 0 && (
                <>
                  <div className="o365-folder-section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Accounts</span>
                    <button onClick={() => { setCurrentView("settings"); setSettingsTab("accounts"); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-primary)", fontSize: 11, padding: 0 }}>+ Add</button>
                  </div>
                  {emailAccounts.map(account => (
                    <button key={account.id} className={`o365-folder ${activeAccountId === account.id ? "active" : ""}`} onClick={() => switchAccount(account.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderLeft: activeAccountId === account.id ? "3px solid var(--c-primary)" : "3px solid transparent" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: activeAccountId === account.id ? "var(--c-primary)" : "#e0e0e0", color: activeAccountId === account.id ? "#fff" : "#666", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {(account.display_name || account.email_address || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.display_name || account.email_address.split("@")[0]}</div>
                        <div style={{ fontSize: 10, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.email_address}</div>
                      </div>
                      {account.is_default ? <span style={{ fontSize: 8, background: "#e6f4e6", color: "#107c10", padding: "1px 4px", borderRadius: 2 }}>DEFAULT</span> : null}
                    </button>
                  ))}
                </>
              )}
              <div className="o365-folder-section">Smart folders</div>
              {["Inbox"].filter(n => data.folders.some(f => f.name === n)).map(n => {
                const f = data.folders.find(f => f.name === n);
                const Icon = folderIcons[n] || Inbox;
                return <button key={n} className={`o365-folder ${selectedFolder === n && !smartFolder ? "active" : ""}`} onClick={() => { setSmartFolder(null); setCurrentView("mail"); setSelectedFolder(n); setSelectedEmailId(data.emails.find(e => e.folder_name === n)?.id ?? null); }}>
                  <Icon size={17} /><span className="o365-folder-label">{getFolderDisplayName(n)}</span>{f?.unread_count > 0 ? <span className="o365-folder-count">{f.unread_count}</span> : null}
                </button>;
              })}
              <button className={`o365-folder ${smartFolder === "scheduled" ? "active" : ""}`} onClick={() => handleSmartFolderClick("scheduled")} title="Scheduled emails">
                <Clock size={17} style={{ color: "#f57c00" }} /><span className="o365-folder-label">Scheduled</span>
              </button>
              <button className={`o365-folder ${smartFolder === "snoozed" ? "active" : ""}`} onClick={() => handleSmartFolderClick("snoozed")} title="Snoozed emails">
                <Clock size={17} style={{ color: "#777" }} /><span className="o365-folder-label">Snoozed</span>
              </button>
              <button className={`o365-folder ${smartFolder === "ai-tasks" ? "active" : ""}`} onClick={() => handleSmartFolderClick("ai-tasks")} title="AI Tasks">
                <Sparkles size={17} style={{ color: "#1a237e" }} /><span className="o365-folder-label">AI Tasks</span>
              </button>
              <div className="o365-folder-section">Email</div>
              {["Sent", "Drafts"].filter(n => data.folders.some(f => f.name === n)).map(n => {
                const f = data.folders.find(f => f.name === n);
                const Icon = folderIcons[n] || Inbox;
                return <button key={n} className={`o365-folder ${selectedFolder === n && !smartFolder ? "active" : ""}`} onClick={() => { setSmartFolder(null); setCurrentView("mail"); setSelectedFolder(n); setSelectedEmailId(data.emails.find(e => e.folder_name === n)?.id ?? null); }}>
                  <Icon size={17} /><span className="o365-folder-label">{getFolderDisplayName(n)}</span>{f?.unread_count > 0 ? <span className="o365-folder-count">{f.unread_count}</span> : null}
                </button>;
              })}
              <div className="o365-folder-section">Tasks</div>
              <button className={`o365-folder ${smartFolder === "tasks" ? "active" : ""}`} onClick={() => handleSmartFolderClick("tasks")} title="My Tasks">
                <CheckCircle size={17} style={{ color: "#1a237e" }} /><span className="o365-folder-label">My Tasks</span>
                {taskStats.pending > 0 ? <span className="o365-folder-count">{taskStats.pending}</span> : null}
              </button>
              {taskStats.overdue > 0 ? (
                <button className={`o365-folder ${smartFolder === "tasks-overdue" ? "active" : ""}`} onClick={() => handleSmartFolderClick("tasks-overdue")} title="Overdue Tasks">
                  <AlertTriangle size={17} style={{ color: "#d32f2f" }} /><span className="o365-folder-label">Overdue</span>
                  <span className="o365-folder-count" style={{ background: "#d32f2f", color: "#fff" }}>{taskStats.overdue}</span>
                </button>
              ) : null}
              {taskStats.due_soon > 0 ? (
                <button className={`o365-folder ${smartFolder === "tasks-due-soon" ? "active" : ""}`} onClick={() => handleSmartFolderClick("tasks-due-soon")} title="Due Soon">
                  <Clock size={17} style={{ color: "#f57c00" }} /><span className="o365-folder-label">Due Soon</span>
                  <span className="o365-folder-count" style={{ background: "#f57c00", color: "#fff" }}>{taskStats.due_soon}</span>
                </button>
              ) : null}
              {(employees.some(e => e.manager_id === currentUser?.id) || canAccessAdmin) ? <>
                <div className="o365-folder-section">Approvals</div>
                <button className={`o365-folder ${currentView === "approvals" ? "active" : ""}`} onClick={() => { setCurrentView("approvals"); loadPendingApprovals(); }}>
                  <CheckCircle size={17} /><span className="o365-folder-label">Pending</span>{pendingApprovals.length > 0 ? <span className="o365-folder-count">{pendingApprovals.length}</span> : null}
                </button>
              </> : null}
              <div className="o365-folder-section">Folders</div>
              {data.folders.filter(f => !["Inbox", "Sent", "Drafts"].includes(f.name)).map(f => {
                const Icon = folderIcons[f.name] || Inbox;
                return <button key={f.id} className={`o365-folder ${f.name === selectedFolder && !smartFolder ? "active" : ""}`} onClick={() => { setSmartFolder(null); setCurrentView("mail"); setSelectedFolder(f.name); setSelectedEmailId(data.emails.find(e => e.folder_name === f.name)?.id ?? null); }}>
                  <Icon size={17} /><span className="o365-folder-label">{getFolderDisplayName(f.name)}</span>{f?.unread_count > 0 ? <span className="o365-folder-count">{f.unread_count}</span> : null}
                </button>;
              })}
              {unclassifiedCount > 0 ? (
                <button className={`o365-folder ${smartFolder === "unclassified" ? "active" : ""}`} onClick={() => handleSmartFolderClick("unclassified")} title="Emails without project classification">
                  <AlertTriangle size={17} style={{ color: "#f57c00" }} /><span className="o365-folder-label">Unclassified</span>
                  <span className="o365-folder-count">{unclassifiedCount}</span>
                </button>
              ) : null}
              {projects.length > 0 ? (
                <>
                  <div className="o365-folder-section">Projects</div>
                  {projects.map(p => (
                    <button key={p.id} className={`o365-folder ${smartFolder === `project-${p.id}` ? "active" : ""}`} onClick={() => handleSmartFolderClick(`project-${p.id}`)} title={p.project_name}>
                      <Folder size={17} style={{ color: "#1a237e" }} /><span className="o365-folder-label">[{p.project_code}]</span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </div>

          {/* MAIN CONTENT */}
          <div className="o365-content">
            {showAdvancedSearch ? (
              <div style={{ padding: "6px 8px", background: "#f5f5f5", borderBottom: "1px solid #e1e1e1", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                <input value={advancedSearch.from} onChange={e => setAdvancedSearch({ ...advancedSearch, from: e.target.value })} placeholder="From" style={{ width: 140, fontSize: 11 }} />
                <input value={advancedSearch.to} onChange={e => setAdvancedSearch({ ...advancedSearch, to: e.target.value })} placeholder="To" style={{ width: 140, fontSize: 11 }} />
                <input value={advancedSearch.subject} onChange={e => setAdvancedSearch({ ...advancedSearch, subject: e.target.value })} placeholder="Subject" style={{ width: 140, fontSize: 11 }} />
                <input type="date" value={advancedSearch.dateFrom} onChange={e => setAdvancedSearch({ ...advancedSearch, dateFrom: e.target.value })} style={{ width: 130, fontSize: 11 }} />
                <input type="date" value={advancedSearch.dateTo} onChange={e => setAdvancedSearch({ ...advancedSearch, dateTo: e.target.value })} style={{ width: 130, fontSize: 11 }} />
                <button onClick={resetAdvancedSearch} style={{ fontSize: 11 }}>Reset</button>
              </div>
            ) : null}

            <div className="o365-split">
              <div className="o365-split-list">
                <div className="o365-msg-toolbar">
                  <div className="o365-msg-toolbar-left">
                    {smartFolder === "scheduled" ? (
                      <>
                        <button className="o365-msg-toolbar-btn" title="Preview"><Eye size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Send now" disabled={!selectedEmail} onClick={() => selectedEmail && handleCancelScheduleEmail(selectedEmail.id)}><Play size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Reschedule" disabled={!selectedEmail}><Clock size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Delete" disabled={!selectedEmail} onClick={() => selectedEmail && handleDeleteAction([selectedEmail.id])}><Trash2 size={20} /></button>
                        <button className="o365-msg-toolbar-btn" onClick={() => loadSmartFolder("scheduled")} title="Refresh"><RefreshCw size={20} /></button>
                      </>
                    ) : smartFolder === "snoozed" ? (
                      <>
                        <button className="o365-msg-toolbar-btn" title="Preview"><Eye size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Unsnooze" disabled={!selectedEmail} onClick={() => selectedEmail && handleUnsnoozeEmail(selectedEmail.id)}><Inbox size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Change snooze" disabled={!selectedEmail}><Clock size={20} /></button>
                        <button className="o365-msg-toolbar-btn" onClick={() => loadSmartFolder("snoozed")} title="Refresh"><RefreshCw size={20} /></button>
                      </>
                    ) : smartFolder === "ai-tasks" ? (
                      <>
                        <button className="o365-msg-toolbar-btn" title="Preview"><Eye size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Mark done" disabled={!selectedEmail}><Inbox size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Change snooze" disabled={!selectedEmail}><Clock size={20} /></button>
                        <button className="o365-msg-toolbar-btn" onClick={() => loadSmartFolder("ai-tasks")} title="Refresh"><RefreshCw size={20} /></button>
                      </>
                    ) : smartFolder === "unclassified" ? (
                      <>
                        <button className="o365-msg-toolbar-btn" title="Preview"><Eye size={20} /></button>
                        <select
                          className="o365-msg-toolbar-btn"
                          style={{ width: 140, fontSize: 11, padding: "2px 4px" }}
                          disabled={!selectedEmail}
                          onChange={(e) => {
                            if (!selectedEmail) return;
                            const [pid, kid] = e.target.value.split(":");
                            handleClassifyEmail(selectedEmail.id, pid || null, kid || null);
                          }}
                          value=""
                        >
                          <option value="">Classify as...</option>
                          {projects.map(p => <option key={p.id} value={`${p.id}:`}>Project: [{p.project_code}] {p.project_name}</option>)}
                          {emailKeys.map(k => <option key={k.id} value={`:${k.id}`}>Key: [{k.key_code}] {k.key_name}</option>)}
                        </select>
                        <button className="o365-msg-toolbar-btn" onClick={() => loadSmartFolder("unclassified")} title="Refresh"><RefreshCw size={20} /></button>
                      </>
                    ) : (
                      <>
                        <button className="o365-msg-toolbar-btn" onClick={handleRunCycle} disabled={isRunningCycle} title="Refresh"><RefreshCw size={20} className={isRunningCycle ? "spin" : ""} /></button>
                        <button className="o365-msg-toolbar-btn" onClick={() => { if (selectedEmailIds.length) handleDeleteAction(selectedEmailIds); }} title="Delete" disabled={!selectedEmailIds.length}><Trash2 size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="Mark as read"><Mail size={20} /></button>
                        <button className="o365-msg-toolbar-btn" onClick={() => setShowAdvancedSearch(!showAdvancedSearch)} title="Search"><Search size={20} /></button>
                        <button className="o365-msg-toolbar-btn" title="More options"><MoreHorizontal size={20} /></button>
                      </>
                    )}
                  </div>
                  <div className="o365-msg-toolbar-right">
                    <span className="o365-msg-toolbar-label">{smartFolder ? smartFolder.charAt(0).toUpperCase() + smartFolder.slice(1).replace("-", " ") : getFolderDisplayName(selectedFolder)} ({resultSummary.totalMatches})</span>
                  </div>
                </div>
                <div className="o365-msg-list">
                  {filteredEmails.length ? (() => {
                    const today = dayjs().startOf('day');
                    const yesterday = dayjs().subtract(1, 'day').startOf('day');
                    let lastDateGroup = '';
                    return filteredEmails.map(email => {
                      const emailDate = dayjs(getEmailTimestamp(email)).startOf('day');
                      let dateGroup = '';
                      if (emailDate.isSame(today, 'day')) dateGroup = 'TODAY';
                      else if (emailDate.isSame(yesterday, 'day')) dateGroup = 'YESTERDAY';
                      else dateGroup = emailDate.format('dddd D MMM').toUpperCase();
                      
                      const showDateHeader = dateGroup !== lastDateGroup;
                      lastDateGroup = dateGroup;
                      
                      return (
                        <Fragment key={email.id}>
                          {showDateHeader && <div className="o365-msg-date-header">{dateGroup}</div>}
                          <div className={`o365-msg-row ${selectedEmail?.id === email.id ? "active" : ""} ${email.approval_status === "pending" ? "pending" : email.approval_status === "rejected" ? "rejected" : !email.is_read ? "unread" : "read"}`} onClick={() => onEmailClick(email)}>
                            {!isStandardInboxUser ? <input type="checkbox" className="msg-check" checked={selectedEmailIds.includes(email.id)} onChange={() => toggleEmailSelection(email.id)} onClick={e => e.stopPropagation()} /> : <div style={{ width: 16 }} />}
                            <span className="msg-sender" style={{ color: getPriorityColor(email.priority) }}>
                              {getPriorityLabel(email.priority) ? <span style={{ marginRight: 2 }}>{getPriorityLabel(email.priority)}</span> : null}
                              {highlightText(email.folder_name === "Sent" || email.folder_name === "Outbox" ? email.recipient_email || email.sender_name : email.sender_name, highlightTerms)}
                            </span>
                            <span className="msg-subject">
                              {email.approval_status === "pending" ? <span style={{ color: "#ff8c00", fontWeight: 700, marginRight: 4, fontSize: 10, background: "#fff3e0", padding: "1px 5px", borderRadius: 3 }}>&#9650; PENDING</span> : null}
                              {email.approval_status === "rejected" ? <span style={{ color: "#d13438", fontWeight: 700, marginRight: 4, fontSize: 10, background: "#fde7e9", padding: "1px 5px", borderRadius: 3 }}>&#9660; REJECTED</span> : null}
                              {email.approval_status === "approved" ? <span style={{ color: "#107c10", fontWeight: 700, marginRight: 4, fontSize: 10, background: "#e6f4e6", padding: "1px 5px", borderRadius: 3 }}>&#10003; APPROVED</span> : null}
                              {email.serial ? <span style={{ color: "var(--c-primary)", fontWeight: 600, marginRight: 4, fontSize: 10, background: "var(--c-primary-tp)", padding: "1px 5px", borderRadius: 3 }}>{email.serial}</span> : null}
                              {email.parent_id ? <span style={{ color: "#666", marginRight: 2, fontSize: 10 }}>&#9500;</span> : null}
                              {email.recalled ? <span style={{ color: "#d13438", fontWeight: 700, marginRight: 4, fontSize: 10 }}>[RECALLED]</span> : null}
                              {email.has_attachments ? <Paperclip size={11} style={{ flexShrink: 0, opacity: 0.6 }} /> : null}
                              {highlightText(email.subject, highlightTerms)}
                              <span className="msg-preview">- {getEmailListPreview(email)}</span>
                            </span>
                            <span className="msg-date">{dayjs(getEmailTimestamp(email)).format("MM/DD")}</span>
                          </div>
                        </Fragment>
                      );
                    });
                  })() : <div className="o365-empty">No emails in <strong>{selectedFolder}</strong>.</div>}
                </div>
              </div>

              {/* READING PANE */}
              <div className="o365-reading">
                <Suspense fallback={<div className="o365-empty">Loading message...</div>}>
                  <MailReaderPane
                    selectedEmail={selectedEmail}
                    highlightText={highlightText}
                    highlightTerms={highlightTerms}
                    currentUser={currentUser}
                    selectedVisibleAttachmentCards={selectedVisibleAttachmentCards}
                    handleDownloadAllAttachments={handleDownloadAllAttachments}
                    selectedEmailHtmlDocument={selectedEmailHtmlDocument}
                    readingHtmlFrameRef={readingHtmlFrameRef}
                    handleReadingFrameLoad={handleReadingFrameLoad}
                    readingHtmlFrameHeight={readingHtmlFrameHeight}
                    renderPlainEmailBody={renderPlainEmailBody}
                    isManager={isManager}
                    managerDecisionNotes={managerDecisionNotes}
                    setManagerDecisionNotes={setManagerDecisionNotes}
                    handleApproveEmail={handleApproveEmail}
                    handleRejectEmail={handleRejectEmail}
                    prepareReplyDraft={prepareReplyDraft}
                    handleDeleteAction={handleDeleteAction}
                    handleMoreAction={handleMoreAction}
                    handleRetryEmail={handleRetryEmail}
                    isRetryingEmail={isRetryingEmail}
                    handleRecallEmail={handleRecallEmail}
                    moveTarget={moveTarget}
                    setMoveTarget={setMoveTarget}
                    dataFolders={data.folders}
                    handleMoveEmail={handleMoveEmail}
                    isMovingEmail={isMovingEmail}
                    approvalConversationItems={approvalConversationItems}
                    getApprovalConversationBadgeClass={getApprovalConversationBadgeClass}
                    calendarEvent={calendarEvent}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      )}

      {currentView === "calendar" && renderCalendar()}
      {currentView === "compose" && renderCompose()}

      {currentView === "approvals" && renderApprovals()}

      {currentView === "archive" && (
        <div className="o365-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--bd-light)", background: "#fff" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--fg-text)" }}>Internal Email Archive & Tracking</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-secondary-text)" }}>Search by serial number to find related email threads</p>
          </div>
          <div style={{ padding: "16px 24px", background: "#fff", borderBottom: "1px solid var(--bd-light)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#999" }} />
                <input
                  value={archiveSearch}
                  onChange={e => setArchiveSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") searchArchive(archiveSearch); }}
                  placeholder="Search by serial (e.g., TECH-20260705-0001)"
                  style={{ width: "100%", padding: "10px 12px 10px 36px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <button onClick={() => searchArchive(archiveSearch)} style={{ padding: "10px 20px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Search</button>
            </div>
          </div>
          <div style={{ padding: "16px 24px", background: "#f8f9fa", borderBottom: "1px solid var(--bd-light)", display: "flex", gap: 24 }}>
            <div><span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Emails</span><div style={{ fontSize: 22, fontWeight: 700, color: "var(--c-primary)" }}>{archiveStats.stats?.total || 0}</div></div>
            <div><span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Unique Serials</span><div style={{ fontSize: 22, fontWeight: 700, color: "#107c10" }}>{archiveStats.stats?.unique_serials || 0}</div></div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
            {archiveThread && archiveThread.length > 0 ? (
              <div>
                <button onClick={() => setArchiveThread(null)} style={{ marginBottom: 12, padding: "6px 12px", background: "#f0f0f0", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>Back to results</button>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Thread: {archiveThread[0]?.serial}</h3>
                {archiveThread.map((email, i) => (
                  <div key={email.id} style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 14, marginBottom: 10, background: "#fff", borderLeft: `4px solid ${email.folder_name === "Sent" ? "#1a237e" : "#107c10"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{email.sender_name || email.sender_email}</span>
                      <span style={{ fontSize: 11, color: "#888" }}>{dayjs(email.sent_at || email.received_at).format("ddd, MMM D, YYYY HH:mm")}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>To: {email.recipient_email}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{email.subject}</div>
                    <div style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>{(email.body || "").substring(0, 200)}...</div>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, fontSize: 11 }}>
                      <span style={{ padding: "2px 8px", background: "#e8f0fe", color: "#1a237e", borderRadius: 3 }}>{email.folder_name}</span>
                      <span style={{ padding: "2px 8px", background: "#f5f5f5", color: "#666", borderRadius: 3 }}>Depth: {email.thread_depth || 0}</span>
                      {email.serial ? <span style={{ padding: "2px 8px", background: "#e6f4e6", color: "#107c10", borderRadius: 3 }}>{email.serial}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : archiveResults.length > 0 ? (
              <div>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Search Results ({archiveResults.length})</h3>
                {archiveResults.map(email => (
                  <div key={email.id} onClick={() => loadArchiveThread(email.serial)} style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 14, marginBottom: 8, background: "#fff", cursor: "pointer", transition: "all 0.15s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{email.subject}</span>
                      <span style={{ fontSize: 11, color: "#888" }}>{dayjs(email.sent_at || email.received_at).format("MM/DD/YYYY HH:mm")}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#666" }}>
                      <span>From: {email.sender_name || email.sender_email}</span>
                      <span>To: {email.recipient_email}</span>
                    </div>
                    {email.serial ? <div style={{ marginTop: 6, fontSize: 11, color: "var(--c-primary)", fontWeight: 600 }}>{email.serial}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Recent Archived Emails</h3>
                {archiveStats.recent && archiveStats.recent.length > 0 ? archiveStats.recent.map((email, i) => (
                  <div key={i} onClick={() => loadArchiveThread(email.serial)} style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 14, marginBottom: 8, background: "#fff", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{email.subject}</span>
                      <span style={{ fontSize: 11, color: "#888" }}>{dayjs(email.received_at).format("MM/DD/YYYY")}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#666" }}>
                      <span>{email.sender_name || email.sender_email}</span>
                      <span>&rarr; {email.recipient_email}</span>
                    </div>
                    {email.serial ? <div style={{ marginTop: 6, fontSize: 11, color: "var(--c-primary)", fontWeight: 600 }}>{email.serial}</div> : null}
                  </div>
                )) : <div className="o365-empty">No archived emails yet.</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {currentView === "settings" && renderSettings()}

      {currentView === "admin" && (
        <Suspense fallback={<div className="o365-admin"><div className="o365-settings-section"><div className="o365-settings-body"><p style={{ fontSize: 12, color: "#666" }}>Loading admin dashboard...</p></div></div></div>}>
          <AdminDashboard
            canAccessAdmin={canAccessAdmin}
            currentUser={currentUser}
            adminTab={adminTab}
            setAdminTab={setAdminTab}
            onRefresh={handleRefreshAdminDashboard}
            onRunFullMailSync={handleRunFullMailSync}
            isRunningFullMailSync={isRunningFullMailSync}
            fullMailSyncSummary={fullMailSyncSummary}
            adminSummary={adminSummary}
            dashboardStats={dashboardStats}
            analytics={analytics}
            approvalAnalytics={approvalAnalytics}
            employeeForm={employeeForm}
            setEmployeeForm={setEmployeeForm}
            editingEmployeeId={editingEmployeeId}
            setEditingEmployeeId={setEditingEmployeeId}
            createEmptyEmployeeForm={createEmptyEmployeeForm}
            employees={employees}
            showManagerQuickForm={showManagerQuickForm}
            setShowManagerQuickForm={setShowManagerQuickForm}
            managerQuickForm={managerQuickForm}
            setManagerQuickForm={setManagerQuickForm}
            isSavingEmployee={isSavingEmployee}
            onQuickCreateManager={handleQuickCreateManager}
            onSaveEmployee={handleSaveEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            adminMailTests={adminMailTests}
            isRunningAdminMailTests={isRunningAdminMailTests}
            onRunAdminMailTests={runAdminMailTests}
            emailTrailTotal={emailTrailTotal}
            emailTrailFilters={emailTrailFilters}
            setEmailTrailFilters={setEmailTrailFilters}
            dataFolders={data.folders}
            isLoadingTrail={isLoadingTrail}
            onLoadEmailTrailData={loadEmailTrailData}
            onExportEmailTrailCsv={handleExportEmailTrailCsv}
            emailTrail={emailTrail}
            archiveForm={archiveForm}
            setArchiveForm={setArchiveForm}
            isCreatingArchive={isCreatingArchive}
            onCreateArchive={handleCreateArchive}
            archives={archives}
            archiveExplorerFilters={archiveExplorerFilters}
            setArchiveExplorerFilters={setArchiveExplorerFilters}
            archiveExplorerData={archiveExplorerData}
            archiveExplorerFocusEmailId={archiveExplorerFocusEmailId}
            setArchiveExplorerFocusEmailId={setArchiveExplorerFocusEmailId}
            activeTrackingTaskActionKey={activeTrackingTaskActionKey}
            selectedArchiveTrackingTaskIds={selectedArchiveTrackingTaskIds}
            bulkArchiveTrackingAssignedTo={bulkArchiveTrackingAssignedTo}
            setBulkArchiveTrackingAssignedTo={setBulkArchiveTrackingAssignedTo}
            activeBulkTrackingAction={activeBulkTrackingAction}
            isLoadingArchiveExplorer={isLoadingArchiveExplorer}
            onLoadArchiveExplorer={loadArchiveExplorer}
            archiveBackfillForm={archiveBackfillForm}
            setArchiveBackfillForm={setArchiveBackfillForm}
            archiveBackfillJob={archiveBackfillJob}
            archiveBackfillHistory={archiveBackfillHistory}
            archiveBackfillSummary={archiveBackfillSummary}
            isArchiveBackfillDetailsOpen={isArchiveBackfillDetailsOpen}
            archiveBackfillDetailsJob={archiveBackfillDetailsJob}
            archiveBackfillDetailsSearch={archiveBackfillDetailsSearch}
            setArchiveBackfillDetailsSearch={setArchiveBackfillDetailsSearch}
            archiveBackfillDetailsFailedOnly={archiveBackfillDetailsFailedOnly}
            setArchiveBackfillDetailsFailedOnly={setArchiveBackfillDetailsFailedOnly}
            isLoadingArchiveBackfillHistory={isLoadingArchiveBackfillHistory}
            isRunningArchiveBackfill={isRunningArchiveBackfill}
            isCancellingArchiveBackfill={isCancellingArchiveBackfill}
            isRetryingArchiveBackfill={isRetryingArchiveBackfill}
            onRunArchiveBackfill={runArchiveBackfill}
            onCancelArchiveBackfill={cancelArchiveBackfillJob}
            onRetryFailedArchiveBackfill={retryFailedArchiveBackfillItems}
            onOpenArchiveBackfillJob={openArchiveBackfillHistoryJob}
            onRetryFailedArchiveBackfillForJob={retryFailedArchiveBackfillItemsForJob}
            onExportArchiveBackfillSummary={exportArchiveBackfillSummary}
            onCloseArchiveBackfillDetailsDrawer={closeArchiveBackfillDetailsDrawer}
            onCopyArchiveBackfillErrors={copyArchiveBackfillErrors}
            onExportArchiveBackfillDetailsCsv={exportArchiveBackfillDetailsCsv}
            onOpenArchiveBackfillEmailById={openArchiveBackfillEmailById}
            onFocusArchiveTrackingTasksByEmailId={focusArchiveTrackingTasksByEmailId}
            onOpenTrackingTaskFromArchive={openTrackingTaskFromArchive}
            onMarkArchiveTrackingTaskDone={markArchiveTrackingTaskDone}
            onAssignArchiveTrackingTask={assignArchiveTrackingTask}
            onOpenRelatedEmailFromTrackingTask={openRelatedEmailFromTrackingTask}
            onToggleArchiveTrackingTaskSelection={toggleArchiveTrackingTaskSelection}
            onToggleAllArchiveTrackingTaskSelections={toggleAllArchiveTrackingTaskSelections}
            onMarkSelectedArchiveTrackingTasksDone={markSelectedArchiveTrackingTasksDone}
            onAssignSelectedArchiveTrackingTasks={assignSelectedArchiveTrackingTasks}
            onExportSelectedArchiveTrackingTasks={exportSelectedArchiveTrackingTasks}
            apiFetch={apiFetch}
          />
        </Suspense>
      )}

      {isApprovalDrawerOpen ? (
        <div className="o365-drawer-overlay" onClick={closeApprovalHistoryDrawer}>
          <aside className="o365-approval-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="o365-approval-drawer-header">
              <div>
                <h3>Approval History</h3>
                <p>{approvalDrawerEmail?.subject || "Approval workflow details"}</p>
              </div>
              <button type="button" onClick={closeApprovalHistoryDrawer}><X size={16} /></button>
            </div>
            <div className="o365-approval-drawer-body">
              <div className="o365-approval-panel">
                <div className="o365-approval-panel-title">Workflow Summary</div>
                <div className="o365-approval-meta-grid">
                  <span>Serial</span><strong>{approvalDrawerEmail?.serial || "-"}</strong>
                  <span>Version</span><strong>REV{String(approvalDrawerEmail?.version_number || 1).padStart(2, "0")}</strong>
                  <span>Subject Key</span><strong>{approvalDrawerEmail?.subject_key || "-"}</strong>
                  <span>Status</span><strong>{approvalDrawerEmail?.approval_status || approvalDrawerEmail?.status || "-"}</strong>
                </div>
              </div>
              {approvalActionLinks ? (
                <div className="o365-approval-panel">
                  <div className="o365-approval-panel-title">Telegram-Ready Links</div>
                  <div className="o365-approval-link-stack">
                    <label>Approve Expires</label>
                    <div style={{ fontSize: 12, color: "#555" }}>{approvalActionLinks.approve_expires_at ? dayjs(approvalActionLinks.approve_expires_at).format("YYYY-MM-DD HH:mm") : "-"}</div>
                    <label>Reject Expires</label>
                    <div style={{ fontSize: 12, color: "#555" }}>{approvalActionLinks.reject_expires_at ? dayjs(approvalActionLinks.reject_expires_at).format("YYYY-MM-DD HH:mm") : "-"}</div>
                    <label>Telegram Chat Mapping</label>
                    <div style={{ fontSize: 12, color: "#555" }}>{approvalActionLinks.telegram_chat_id || "No persistent Telegram chat mapped."}</div>
                    <label>Approve URL</label>
                    <div className="o365-approval-link-row">
                      <input value={approvalActionLinks.approve_url} readOnly />
                      <button type="button" onClick={() => copyTextToClipboard(approvalActionLinks.approve_url, "Approve link copied.")}><Copy size={14} /></button>
                    </div>
                    <label>Reject URL</label>
                    <div className="o365-approval-link-row">
                      <input value={approvalActionLinks.reject_url} readOnly />
                      <button type="button" onClick={() => copyTextToClipboard(approvalActionLinks.reject_url, "Reject link copied.")}><Copy size={14} /></button>
                    </div>
                    <label>Telegram Share Payload</label>
                    <div className="o365-approval-link-row">
                      <textarea value={approvalActionLinks.share_text} readOnly rows={5} />
                      <button type="button" onClick={() => copyTextToClipboard(approvalActionLinks.share_text, "Telegram share payload copied.")}><Copy size={14} /></button>
                    </div>
                    <div className="o365-approval-link-actions">
                      <button type="button" onClick={() => window.open(approvalActionLinks.telegram_share_url, "_blank", "noopener,noreferrer")}><MessageCircle size={14} /> Open Telegram Share</button>
                      <button type="button" onClick={() => window.open(approvalActionLinks.history_url, "_blank", "noopener,noreferrer")}><ExternalLink size={14} /> Open History Link</button>
                      <button type="button" onClick={async () => {
                        await revokeApprovalActionLinks(approvalDrawerEmail.id);
                        setSuccessMessage("Approval links revoked.");
                        setError("");
                      }}><X size={14} /> Revoke Links</button>
                      <button type="button" onClick={async () => {
                        await loadApprovalActionLinks(approvalDrawerEmail.id, true);
                        setSuccessMessage("Approval links regenerated.");
                        setError("");
                      }}><RefreshCw size={14} /> Regenerate</button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="o365-approval-panel">
                <div className="o365-approval-panel-title">
                  Gmail-Style Conversation
                  {isLoadingApprovalHistory ? <span style={{ marginLeft: 8, fontWeight: 400, color: "#666" }}>Loading...</span> : null}
                </div>
                {approvalConversationItems.length ? (
                  <div className="o365-approval-thread">
                    {approvalConversationItems.map((item) => (
                      <div key={item.id} className={`o365-approval-thread-item ${item.lane}`}>
                        <div className={`o365-approval-thread-dot ${getApprovalConversationBadgeClass(item.lane)}`}></div>
                        <div className="o365-approval-thread-card">
                          <div className="o365-approval-thread-head">
                            <strong>{item.actorLabel}</strong>
                            <span className={`o365-approval-thread-badge ${getApprovalConversationBadgeClass(item.lane)}`}>{item.summary}</span>
                            <span>{dayjs(item.created_at).format("YYYY-MM-DD HH:mm")}</span>
                          </div>
                          <div className="o365-approval-thread-meta">
                            {item.action_type} | {item.serial_id} | REV{String(item.version_number || 1).padStart(2, "0")}
                          </div>
                          {item.snapshot_subject ? <div className="o365-approval-thread-subject">{item.snapshot_subject}</div> : null}
                          {item.previewText ? <div className="o365-approval-thread-body">{item.previewText}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ fontSize: 12, color: "#777" }}>No serialized approval history is available yet.</div>}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Dialog */}
      {dialog ? (
        <div className="o365-dialog-overlay" onClick={() => closeDialog(Boolean(pendingQueryAction))}>
          <div className="o365-dialog" onClick={e => e.stopPropagation()}>
            <div className="o365-dialog-header">
              <h3>{dialog.title}</h3>
              <button onClick={() => closeDialog(Boolean(pendingQueryAction))} style={{ background: "transparent", border: "none", padding: 4 }}><X size={16} /></button>
            </div>
            <div className="o365-dialog-body">{dialog.body}</div>
            <div className="o365-dialog-actions">
              {dialog.actions?.length ? dialog.actions.map((action, index) => (
                <button
                  key={`${action.label}-${index}`}
                  onClick={action.onClick}
                  className={action.style === "primary" ? "primary" : ""}
                  style={action.style === "danger" ? { background: "#d13438", color: "#fff", border: "1px solid #d13438" } : undefined}
                >
                  {action.label}
                </button>
              )) : <button onClick={() => closeDialog(Boolean(pendingQueryAction))}>Close</button>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Helper component for banner question mark icon
function QuestionMark(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export default App;
