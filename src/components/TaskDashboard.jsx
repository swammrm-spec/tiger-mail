import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle, Clock, AlertTriangle, Search, Filter, Calendar,
  ChevronDown, RefreshCw, ArrowRight, List, LayoutGrid, Bell,
  Folder, User, ChevronLeft, MoreVertical, Trash2, Edit3
} from "lucide-react";

const TASK_TYPES = {
  general: { label: "General", color: "#607d8b", bg: "#eceff1" },
  customs: { label: "Customs", color: "#1565c0", bg: "#e3f2fd" },
  tender: { label: "Tender", color: "#c62828", bg: "#ffebee" },
  payment: { label: "Payment", color: "#2e7d32", bg: "#e8f5e9" },
  project: { label: "Project", color: "#6a1b9a", bg: "#f3e5f5" },
  contract: { label: "Contract", color: "#e65100", bg: "#fff3e0" },
  submission: { label: "Submission", color: "#00838f", bg: "#e0f7fa" },
};

const STATUS_MAP = {
  pending: { label: "Pending", color: "#f57c00", bg: "#fff3e0" },
  in_progress: { label: "In Progress", color: "#1976d2", bg: "#e3f2fd" },
  completed: { label: "Completed", color: "#2e7d32", bg: "#e8f5e9" },
  overdue: { label: "Overdue", color: "#c62828", bg: "#ffebee" },
};

const PRIORITY_MAP = {
  low: { label: "Low", color: "#78909c" },
  medium: { label: "Medium", color: "#f57c00" },
  high: { label: "High", color: "#c62828" },
  critical: { label: "Critical", color: "#b71c1c" },
};

