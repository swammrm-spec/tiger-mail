import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertTriangle, Search, Filter, Calendar, RefreshCw, List, LayoutGrid, Bell,
  Folder, User, BarChart3, Clock3, Briefcase, CheckCircle, ArrowRight, Download
} from "lucide-react";
import { formatJordanDateOnly, formatJordanDateTime } from "../utils/timezone.js";

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

function normalizeStatus(value = "") {
  const normalized = String(value || "pending").trim().toLowerCase();
  if (normalized === "in progress") return "in_progress";
  return normalized;
}

function normalizePriority(value = "") {
  const normalized = String(value || "medium").trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(normalized)) {
    return normalized;
  }
  return "medium";
}

function resolveTaskType(value = "") {
  const normalized = String(value || "general").trim().toLowerCase();
  if (TASK_TYPES[normalized]) return normalized;
  if (normalized.includes("custom")) return "customs";
  if (normalized.includes("tender") || normalized.includes("bid")) return "tender";
  if (normalized.includes("payment") || normalized.includes("finance")) return "payment";
  if (normalized.includes("contract") || normalized.includes("warranty")) return "contract";
  if (normalized.includes("submission") || normalized.includes("deliver")) return "submission";
  if (normalized.includes("project")) return "project";
  return "general";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename, contents) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatHistoryActionLabel(actionType = "") {
  const normalized = String(actionType || "").trim().toLowerCase();
  if (normalized === "created") return "Created";
  if (normalized === "started") return "Started";
  if (normalized === "completed") return "Completed";
  if (normalized === "reassigned") return "Reassigned";
  return "Updated";
}

function formatHistoryFieldLabel(fieldName = "") {
  const normalized = String(fieldName || "").trim().toLowerCase();
  if (normalized === "assigned_to") return "Assignee";
  if (normalized === "due_date") return "Due Date";
  if (normalized === "task_type") return "Task Type";
  if (normalized === "priority") return "Priority";
  if (normalized === "status") return "Status";
  return "Task";
}

function formatHistoryChange(entry = {}) {
  const fieldName = String(entry.field_name || "task").trim().toLowerCase();
  const previousLabel = entry.previous_display || entry.previous_value || "Empty";
  const nextLabel = entry.next_display || entry.next_value || "Empty";
  if (fieldName === "task") {
    return nextLabel;
  }
  return `${formatHistoryFieldLabel(fieldName)}: ${previousLabel} -> ${nextLabel}`;
}

