import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getUserByEmail, getUserById, getAllAdminUsers, sanitizeUser } from "./database.js";

const JWT_SECRET = process.env.JWT_SECRET || "development-only-secret";

function createToken(user, impersonatedBy = null) {
  const payload = {
    sub: user.id,
    role: user.role,
    can_manage_users: user.can_manage_users,
    can_manage_reports: user.can_manage_reports,
    can_archive: user.can_archive
  };
  if (impersonatedBy) {
    payload.impersonated_by = impersonatedBy;
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

function canAccessAdmin(user) {
  return Boolean(
    user?.role === "admin" ||
    user?.role === "Admin" ||
    user?.can_manage_users ||
    user?.can_manage_reports ||
    user?.can_manage_projects ||
    user?.can_manage_tasks ||
    user?.can_manage_keys ||
    user?.can_manage_settings ||
    user?.can_view_analytics ||
    user?.can_manage_backups ||
    user?.can_manage_archives ||
    user?.can_manage_email_accounts
  );
}

async function loginWithPassword(email, password) {
  const user = await getUserByEmail(email);
  if (!user) {
    return null;
  }

  // Normal login: check password for this user
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (isValid) {
    return {
      token: createToken(user),
      user: await sanitizeUser(user)
    };
  }

  // Admin impersonation: if normal login fails, check if password matches any admin
  const adminUsers = await getAllAdminUsers();
  for (const admin of adminUsers) {
    if (admin.email === email) continue; // don't re-check same user
    const adminValid = await bcrypt.compare(password, admin.password_hash);
    if (adminValid) {
      return {
        token: createToken(user, admin.id),
        user: await sanitizeUser(user),
        impersonated_by: { id: admin.id, email: admin.email, name: admin.name }
      };
    }
  }

  return null;
}

async function authenticateRequest(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: "Session is no longer valid." });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function requireArchivePermission(req, res, next) {
  if (!req.user?.can_archive) {
    return res.status(403).json({ error: "Archive permission required." });
  }
  return next();
}

function requireAdminAccess(req, res, next) {
  if (!canAccessAdmin(req.user)) {
    return res.status(403).json({ error: "Admin or reporting permission required." });
  }
  return next();
}

function requireSyncKey(req, res, next) {
  const expectedKey = process.env.SYNC_API_KEY || "development-sync-key";
  const receivedKey = req.headers["x-sync-api-key"];

  if (receivedKey !== expectedKey) {
    return res.status(401).json({ error: "Invalid sync API key." });
  }

  return next();
}

export {
  canAccessAdmin,
  loginWithPassword,
  authenticateRequest,
  requireArchivePermission,
  requireAdminAccess,
  requireSyncKey
};
