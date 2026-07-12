import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Calendar, Clock, X, ChevronDown, AlertTriangle, MapPin } from "lucide-react";
import { formatJordanDateOnly, formatJordanDateTime } from "../utils/timezone.js";

const SNOOZE_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 1440, label: "Tomorrow" },
];

export default function ReminderPopup({ calendarEvents = [], tasks = [], onDismiss, onSnooze, onOpenEvent, onOpenTask }) {
  const [reminders, setReminders] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [snoozeMinutes, setSnoozeMinutes] = useState(15);
  const [showSnoozeDropdown, setShowSnoozeDropdown] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 60 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const popupRef = useRef(null);

  useEffect(() => {
    const now = new Date();
    const items = [];

    calendarEvents.forEach(evt => {
      const eventStart = evt.starts_at || evt.start;
      if (!eventStart) return;
      const eventTime = new Date(eventStart);
      const reminderAt = evt.reminder_at || eventStart;
      const diffMs = new Date(reminderAt).getTime() - now.getTime();
      const diffMin = Math.round(diffMs / 60000);

      if (diffMin <= 15 && diffMin >= -1440) {
        const isPast = diffMin < 0;
        const overdueMin = Math.abs(diffMin);
        let timeLabel;
        if (isPast) {
          if (overdueMin < 60) timeLabel = `${overdueMin} minutes overdue`;
          else if (overdueMin < 1440) timeLabel = `${Math.floor(overdueMin / 60)} hours overdue`;
          else timeLabel = `${Math.floor(overdueMin / 1440)} day${Math.floor(overdueMin / 1440) > 1 ? "s" : ""} overdue`;
        } else if (diffMin === 0) {
          timeLabel = "Starting now";
        } else {
          timeLabel = `in ${diffMin} minutes`;
        }

        items.push({
          id: `cal-${evt.occurrence_key || evt.id || evt.summary}`,
          type: "calendar",
          title: evt.title || evt.summary || "Meeting",
          time: eventTime,
          timeLabel,
          location: evt.location || "",
          isPast,
          overdueMinutes: isPast ? overdueMin : 0,
          originalEvent: evt
        });
      }
    });

    tasks.forEach(task => {
      if (!task.due_date || task.status === "completed") return;
      const dueTime = new Date(task.due_date);
      const diffMs = dueTime.getTime() - now.getTime();
      const diffMin = Math.round(diffMs / 60000);

      if (diffMin <= 15 && diffMin >= -1440 * 7) {
        const isPast = diffMin < 0;
        const overdueMin = Math.abs(diffMin);
        let timeLabel;
        if (isPast) {
          if (overdueMin < 60) timeLabel = `${overdueMin} minutes overdue`;
          else if (overdueMin < 1440) timeLabel = `${Math.floor(overdueMin / 60)} hours overdue`;
          else timeLabel = `${Math.floor(overdueMin / 1440)} day${Math.floor(overdueMin / 1440) > 1 ? "s" : ""} overdue`;
        } else if (diffMin === 0) {
          timeLabel = "Due now";
        } else {
          timeLabel = `due in ${diffMin} minutes`;
        }

        items.push({
          id: `task-${task.id}`,
          type: "task",
          title: task.title,
          time: dueTime,
          timeLabel,
          project: task.project_code || "",
          isPast,
          overdueMinutes: isPast ? overdueMin : 0,
          originalTask: task
        });
      }
    });

    items.sort((a, b) => {
      if (a.isPast !== b.isPast) return a.isPast ? -1 : 1;
      if (a.isPast) return b.overdueMinutes - a.overdueMinutes;
      return a.time - b.time;
    });

    setReminders(items);
  }, [calendarEvents, tasks]);

  useEffect(() => {
    if (reminders.length > 0 && selectedIndex >= reminders.length) {
      setSelectedIndex(0);
    }
  }, [reminders, selectedIndex]);

  const handleDismiss = useCallback((id) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    if (onDismiss) onDismiss(id);
  }, [onDismiss]);

  const handleDismissAll = useCallback(() => {
    const ids = reminders.map(r => r.id);
    setReminders([]);
    if (onDismiss) ids.forEach(id => onDismiss(id));
  }, [reminders, onDismiss]);

  const handleSnooze = useCallback((id, minutes) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    if (onSnooze) onSnooze(id, minutes);
    setShowSnoozeDropdown(false);
  }, [onSnooze]);

  const handleSnoozeAll = useCallback((minutes) => {
    const ids = reminders.map(r => r.id);
    setReminders([]);
    if (onSnooze) ids.forEach(id => onSnooze(id, minutes));
  }, [reminders, onSnooze]);

  const handleOpen = useCallback((reminder) => {
    if (reminder.type === "calendar" && onOpenEvent) {
      onOpenEvent(reminder.originalEvent);
    } else if (reminder.type === "task" && onOpenTask) {
      onOpenTask(reminder.originalTask);
    }
  }, [onOpenEvent, onOpenTask]);

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest(".reminder-btn") || e.target.closest("select") || e.target.closest("button")) return;
    setIsDragging(true);
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 400, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.y))
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (reminders.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % reminders.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + reminders.length) % reminders.length);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (reminders[selectedIndex]) handleDismiss(reminders[selectedIndex].id);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (reminders[selectedIndex]) handleSnooze(reminders[selectedIndex].id, snoozeMinutes);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reminders, selectedIndex, snoozeMinutes, handleDismiss, handleSnooze]);

  if (reminders.length === 0) return null;

  const selectedReminder = reminders[selectedIndex];
  const overdueCount = reminders.filter(r => r.isPast).length;

  return (
    <div
      ref={popupRef}
      className={`reminder-popup ${isMinimized ? "minimized" : ""}`}
      style={{ left: position.x, top: position.y }}
    >
      {/* Title Bar */}
      <div className="reminder-titlebar" onMouseDown={handleMouseDown}>
        <div className="reminder-titlebar-left">
          <Bell size={14} />
          <span>{reminders.length} Reminder{reminders.length > 1 ? "s" : ""}</span>
        </div>
        <div className="reminder-titlebar-right">
          <button className="reminder-titlebar-btn" onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? "□" : "—"}
          </button>
          <button className="reminder-titlebar-btn close" onClick={handleDismissAll}>X</button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Selected Event Preview */}
          {selectedReminder && (
            <div className="reminder-preview">
              <div className="reminder-preview-icon">
                {selectedReminder.type === "calendar" ? <Calendar size={24} /> : <Clock size={24} />}
              </div>
              <div className="reminder-preview-content">
                <div className="reminder-preview-title">{selectedReminder.title}</div>
                <div className="reminder-preview-time">
                  {formatJordanDateTime(selectedReminder.time, { month: undefined, day: undefined, year: undefined })}
                  {" "}
                  {formatJordanDateOnly(selectedReminder.time, { month: "2-digit", day: "2-digit", year: "numeric" })}
                </div>
                {selectedReminder.location && (
                  <div className="reminder-preview-location">
                    <MapPin size={12} /> {selectedReminder.location}
                  </div>
                )}
                {selectedReminder.project && (
                  <div className="reminder-preview-project">{selectedReminder.project}</div>
                )}
              </div>
            </div>
          )}

          {/* Reminder List */}
          <div className="reminder-list">
            {reminders.map((reminder, index) => (
              <div
                key={reminder.id}
                className={`reminder-item ${index === selectedIndex ? "selected" : ""} ${reminder.isPast ? "overdue" : ""}`}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => handleOpen(reminder)}
              >
                <div className="reminder-item-icon">
                  {reminder.type === "calendar" ? <Calendar size={14} /> : <Clock size={14} />}
                </div>
                <div className="reminder-item-content">
                  <div className="reminder-item-title">{reminder.title}</div>
                </div>
                <div className={`reminder-item-time ${reminder.isPast ? "overdue" : ""}`}>
                  {reminder.timeLabel}
                </div>
              </div>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="reminder-footer">
            <div className="reminder-footer-left">
              <span className="reminder-hint">Click Snooze to be reminded in:</span>
              <div className="reminder-snooze-group">
                <div className="reminder-snooze-select">
                  <select
                    value={snoozeMinutes}
                    onChange={(e) => setSnoozeMinutes(Number(e.target.value))}
                  >
                    {SNOOZE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="reminder-btn snooze"
                  onClick={() => selectedReminder && handleSnooze(selectedReminder.id, snoozeMinutes)}
                >
                  Snooze
                </button>
              </div>
            </div>
            <div className="reminder-footer-right">
              <button className="reminder-btn dismiss" onClick={() => selectedReminder && handleDismiss(selectedReminder.id)}>
                Dismiss
              </button>
              <button className="reminder-btn dismiss-all" onClick={handleDismissAll}>
                Dismiss All
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
