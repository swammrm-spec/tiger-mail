import { useState, useEffect, useCallback } from "react";
import dayjs from "dayjs";
import { Bell, Calendar, Clock, X, CheckCircle, AlertTriangle, Mail, ChevronRight, BellOff } from "lucide-react";

export default function NotificationPanel({ calendarEvents, pendingApprovals, currentUser, onSelectEvent, onSelectEmail }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, toast.duration || 8000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const items = [];

    if (calendarEvents && calendarEvents.length > 0) {
      const now = dayjs();
      calendarEvents.forEach(evt => {
        if (!evt.start) return;
        const eventTime = dayjs(evt.start);
        const diffMinutes = eventTime.diff(now, "minute");

        if (diffMinutes > 0 && diffMinutes <= 15) {
          items.push({
            id: `cal-soon-${evt.id || evt.summary}`,
            type: "meeting",
            title: evt.summary || "Meeting",
            subtitle: `Starts in ${diffMinutes} minute${diffMinutes > 1 ? "s" : ""}`,
            time: evt.start,
            location: evt.location,
            icon: "calendar",
            urgent: diffMinutes <= 5,
          });
        } else if (diffMinutes > 15 && diffMinutes <= 60) {
          items.push({
            id: `cal-upcoming-${evt.id || evt.summary}`,
            type: "meeting",
            title: evt.summary || "Meeting",
            subtitle: `Starts at ${eventTime.format("HH:mm")}`,
            time: evt.start,
            location: evt.location,
            icon: "calendar",
            urgent: false,
          });
        }
      });
    }

    if (pendingApprovals && pendingApprovals.length > 0) {
      items.push({
        id: "pending-approvals",
        type: "approval",
        title: "Pending Approvals",
        subtitle: `${pendingApprovals.length} email${pendingApprovals.length > 1 ? "s" : ""} waiting for your approval`,
        icon: "mail",
        urgent: pendingApprovals.length > 3,
        count: pendingApprovals.length,
      });
    }

    setNotifications(items);
  }, [calendarEvents, pendingApprovals]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = dayjs();
      if (calendarEvents && calendarEvents.length > 0) {
        calendarEvents.forEach(evt => {
          if (!evt.start) return;
          const eventTime = dayjs(evt.start);
          const diffMinutes = eventTime.diff(now, "minute");
          const toastKey = `toast-${evt.summary}-${evt.start}`;

          if (diffMinutes === 15 || diffMinutes === 10 || diffMinutes === 5) {
            const alreadyToasted = toasts.some(t => t.key === toastKey);
            if (!alreadyToasted) {
              addToast({
                key: toastKey,
                type: "reminder",
                title: `Meeting in ${diffMinutes} minutes`,
                body: evt.summary,
                location: evt.location,
                duration: 15000,
              });
            }
          }
        });
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [calendarEvents, toasts, addToast]);

  useEffect(() => {
    if (notifications.length > 0 && !isOpen) {
      const urgent = notifications.find(n => n.urgent);
      if (urgent) {
        const toastKey = `urgent-${urgent.id}`;
        const alreadyToasted = toasts.some(t => t.key === toastKey);
        if (!alreadyToasted) {
          addToast({
            key: toastKey,
            type: urgent.type,
            title: urgent.title,
            body: urgent.subtitle,
            duration: 10000,
          });
        }
      }
    }
  }, [notifications, isOpen, toasts, addToast]);

  const unreadCount = notifications.filter(n => !dismissed.has(n.id)).length;

  const dismissNotification = (id) => {
    setDismissed(prev => new Set([...prev, id]));
  };

  const getIcon = (type, icon) => {
    if (icon === "calendar") return <Calendar size={16} />;
    if (icon === "mail") return <Mail size={16} />;
    if (type === "approval") return <AlertTriangle size={16} />;
    return <Bell size={16} />;
  };

  const getIconBg = (type, urgent) => {
    if (urgent) return { background: "#fde7e9", color: "#d13438" };
    if (type === "meeting") return { background: "#e8f4fd", color: "#1a237e" };
    if (type === "approval") return { background: "#fff3e0", color: "#f57c00" };
    return { background: "#f0f0f0", color: "#555" };
  };

  return (
    <>
      <div className="notif-bell-wrapper" onClick={() => setIsOpen(!isOpen)}>
        <Bell size={20} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
      </div>

      {isOpen && (
        <div className="notif-overlay" onClick={() => setIsOpen(false)} />
      )}

      {isOpen && (
        <div className="notif-panel" onClick={e => e.stopPropagation()}>
          <div className="notif-panel-header">
            <div className="notif-panel-title">
              <Bell size={16} />
              <span>Notifications</span>
            </div>
            {notifications.length > 0 && (
              <button className="notif-mark-all" onClick={() => setDismissed(new Set(notifications.map(n => n.id)))}>
                <CheckCircle size={14} /> Mark all read
              </button>
            )}
          </div>

          <div className="notif-panel-body">
            {notifications.length === 0 ? (
              <div className="notif-empty">
                <BellOff size={32} />
                <p>No new notifications</p>
              </div>
            ) : (
              notifications.filter(n => !dismissed.has(n.id)).map(n => (
                <div key={n.id} className={`notif-item ${n.urgent ? "urgent" : ""}`} onClick={() => {
                  if (n.type === "meeting" && onSelectEvent) onSelectEvent(n);
                  if (n.type === "approval" && onSelectEmail) onSelectEmail(n);
                  dismissNotification(n.id);
                  setIsOpen(false);
                }}>
                  <div className="notif-item-icon" style={getIconBg(n.type, n.urgent)}>
                    {getIcon(n.type, n.icon)}
                  </div>
                  <div className="notif-item-content">
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-subtitle">{n.subtitle}</div>
                    {n.location && <div className="notif-item-location">📍 {n.location}</div>}
                  </div>
                  <button className="notif-item-dismiss" onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}>
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="notif-panel-footer">
              <button onClick={() => { setDismissed(new Set(notifications.map(n => n.id))); setIsOpen(false); }}>
                View all
              </button>
            </div>
          )}
        </div>
      )}

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast-notification ${toast.type} ${toast.urgent ? "urgent" : ""}`}>
            <div className="toast-icon" style={getIconBg(toast.type, toast.urgent)}>
              {toast.type === "reminder" ? <Calendar size={16} /> : toast.type === "approval" ? <AlertTriangle size={16} /> : <Bell size={16} />}
            </div>
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              {toast.body && <div className="toast-body">{toast.body}</div>}
              {toast.location && <div className="toast-location">📍 {toast.location}</div>}
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