export default function TaskDashboard({ currentUser, focusedTrackingTaskId = null, onFocusedTrackingTaskHandled = null }) {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({
    totals: {},
    by_status: [],
    by_task_type: [],
    by_priority: []
  });
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterProjectId, setFilterProjectId] = useState("all");
  const [filterAssignedTo, setFilterAssignedTo] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [urgentTasks, setUrgentTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [assigningTo, setAssigningTo] = useState("");
  const [taskHistory, setTaskHistory] = useState([]);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const [taskHistoryError, setTaskHistoryError] = useState("");
  const [taskHistoryActorFilter, setTaskHistoryActorFilter] = useState("all");
  const [taskHistoryActionFilter, setTaskHistoryActionFilter] = useState("all");
  const [taskHistoryFromDate, setTaskHistoryFromDate] = useState("");
  const [taskHistoryToDate, setTaskHistoryToDate] = useState("");

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

  const buildQueryParams = useCallback((includeStatus = true) => {
    const params = new URLSearchParams();
    if (includeStatus && filterStatus !== "all") params.set("status", filterStatus.toUpperCase());
    if (filterProjectId !== "all") params.set("project_id", filterProjectId);
    if (canAccessAdmin && filterAssignedTo !== "all") params.set("assigned_to", filterAssignedTo);
    return params.toString();
  }, [canAccessAdmin, filterAssignedTo, filterProjectId, filterStatus]);

  const normalizeTasks = useCallback((apiTasks = []) => {
    return safeArray(apiTasks).map((task) => {
      const taskType = resolveTaskType(task.task_type);
      const status = normalizeStatus(task.status);
      return {
        ...task,
        id: task.task_id,
        task_id: task.task_id,
        task_type: taskType,
        task_type_raw: task.task_type || "general",
        priority: normalizePriority(task.priority),
        status,
        title: String(task.email_subject || TASK_TYPES[taskType]?.label || "Tracking task").trim(),
        description: String(task.ai_summary || "").trim()
      };
    });
  }, []);

  const fetchFilterData = useCallback(async () => {
    try {
      const requests = [fetch("/api/projects", { credentials: "include" })];
      if (canAccessAdmin) {
        requests.push(fetch("/api/admin/employees", { credentials: "include" }));
      }
      const [projectsRes, employeesRes] = await Promise.all(requests);
      if (projectsRes.ok) {
        const projectsData = await projectsRes.json();
        setProjects(safeArray(projectsData.projects));
      }
      if (canAccessAdmin) {
        if (employeesRes?.ok) {
          const employeesData = await employeesRes.json();
          setEmployees(safeArray(employeesData.employees));
        }
      } else if (currentUser?.id) {
        setEmployees([{
          id: currentUser.id,
          name: currentUser.name || currentUser.email || "My Tasks",
          email: currentUser.email || ""
        }]);
      }
    } catch (e) {
      console.error("Failed to fetch dashboard filters:", e);
    }
  }, [canAccessAdmin, currentUser]);

  const fetchDashboardData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");
      const activeQuery = buildQueryParams(true);
      const summaryQuery = buildQueryParams(false);
      const [tasksRes, summaryRes] = await Promise.all([
        fetch(`/api/tracking-tasks/active${activeQuery ? `?${activeQuery}` : ""}`, { credentials: "include" }),
        fetch(`/api/tracking-tasks/summary${summaryQuery ? `?${summaryQuery}` : ""}`, { credentials: "include" })
      ]);
      if (!tasksRes.ok || !summaryRes.ok) {
        throw new Error("Unable to load tracking task dashboard.");
      }
      const tasksData = await tasksRes.json();
      const summaryData = await summaryRes.json();
      setTasks(normalizeTasks(tasksData.tasks));
      setSummary(summaryData.summary || { totals: {}, by_status: [], by_task_type: [], by_priority: [] });
    } catch (e) {
      console.error("Failed to fetch tracking dashboard:", e);
      setError("Unable to load tracking tasks right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildQueryParams, normalizeTasks]);

  useEffect(() => {
    fetchFilterData();
  }, [fetchFilterData]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!focusedTrackingTaskId) {
      return;
    }
    setSearchQuery("");
    setFilterStatus("all");
    setFilterProjectId("all");
    setFilterAssignedTo("all");
  }, [focusedTrackingTaskId]);

  useEffect(() => {
    const interval = setInterval(() => fetchDashboardData({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!focusedTrackingTaskId || loading) {
      return;
    }
    const normalizedFocusId = Number(focusedTrackingTaskId || 0);
    const matchedTask = tasks.find((task) => Number(task.task_id) === normalizedFocusId) || null;
    if (matchedTask) {
      setSelectedTask(matchedTask);
      onFocusedTrackingTaskHandled?.();
    }
  }, [focusedTrackingTaskId, loading, onFocusedTrackingTaskHandled, tasks]);

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

  useEffect(() => {
    setAssigningTo(selectedTask?.assigned_to ? String(selectedTask.assigned_to) : "all");
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask?.task_id) {
      setTaskHistory([]);
      setTaskHistoryError("");
      setTaskHistoryLoading(false);
      return;
    }

    let cancelled = false;
    async function loadTaskHistory() {
      try {
        setTaskHistoryLoading(true);
        setTaskHistoryError("");
        const res = await fetch(`/api/tracking-tasks/${selectedTask.task_id}/history${taskHistoryQuery ? `?${taskHistoryQuery}` : ""}`, {
          credentials: "include"
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Unable to load tracking task history.");
        }
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setTaskHistory(safeArray(data.history));
        }
      } catch (e) {
        if (!cancelled) {
          setTaskHistory([]);
          setTaskHistoryError(e.message || "Unable to load tracking task history.");
        }
      } finally {
        if (!cancelled) {
          setTaskHistoryLoading(false);
        }
      }
    }

    loadTaskHistory();
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.task_id, selectedTask?.updated_at, taskHistoryQuery]);

  const applyTaskUpdate = useCallback(async (taskId, updates, errorMessage) => {
    try {
      setActionBusyId(taskId);
      const res = await fetch(`/api/tracking-tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || errorMessage);
      }
      await fetchDashboardData({ silent: true });
      const data = await res.json().catch(() => ({}));
      if (data.task) {
        setSelectedTask((current) => current?.task_id === taskId ? normalizeTasks([data.task])[0] : current);
      }
      return true;
    } catch (e) {
      console.error(errorMessage, e);
      setError(e.message || errorMessage);
      return false;
    } finally {
      setActionBusyId(null);
    }
  }, [fetchDashboardData, normalizeTasks]);

  const completeTask = useCallback(async (taskId) => {
    try {
      setActionBusyId(taskId);
      const res = await fetch(`/api/tracking-tasks/${taskId}/complete`, {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to complete tracking task.");
      }
      const data = await res.json().catch(() => ({}));
      await fetchDashboardData({ silent: true });
      if (data.task) {
        setSelectedTask((current) => current?.task_id === taskId ? normalizeTasks([data.task])[0] : null);
      } else {
        setSelectedTask(null);
      }
      return true;
    } catch (e) {
      console.error("Unable to complete tracking task.", e);
      setError(e.message || "Unable to complete tracking task.");
      return false;
    } finally {
      setActionBusyId(null);
    }
  }, [fetchDashboardData, normalizeTasks]);

  const startTask = useCallback(async (taskId) => {
    return applyTaskUpdate(taskId, { status: "IN_PROGRESS" }, "Unable to start tracking task.");
  }, [applyTaskUpdate]);

  const reassignTask = useCallback(async () => {
    if (!selectedTask?.task_id || !canAccessAdmin) return;
    const nextAssignedTo = assigningTo === "all" ? null : Number(assigningTo || 0) || null;
    const success = await applyTaskUpdate(
      selectedTask.task_id,
      { assigned_to: nextAssignedTo },
      "Unable to reassign tracking task."
    );
    if (success) {
      setSelectedTask((current) => current ? { ...current, assigned_to: nextAssignedTo } : current);
    }
  }, [applyTaskUpdate, assigningTo, canAccessAdmin, selectedTask]);

  const filteredTasks = useMemo(() => tasks.filter((t) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title || "").toLowerCase().includes(q)
        || (t.description || "").toLowerCase().includes(q)
        || (t.project_code || "").toLowerCase().includes(q)
        || (t.project_name || "").toLowerCase().includes(q)
        || (t.email_subject || "").toLowerCase().includes(q)
        || (t.assigned_to_name || "").toLowerCase().includes(q);
    }
    return true;
  }), [searchQuery, tasks]);

  const summaryCards = [
    { key: "total", label: "Total", value: summary?.totals?.total || 0, className: "" },
    { key: "pending", label: "Pending", value: summary?.totals?.pending || 0, className: "pending" },
    { key: "in_progress", label: "In Progress", value: summary?.totals?.in_progress || 0, className: "progress" },
    { key: "completed", label: "Completed", value: summary?.totals?.completed || 0, className: "done" },
    { key: "overdue", label: "Overdue", value: summary?.totals?.overdue || 0, className: "overdue" },
    { key: "due_soon", label: "Due Soon", value: summary?.totals?.due_soon || 0, className: "soon" }
  ];

  const taskTypeBreakdown = useMemo(() => safeArray(summary?.by_task_type).slice(0, 6), [summary]);
  const priorityBreakdown = useMemo(() => safeArray(summary?.by_priority), [summary]);
  const taskHistoryQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (taskHistoryActorFilter !== "all") {
      params.set("actor", taskHistoryActorFilter);
    }
    if (taskHistoryActionFilter !== "all") {
      params.set("action_type", taskHistoryActionFilter);
    }
    if (taskHistoryFromDate) {
      params.set("from_date", taskHistoryFromDate);
    }
    if (taskHistoryToDate) {
      params.set("to_date", taskHistoryToDate);
    }
    return params.toString();
  }, [taskHistoryActionFilter, taskHistoryActorFilter, taskHistoryFromDate, taskHistoryToDate]);
  const taskHistorySummary = useMemo(() => {
    const counts = safeArray(taskHistory).reduce((acc, entry) => {
      const key = String(entry?.action_type || "updated").trim().toLowerCase() || "updated";
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
    const actionSummary = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([actionType, total]) => `${formatHistoryActionLabel(actionType)}: ${total}`)
      .join(" | ");
    const lastActor = taskHistory[0]?.actor_name || taskHistory[0]?.actor_email || "System";
    const dateRangeLabel = taskHistoryFromDate || taskHistoryToDate
      ? `${taskHistoryFromDate || "Any"} -> ${taskHistoryToDate || "Any"}`
      : "All dates";
    return {
      actionSummary,
      lastActor,
      dateRangeLabel
    };
  }, [taskHistory, taskHistoryFromDate, taskHistoryToDate]);

  const formatDate = (dateStr) => {
    if (!dateStr) return "No date";
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays <= 7) return `${diffDays} days`;
    return formatJordanDateOnly(d, { month: "short", day: "numeric", year: undefined });
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

  const exportTaskHistoryCsv = useCallback(() => {
    if (!selectedTask?.task_id || !taskHistory.length) {
      return;
    }
    const csvRows = [
      [
        "Tracking Task ID",
        "History ID",
        "Action Type",
        "Action Label",
        "Field Name",
        "Field Label",
        "Actor Name",
        "Actor Email",
        "Previous Value",
        "Next Value",
        "Previous Display",
        "Next Display",
        "Change Summary",
        "Created At"
      ].join(","),
      ...taskHistory.map((entry) => ([
        escapeCsvValue(selectedTask.task_id),
        escapeCsvValue(entry.id),
        escapeCsvValue(entry.action_type),
        escapeCsvValue(formatHistoryActionLabel(entry.action_type)),
        escapeCsvValue(entry.field_name),
        escapeCsvValue(formatHistoryFieldLabel(entry.field_name)),
        escapeCsvValue(entry.actor_name || "System"),
        escapeCsvValue(entry.actor_email),
        escapeCsvValue(entry.previous_value),
        escapeCsvValue(entry.next_value),
        escapeCsvValue(entry.previous_display),
        escapeCsvValue(entry.next_display),
        escapeCsvValue(formatHistoryChange(entry)),
        escapeCsvValue(entry.created_at ? new Date(entry.created_at).toISOString() : "")
      ].join(",")))
    ].join("\n");
    downloadCsvFile(`tracking-task-${selectedTask.task_id}-timeline-${Date.now()}.csv`, csvRows);
  }, [selectedTask, taskHistory]);

  const resetTaskHistoryFilters = useCallback(() => {
    setTaskHistoryActorFilter("all");
    setTaskHistoryActionFilter("all");
    setTaskHistoryFromDate("");
    setTaskHistoryToDate("");
  }, []);

  return (
    <div className="task-dashboard">
      {error && (
        <div className="task-error-banner">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

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
                <span key={t.task_id} className="urgent-chip" onClick={() => setSelectedTask(t)}>
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
        {summaryCards.map((card) => (
          <div key={card.key} className={`stat-card ${card.className}`.trim()}>
            <div className="stat-number">{card.value}</div>
            <div className="stat-label">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="task-summary-panels">
        <div className="task-summary-panel">
          <div className="task-summary-head">
            <BarChart3 size={15} />
            <span>By Task Type</span>
          </div>
          <div className="task-summary-chip-list">
            {taskTypeBreakdown.length ? taskTypeBreakdown.map((item) => {
              const taskType = resolveTaskType(item.task_type);
              const typeInfo = TASK_TYPES[taskType] || TASK_TYPES.general;
              return (
                <span key={item.task_type} className="task-summary-chip" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                  {typeInfo.label} <strong>{item.total}</strong>
                </span>
              );
            }) : <span className="task-summary-empty">No task type data</span>}
          </div>
        </div>

        <div className="task-summary-panel">
          <div className="task-summary-head">
            <Clock3 size={15} />
            <span>By Priority</span>
          </div>
          <div className="task-summary-chip-list">
            {priorityBreakdown.length ? priorityBreakdown.map((item) => {
              const priority = normalizePriority(item.priority);
              const priorityInfo = PRIORITY_MAP[priority] || PRIORITY_MAP.medium;
              return (
                <span key={item.priority} className="task-summary-chip neutral">
                  <span style={{ color: priorityInfo.color }}>{priorityInfo.label}</span> <strong>{item.total}</strong>
                </span>
              );
            }) : <span className="task-summary-empty">No priority data</span>}
          </div>
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
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="filter-group">
            <Folder size={14} />
            <select value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
              <option value="all">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_code ? `${project.project_code} - ${project.project_name || ""}` : project.project_name || `Project ${project.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <User size={14} />
            <select
              value={canAccessAdmin ? filterAssignedTo : String(currentUser?.id || "all")}
              onChange={(e) => setFilterAssignedTo(e.target.value)}
              disabled={!canAccessAdmin}
            >
              {canAccessAdmin && <option value="all">All Assignees</option>}
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name || employee.email || `User ${employee.id}`}
                </option>
              ))}
              {!employees.length && currentUser?.id && (
                <option value={currentUser.id}>{currentUser.name || currentUser.email || "My Tasks"}</option>
              )}
            </select>
          </div>
          <div className="task-toolbar-meta">
            <Briefcase size={14} />
            <span>{filteredTasks.length} active tasks</span>
          </div>
          <button className="view-toggle" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}>
            {viewMode === "grid" ? <List size={16} /> : <LayoutGrid size={16} />}
          </button>
          <button className="refresh-btn" onClick={() => fetchDashboardData({ silent: true })} title="Refresh dashboard">
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </div>

      <div className="task-dashboard-caption">
        <span>Source: tracking tasks derived from archived email workflows and AI extraction.</span>
        {summary?.filters?.assigned_to && !canAccessAdmin ? <span>Showing only your assigned tasks.</span> : null}
      </div>

      {/* Task Grid/List */}
      {loading ? (
        <div className="task-loading">
          <RefreshCw size={24} className="spin" />
          <span>Loading tracking tasks...</span>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="task-empty">
          <Folder size={48} />
          <p>No tracking tasks found</p>
          <span>{searchQuery ? "Try a different search term" : "No tracking tasks match the current filters"}</span>
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
                key={task.task_id}
                className={`task-card ${isOverdue ? "overdue" : ""} ${task.status === "completed" ? "completed" : ""}`}
                onClick={() => setSelectedTask(task)}
              >
                <div className="task-card-header">
                  <span className="task-type-badge" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                    {typeInfo.label}
                  </span>
                  <span className="task-card-id">#{task.task_id}</span>
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
                      {isOverdue ? STATUS_MAP.overdue.label : statusInfo.label}
                    </span>
                    {(task.priority === "high" || task.priority === "critical") ? (
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
                key={task.task_id}
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
                  {isOverdue ? STATUS_MAP.overdue.label : statusInfo.label}
                </span>
                <div className="list-actions">
                  {task.status === "pending" && (
                    <button
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); startTask(task.task_id); }}
                      title="Start"
                      disabled={actionBusyId === task.task_id}
                    >
                      <ArrowRight size={16} />
                    </button>
                  )}
                  {task.status !== "completed" && (
                    <button
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); completeTask(task.task_id); }}
                      title="Complete"
                      disabled={actionBusyId === task.task_id}
                    >
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
                <span className="detail-label">Tracking ID:</span>
                <span>#{selectedTask.task_id}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Status:</span>
                <span className="status-badge" style={{ background: STATUS_MAP[selectedTask.status]?.bg, color: STATUS_MAP[selectedTask.status]?.color }}>
                  {(selectedTask.status !== "completed" && selectedTask.due_date && new Date(selectedTask.due_date) < new Date())
                    ? STATUS_MAP.overdue.label
                    : STATUS_MAP[selectedTask.status]?.label}
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
                  {selectedTask.due_date ? formatJordanDateTime(selectedTask.due_date) : "No date"}
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
              {canAccessAdmin && (
                <div className="detail-row detail-row-stack">
                  <span className="detail-label">Reassign:</span>
                  <div className="task-modal-inline-tools">
                    <select value={assigningTo} onChange={(e) => setAssigningTo(e.target.value)}>
                      <option value="all">Unassigned</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name || employee.email || `User ${employee.id}`}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-secondary"
                      onClick={reassignTask}
                      disabled={actionBusyId === selectedTask.task_id}
                    >
                      Save Assignee
                    </button>
                  </div>
                </div>
              )}
              {selectedTask.email_subject && (
                <div className="detail-row">
                  <span className="detail-label">Related Email:</span>
                  <span className="email-link">{selectedTask.email_subject}</span>
                </div>
              )}
              {selectedTask.ai_summary && (
                <div className="detail-row detail-row-stack">
                  <span className="detail-label">AI Summary:</span>
                  <div className="task-ai-summary">{selectedTask.ai_summary}</div>
                </div>
              )}
              <div className="detail-row detail-row-stack">
                <span className="detail-label">Timeline:</span>
                {selectedTask?.task_id ? (
                  <div className="task-modal-inline-tools">
                    <select value={taskHistoryActorFilter} onChange={(e) => setTaskHistoryActorFilter(e.target.value)}>
                      <option value="all">All Actors</option>
                      <option value="system">System</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name || employee.email || `User ${employee.id}`}
                        </option>
                      ))}
                    </select>
                    <select value={taskHistoryActionFilter} onChange={(e) => setTaskHistoryActionFilter(e.target.value)}>
                      <option value="all">All Actions</option>
                      <option value="created">Created</option>
                      <option value="started">Started</option>
                      <option value="completed">Completed</option>
                      <option value="reassigned">Reassigned</option>
                      <option value="updated">Updated</option>
                    </select>
                    <input
                      type="date"
                      value={taskHistoryFromDate}
                      onChange={(e) => setTaskHistoryFromDate(e.target.value)}
                    />
                    <input
                      type="date"
                      value={taskHistoryToDate}
                      onChange={(e) => setTaskHistoryToDate(e.target.value)}
                    />
                    <button
                      className="btn-secondary"
                      onClick={resetTaskHistoryFilters}
                      disabled={taskHistoryLoading}
                    >
                      Reset Filters
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={exportTaskHistoryCsv}
                      disabled={taskHistoryLoading || !!taskHistoryError || !taskHistory.length}
                    >
                      <Download size={16} /> Export Timeline CSV
                    </button>
                  </div>
                ) : null}
                {!taskHistoryLoading && !taskHistoryError && taskHistory.length ? (
                  <div className="task-modal-inline-tools">
                    {taskHistorySummary.actionSummary ? (
                      <span className="task-summary-chip neutral">{taskHistorySummary.actionSummary}</span>
                    ) : null}
                    <span className="task-summary-chip neutral">Last Actor: {taskHistorySummary.lastActor}</span>
                    <span className="task-summary-chip neutral">Range: {taskHistorySummary.dateRangeLabel}</span>
                  </div>
                ) : null}
                {taskHistoryLoading ? (
                  <div className="task-history-empty">Loading history...</div>
                ) : taskHistoryError ? (
                  <div className="task-history-error">{taskHistoryError}</div>
                ) : !taskHistory.length ? (
                  <div className="task-history-empty">No history matches the current audit filters.</div>
                ) : (
                  <div className="task-history-timeline">
                    {taskHistory.map((entry) => (
                      <div key={entry.id} className="task-history-item">
                        <div className="task-history-item-head">
                          <span className="task-history-action">{formatHistoryActionLabel(entry.action_type)}</span>
                          <span className="task-history-time">
                            {entry.created_at ? formatJordanDateTime(entry.created_at) : "Unknown time"}
                          </span>
                        </div>
                        <div className="task-history-actor">
                          {entry.actor_name || entry.actor_email || "System"}
                        </div>
                        <div className="task-history-change">
                          {formatHistoryChange(entry)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="task-modal-actions">
              {selectedTask.status === "pending" && (
                <button
                  className="btn-secondary"
                  onClick={() => startTask(selectedTask.task_id)}
                  disabled={actionBusyId === selectedTask.task_id}
                >
                  <ArrowRight size={16} /> Start Task
                </button>
              )}
              {selectedTask.status !== "completed" && (
                <button
                  className="btn-primary"
                  onClick={() => completeTask(selectedTask.task_id)}
                  disabled={actionBusyId === selectedTask.task_id}
                >
                  <CheckCircle size={16} /> Mark Complete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
