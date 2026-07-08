import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Calendar, Clock, X, CheckCircle, AlertTriangle, Mail, ChevronRight, BellOff, Trash2, RefreshCw } from "lucide-react";

const CATEGORY_ICONS = {
  task_overdue: AlertTriangle,
  task_deadline: Clock,
  email_unanswered: Mail,
  email_stale: Mail,
  approval: Mail,
  meeting: Calendar,
  info: Bell,
};

const CATEGORY_COLORS = {
  task_overdue: { bg: "#fde7e9", fg: "#d13438" },
  task_deadline: { bg: "#fff3e0", fg: "#f57c00" },
  email_unanswered: { bg: "#fce4ec", fg: "#c62828" },
  email_stale: { bg: "#fff8e1", fg: "#f9a825" },
  approval: { bg: "#e8f5e9", fg: "#2e7d32" },
  meeting: { bg: "#e8f4fd", fg: "#1a237e" },
  info: { bg: "#f0f0f0", fg: "#555" },
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export default function NotificationPanel({ calendarEvents, pendingApprovals, currentUser, onSelectEvent, onSelectEmail, onNavigate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState([]);
  const prevUnreadRef = useRef(0);
  const panelRef = useRef(null);

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), toast.duration || 8000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=100", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);

      if (prevUnreadRef.current > 0 && data.unreadCount > prevUnreadRef.current) {
        const newest = (data.notifications || [])[0];
        if (newest) {
          addToast({
            type: newest.category,
            title: newest.title,
            body: newest.message,
            duration: 10000,
          });
        }
      }
      prevUnreadRef.current = data.unreadCount || 0;
    } catch (e) {
      console.error("Failed to fetch notifications:", e);
    }
  }, [addToast]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (calendarEvents && calendarEvents.length > 0) {
      const now = Date.now();
      calendarEvents.forEach(evt => {
        if (!evt.start) return;
        const diffMin = (new Date(evt.start).getTime() - now) / 60000;
        if (diffMin > 0 && diffMin <= 15) {
          addToast({
            type: "meeting",
            title: `${evt.summary || "Meeting"} in ${Math.round(diffMin)} min`,
            body: evt.location ? `📍 ${evt.location}` : "",
            duration: 15000,
          });
        }
      });
    }
  }, [calendarEvents, addToast]);

  const markAsRead = async (id) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "PUT", credentials: "include" });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) { console.error(e); }
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "PUT", credentials: "include" });
      setNotifications(prev => prev.map(n => ({ ...n, read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (e) { console.error(e); }
  };

  const deleteNotif = async (id) => {
    try {
      await fetch(`/api/notifications/${id}`, { method: "DELETE", credentials: "include" });
      const wasUnread = notifications.find(n => n.id === id && !n.read);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (wasUnread) setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) { console.error(e); }
  };

  const handleNotifClick = (notif) => {
    markAsRead(notif.id);
    if (notif.action_url && onNavigate) {
      onNavigate(notif.action_url);
    } else if (notif.email_id && onSelectEmail) {
      onSelectEmail({ id: notif.email_id });
    }
    setIsOpen(false);
  };

  const filtered = notifications.filter(n => {
    if (filter === "unread") return !n.read;
    if (filter !== "all") return n.category === filter;
    return true;
  }).sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99);
  });

  const formatTime = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "الآن";
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `منذ ${diffH} ساعة`;
    const diffD = Math.floor(diffH / 24);
    return `منذ ${diffD} يوم`;
  };

  return (
    <>
      <div className="notif-bell-wrapper" onClick={() => setIsOpen(!isOpen)} ref={panelRef}>
        <Bell size={20} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </div>

      {isOpen && <div className="notif-overlay" onClick={() => setIsOpen(false)} />}

      {isOpen && (
        <div className="notif-panel" onClick={e => e.stopPropagation()}>
          <div className="notif-panel-header">
            <div className="notif-panel-title">
              <Bell size={16} />
              <span>الإشعارات</span>
              {unreadCount > 0 && <span className="notif-header-count">{unreadCount} جديد</span>}
            </div>
            <div className="notif-panel-actions">
              <button className="notif-action-btn" onClick={fetchNotifications} title="تحديث">
                <RefreshCw size={14} />
              </button>
              {unreadCount > 0 && (
                <button className="notif-mark-all" onClick={markAllRead}>
                  <CheckCircle size={14} /> قراءة الكل
                </button>
              )}
            </div>
          </div>

          <div className="notif-filter-bar">
            {[
              { key: "all", label: "الكل" },
              { key: "unread", label: "غير مقروء" },
              { key: "task_overdue", label: "متأخر" },
              { key: "task_deadline", label: "مواعيد" },
              { key: "email_unanswered", label: "بانتظار رد" },
            ].map(f => (
              <button
                key={f.key}
                className={`notif-filter-btn ${filter === f.key ? "active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {f.key === "unread" && unreadCount > 0 && <span className="notif-filter-count">{unreadCount}</span>}
              </button>
            ))}
          </div>

          <div className="notif-panel-body">
            {filtered.length === 0 ? (
              <div className="notif-empty">
                <BellOff size={32} />
                <p>لا توجد إشعارات</p>
              </div>
            ) : (
              filtered.map(n => {
                const Icon = CATEGORY_ICONS[n.category] || Bell;
                const colors = CATEGORY_COLORS[n.category] || CATEGORY_COLORS.info;
                return (
                  <div
                    key={n.id}
                    className={`notif-item ${n.priority === "critical" || n.priority === "high" ? "urgent" : ""} ${n.read ? "read" : "unread"}`}
                    onClick={() => handleNotifClick(n)}
                  >
                    <div className="notif-item-icon" style={{ background: colors.bg, color: colors.fg }}>
                      <Icon size={16} />
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-title">{n.title}</div>
                      <div className="notif-item-subtitle">{n.message}</div>
                      <div className="notif-item-meta">
                        <span className="notif-item-time">{formatTime(n.created_at)}</span>
                        {n.project_code && <span className="notif-item-project">[{n.project_code}]</span>}
                        {n.email_subject && <span className="notif-item-email">📧 {n.email_subject}</span>}
                        {n.task_title && <span className="notif-item-task">📋 {n.task_title}</span>}
                      </div>
                    </div>
                    <div className="notif-item-actions">
                      {!n.read && (
                        <button className="notif-item-btn" onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }} title="تحديد كمقروء">
                          <CheckCircle size={14} />
                        </button>
                      )}
                      <button className="notif-item-btn delete" onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }} title="حذف">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="notif-panel-footer">
            <button onClick={() => { setIsOpen(false); }}>
              إغلاق
            </button>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast-notification ${toast.type || "info"}`}>
            <div className="toast-icon" style={CATEGORY_COLORS[toast.type] || CATEGORY_COLORS.info}>
              {(() => { const TIcon = CATEGORY_ICONS[toast.type] || Bell; return <TIcon size={16} />; })()}
            </div>
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              {toast.body && <div className="toast-body">{toast.body}</div>}
            </div>
            <button className="toast-close" onClick={() => dismissToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