export default function TaskDashboard({ currentUser, setCurrentView }) {
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [urgentTasks, setUrgentTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTaskMenu, setShowTaskMenu] = useState(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/tasks", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error("Failed to fetch tasks:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/stats", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats || {});
      }
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchStats();
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks, fetchStats]);

  useEffect(() => {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const urgent = tasks.filter(t => {
      if (t.status === "completed") return false;
      if (!t.due_date) return false;
      const due = new Date(t.due_date);
      return due <= in48h;
    }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    setUrgentTasks(urgent);
  }, [tasks]);

  const completeTask = async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/complete`, {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        fetchTasks();
        fetchStats();
      }
    } catch (e) {
      console.error("Failed to complete task:", e);
    }
  };

  const updateTaskStatus = async (taskId, status) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchTasks();
        fetchStats();
        setShowTaskMenu(null);
      }
    } catch (e) {
      console.error("Failed to update task:", e);
    }
  };

  const deleteTask = async (taskId) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (res.ok) {
        fetchTasks();
        fetchStats();
        setShowTaskMenu(null);
      }
    } catch (e) {
      console.error("Failed to delete task:", e);
    }
  };

  const filteredTasks = tasks.filter(t => {
    if (filterType !== "all" && t.task_type !== filterType) return false;
    if (filterStatus !== "all") {
      if (filterStatus === "overdue") {
        if (t.status === "completed") return false;
        if (!t.due_date || new Date(t.due_date) >= new Date()) return false;
      } else if (t.status !== filterStatus) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.project_code || "").toLowerCase().includes(q) ||
        (t.email_subject || "").toLowerCase().includes(q);
    }
    return true;
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return "No date";
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays <= 7) return `${diffDays} days`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getDateColor = (dateStr, status) => {
    if (status === "completed") return "#2e7d32";
    if (!dateStr) return "#78909c";
    const d = new Date(dateStr);
    const now = new Date();
    const diffHours = (d - now) / (1000 * 60 * 60);
    if (diffHours < 0) return "#c62828";
    if (diffHours <= 24) return "#f57c00";
    if (diffHours <= 48) return "#f57c00";
    return "#2e7d32";
  };

  return (
    <div className="task-dashboard">
      {/* Urgent Alerts */}
      {urgentTasks.length > 0 && (
        <div className="task-urgent-banner">
          <div className="urgent-icon">
            <Bell size={18} />
          </div>
          <div className="urgent-content">
            <span className="urgent-title">Urgent: {urgentTasks.length} task(s) due soon or overdue</span>
            <div className="urgent-items">
              {urgentTasks.slice(0, 3).map(t => (
                <span key={t.id} className="urgent-chip" onClick={() => setSelectedTask(t)}>
                  {t.title} - {formatDate(t.due_date)}
                </span>
              ))}
              {urgentTasks.length > 3 && <span className="urgent-more">+{urgentTasks.length - 3} more</span>}
            </div>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="task-stats-bar">
        <div className="stat-card">
          <div className="stat-number">{stats.total || 0}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card pending">
          <div className="stat-number">{stats.pending || 0}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card progress">
          <div className="stat-number">{stats.in_progress || 0}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card done">
          <div className="stat-number">{stats.completed || 0}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="stat-card overdue">
          <div className="stat-number">{stats.overdue || 0}</div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat-card soon">
          <div className="stat-number">{stats.due_soon || 0}</div>
          <div className="stat-label">Due Soon</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="task-toolbar">
        <div className="task-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="task-filters">
          <div className="filter-group">
            <Filter size={14} />
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              {Object.entries(TASK_TYPES).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <button className="view-toggle" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}>
            {viewMode === "grid" ? <List size={16} /> : <LayoutGrid size={16} />}
          </button>
          <button className="refresh-btn" onClick={() => { fetchTasks(); fetchStats(); }}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Task Grid/List */}
      {loading ? (
        <div className="task-loading">
          <RefreshCw size={24} className="spin" />
          <span>Loading tasks...</span>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="task-empty">
          <Folder size={48} />
          <p>No tasks found</p>
          <span>{searchQuery ? "Try a different search term" : "No tasks match the current filters"}</span>
        </div>
      ) : viewMode === "grid" ? (
        <div className="task-grid">
          {filteredTasks.map(task => {
            const typeInfo = TASK_TYPES[task.task_type] || TASK_TYPES.general;
            const statusInfo = STATUS_MAP[task.status] || STATUS_MAP.pending;
            const priorityInfo = PRIORITY_MAP[task.priority] || PRIORITY_MAP.medium;
            const isOverdue = task.status !== "completed" && task.due_date && new Date(task.due_date) < new Date();

            return (
              <div
                key={task.id}
                className={`task-card ${isOverdue ? "overdue" : ""} ${task.status === "completed" ? "completed" : ""}`}
                onClick={() => setSelectedTask(task)}
              >
                <div className="task-card-header">
                  <span className="task-type-badge" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                    {typeInfo.label}
                  </span>
                  <div className="task-card-menu">
                    <button className="menu-trigger" onClick={(e) => { e.stopPropagation(); setShowTaskMenu(showTaskMenu === task.id ? null : task.id); }}>
                      <MoreVertical size={14} />
                    </button>
                    {showTaskMenu === task.id && (
                      <div className="task-dropdown">
                        {task.status !== "completed" && (
                          <button onClick={(e) => { e.stopPropagation(); completeTask(task.id); }}>
                            <CheckCircle size={14} /> Complete
                          </button>
                        )}
                        {task.status === "pending" && (
                          <button onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, "in_progress"); }}>
                            <ArrowRight size={14} /> Start
                          </button>
                        )}
                        {task.status === "in_progress" && (
                          <button onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, "pending"); }}>
                            <ChevronLeft size={14} /> Back to Pending
                          </button>
                        )}
                        <button className="delete" onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}>
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <h4 className="task-card-title">{task.title}</h4>
                {task.description && <p className="task-card-desc">{task.description}</p>}
                <div className="task-card-meta">
                  {task.project_code && (
                    <span className="meta-item project">
                      <Folder size={12} /> {task.project_code}
                    </span>
                  )}
                  {task.assigned_to_name && (
                    <span className="meta-item assignee">
                      <User size={12} /> {task.assigned_to_name}
                    </span>
                  )}
                </div>
                <div className="task-card-footer">
                  <span className="task-date" style={{ color: getDateColor(task.due_date, task.status) }}>
                    <Calendar size={12} /> {formatDate(task.due_date)}
                  </span>
                  <div className="task-card-badges">
                    <span className="status-badge" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                      {statusInfo.label}
                    </span>
                    {task.priority === "high" || task.priority === "critical" ? (
                      <span className="priority-badge" style={{ color: priorityInfo.color }}>
                        <AlertTriangle size={12} />
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="task-list">
          {filteredTasks.map(task => {
            const typeInfo = TASK_TYPES[task.task_type] || TASK_TYPES.general;
            const statusInfo = STATUS_MAP[task.status] || STATUS_MAP.pending;
            const isOverdue = task.status !== "completed" && task.due_date && new Date(task.due_date) < new Date();

            return (
              <div
                key={task.id}
                className={`task-list-item ${isOverdue ? "overdue" : ""} ${task.status === "completed" ? "completed" : ""}`}
                onClick={() => setSelectedTask(task)}
              >
                <div className="list-type-indicator" style={{ background: typeInfo.color }} />
                <div className="list-content">
                  <div className="list-main">
                    <span className="list-title">{task.title}</span>
                    {task.project_code && <span className="list-project">[{task.project_code}]</span>}
                  </div>
                  <div className="list-meta">
                    <span className="list-date" style={{ color: getDateColor(task.due_date, task.status) }}>
                      <Calendar size={12} /> {formatDate(task.due_date)}
                    </span>
                    {task.assigned_to_name && <span className="list-assignee"><User size={12} /> {task.assigned_to_name}</span>}
                  </div>
                </div>
                <span className="status-badge small" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                  {statusInfo.label}
                </span>
                <div className="list-actions">
                  {task.status !== "completed" && (
                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); completeTask(task.id); }} title="Complete">
                      <CheckCircle size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="task-modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="task-modal" onClick={e => e.stopPropagation()}>
            <div className="task-modal-header">
              <span className="task-type-badge" style={{ background: TASK_TYPES[selectedTask.task_type]?.bg, color: TASK_TYPES[selectedTask.task_type]?.color }}>
                {TASK_TYPES[selectedTask.task_type]?.label || "General"}
              </span>
              <button className="close-btn" onClick={() => setSelectedTask(null)}>X</button>
            </div>
            <h3>{selectedTask.title}</h3>
            {selectedTask.description && <p className="task-modal-desc">{selectedTask.description}</p>}
            <div className="task-modal-details">
              <div className="detail-row">
                <span className="detail-label">Status:</span>
                <span className="status-badge" style={{ background: STATUS_MAP[selectedTask.status]?.bg, color: STATUS_MAP[selectedTask.status]?.color }}>
                  {STATUS_MAP[selectedTask.status]?.label}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Priority:</span>
                <span style={{ color: PRIORITY_MAP[selectedTask.priority]?.color }}>
                  {PRIORITY_MAP[selectedTask.priority]?.label || "Medium"}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Due Date:</span>
                <span style={{ color: getDateColor(selectedTask.due_date, selectedTask.status) }}>
                  {selectedTask.due_date ? new Date(selectedTask.due_date).toLocaleDateString() : "No date"}
                </span>
              </div>
              {selectedTask.project_code && (
                <div className="detail-row">
                  <span className="detail-label">Project:</span>
                  <span>{selectedTask.project_code} - {selectedTask.project_name || ""}</span>
                </div>
              )}
              {selectedTask.assigned_to_name && (
                <div className="detail-row">
                  <span className="detail-label">Assigned To:</span>
                  <span>{selectedTask.assigned_to_name}</span>
                </div>
              )}
              {selectedTask.email_subject && (
                <div className="detail-row">
                  <span className="detail-label">Related Email:</span>
                  <span className="email-link">{selectedTask.email_subject}</span>
                </div>
              )}
            </div>
            <div className="task-modal-actions">
              {selectedTask.status !== "completed" && (
                <>
                  <button className="btn-primary" onClick={() => { completeTask(selectedTask.id); setSelectedTask(null); }}>
                    <CheckCircle size={16} /> Mark Complete
                  </button>
                  {selectedTask.status === "pending" && (
                    <button className="btn-secondary" onClick={() => { updateTaskStatus(selectedTask.id, "in_progress"); setSelectedTask(null); }}>
                      <ArrowRight size={16} /> Start Task
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
