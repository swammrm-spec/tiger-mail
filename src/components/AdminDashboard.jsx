import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Download, RefreshCw, UserCog } from "lucide-react";
import ThreadTracker from "./ThreadTracker.jsx";
import { formatJordanDateTime } from "../utils/timezone.js";

function normalizeTrackingStatus(value = "") {
  const normalized = String(value || "pending").trim().toLowerCase();
  return normalized === "in progress" ? "in_progress" : normalized;
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

function formatTrackingHistoryActionLabel(actionType = "") {
  const normalized = String(actionType || "").trim().toLowerCase();
  if (normalized === "created") return "Created";
  if (normalized === "started") return "Started";
  if (normalized === "completed") return "Completed";
  if (normalized === "reassigned") return "Reassigned";
  return "Updated";
}

function formatTrackingHistoryFieldLabel(fieldName = "") {
  const normalized = String(fieldName || "").trim().toLowerCase();
  if (normalized === "assigned_to") return "Assignee";
  if (normalized === "due_date") return "Due Date";
  if (normalized === "task_type") return "Task Type";
  if (normalized === "priority") return "Priority";
  if (normalized === "status") return "Status";
  return "Task";
}

function formatTrackingHistoryChange(entry = {}) {
  const fieldName = String(entry.field_name || "task").trim().toLowerCase();
  const previousLabel = entry.previous_display || entry.previous_value || "Empty";
  const nextLabel = entry.next_display || entry.next_value || "Empty";
  if (fieldName === "task") {
    return nextLabel;
  }
  return `${formatTrackingHistoryFieldLabel(fieldName)}: ${previousLabel} -> ${nextLabel}`;
}

export default function AdminDashboard({
  canAccessAdmin,
  currentUser,
  adminTab,
  setAdminTab,
  onRefresh,
  apiFetch,
  onRunFullMailSync,
  isRunningFullMailSync,
  fullMailSyncSummary,
  adminSummary,
  dashboardStats,
  analytics,
  approvalAnalytics,
  employeeForm,
  setEmployeeForm,
  editingEmployeeId,
  setEditingEmployeeId,
  createEmptyEmployeeForm,
  employees,
  showManagerQuickForm,
  setShowManagerQuickForm,
  managerQuickForm,
  setManagerQuickForm,
  isSavingEmployee,
  onQuickCreateManager,
  onSaveEmployee,
  onDeleteEmployee,
  adminMailTests,
  isRunningAdminMailTests,
  onRunAdminMailTests,
  emailTrailTotal,
  emailTrailFilters,
  setEmailTrailFilters,
  dataFolders,
  isLoadingTrail,
  onLoadEmailTrailData,
  onExportEmailTrailCsv,
  emailTrail,
  archiveForm,
  setArchiveForm,
  isCreatingArchive,
  onCreateArchive,
  archives,
  archiveExplorerFilters,
  setArchiveExplorerFilters,
  archiveExplorerData,
  archiveExplorerFocusEmailId,
  setArchiveExplorerFocusEmailId,
  activeTrackingTaskActionKey,
  selectedArchiveTrackingTaskIds,
  bulkArchiveTrackingAssignedTo,
  setBulkArchiveTrackingAssignedTo,
  activeBulkTrackingAction,
  isLoadingArchiveExplorer,
  onLoadArchiveExplorer,
  archiveBackfillForm,
  setArchiveBackfillForm,
  archiveBackfillJob,
  archiveBackfillHistory,
  archiveBackfillSummary,
  isArchiveBackfillDetailsOpen,
  archiveBackfillDetailsJob,
  archiveBackfillDetailsSearch,
  setArchiveBackfillDetailsSearch,
  archiveBackfillDetailsFailedOnly,
  setArchiveBackfillDetailsFailedOnly,
  isLoadingArchiveBackfillHistory,
  isRunningArchiveBackfill,
  isCancellingArchiveBackfill,
  isRetryingArchiveBackfill,
  onRunArchiveBackfill,
  onCancelArchiveBackfill,
  onRetryFailedArchiveBackfill,
  onOpenArchiveBackfillJob,
  onRetryFailedArchiveBackfillForJob,
  onExportArchiveBackfillSummary,
  onCloseArchiveBackfillDetailsDrawer,
  onCopyArchiveBackfillErrors,
  onExportArchiveBackfillDetailsCsv,
  onOpenArchiveBackfillEmailById,
  onFocusArchiveTrackingTasksByEmailId,
  onOpenTrackingTaskFromArchive,
  onMarkArchiveTrackingTaskDone,
  onAssignArchiveTrackingTask,
  onOpenRelatedEmailFromTrackingTask,
  onToggleArchiveTrackingTaskSelection,
  onToggleAllArchiveTrackingTaskSelections,
  onMarkSelectedArchiveTrackingTasksDone,
  onAssignSelectedArchiveTrackingTasks,
  onExportSelectedArchiveTrackingTasks
}) {
  const registryRows = archiveExplorerData?.email_registry || [];
  const contentRows = archiveExplorerData?.email_content_archive || [];
  const allTrackingRows = archiveExplorerData?.tracking_tasks || [];
  const trackingRows = archiveExplorerFocusEmailId
    ? allTrackingRows.filter((row) => Number(row.email_id || row.email_db_id) === Number(archiveExplorerFocusEmailId))
    : allTrackingRows;
  const assignableEmployees = Array.isArray(employees) ? employees : [];
  const selectedTrackingTaskSet = new Set((selectedArchiveTrackingTaskIds || []).map((id) => Number(id)));
  const visibleTrackingTaskIds = trackingRows.map((row) => Number(row.task_id)).filter((id) => Number.isInteger(id) && id > 0);
  const selectedVisibleTrackingTaskCount = visibleTrackingTaskIds.filter((id) => selectedTrackingTaskSet.has(id)).length;
  const areAllVisibleTrackingTasksSelected = visibleTrackingTaskIds.length > 0 && selectedVisibleTrackingTaskCount === visibleTrackingTaskIds.length;
  const [trackerSummary, setTrackerSummary] = useState({
    totals: {},
    by_status: [],
    by_task_type: [],
    by_priority: []
  });
  const [trackerRowsData, setTrackerRowsData] = useState([]);
  const [trackerProjects, setTrackerProjects] = useState([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState("");
  const [trackerSearch, setTrackerSearch] = useState("");
  const [trackerStatusFilter, setTrackerStatusFilter] = useState("all");
  const [trackerProjectFilter, setTrackerProjectFilter] = useState("all");
  const [trackerAssignedFilter, setTrackerAssignedFilter] = useState("all");
  const [trackerSelectedIds, setTrackerSelectedIds] = useState([]);
  const [trackerBulkAssignedTo, setTrackerBulkAssignedTo] = useState("");
  const [trackerBulkAction, setTrackerBulkAction] = useState("");
  const [trackerRowActionId, setTrackerRowActionId] = useState(null);
  const [trackerFocusedTaskId, setTrackerFocusedTaskId] = useState(null);
  const [trackerHistory, setTrackerHistory] = useState([]);
  const [trackerHistoryLoading, setTrackerHistoryLoading] = useState(false);
  const [trackerHistoryError, setTrackerHistoryError] = useState("");
  const [trackerHistoryActorFilter, setTrackerHistoryActorFilter] = useState("all");
  const [trackerHistoryActionFilter, setTrackerHistoryActionFilter] = useState("all");
  const [trackerHistoryFromDate, setTrackerHistoryFromDate] = useState("");
  const [trackerHistoryToDate, setTrackerHistoryToDate] = useState("");
  const [notificationAnalytics, setNotificationAnalytics] = useState({
    period_days: 30,
    totals: {},
    latest_event_at: null,
    top_actors: []
  });
  const [notificationAnalyticsLoading, setNotificationAnalyticsLoading] = useState(false);
  const [notificationAnalyticsError, setNotificationAnalyticsError] = useState("");
  const [notificationAnalyticsFromDate, setNotificationAnalyticsFromDate] = useState("");
  const [notificationAnalyticsToDate, setNotificationAnalyticsToDate] = useState("");
  const [notificationAnalyticsHistory, setNotificationAnalyticsHistory] = useState([]);
  const [showNotificationHistory, setShowNotificationHistory] = useState(false);

  const trackerSummaryCards = [
    { key: "total", label: "Total", value: Number(trackerSummary?.totals?.total || 0), accent: "#44546f" },
    { key: "pending", label: "Pending", value: Number(trackerSummary?.totals?.pending || 0), accent: "#d97706" },
    { key: "in_progress", label: "In Progress", value: Number(trackerSummary?.totals?.in_progress || 0), accent: "#2563eb" },
    { key: "completed", label: "Completed", value: Number(trackerSummary?.totals?.completed || 0), accent: "#15803d" },
    { key: "overdue", label: "Overdue", value: Number(trackerSummary?.totals?.overdue || 0), accent: "#b42318" },
    { key: "due_soon", label: "Due Soon", value: Number(trackerSummary?.totals?.due_soon || 0), accent: "#7c3aed" }
  ];

  const trackerQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (trackerStatusFilter !== "all") {
      params.set("status", trackerStatusFilter.toUpperCase());
    }
    if (trackerProjectFilter !== "all") {
      params.set("project_id", trackerProjectFilter);
    }
    if (trackerAssignedFilter !== "all") {
      params.set("assigned_to", trackerAssignedFilter);
    }
    return params.toString();
  }, [trackerAssignedFilter, trackerProjectFilter, trackerStatusFilter]);

  const filteredTrackerRows = useMemo(() => {
    const normalizedSearch = String(trackerSearch || "").trim().toLowerCase();
    if (!normalizedSearch) {
      return trackerRowsData;
    }
    return trackerRowsData.filter((row) => {
      const haystack = [
        row.task_id,
        row.task_type,
        row.status,
        row.priority,
        row.project_code,
        row.project_name,
        row.email_subject,
        row.assigned_to_name,
        row.ai_summary
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      return haystack.includes(normalizedSearch);
    });
  }, [trackerRowsData, trackerSearch]);

  const trackerSelectedSet = useMemo(() => new Set((trackerSelectedIds || []).map((id) => Number(id))), [trackerSelectedIds]);
  const trackerVisibleIds = useMemo(() => filteredTrackerRows.map((row) => Number(row.task_id)).filter((id) => Number.isInteger(id) && id > 0), [filteredTrackerRows]);
  const trackerSelectedVisibleCount = useMemo(() => trackerVisibleIds.filter((id) => trackerSelectedSet.has(id)).length, [trackerSelectedSet, trackerVisibleIds]);
  const trackerSelectedRows = useMemo(() => filteredTrackerRows.filter((row) => trackerSelectedSet.has(Number(row.task_id))), [filteredTrackerRows, trackerSelectedSet]);
  const areAllTrackerRowsSelected = trackerVisibleIds.length > 0 && trackerSelectedVisibleCount === trackerVisibleIds.length;
  const trackerFocusedTask = useMemo(
    () => trackerRowsData.find((row) => Number(row.task_id) === Number(trackerFocusedTaskId)) || null,
    [trackerFocusedTaskId, trackerRowsData]
  );
  const trackerHistoryQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (trackerHistoryActorFilter !== "all") {
      params.set("actor", trackerHistoryActorFilter);
    }
    if (trackerHistoryActionFilter !== "all") {
      params.set("action_type", trackerHistoryActionFilter);
    }
    if (trackerHistoryFromDate) {
      params.set("from_date", trackerHistoryFromDate);
    }
    if (trackerHistoryToDate) {
      params.set("to_date", trackerHistoryToDate);
    }
    return params.toString();
  }, [trackerHistoryActionFilter, trackerHistoryActorFilter, trackerHistoryFromDate, trackerHistoryToDate]);
  const notificationAnalyticsCards = [
    { key: "reassigned", label: "Reassigned", value: Number(notificationAnalytics?.totals?.reassigned || 0), accent: "#1a73e8" },
    { key: "completed", label: "Completed", value: Number(notificationAnalytics?.totals?.completed || 0), accent: "#107c10" },
    { key: "overdue", label: "Overdue", value: Number(notificationAnalytics?.totals?.overdue || 0), accent: "#d83b01" },
    { key: "total", label: "Total Events", value: Number(notificationAnalytics?.totals?.total || 0), accent: "#44546f" }
  ];
  const notificationAnalyticsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (notificationAnalyticsFromDate) {
      params.set("from_date", notificationAnalyticsFromDate);
    }
    if (notificationAnalyticsToDate) {
      params.set("to_date", notificationAnalyticsToDate);
    }
    if (!notificationAnalyticsFromDate && !notificationAnalyticsToDate) {
      params.set("days", "30");
    }
    return params.toString();
  }, [notificationAnalyticsFromDate, notificationAnalyticsToDate]);
  const hasNotificationAnalyticsData = useMemo(() => {
    return Boolean(
      notificationAnalytics?.top_actors?.length
      || Object.values(notificationAnalytics?.totals || {}).some((value) => Number(value || 0) > 0)
    );
  }, [notificationAnalytics]);

  const loadTrackerAdminData = useCallback(async ({ silent = false } = {}) => {
    if (adminTab !== "tracker") {
      return;
    }
    if (!silent) {
      setTrackerLoading(true);
    }
    setTrackerError("");
    try {
      const [summaryResponse, activeResponse, projectsResponse] = await Promise.all([
        apiFetch(`/api/tracking-tasks/summary${trackerQuery ? `?${trackerQuery}` : ""}`),
        apiFetch(`/api/tracking-tasks/active${trackerQuery ? `?${trackerQuery}` : ""}`),
        apiFetch("/api/projects")
      ]);
      setTrackerSummary(summaryResponse.summary || {
        totals: {},
        by_status: [],
        by_task_type: [],
        by_priority: []
      });
      setTrackerRowsData(Array.isArray(activeResponse.tasks) ? activeResponse.tasks : []);
      setTrackerProjects(Array.isArray(projectsResponse.projects) ? projectsResponse.projects : []);
    } catch (e) {
      setTrackerError(e.message || "Unable to load tracking tasks.");
    } finally {
      setTrackerLoading(false);
    }
  }, [adminTab, trackerQuery]);

  const loadNotificationAnalytics = useCallback(async ({ silent = false } = {}) => {
    if (adminTab !== "tracker") {
      return;
    }
    if (!silent) {
      setNotificationAnalyticsLoading(true);
    }
    setNotificationAnalyticsError("");
    try {
      const response = await apiFetch(`/api/admin/notification-analytics${notificationAnalyticsQuery ? `?${notificationAnalyticsQuery}` : ""}`);
      setNotificationAnalytics(response.analytics || {
        period_days: 30,
        period_label: "Last 30 days",
        from_date: null,
        to_date: null,
        totals: {},
        latest_event_at: null,
        top_actors: []
      });
    } catch (e) {
      setNotificationAnalyticsError(e.message || "Unable to load notification analytics.");
    } finally {
      setNotificationAnalyticsLoading(false);
    }
  }, [adminTab, apiFetch, notificationAnalyticsQuery]);

  useEffect(() => {
    if (adminTab === "tracker") {
      loadTrackerAdminData();
      loadNotificationAnalytics();
    }
  }, [adminTab, loadNotificationAnalytics, loadTrackerAdminData]);

  useEffect(() => {
    if (adminTab === "tracker") {
      loadNotificationAnalytics({ silent: true });
    }
  }, [adminTab, loadNotificationAnalytics, notificationAnalyticsQuery]);

  useEffect(() => {
    if (adminTab !== "tracker") return;
    let cancelled = false;
    async function loadNotificationHistory() {
      try {
        const params = new URLSearchParams();
        if (notificationAnalyticsFromDate) params.set("from_date", notificationAnalyticsFromDate);
        if (notificationAnalyticsToDate) params.set("to_date", notificationAnalyticsToDate);
        params.set("limit", "100");
        const response = await apiFetch(`/api/admin/notification-history?${params.toString()}`);
        if (!cancelled) {
          setNotificationAnalyticsHistory(Array.isArray(response.history) ? response.history : []);
        }
      } catch (e) {
        if (!cancelled) setNotificationAnalyticsHistory([]);
      }
    }
    loadNotificationHistory();
    return () => { cancelled = true; };
  }, [adminTab, apiFetch, notificationAnalyticsFromDate, notificationAnalyticsToDate]);

  useEffect(() => {
    if (adminTab === "tracker") {
      loadTrackerAdminData({ silent: true });
    }
  }, [trackerQuery, adminTab, loadTrackerAdminData]);

  useEffect(() => {
    const validIds = new Set(
      trackerRowsData
        .map((row) => Number(row.task_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setTrackerSelectedIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [trackerRowsData]);

  useEffect(() => {
    if (!trackerRowsData.length) {
      setTrackerFocusedTaskId(null);
      return;
    }
    const validIds = new Set(
      trackerRowsData
        .map((row) => Number(row.task_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setTrackerFocusedTaskId((prev) => {
      if (prev && validIds.has(Number(prev))) {
        return prev;
      }
      return Number(trackerRowsData[0]?.task_id || 0) || null;
    });
  }, [trackerRowsData]);

  useEffect(() => {
    if (adminTab !== "tracker" || !trackerFocusedTaskId) {
      setTrackerHistory([]);
      setTrackerHistoryError("");
      setTrackerHistoryLoading(false);
      return;
    }

    let cancelled = false;
    async function loadTrackerHistory() {
      try {
        setTrackerHistoryLoading(true);
        setTrackerHistoryError("");
        const response = await apiFetch(`/api/tracking-tasks/${trackerFocusedTaskId}/history${trackerHistoryQuery ? `?${trackerHistoryQuery}` : ""}`);
        if (!cancelled) {
          setTrackerHistory(Array.isArray(response.history) ? response.history : []);
        }
      } catch (e) {
        if (!cancelled) {
          setTrackerHistory([]);
          setTrackerHistoryError(e.message || "Unable to load tracking task history.");
        }
      } finally {
        if (!cancelled) {
          setTrackerHistoryLoading(false);
        }
      }
    }

    loadTrackerHistory();
    return () => {
      cancelled = true;
    };
  }, [adminTab, apiFetch, trackerFocusedTaskId, trackerFocusedTask?.updated_at, trackerHistoryQuery]);

  async function updateTrackerTask(taskId, updates = {}, errorMessage = "Unable to update tracking task.") {
    setTrackerRowActionId(taskId);
    setTrackerError("");
    try {
      await apiFetch(`/api/tracking-tasks/${taskId}`, {
        method: "PUT",
        body: updates
      });
      await loadTrackerAdminData({ silent: true });
      await loadNotificationAnalytics({ silent: true });
    } catch (e) {
      setTrackerError(e.message || errorMessage);
    } finally {
      setTrackerRowActionId(null);
    }
  }

  async function completeTrackerTask(taskId) {
    setTrackerRowActionId(taskId);
    setTrackerError("");
    try {
      await apiFetch(`/api/tracking-tasks/${taskId}/complete`, {
        method: "POST"
      });
      await loadTrackerAdminData({ silent: true });
      await loadNotificationAnalytics({ silent: true });
    } catch (e) {
      setTrackerError(e.message || "Unable to complete tracking task.");
    } finally {
      setTrackerRowActionId(null);
    }
  }

  function toggleTrackerSelection(taskId, shouldSelect) {
    const normalizedTaskId = Number(taskId);
    if (!Number.isInteger(normalizedTaskId) || normalizedTaskId <= 0) {
      return;
    }
    setTrackerSelectedIds((prev) => {
      if (shouldSelect) {
        return prev.includes(normalizedTaskId) ? prev : [...prev, normalizedTaskId];
      }
      return prev.filter((id) => id !== normalizedTaskId);
    });
  }

  function toggleAllTrackerSelections(shouldSelect) {
    if (!trackerVisibleIds.length) {
      setTrackerSelectedIds([]);
      return;
    }
    setTrackerSelectedIds((prev) => {
      if (shouldSelect) {
        return Array.from(new Set([...prev, ...trackerVisibleIds]));
      }
      return prev.filter((id) => !trackerVisibleIds.includes(id));
    });
  }

  async function handleTrackerBulkComplete() {
    if (!trackerSelectedRows.length) {
      setTrackerError("No tracking tasks selected.");
      return;
    }
    const eligibleRows = trackerSelectedRows.filter((row) => normalizeTrackingStatus(row.status) !== "completed");
    if (!eligibleRows.length) {
      setTrackerError("Selected tracking tasks are already completed.");
      return;
    }
    setTrackerBulkAction("complete");
    setTrackerError("");
    try {
      await Promise.all(
        eligibleRows.map((row) => apiFetch(`/api/tracking-tasks/${row.task_id}/complete`, { method: "POST" }))
      );
      await loadTrackerAdminData({ silent: true });
      await loadNotificationAnalytics({ silent: true });
      setTrackerSelectedIds([]);
    } catch (e) {
      setTrackerError(e.message || "Unable to complete selected tracking tasks.");
    } finally {
      setTrackerBulkAction("");
    }
  }

  async function handleTrackerBulkAssign() {
    if (!trackerSelectedRows.length) {
      setTrackerError("No tracking tasks selected.");
      return;
    }
    const nextAssignedTo = trackerBulkAssignedTo === "" ? null : Number(trackerBulkAssignedTo);
    if (nextAssignedTo !== null && (!Number.isInteger(nextAssignedTo) || nextAssignedTo <= 0)) {
      setTrackerError("Assigned user is invalid.");
      return;
    }
    setTrackerBulkAction("assign");
    setTrackerError("");
    try {
      await Promise.all(
        trackerSelectedRows.map((row) => apiFetch(`/api/tracking-tasks/${row.task_id}`, {
          method: "PUT",
          body: { assigned_to: nextAssignedTo }
        }))
      );
      await loadTrackerAdminData({ silent: true });
      await loadNotificationAnalytics({ silent: true });
      setTrackerSelectedIds([]);
    } catch (e) {
      setTrackerError(e.message || "Unable to assign selected tracking tasks.");
    } finally {
      setTrackerBulkAction("");
    }
  }

  function handleTrackerExportCsv() {
    if (!trackerSelectedRows.length) {
      setTrackerError("No tracking tasks selected.");
      return;
    }
    const csv = [
      ["Task ID", "Task Type", "Status", "Priority", "Due Date", "Project Code", "Project Name", "Email Subject", "Assigned To", "AI Summary"].join(","),
      ...trackerSelectedRows.map((row) => ([
        escapeCsvValue(row.task_id),
        escapeCsvValue(row.task_type),
        escapeCsvValue(row.status),
        escapeCsvValue(row.priority),
        escapeCsvValue(row.due_date),
        escapeCsvValue(row.project_code),
        escapeCsvValue(row.project_name),
        escapeCsvValue(row.email_subject),
        escapeCsvValue(row.assigned_to_name),
        escapeCsvValue(row.ai_summary)
      ].join(",")))
    ].join("\n");
    downloadCsvFile(`admin-tracking-tasks-${Date.now()}.csv`, csv);
  }

  function handleTrackerTimelineExportCsv() {
    if (!trackerFocusedTask || !trackerHistory.length) {
      return;
    }
    const csv = [
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
      ...trackerHistory.map((entry) => ([
        escapeCsvValue(trackerFocusedTask.task_id),
        escapeCsvValue(entry.id),
        escapeCsvValue(entry.action_type),
        escapeCsvValue(formatTrackingHistoryActionLabel(entry.action_type)),
        escapeCsvValue(entry.field_name),
        escapeCsvValue(formatTrackingHistoryFieldLabel(entry.field_name)),
        escapeCsvValue(entry.actor_name || "System"),
        escapeCsvValue(entry.actor_email),
        escapeCsvValue(entry.previous_value),
        escapeCsvValue(entry.next_value),
        escapeCsvValue(entry.previous_display),
        escapeCsvValue(entry.next_display),
        escapeCsvValue(formatTrackingHistoryChange(entry)),
        escapeCsvValue(entry.created_at ? dayjs(entry.created_at).toISOString() : "")
      ].join(",")))
    ].join("\n");
    downloadCsvFile(`admin-tracking-task-${trackerFocusedTask.task_id}-timeline-${Date.now()}.csv`, csv);
  }

  function handleNotificationAnalyticsExportCsv() {
    const totals = notificationAnalytics?.totals || {};
    const topActors = Array.isArray(notificationAnalytics?.top_actors) ? notificationAnalytics.top_actors : [];
    const hasSummaryData = Object.values(totals).some((value) => Number(value || 0) > 0);
    if (!hasSummaryData && !topActors.length) {
      return;
    }

    const periodInfo = notificationAnalytics?.period_label
      || (notificationAnalyticsFromDate || notificationAnalyticsToDate
        ? `${notificationAnalyticsFromDate || "Start"} to ${notificationAnalyticsToDate || "Now"}`
        : `Last ${notificationAnalytics?.period_days || 30} days`);

    const summaryRows = [
      ["Section", "Metric", "Value"].join(","),
      ["Summary", "Time Zone", escapeCsvValue("Asia/Amman")].join(","),
      ["Summary", "Period", escapeCsvValue(periodInfo)].join(","),
      ["Summary", "From Date", escapeCsvValue(notificationAnalytics?.from_date ? formatJordanDateTime(notificationAnalytics.from_date) : "")].join(","),
      ["Summary", "To Date", escapeCsvValue(notificationAnalytics?.to_date ? formatJordanDateTime(notificationAnalytics.to_date) : "")].join(","),
      ["Summary", "Latest Event", escapeCsvValue(notificationAnalytics?.latest_event_at ? formatJordanDateTime(notificationAnalytics.latest_event_at) : "")].join(","),
      ["Summary", "Reassigned", escapeCsvValue(totals.reassigned || 0)].join(","),
      ["Summary", "Completed", escapeCsvValue(totals.completed || 0)].join(","),
      ["Summary", "Overdue", escapeCsvValue(totals.overdue || 0)].join(","),
      ["Summary", "Total Events", escapeCsvValue(totals.total || 0)].join(",")
    ];

    const actorHeader = [
      "Section",
      "Actor User ID",
      "Actor Name",
      "Total",
      "Reassigned",
      "Completed",
      "Overdue"
    ].join(",");

    const actorRows = topActors.map((item) => ([
      "Top Actors",
      escapeCsvValue(item.actor_user_id || ""),
      escapeCsvValue(item.actor_name || "System"),
      escapeCsvValue(item.total || 0),
      escapeCsvValue(item.reassigned || 0),
      escapeCsvValue(item.completed || 0),
      escapeCsvValue(item.overdue || 0)
    ].join(",")));

    const csv = [
      ...summaryRows,
      "",
      actorHeader,
      ...actorRows
    ].join("\n");

    downloadCsvFile(`admin-notification-analytics-${Date.now()}.csv`, csv);
  }

  function resetNotificationAnalyticsFilters() {
    setNotificationAnalyticsFromDate("");
    setNotificationAnalyticsToDate("");
  }

  function resetTrackerHistoryFilters() {
    setTrackerHistoryActorFilter("all");
    setTrackerHistoryActionFilter("all");
    setTrackerHistoryFromDate("");
    setTrackerHistoryToDate("");
  }

  function updateArchiveExplorerFilter(key, value) {
    setArchiveExplorerFilters({ ...archiveExplorerFilters, [key]: value });
  }

  function handleArchiveExplorerSearch() {
    onLoadArchiveExplorer(archiveExplorerFilters);
  }

  function handleArchiveExplorerReset() {
    const defaults = { project_code: "", serial_number: "", thread_id: "", limit: 50 };
    setArchiveExplorerFilters(defaults);
    onLoadArchiveExplorer(defaults);
  }

  function formatDateTime(value) {
    return value ? formatJordanDateTime(value) : "-";
  }

  function getAttachmentCount(value) {
    if (!value) return 0;
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  function getAiTaskCount(value) {
    if (!value) return 0;
    if (Array.isArray(value)) return value.length;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  function updateArchiveBackfillField(key, value) {
    setArchiveBackfillForm({ ...archiveBackfillForm, [key]: value });
  }

  function handleRunArchiveBackfill() {
    onRunArchiveBackfill(archiveBackfillForm);
  }

  const archiveBackfillProgress = archiveBackfillJob?.progress || null;
  const archiveBackfillStatus = archiveBackfillJob?.status || "idle";
  const archiveBackfillPercent = Math.max(0, Math.min(100, Number(archiveBackfillProgress?.percent || 0)));
  const hasFailedItems = Array.isArray(archiveBackfillSummary?.items)
    && archiveBackfillSummary.items.some((item) => item.status === "error");
  const backfillHistoryRows = Array.isArray(archiveBackfillHistory) ? archiveBackfillHistory : [];
  const detailRows = Array.isArray(archiveBackfillDetailsJob?.summary?.items)
    ? archiveBackfillDetailsJob.summary.items.filter((item) => {
        if (archiveBackfillDetailsFailedOnly && item.status !== "error") {
          return false;
        }
        const normalizedSearch = String(archiveBackfillDetailsSearch || "").trim().toLowerCase();
        if (!normalizedSearch) {
          return true;
        }
        const haystack = [
          item.email_id,
          item.subject,
          item.status,
          item.category,
          item.error
        ].map((value) => String(value || "").toLowerCase()).join(" ");
        return haystack.includes(normalizedSearch);
      })
    : [];

  return (
    <div className="o365-admin">
      {canAccessAdmin ? (
        <>
          {isArchiveBackfillDetailsOpen && archiveBackfillDetailsJob ? (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 1500, display: "flex", justifyContent: "flex-end" }}>
              <div style={{ width: "min(760px, 92vw)", height: "100vh", background: "#fff", boxShadow: "-6px 0 24px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #e1e1e1", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>Job Details</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {archiveBackfillDetailsJob.job_id} | {archiveBackfillDetailsJob.status} | {formatDateTime(archiveBackfillDetailsJob.created_at)}
                    </div>
                  </div>
                  <button onClick={onCloseArchiveBackfillDetailsDrawer} style={{ fontSize: 12, padding: "6px 12px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>
                    Close
                  </button>
                </div>
                <div style={{ padding: 20, overflow: "auto", display: "grid", gap: 16 }}>
                  <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff" }}>
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                      Used Filters
                    </div>
                    <div style={{ padding: 12, fontSize: 12, color: "#555", display: "grid", gap: 6 }}>
                      <div>Limit: {archiveBackfillDetailsJob.options?.limit ?? "-"}</div>
                      <div>Include Sent: {String(Boolean(archiveBackfillDetailsJob.options?.includeSent || archiveBackfillDetailsJob.options?.include_sent)).toUpperCase()}</div>
                      <div>Force: {String(Boolean(archiveBackfillDetailsJob.options?.force)).toUpperCase()}</div>
                      <div>Retry Failed Only: {String(Boolean(archiveBackfillDetailsJob.options?.retry_failed_only)).toUpperCase()}</div>
                      <div>Source Job: {archiveBackfillDetailsJob.options?.source_job_id || "-"}</div>
                    </div>
                  </div>

                  <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff" }}>
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                      Detail Filters
                    </div>
                    <div style={{ padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div style={{ flex: "1 1 260px" }}>
                        <label style={{ fontSize: 11, display: "block", color: "#666" }}>Search</label>
                        <input
                          value={archiveBackfillDetailsSearch}
                          onChange={(e) => setArchiveBackfillDetailsSearch(e.target.value)}
                          placeholder="Search by email id, subject, status, category, or error"
                          style={{ width: "100%", fontSize: 12 }}
                        />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#444" }}>
                        <input
                          type="checkbox"
                          checked={Boolean(archiveBackfillDetailsFailedOnly)}
                          onChange={(e) => setArchiveBackfillDetailsFailedOnly(e.target.checked)}
                        />
                        Failed Only
                      </label>
                      <button
                        onClick={() => onCopyArchiveBackfillErrors(archiveBackfillDetailsJob, archiveBackfillDetailsSearch, archiveBackfillDetailsFailedOnly)}
                        style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                      >
                        Copy Errors
                      </button>
                      <button
                        onClick={() => onExportArchiveBackfillDetailsCsv(archiveBackfillDetailsJob, archiveBackfillDetailsSearch, archiveBackfillDetailsFailedOnly)}
                        style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                      >
                        Download CSV
                      </button>
                    </div>
                  </div>

                  <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff" }}>
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                      Detail Rows ({detailRows.length})
                    </div>
                    <div style={{ maxHeight: "55vh", overflow: "auto", padding: 12 }}>
                      {!detailRows.length ? (
                        <div style={{ fontSize: 12, color: "#666" }}>No rows match the current filters.</div>
                      ) : detailRows.map((item, index) => (
                        <div key={`${item.email_id || "row"}-${index}`} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <strong>{item.subject || `Email ${item.email_id || "-"}`}</strong>
                            <span style={{ color: item.status === "error" ? "#d83b01" : "#666" }}>{item.status || "-"}</span>
                          </div>
                          <div style={{ color: "#666", marginTop: 4 }}>
                            Email ID: {item.email_id || "-"} | Category: {item.category || "-"} | Created: {Number(item.created || 0)} | Updated: {Number(item.updated || 0)} | Skipped: {Number(item.skipped || 0)}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                            <button
                              onClick={() => onOpenArchiveBackfillEmailById(item.email_id)}
                              disabled={!item.email_id}
                              style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: item.email_id ? "pointer" : "not-allowed", opacity: item.email_id ? 1 : 0.6 }}
                            >
                              Open Email
                            </button>
                            <button
                              onClick={() => onFocusArchiveTrackingTasksByEmailId(item.email_id)}
                              disabled={!item.email_id}
                              style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: item.email_id ? "pointer" : "not-allowed", opacity: item.email_id ? 1 : 0.6 }}
                            >
                              Go to Tracking Tasks
                            </button>
                          </div>
                          {item.error ? <div style={{ marginTop: 6, color: "#d83b01", whiteSpace: "pre-wrap" }}>{item.error}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2>Admin Dashboard</h2>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#666" }}><UserCog size={14} /> {currentUser?.name} ({currentUser?.role})</span>
              <button onClick={onRefresh} title="Refresh" style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}><RefreshCw size={14} /></button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e1e1e1" }}>
            {["overview", "tracker", "approval", "employees", "mail-tests", "trail", "archives"].map((tab) => (
              <button key={tab} onClick={() => setAdminTab(tab)} style={{ padding: "8px 16px", fontSize: 12, background: "none", border: "none", borderBottom: adminTab === tab ? "2px solid var(--c-primary)" : "2px solid transparent", color: adminTab === tab ? "var(--c-primary)" : "#333", cursor: "pointer", fontWeight: adminTab === tab ? 600 : 400, textTransform: "capitalize" }}>{tab}</button>
            ))}
          </div>

          {adminTab === "overview" && (
            <>
              <div className="o365-settings-section" style={{ marginBottom: 16 }}>
                <h3>Mail Operations</h3>
                <div className="o365-settings-body">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" onClick={onRunFullMailSync} disabled={isRunningFullMailSync}>
                      <RefreshCw size={14} />{isRunningFullMailSync ? "Running Full Sync..." : "Run Full Mail Sync Now"}
                    </button>
                    <span style={{ fontSize: 12, color: "#666" }}>Runs Inbox/Sent synchronization for all configured employee accounts.</span>
                  </div>
                  {fullMailSyncSummary ? (
                    <div style={{ marginTop: 12, border: "1px solid #e1e1e1", borderRadius: 6, padding: 12, background: "#fafafa" }}>
                      <div style={{ fontSize: 12, marginBottom: 8 }}>
                        <strong>Last Full Sync:</strong> Accounts {Number(fullMailSyncSummary?.totals?.accounts || 0)}, Received {Number(fullMailSyncSummary?.totals?.received || 0)}, Sent {Number(fullMailSyncSummary?.totals?.sent || 0)}, Skipped {Number(fullMailSyncSummary?.totals?.skipped || 0)}, Deleted {Number(fullMailSyncSummary?.totals?.deleted || 0)}.
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {(fullMailSyncSummary.accounts || []).map((item) => (
                          <div key={`${item.user_id}-${item.email_address}`} style={{ fontSize: 12, padding: "8px 10px", border: "1px solid #ececec", borderRadius: 4, background: "#fff" }}>
                            <strong>{item.email_address || `User ${item.user_id}`}</strong> [{item.account_type || "POP3"}] - {item.ok ? `received ${Number(item.received || 0)}, sent ${Number(item.sent || 0)}, skipped ${Number(item.skipped || 0)}` : `failed: ${item.error || "Unknown error"}`}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="o365-admin-grid">
                {(adminSummary ? [
                  { label: "Total Emails", value: adminSummary.totals.total_emails },
                  { label: "High Priority", value: adminSummary.totals.high_priority },
                  { label: "Attachments", value: adminSummary.totals.attachments },
                  { label: "Flagged Reports", value: adminSummary.totals.flagged }
                ] : dashboardStats).map((item) => (
                  <div key={item.label} className="o365-admin-card"><strong>{item.value}</strong><span>{item.label}</span></div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
                <div className="o365-settings-section">
                  <h3>Employees & Permissions</h3>
                  <div className="o365-settings-body">
                    {adminSummary?.roleMatrix?.length ? adminSummary.roleMatrix.map((u) => (
                      <div key={u.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #eee", fontSize: 12 }}>
                        <span><strong>{u.name}</strong> ({u.role})</span>
                        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", fontSize: 10 }}>
                          {u.role === "Admin" || u.role === "admin" ? <span style={{ background: "#1a237e", color: "#fff", padding: "1px 4px", borderRadius: 2 }}>ADMIN</span> : null}
                          <span style={{ color: u.can_manage_users ? "#107c10" : "#999" }}>Users</span>
                          <span style={{ color: u.can_manage_projects ? "#107c10" : "#999" }}>Projects</span>
                          <span style={{ color: u.can_manage_tasks ? "#107c10" : "#999" }}>Tasks</span>
                          <span style={{ color: u.can_manage_keys ? "#107c10" : "#999" }}>Keys</span>
                          <span style={{ color: u.can_manage_settings ? "#107c10" : "#999" }}>Settings</span>
                          <span style={{ color: u.can_view_analytics ? "#107c10" : "#999" }}>Analytics</span>
                          <span style={{ color: u.can_manage_backups ? "#107c10" : "#999" }}>Backups</span>
                        </span>
                      </div>
                    )) : <div style={{ fontSize: 12, color: "#666" }}>No user data.</div>}
                  </div>
                </div>
                <div className="o365-settings-section">
                  <h3>Employee Analytics Summary</h3>
                  <div className="o365-settings-body">
                    {analytics ? (
                      <>
                        <div style={{ fontSize: 12, marginBottom: 8 }}>
                          <strong>Total Employees:</strong> {analytics.summary?.total_employees} (Active: {analytics.summary?.active_employees})<br />
                          <strong>Total Emails:</strong> {analytics.summary?.total_emails}<br />
                          <strong>Serialized:</strong> {analytics.summary?.total_serialized}<br />
                          <strong>Archives:</strong> {analytics.summary?.total_archives}
                        </div>
                        {analytics.employees?.slice(0, 5).map((emp) => (
                          <div key={emp.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                            <strong>{emp.name}</strong> ({emp.email}) — Sent:{emp.sent_count}, Received:{emp.received_count}, High:{emp.high_priority_count}
                          </div>
                        ))}
                      </>
                    ) : <div style={{ fontSize: 12, color: "#666" }}>Load analytics from Overview tab.</div>}
                  </div>
                </div>
              </div>
            </>
          )}

          {adminTab === "tracker" && (
            <>
              <div className="o365-admin-grid">
                {trackerSummaryCards.map((item) => (
                  <div key={item.key} className="o365-admin-card" style={{ borderTop: `3px solid ${item.accent}` }}>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="o365-settings-section" style={{ marginTop: 16 }}>
                <h3>Tracking Tasks Control Center</h3>
                <div className="o365-settings-body">
                  {trackerError ? (
                    <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 6, border: "1px solid #f1aeb5", background: "#fff5f5", color: "#a12622", fontSize: 12 }}>
                      {trackerError}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Search</label>
                      <input
                        value={trackerSearch}
                        onChange={(e) => setTrackerSearch(e.target.value)}
                        placeholder="Project, subject, AI summary..."
                        style={{ width: 220, fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Status</label>
                      <select value={trackerStatusFilter} onChange={(e) => setTrackerStatusFilter(e.target.value)} style={{ minWidth: 140, fontSize: 12 }}>
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Project</label>
                      <select value={trackerProjectFilter} onChange={(e) => setTrackerProjectFilter(e.target.value)} style={{ minWidth: 180, fontSize: 12 }}>
                        <option value="all">All Projects</option>
                        {trackerProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.code || project.name || `Project ${project.id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Assigned To</label>
                      <select value={trackerAssignedFilter} onChange={(e) => setTrackerAssignedFilter(e.target.value)} style={{ minWidth: 180, fontSize: 12 }}>
                        <option value="all">All Employees</option>
                        {assignableEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name || employee.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => loadTrackerAdminData()}
                      disabled={trackerLoading || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                      style={{ fontSize: 12, padding: "6px 12px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: trackerLoading || trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer" }}
                    >
                      {trackerLoading ? "Loading..." : "Refresh"}
                    </button>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12, padding: "10px 12px", border: "1px solid #e1e1e1", borderRadius: 8, background: "#fafafa" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#444" }}>
                      <input
                        type="checkbox"
                        checked={areAllTrackerRowsSelected}
                        onChange={(e) => toggleAllTrackerSelections(e.target.checked)}
                        disabled={!filteredTrackerRows.length || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                      />
                      Select All Visible
                    </label>
                    <span style={{ fontSize: 12, color: "#666" }}>
                      Selected: {trackerSelectedVisibleCount} / {filteredTrackerRows.length}
                    </span>
                    <button
                      onClick={handleTrackerBulkComplete}
                      disabled={!trackerSelectedRows.length || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                      style={{ fontSize: 12, padding: "6px 10px", background: "#107c10", color: "#fff", border: "none", borderRadius: 4, cursor: !trackerSelectedRows.length || trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: !trackerSelectedRows.length || trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                    >
                      {trackerBulkAction === "complete" ? "Saving..." : "Bulk Complete"}
                    </button>
                    <select
                      value={trackerBulkAssignedTo}
                      onChange={(e) => setTrackerBulkAssignedTo(e.target.value)}
                      disabled={Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                      style={{ minWidth: 180, fontSize: 12, padding: "6px 8px", border: "1px solid #d1d1d1", borderRadius: 4, background: "#fff", cursor: trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                    >
                      <option value="">{trackerBulkAction === "assign" ? "Assigning..." : "Assign Selected To"}</option>
                      {assignableEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name || employee.email}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleTrackerBulkAssign}
                      disabled={!trackerSelectedRows.length || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                      style={{ fontSize: 12, padding: "6px 10px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 4, cursor: !trackerSelectedRows.length || trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: !trackerSelectedRows.length || trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                    >
                      Apply Assign
                    </button>
                    <button
                      onClick={handleTrackerExportCsv}
                      disabled={!trackerSelectedRows.length || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                      style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: !trackerSelectedRows.length || trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: !trackerSelectedRows.length || trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                    >
                      <Download size={14} /> Export CSV
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.65fr", gap: 16, alignItems: "start" }}>
                    <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                        Active Tracking Tasks ({filteredTrackerRows.length})
                      </div>
                      <div style={{ maxHeight: 520, overflow: "auto" }}>
                        {trackerLoading && !trackerRowsData.length ? (
                          <div style={{ padding: 12, fontSize: 12, color: "#666" }}>Loading tracking tasks...</div>
                        ) : !filteredTrackerRows.length ? (
                          <div style={{ padding: 12, fontSize: 12, color: "#666" }}>No tracking tasks match the current filters.</div>
                        ) : filteredTrackerRows.map((row) => {
                          const normalizedStatus = normalizeTrackingStatus(row.status);
                          const isSelected = trackerSelectedSet.has(Number(row.task_id));
                          const isBusy = Number(trackerRowActionId) === Number(row.task_id);
                          return (
                            <div key={row.task_id} style={{ padding: 12, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => toggleTrackerSelection(row.task_id, e.target.checked)}
                                  disabled={Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                                />
                                <span style={{ fontSize: 11, color: "#666" }}>Task #{row.task_id}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                                <strong>{row.email_subject || `Tracking Task ${row.task_id}`}</strong>
                                <span style={{ color: "#666" }}>{formatDateTime(row.due_date)}</span>
                              </div>
                              <div style={{ color: "#555" }}>
                                {row.task_type || "general"} | {row.status || "PENDING"} | {row.priority || "medium"}
                              </div>
                              <div style={{ color: "#777", marginTop: 4 }}>
                                {row.project_code || "No project"}{row.project_name ? ` | ${row.project_name}` : ""} | Assigned to: {row.assigned_to_name || "-"}
                              </div>
                              {row.ai_summary ? (
                                <div style={{ marginTop: 6, padding: "6px 8px", background: "#fafafa", borderRadius: 4, color: "#444" }}>
                                  {row.ai_summary}
                                </div>
                              ) : null}
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                                <button
                                  onClick={() => setTrackerFocusedTaskId(row.task_id)}
                                  style={{ fontSize: 12, padding: "6px 10px", background: Number(trackerFocusedTaskId) === Number(row.task_id) ? "#eef4ff" : "#fff", color: Number(trackerFocusedTaskId) === Number(row.task_id) ? "#1a73e8" : "#333", border: Number(trackerFocusedTaskId) === Number(row.task_id) ? "1px solid #a8c7fa" : "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                                >
                                  {Number(trackerFocusedTaskId) === Number(row.task_id) ? "Timeline Open" : "View Timeline"}
                                </button>
                                <button
                                  onClick={() => updateTrackerTask(row.task_id, { status: "IN_PROGRESS" }, "Unable to start tracking task.")}
                                  disabled={normalizedStatus === "completed" || normalizedStatus === "in_progress" || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                                  style={{ fontSize: 12, padding: "6px 10px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 4, cursor: normalizedStatus === "completed" || normalizedStatus === "in_progress" || trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: normalizedStatus === "completed" || normalizedStatus === "in_progress" || trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                                >
                                  {isBusy && normalizedStatus !== "completed" ? "Saving..." : "Start"}
                                </button>
                                <button
                                  onClick={() => completeTrackerTask(row.task_id)}
                                  disabled={normalizedStatus === "completed" || Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                                  style={{ fontSize: 12, padding: "6px 10px", background: "#107c10", color: "#fff", border: "none", borderRadius: 4, cursor: normalizedStatus === "completed" || trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: normalizedStatus === "completed" || trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                                >
                                  {isBusy && normalizedStatus === "completed" ? "Saving..." : "Mark Complete"}
                                </button>
                                <select
                                  value={row.assigned_to ?? ""}
                                  onChange={(e) => updateTrackerTask(row.task_id, { assigned_to: e.target.value === "" ? null : Number(e.target.value) }, "Unable to reassign tracking task.")}
                                  disabled={Boolean(trackerBulkAction) || Boolean(trackerRowActionId)}
                                  style={{ minWidth: 180, fontSize: 12, padding: "6px 8px", border: "1px solid #d1d1d1", borderRadius: 4, background: "#fff", cursor: trackerBulkAction || trackerRowActionId ? "not-allowed" : "pointer", opacity: trackerBulkAction || trackerRowActionId ? 0.6 : 1 }}
                                >
                                  <option value="">{isBusy ? "Assigning..." : "Assign To"}</option>
                                  {assignableEmployees.map((employee) => (
                                    <option key={employee.id} value={employee.id}>
                                      {employee.name || employee.email}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 16 }}>
                      <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span>Notification Analytics</span>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                              <span style={{ color: "#666" }}>From:</span>
                              <input
                                type="date"
                                value={notificationAnalyticsFromDate}
                                onChange={(e) => setNotificationAnalyticsFromDate(e.target.value)}
                                style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4 }}
                              />
                              <span style={{ color: "#666" }}>To:</span>
                              <input
                                type="date"
                                value={notificationAnalyticsToDate}
                                onChange={(e) => setNotificationAnalyticsToDate(e.target.value)}
                                style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4 }}
                              />
                            </div>
                            <button
                              onClick={resetNotificationAnalyticsFilters}
                              disabled={notificationAnalyticsLoading || (!notificationAnalyticsFromDate && !notificationAnalyticsToDate)}
                              style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: notificationAnalyticsLoading || (!notificationAnalyticsFromDate && !notificationAnalyticsToDate) ? "not-allowed" : "pointer", opacity: notificationAnalyticsLoading || (!notificationAnalyticsFromDate && !notificationAnalyticsToDate) ? 0.6 : 1 }}
                            >
                              Reset Dates
                            </button>
                            <button
                              onClick={handleNotificationAnalyticsExportCsv}
                              disabled={notificationAnalyticsLoading || !hasNotificationAnalyticsData}
                              style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: notificationAnalyticsLoading || !hasNotificationAnalyticsData ? "not-allowed" : "pointer", opacity: notificationAnalyticsLoading || !hasNotificationAnalyticsData ? 0.6 : 1 }}
                            >
                              <Download size={14} /> Export CSV
                            </button>
                            <button
                              onClick={() => loadNotificationAnalytics()}
                              disabled={notificationAnalyticsLoading}
                              style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: notificationAnalyticsLoading ? "not-allowed" : "pointer", opacity: notificationAnalyticsLoading ? 0.6 : 1 }}
                            >
                              {notificationAnalyticsLoading ? "Loading..." : "Refresh"}
                            </button>
                          </div>
                        </div>
                        <div style={{ padding: 12, display: "grid", gap: 12 }}>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            Jordan Time Zone: <strong>Asia/Amman</strong> | {notificationAnalytics?.period_label || `Last ${Number(notificationAnalytics?.period_days || 30)} days`} | Latest Event: {notificationAnalytics?.latest_event_at ? formatDateTime(notificationAnalytics.latest_event_at) : "-"}
                          </div>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            From: {notificationAnalytics?.from_date ? formatDateTime(notificationAnalytics.from_date) : "-"} | To: {notificationAnalytics?.to_date ? formatDateTime(notificationAnalytics.to_date) : "Now"}
                          </div>
                          {notificationAnalyticsError ? (
                            <div className="task-history-error">{notificationAnalyticsError}</div>
                          ) : null}
                          <div className="o365-admin-grid" style={{ marginBottom: 0 }}>
                            {notificationAnalyticsCards.map((item) => (
                              <div key={item.key} className="o365-admin-card" style={{ borderTop: `3px solid ${item.accent}` }}>
                                <strong>{item.value}</strong>
                                <span>{item.label}</span>
                              </div>
                            ))}
                          </div>
                          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, background: "#fafafa", overflow: "hidden" }}>
                            <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 600 }}>
                              Top Actors
                            </div>
                            <div style={{ padding: 12, display: "grid", gap: 8 }}>
                              {notificationAnalytics?.top_actors?.length ? notificationAnalytics.top_actors.map((item, index) => (
                                <div key={`${item.actor_user_id || "system"}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                                  <span>{item.actor_name || "System"}</span>
                                  <span style={{ color: "#666" }}>
                                    Total: {Number(item.total || 0)} | Reassigned: {Number(item.reassigned || 0)} | Completed: {Number(item.completed || 0)} | Overdue: {Number(item.overdue || 0)}
                                  </span>
                                </div>
                              )) : (
                                <div style={{ fontSize: 12, color: "#666" }}>No notification events recorded yet for the selected period.</div>
                              )}
                            </div>
                          </div>
                          {notificationAnalyticsHistory.length > 0 && (
                            <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, background: "#fafafa", overflow: "hidden" }}>
                              <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>Event Timeline ({notificationAnalyticsHistory.length} events)</span>
                                <button
                                  onClick={() => setShowNotificationHistory(!showNotificationHistory)}
                                  style={{ fontSize: 11, padding: "2px 8px", background: "#fff", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                                >
                                  {showNotificationHistory ? "Hide" : "Show"}
                                </button>
                              </div>
                              {showNotificationHistory && (
                                <div style={{ padding: 12, display: "grid", gap: 6, maxHeight: 300, overflowY: "auto" }}>
                                  {notificationAnalyticsHistory.map((evt, idx) => {
                                    const meta = evt.metadata || {};
                                    const categoryColors = {
                                      tracking_task_reassigned: "#1a73e8",
                                      tracking_task_completed: "#107c10",
                                      tracking_task_overdue: "#d83b01"
                                    };
                                    return (
                                      <div key={evt.id || idx} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11, padding: "6px 8px", background: "#fff", borderRadius: 4, borderLeft: `3px solid ${categoryColors[evt.category] || "#999"}` }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{evt.title || "Notification"}</div>
                                          <div style={{ color: "#666", marginBottom: 2 }}>{evt.message || ""}</div>
                                          <div style={{ display: "flex", gap: 12, color: "#888", flexWrap: "wrap" }}>
                                            <span>Actor: <strong>{meta.actor_name || "System"}</strong></span>
                                            {meta.tracking_task_id && <span>Task ID: <strong>#{meta.tracking_task_id}</strong></span>}
                                            {meta.task_id && <span>Task: <strong>{meta.task_id}</strong></span>}
                                            {meta.serial_number && <span>Serial: <strong>{meta.serial_number}</strong></span>}
                                            <span>{formatDateTime(evt.created_at)}</span>
                                          </div>
                                        </div>
                                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: `${categoryColors[evt.category] || "#999"}20`, color: categoryColors[evt.category] || "#999", whiteSpace: "nowrap" }}>
                                          {evt.category?.replace("tracking_task_", "") || "event"}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                          Breakdown by Status
                        </div>
                        <div style={{ padding: 12, display: "grid", gap: 8 }}>
                          {(trackerSummary.by_status || []).length ? trackerSummary.by_status.map((item) => (
                            <div key={item.status} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                              <span>{item.status || "UNKNOWN"}</span>
                              <strong>{Number(item.total || 0)}</strong>
                            </div>
                          )) : <div style={{ fontSize: 12, color: "#666" }}>No status data yet.</div>}
                        </div>
                      </div>

                      <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                          Breakdown by Task Type
                        </div>
                        <div style={{ padding: 12, display: "grid", gap: 8 }}>
                          {(trackerSummary.by_task_type || []).length ? trackerSummary.by_task_type.map((item) => (
                            <div key={item.task_type} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                              <span>{item.task_type || "general"}</span>
                              <strong>{Number(item.total || 0)}</strong>
                            </div>
                          )) : <div style={{ fontSize: 12, color: "#666" }}>No type data yet.</div>}
                        </div>
                      </div>

                      <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                          Breakdown by Priority
                        </div>
                        <div style={{ padding: 12, display: "grid", gap: 8 }}>
                          {(trackerSummary.by_priority || []).length ? trackerSummary.by_priority.map((item) => (
                            <div key={item.priority} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                              <span>{item.priority || "medium"}</span>
                              <strong>{Number(item.total || 0)}</strong>
                            </div>
                          )) : <div style={{ fontSize: 12, color: "#666" }}>No priority data yet.</div>}
                        </div>
                      </div>

                      <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <span>Task Timeline {trackerFocusedTask ? `#${trackerFocusedTask.task_id}` : ""}</span>
                          <button
                            onClick={handleTrackerTimelineExportCsv}
                            disabled={!trackerFocusedTask || trackerHistoryLoading || Boolean(trackerHistoryError) || !trackerHistory.length}
                            style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: !trackerFocusedTask || trackerHistoryLoading || trackerHistoryError || !trackerHistory.length ? "not-allowed" : "pointer", opacity: !trackerFocusedTask || trackerHistoryLoading || trackerHistoryError || !trackerHistory.length ? 0.6 : 1 }}
                          >
                            <Download size={14} /> Export Timeline CSV
                          </button>
                        </div>
                        <div style={{ padding: 12 }}>
                          {trackerFocusedTask ? (
                            <div style={{ marginBottom: 10, fontSize: 12, color: "#555" }}>
                              <strong>{trackerFocusedTask.email_subject || `Tracking Task ${trackerFocusedTask.task_id}`}</strong>
                              <div style={{ marginTop: 4, color: "#777" }}>
                                {trackerFocusedTask.project_code || "No project"} | {trackerFocusedTask.status || "PENDING"} | {trackerFocusedTask.assigned_to_name || "Unassigned"}
                              </div>
                            </div>
                          ) : null}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
                            <div>
                              <label style={{ fontSize: 11, display: "block", color: "#666" }}>Actor</label>
                              <select value={trackerHistoryActorFilter} onChange={(e) => setTrackerHistoryActorFilter(e.target.value)} style={{ minWidth: 150, fontSize: 12 }}>
                                <option value="all">All Actors</option>
                                <option value="system">System</option>
                                {assignableEmployees.map((employee) => (
                                  <option key={employee.id} value={employee.id}>
                                    {employee.name || employee.email}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, display: "block", color: "#666" }}>Action</label>
                              <select value={trackerHistoryActionFilter} onChange={(e) => setTrackerHistoryActionFilter(e.target.value)} style={{ minWidth: 140, fontSize: 12 }}>
                                <option value="all">All Actions</option>
                                <option value="created">Created</option>
                                <option value="started">Started</option>
                                <option value="completed">Completed</option>
                                <option value="reassigned">Reassigned</option>
                                <option value="updated">Updated</option>
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, display: "block", color: "#666" }}>From Date</label>
                              <input
                                type="date"
                                value={trackerHistoryFromDate}
                                onChange={(e) => setTrackerHistoryFromDate(e.target.value)}
                                style={{ fontSize: 12 }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, display: "block", color: "#666" }}>To Date</label>
                              <input
                                type="date"
                                value={trackerHistoryToDate}
                                onChange={(e) => setTrackerHistoryToDate(e.target.value)}
                                style={{ fontSize: 12 }}
                              />
                            </div>
                            <button
                              onClick={resetTrackerHistoryFilters}
                              disabled={trackerHistoryLoading}
                              style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: trackerHistoryLoading ? "not-allowed" : "pointer", opacity: trackerHistoryLoading ? 0.6 : 1 }}
                            >
                              Reset Filters
                            </button>
                          </div>
                          {trackerHistoryLoading ? (
                            <div className="task-history-empty">Loading history...</div>
                          ) : trackerHistoryError ? (
                            <div className="task-history-error">{trackerHistoryError}</div>
                          ) : !trackerFocusedTask ? (
                            <div className="task-history-empty">Select a tracking task to inspect its timeline.</div>
                          ) : !trackerHistory.length ? (
                            <div className="task-history-empty">No history matches the current audit filters.</div>
                          ) : (
                            <div className="task-history-timeline">
                              {trackerHistory.map((entry) => (
                                <div key={entry.id} className="task-history-item">
                                  <div className="task-history-item-head">
                                    <span className="task-history-action">{formatTrackingHistoryActionLabel(entry.action_type)}</span>
                                    <span className="task-history-time">
                                      {entry.created_at ? formatDateTime(entry.created_at) : "Unknown time"}
                                    </span>
                                  </div>
                                  <div className="task-history-actor">
                                    {entry.actor_name || entry.actor_email || "System"}
                                  </div>
                                  <div className="task-history-change">
                                    {formatTrackingHistoryChange(entry)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="o365-settings-section" style={{ marginTop: 16 }}>
                <h3>Thread Tracker</h3>
                <div className="o365-settings-body">
                  <ThreadTracker apiFetch={apiFetch} />
                </div>
              </div>
            </>
          )}

          {adminTab === "approval" && (
            <>
              <div className="o365-admin-grid">
                <div className="o365-admin-card"><strong>{approvalAnalytics?.employees?.length || 0}</strong><span>Employees in Approval Flow</span></div>
                <div className="o365-admin-card"><strong>{approvalAnalytics?.employees?.reduce((sum, item) => sum + Number(item.total_cycles || 0), 0) || 0}</strong><span>Total Approval Cycles</span></div>
                <div className="o365-admin-card"><strong>{approvalAnalytics?.employees?.reduce((sum, item) => sum + Number(item.rejected_cycles || 0), 0) || 0}</strong><span>Total Rejections</span></div>
                <div className="o365-admin-card"><strong>{approvalAnalytics?.employees?.length ? `${(approvalAnalytics.employees.reduce((sum, item) => sum + Number(item.avg_approval_minutes || 0), 0) / approvalAnalytics.employees.length).toFixed(2)} min` : "0 min"}</strong><span>Average Approval Time</span></div>
                <div className="o365-admin-card"><strong>{approvalAnalytics?.employees?.reduce((sum, item) => sum + Number(item.high_risk_cycles || 0), 0) || 0}</strong><span>High Risk Cycles</span></div>
                <div className="o365-admin-card"><strong>{approvalAnalytics?.employees?.reduce((sum, item) => sum + Number(item.reminder_count || 0), 0) || 0}</strong><span>Total Reminder Sends</span></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16, marginTop: 16 }}>
                <div className="o365-settings-section">
                  <h3>Approval Performance by Employee</h3>
                  <div className="o365-settings-body">
                    {approvalAnalytics?.employees?.length ? approvalAnalytics.employees.map((item) => (
                      <div key={item.employee_id} className="o365-approval-history-item">
                        <div><strong>{item.employee_name}</strong> ({item.employee_email})</div>
                        <div>Total Cycles: {item.total_cycles} | Rejections: {item.rejected_cycles} | Rejection Rate: {item.rejection_rate}%</div>
                        <div>Average Approval Time: {item.avg_approval_minutes || 0} minutes</div>
                        <div>High Risk: {item.high_risk_cycles || 0} | Critical Risk: {item.critical_risk_cycles || 0} | Reminders: {item.reminder_count || 0}</div>
                        <div>Last Reminder: {item.last_reminder_at ? formatJordanDateTime(item.last_reminder_at, { month: "short", day: "2-digit", year: undefined }) : "Not sent yet"}</div>
                      </div>
                    )) : <div style={{ fontSize: 12, color: "#666" }}>No approval analytics data is available yet.</div>}
                  </div>
                </div>
                <div className="o365-settings-section">
                  <h3>Common Correction Trends</h3>
                  <div className="o365-settings-body">
                    {approvalAnalytics?.correction_trends?.length ? approvalAnalytics.correction_trends.map((item) => (
                      <div key={`${item.feedback_content}-${item.occurrences}`} className="o365-approval-history-item">
                        <div><strong>{item.occurrences} time(s)</strong></div>
                        <div>{item.feedback_content}</div>
                      </div>
                    )) : <div style={{ fontSize: 12, color: "#666" }}>No rejection trends have been recorded yet.</div>}
                  </div>
                </div>
              </div>
            </>
          )}

          {adminTab === "employees" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
              <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #e1e1e1", background: "#f8f9fa" }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>{editingEmployeeId ? "Edit Employee" : "Add New Employee"}</h3>
                </div>
                <div style={{ padding: 18 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Full Name</label>
                      <input value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} placeholder="e.g. John Doe" style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Email Address</label>
                      <input value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} placeholder="e.g. john@company.com" style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Password {editingEmployeeId ? <span style={{ color: "#999", fontWeight: 400 }}>(leave empty to keep)</span> : ""}</label>
                      <input type="password" value={employeeForm.password} onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })} placeholder={editingEmployeeId ? "Leave empty to keep" : "Enter password"} style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Role</label>
                      <select value={employeeForm.role} onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })} style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, background: "#fff", boxSizing: "border-box" }}>
                        <option>Admin</option><option>Manager</option><option>Employee</option><option>Analyst</option><option>Viewer</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Department</label>
                      <input value={employeeForm.department} onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value })} placeholder="e.g. Sales" style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Phone</label>
                      <input value={employeeForm.phone} onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })} placeholder="e.g. +971 XX XXX XXXX" style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Telegram Chat ID</label>
                      <input value={employeeForm.telegram_chat_id} onChange={(e) => setEmployeeForm({ ...employeeForm, telegram_chat_id: e.target.value })} placeholder="e.g. 123456789" style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Telegram Username</label>
                      <input value={employeeForm.telegram_username} onChange={(e) => setEmployeeForm({ ...employeeForm, telegram_username: e.target.value })} placeholder="e.g. tiger_manager" style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#555" }}>
                      <input type="checkbox" checked={Boolean(employeeForm.telegram_notifications_enabled)} onChange={(e) => setEmployeeForm({ ...employeeForm, telegram_notifications_enabled: e.target.checked })} />
                      Enable Telegram approval notifications for this user
                    </label>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: "#555", display: "block", marginBottom: 3 }}>Direct Manager</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select value={employeeForm.manager_id} onChange={(e) => setEmployeeForm({ ...employeeForm, manager_id: e.target.value })} style={{ flex: 1, padding: "7px 10px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, background: "#fff", boxSizing: "border-box" }}>
                        <option value="">— No Manager —</option>
                        {employees.filter((employee) => employee.id !== editingEmployeeId).map((employee) => (
                          <option key={employee.id} value={employee.id}>{employee.name} ({employee.email})</option>
                        ))}
                      </select>
                      <button onClick={() => setShowManagerQuickForm(!showManagerQuickForm)} title="Add new manager" style={{ padding: "7px 14px", fontSize: 18, fontWeight: 600, background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", lineHeight: 1 }}>{showManagerQuickForm ? "−" : "+"}</button>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: "#666" }}>
                      Workflow routing is controlled here. Any non-admin employee with a direct manager is submitted for approval before external delivery.
                    </div>
                    {showManagerQuickForm && (
                      <div style={{ marginTop: 8, padding: 12, background: "#f7f8fa", borderRadius: 6, border: "1px solid #e1e1e1" }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#555", marginBottom: 8 }}>Quick Add Manager</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input value={managerQuickForm.name} onChange={(e) => setManagerQuickForm({ ...managerQuickForm, name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 120, padding: "6px 10px", fontSize: 12, border: "1px solid #d1d1d1", borderRadius: 4 }} />
                          <input value={managerQuickForm.email} onChange={(e) => setManagerQuickForm({ ...managerQuickForm, email: e.target.value })} placeholder="Email" style={{ flex: 1, minWidth: 180, padding: "6px 10px", fontSize: 12, border: "1px solid #d1d1d1", borderRadius: 4 }} />
                          <button disabled={isSavingEmployee} onClick={onQuickCreateManager} style={{ padding: "6px 14px", fontSize: 12, background: "#107c10", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Create & Select</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "#f7f8fa", borderRadius: 6, border: "1px solid #e1e1e1" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#333", marginBottom: 8 }}>Admin Permissions</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_users)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_users: e.target.checked })} /> Manage Users
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_projects)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_projects: e.target.checked })} /> Manage Projects
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_tasks)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_tasks: e.target.checked })} /> Manage Tasks
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_keys)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_keys: e.target.checked })} /> Manage Keys
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_settings)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_settings: e.target.checked })} /> Manage Settings
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_view_analytics)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_view_analytics: e.target.checked })} /> View Analytics
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_backups)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_backups: e.target.checked })} /> Manage Backups
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_archives)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_archives: e.target.checked })} /> Manage Archives
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_email_accounts)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_email_accounts: e.target.checked })} /> Manage Email Accounts
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_manage_reports)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_manage_reports: e.target.checked })} /> Manage Reports
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(employeeForm.can_archive)} onChange={(e) => setEmployeeForm({ ...employeeForm, can_archive: e.target.checked })} /> Can Archive
                      </label>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button disabled={isSavingEmployee} onClick={onSaveEmployee} style={{ padding: "8px 24px", fontSize: 13, fontWeight: 500, background: editingEmployeeId ? "#ff8c00" : "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>{isSavingEmployee ? "Saving..." : editingEmployeeId ? "Update Employee" : "Add Employee"}</button>
                    {editingEmployeeId ? <button onClick={() => { setEditingEmployeeId(null); setEmployeeForm(createEmptyEmployeeForm()); }} style={{ padding: "8px 16px", fontSize: 13, background: "#6c757d", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Cancel</button> : null}
                  </div>
                </div>
              </div>

              <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #e1e1e1", background: "#f8f9fa" }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>Employees List</h3>
                </div>
                <div style={{ padding: 18, maxHeight: 500, overflowY: "auto" }}>
                  {!employees.length ? (
                    <div style={{ fontSize: 13, color: "#888", textAlign: "center", padding: 20 }}>No employees found.</div>
                  ) : employees.map((emp) => (
                    <div key={emp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                      <div>
                        <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{emp.name}</div>
                        <div style={{ fontSize: 12, color: "#888" }}>
                          {emp.email} <span style={{ color: "var(--c-primary)" }}>({emp.role})</span>
                          {emp.department ? <span> · {emp.department}</span> : ""}
                          {emp.manager_name ? <span> · <span style={{ color: "#555" }}>Manager:</span> {emp.manager_name} ({emp.manager_email})</span> : ""}
                          {emp.telegram_chat_id ? <span> · <span style={{ color: "#555" }}>Telegram:</span> {emp.telegram_chat_id}{emp.telegram_notifications_enabled ? " enabled" : " saved only"}</span> : null}
                          {!emp.is_active ? <span style={{ color: "#d13438", marginLeft: 6 }}>(Inactive)</span> : null}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => { setEditingEmployeeId(emp.id); setEmployeeForm({ name: emp.name, email: emp.email, password: "", role: emp.role, phone: emp.phone || "", department: emp.department || "", manager_id: emp.manager_id || "", telegram_chat_id: emp.telegram_chat_id || "", telegram_username: emp.telegram_username || "", telegram_notifications_enabled: Boolean(emp.telegram_notifications_enabled), can_manage_users: Boolean(emp.can_manage_users), can_manage_reports: Boolean(emp.can_manage_reports), can_manage_projects: Boolean(emp.can_manage_projects), can_manage_tasks: Boolean(emp.can_manage_tasks), can_manage_keys: Boolean(emp.can_manage_keys), can_manage_settings: Boolean(emp.can_manage_settings), can_view_analytics: Boolean(emp.can_view_analytics), can_manage_backups: Boolean(emp.can_manage_backups), can_manage_archives: Boolean(emp.can_manage_archives), can_manage_email_accounts: Boolean(emp.can_manage_email_accounts), can_archive: Boolean(emp.can_archive) }); }} style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: "pointer", color: "#555" }}>Edit</button>
                        <button onClick={() => onDeleteEmployee(emp)} style={{ background: "none", border: "1px solid #d13438", borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: "pointer", color: "#d13438" }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {adminTab === "mail-tests" && (
            <div className="o365-settings-section">
              <h3>Mail Connection Tests</h3>
              <div className="o365-settings-body">
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" onClick={onRunAdminMailTests} disabled={isRunningAdminMailTests}>
                    <RefreshCw size={14} />{isRunningAdminMailTests ? "Running Tests..." : "Run Connection Tests Now"}
                  </button>
                  <span style={{ fontSize: 12, color: "#666" }}>Runs the effective incoming and SMTP connection test for each user mailbox separately.</span>
                </div>
                {adminMailTests?.summary ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
                    <div className="o365-admin-card"><strong>{Number(adminMailTests.summary.total_users || 0)}</strong><span>Total Users</span></div>
                    <div className="o365-admin-card"><strong>{Number(adminMailTests.summary.ok_users || 0)}</strong><span>Passed</span></div>
                    <div className="o365-admin-card"><strong>{Number(adminMailTests.summary.failed_users || 0)}</strong><span>Failed</span></div>
                    <div className="o365-admin-card"><strong>{Number(adminMailTests.summary.missing_settings_users || 0)}</strong><span>Missing Settings</span></div>
                  </div>
                ) : null}
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  {(adminMailTests?.results || []).map((item) => (
                    <div key={`${item.user_id}-${item.email}`} style={{ border: "1px solid #e1e1e1", borderRadius: 6, background: "#fff", padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontSize: 13 }}>
                          <strong>{item.name}</strong> ({item.email})
                        </div>
                        <div style={{ fontSize: 12, color: item.ok ? "#107c10" : item.has_mail_settings ? "#d83b01" : "#666" }}>
                          {item.ok ? "Passed" : item.has_mail_settings ? "Failed" : "Missing Settings"}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#555", display: "grid", gap: 4 }}>
                        <div><strong>Provider:</strong> {item.account_type || "Not configured"}</div>
                        <div><strong>Mailbox:</strong> {item.mailbox_email_address || item.email}</div>
                        <div><strong>Incoming:</strong> {item.incoming ? (item.incoming.ok ? "OK" : `Failed - ${item.incoming.error || "Unknown error"}`) : "Not tested"}</div>
                        <div><strong>SMTP:</strong> {item.outgoing ? (item.outgoing.ok ? "OK" : `Failed - ${item.outgoing.error || "Unknown error"}`) : "Not tested"}</div>
                        {!item.has_mail_settings && item.error ? <div><strong>Settings:</strong> {item.error}</div> : null}
                        {Array.isArray(item.errors) && item.errors.length ? <div><strong>Validation:</strong> {item.errors.join(" | ")}</div> : null}
                      </div>
                    </div>
                  ))}
                  {!adminMailTests?.results?.length ? (
                    <div style={{ fontSize: 12, color: "#666" }}>No test results yet. Run the connection tests to inspect each user mailbox separately.</div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {adminTab === "trail" && (
            <div className="o365-settings-section">
              <h3>Email Trail — {emailTrailTotal} total</h3>
              <div className="o365-settings-body">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <input placeholder="Search subject/sender..." value={emailTrailFilters.search} onChange={(e) => setEmailTrailFilters({ ...emailTrailFilters, search: e.target.value })} style={{ fontSize: 12, width: 180 }} />
                  <input placeholder="Employee ID" value={emailTrailFilters.employee_id} onChange={(e) => setEmailTrailFilters({ ...emailTrailFilters, employee_id: e.target.value })} style={{ fontSize: 12, width: 100 }} />
                  <select value={emailTrailFilters.folder_name} onChange={(e) => setEmailTrailFilters({ ...emailTrailFilters, folder_name: e.target.value })} style={{ fontSize: 12 }}><option value="">All Folders</option>{dataFolders.map((folder) => <option key={folder.id}>{folder.name}</option>)}</select>
                  <input type="date" value={emailTrailFilters.from_date} onChange={(e) => setEmailTrailFilters({ ...emailTrailFilters, from_date: e.target.value })} style={{ fontSize: 12 }} />
                  <input type="date" value={emailTrailFilters.to_date} onChange={(e) => setEmailTrailFilters({ ...emailTrailFilters, to_date: e.target.value })} style={{ fontSize: 12 }} />
                  <button onClick={onLoadEmailTrailData} disabled={isLoadingTrail} style={{ fontSize: 12, padding: "4px 10px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>{isLoadingTrail ? "Loading..." : "Search"}</button>
                  <button onClick={onExportEmailTrailCsv} style={{ fontSize: 12, padding: "4px 10px", background: "none", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}><Download size={14} /> Export CSV</button>
                </div>
                <div style={{ maxHeight: 500, overflow: "auto" }}>
                  {!emailTrail.length ? <div style={{ fontSize: 12, color: "#666" }}>No results.</div> : emailTrail.map((row) => (
                    <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #f0f0f0", fontSize: 11 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{row.subject}</strong> — {row.sender_email} → {row.recipient_email}
                        <span style={{ color: "#888", marginLeft: 8 }}>{row.folder_name} | {row.employee_name ? `Employee ${row.employee_name}` : ""} | {row.serialized ? "Serialized" : ""} | {formatJordanDateTime(row.received_at, { month: "short", day: "2-digit", year: "numeric" })}</span>
                      </div>
                      <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <span style={{ background: row.priority === "High" ? "#d13438" : row.priority === "Low" ? "#ff8c00" : "#e1e1e1", color: row.priority === "High" ? "#fff" : "#333", padding: "0 6px", borderRadius: 3, fontSize: 10 }}>{row.priority}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {adminTab === "archives" && (
            <>
              <div className="o365-settings-section">
                <h3>Create Archive / Serialize</h3>
                <div className="o365-settings-body" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                  <div><label style={{ fontSize: 11, display: "block", color: "#666" }}>Employee ID</label><input value={archiveForm.employee_id} onChange={(e) => setArchiveForm({ ...archiveForm, employee_id: e.target.value })} style={{ fontSize: 12, width: 100 }} placeholder="optional" /></div>
                  <div><label style={{ fontSize: 11, display: "block", color: "#666" }}>Email IDs (comma-separated)</label><input value={archiveForm.email_ids.join(",")} onChange={(e) => setArchiveForm({ ...archiveForm, email_ids: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} style={{ fontSize: 12, width: 200 }} /></div>
                  <div><label style={{ fontSize: 11, display: "block", color: "#666" }}>Notes</label><input value={archiveForm.notes} onChange={(e) => setArchiveForm({ ...archiveForm, notes: e.target.value })} style={{ fontSize: 12, width: 160 }} /></div>
                  <button disabled={isCreatingArchive} onClick={onCreateArchive} style={{ fontSize: 12, padding: "6px 12px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>{isCreatingArchive ? "Creating..." : "Create Archive"}</button>
                </div>
              </div>
              <div className="o365-settings-section" style={{ marginTop: 16 }}>
                <h3>AI Re-analyze / Backfill</h3>
                <div className="o365-settings-body">
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Limit</label>
                      <input
                        type="number"
                        min="1"
                        max="5000"
                        value={archiveBackfillForm.limit}
                        onChange={(e) => updateArchiveBackfillField("limit", e.target.value)}
                        style={{ fontSize: 12, width: 100 }}
                      />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#444" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(archiveBackfillForm.includeSent)}
                        onChange={(e) => updateArchiveBackfillField("includeSent", e.target.checked)}
                      />
                      Include Sent
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#444" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(archiveBackfillForm.force)}
                        onChange={(e) => updateArchiveBackfillField("force", e.target.checked)}
                      />
                      Force Re-analyze
                    </label>
                    <button
                      onClick={handleRunArchiveBackfill}
                      disabled={isRunningArchiveBackfill || isCancellingArchiveBackfill || isRetryingArchiveBackfill}
                      style={{ fontSize: 12, padding: "6px 12px", background: "#107c10", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                    >
                      {isRunningArchiveBackfill ? "Running..." : "Run Backfill"}
                    </button>
                    <button
                      onClick={onCancelArchiveBackfill}
                      disabled={!isRunningArchiveBackfill || isCancellingArchiveBackfill}
                      style={{ fontSize: 12, padding: "6px 12px", background: "#d83b01", color: "#fff", border: "none", borderRadius: 4, cursor: !isRunningArchiveBackfill || isCancellingArchiveBackfill ? "not-allowed" : "pointer", opacity: !isRunningArchiveBackfill || isCancellingArchiveBackfill ? 0.6 : 1 }}
                    >
                      {isCancellingArchiveBackfill ? "Cancelling..." : "Cancel Job"}
                    </button>
                    <button
                      onClick={onRetryFailedArchiveBackfill}
                      disabled={isRunningArchiveBackfill || isRetryingArchiveBackfill || !hasFailedItems}
                      style={{ fontSize: 12, padding: "6px 12px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 4, cursor: isRunningArchiveBackfill || isRetryingArchiveBackfill || !hasFailedItems ? "not-allowed" : "pointer", opacity: isRunningArchiveBackfill || isRetryingArchiveBackfill || !hasFailedItems ? 0.6 : 1 }}
                    >
                      {isRetryingArchiveBackfill ? "Retrying..." : "Retry Failed Items"}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: archiveBackfillSummary ? 12 : 0 }}>
                    Re-analyzes archived emails and creates or updates old tracking tasks without duplicating them.
                  </div>
                  {(isRunningArchiveBackfill || archiveBackfillJob) ? (
                    <div style={{ marginBottom: 12, border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff", padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, fontSize: 12 }}>
                        <strong>Status: {archiveBackfillStatus}</strong>
                        <span>{archiveBackfillPercent}%</span>
                      </div>
                      <div style={{ width: "100%", height: 10, background: "#f0f0f0", borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
                        <div style={{ width: `${archiveBackfillPercent}%`, height: "100%", background: archiveBackfillStatus === "failed" ? "#d83b01" : "#107c10", transition: "width 0.3s ease" }} />
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#555" }}>
                        <span>Processed: {Number(archiveBackfillProgress?.processed || 0)} / {Number(archiveBackfillProgress?.scanned || 0)}</span>
                        <span>Analyzed: {Number(archiveBackfillProgress?.analyzed || 0)}</span>
                        <span>Created: {Number(archiveBackfillProgress?.created || 0)}</span>
                        <span>Updated: {Number(archiveBackfillProgress?.updated || 0)}</span>
                        <span>Skipped: {Number(archiveBackfillProgress?.skipped || 0)}</span>
                        <span>Errors: {Number(archiveBackfillProgress?.errors || 0)}</span>
                      </div>
                      {archiveBackfillProgress?.current_subject ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                          Current: {archiveBackfillProgress.current_subject}
                        </div>
                      ) : null}
                      {archiveBackfillJob?.cancel_requested ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#d83b01" }}>
                          Cancellation requested. The job will stop safely after the current item.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {archiveBackfillSummary ? (
                    <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff" }}>
                      <div className="o365-admin-grid" style={{ padding: 12, marginBottom: 0 }}>
                        <div className="o365-admin-card"><strong>{Number(archiveBackfillSummary.scanned || 0)}</strong><span>Scanned</span></div>
                        <div className="o365-admin-card"><strong>{Number(archiveBackfillSummary.analyzed || 0)}</strong><span>Analyzed</span></div>
                        <div className="o365-admin-card"><strong>{Number(archiveBackfillSummary.tasks_created || 0)}</strong><span>Tasks Created</span></div>
                        <div className="o365-admin-card"><strong>{Number(archiveBackfillSummary.tasks_updated || 0)}</strong><span>Tasks Updated</span></div>
                        <div className="o365-admin-card"><strong>{Number(archiveBackfillSummary.tasks_skipped || 0)}</strong><span>Skipped</span></div>
                        <div className="o365-admin-card"><strong>{Number(archiveBackfillSummary.errors || 0)}</strong><span>Errors</span></div>
                      </div>
                      <div style={{ borderTop: "1px solid #eee", padding: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                          Last Run Details ({Array.isArray(archiveBackfillSummary.items) ? archiveBackfillSummary.items.length : 0})
                        </div>
                        <div style={{ maxHeight: 220, overflow: "auto" }}>
                          {!Array.isArray(archiveBackfillSummary.items) || !archiveBackfillSummary.items.length ? (
                            <div style={{ fontSize: 12, color: "#666" }}>No detail rows returned.</div>
                          ) : archiveBackfillSummary.items.map((item, index) => (
                            <div key={`${item.email_id || "row"}-${index}`} style={{ padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                <strong>{item.subject || `Email ${item.email_id || "-"}`}</strong>
                                <span style={{ color: item.status === "error" ? "#d83b01" : "#666" }}>{item.status || "-"}</span>
                              </div>
                              <div style={{ color: "#666", marginTop: 4 }}>
                                Email ID: {item.email_id || "-"} | Category: {item.category || "-"} | Created: {Number(item.created || 0)} | Updated: {Number(item.updated || 0)} | Skipped: {Number(item.skipped || 0)}
                              </div>
                              {item.error ? <div style={{ marginTop: 4, color: "#d83b01" }}>{item.error}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 12, border: "1px solid #e1e1e1", borderRadius: 8, background: "#fff" }}>
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                      Job History ({backfillHistoryRows.length})
                    </div>
                    <div style={{ maxHeight: 260, overflow: "auto", padding: 12 }}>
                      {isLoadingArchiveBackfillHistory ? (
                        <div style={{ fontSize: 12, color: "#666" }}>Loading job history...</div>
                      ) : !backfillHistoryRows.length ? (
                        <div style={{ fontSize: 12, color: "#666" }}>No backfill jobs yet.</div>
                      ) : backfillHistoryRows.map((job) => {
                        const jobHasFailedItems = Array.isArray(job.summary?.items) && job.summary.items.some((item) => item.status === "error");
                        const isSelectedJob = archiveBackfillJob?.job_id === job.job_id;
                        return (
                          <div key={job.job_id} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                              <strong>{job.job_id}</strong>
                              <span style={{ color: job.status === "failed" ? "#d83b01" : job.status === "completed" ? "#107c10" : "#666" }}>
                                {job.status}
                              </span>
                            </div>
                            <div style={{ color: "#666", marginBottom: 6 }}>
                              {formatDateTime(job.created_at)} | Scanned: {Number(job.summary?.scanned || 0)} | Processed: {Number(job.summary?.processed || 0)} | Errors: {Number(job.summary?.errors || 0)}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={() => onOpenArchiveBackfillJob(job)}
                                style={{ fontSize: 12, padding: "6px 10px", background: isSelectedJob ? "var(--c-primary)" : "#fff", color: isSelectedJob ? "#fff" : "#333", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                              >
                                Open
                              </button>
                              <button
                                onClick={() => onRetryFailedArchiveBackfillForJob(job.job_id)}
                                disabled={isRunningArchiveBackfill || !jobHasFailedItems}
                                style={{ fontSize: 12, padding: "6px 10px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 4, cursor: isRunningArchiveBackfill || !jobHasFailedItems ? "not-allowed" : "pointer", opacity: isRunningArchiveBackfill || !jobHasFailedItems ? 0.6 : 1 }}
                              >
                                Retry Failed
                              </button>
                              <button
                                onClick={() => onExportArchiveBackfillSummary(job)}
                                style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                              >
                                Export Summary
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div className="o365-settings-section" style={{ marginTop: 16 }}>
                <h3>Archive Explorer</h3>
                <div className="o365-settings-body">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Project Code</label>
                      <input
                        value={archiveExplorerFilters.project_code}
                        onChange={(e) => updateArchiveExplorerFilter("project_code", e.target.value)}
                        placeholder="e.g. PROJ-1001"
                        style={{ fontSize: 12, width: 150 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Serial Number</label>
                      <input
                        value={archiveExplorerFilters.serial_number}
                        onChange={(e) => updateArchiveExplorerFilter("serial_number", e.target.value)}
                        placeholder="e.g. TENDER-2026-0001"
                        style={{ fontSize: 12, width: 180 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Thread ID</label>
                      <input
                        value={archiveExplorerFilters.thread_id}
                        onChange={(e) => updateArchiveExplorerFilter("thread_id", e.target.value)}
                        placeholder="approval:123 or message:..."
                        style={{ fontSize: 12, width: 220 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: "block", color: "#666" }}>Limit</label>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={archiveExplorerFilters.limit}
                        onChange={(e) => updateArchiveExplorerFilter("limit", e.target.value)}
                        style={{ fontSize: 12, width: 80 }}
                      />
                    </div>
                    <button onClick={handleArchiveExplorerSearch} disabled={isLoadingArchiveExplorer} style={{ fontSize: 12, padding: "6px 12px", background: "var(--c-primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                      {isLoadingArchiveExplorer ? "Loading..." : "Search"}
                    </button>
                    <button onClick={handleArchiveExplorerReset} disabled={isLoadingArchiveExplorer} style={{ fontSize: 12, padding: "6px 12px", background: "none", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>
                      Reset
                    </button>
                  </div>

                  <div className="o365-admin-grid" style={{ marginBottom: 12 }}>
                    <div className="o365-admin-card"><strong>{Number(archiveExplorerData?.totals?.registry || 0)}</strong><span>Email Registry</span></div>
                    <div className="o365-admin-card"><strong>{Number(archiveExplorerData?.totals?.content_archive || 0)}</strong><span>Content Archive</span></div>
                    <div className="o365-admin-card"><strong>{Number(archiveExplorerData?.totals?.tracking_tasks || 0)}</strong><span>Tracking Tasks</span></div>
                    <div className="o365-admin-card"><strong>{Number(registryRows.length + contentRows.length + trackingRows.length || 0)}</strong><span>Loaded Rows</span></div>
                  </div>
                  {archiveExplorerFocusEmailId ? (
                    <div style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid #d0e3ff", background: "#f5f9ff", borderRadius: 8, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", fontSize: 12 }}>
                      <span>Focused on tracking tasks for email ID {archiveExplorerFocusEmailId}.</span>
                      <button
                        onClick={() => setArchiveExplorerFocusEmailId(null)}
                        style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}
                      >
                        Clear Focus
                      </button>
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gap: 16 }}>
                    <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                        email_registry ({registryRows.length})
                      </div>
                      <div style={{ maxHeight: 300, overflow: "auto" }}>
                        {!registryRows.length ? <div style={{ padding: 12, fontSize: 12, color: "#666" }}>No registry rows found.</div> : registryRows.map((row) => (
                          <div key={row.email_db_id} style={{ padding: 12, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                              <strong>{row.serial_number || `Email DB ${row.email_db_id}`}</strong>
                              <span style={{ color: "#666" }}>{formatDateTime(row.updated_at)}</span>
                            </div>
                            <div>{row.subject || "No subject"}</div>
                            <div style={{ color: "#555", marginTop: 4 }}>
                              {row.project_code || "No project"} | {row.thread_id || "No thread"} | {row.folder_name || "-"} | {row.approval_status || "none"} | {row.risk_level || "low"}
                            </div>
                            <div style={{ color: "#777", marginTop: 4 }}>
                              {row.sender_email || "-"} → {row.recipient_email || "-"}
                            </div>
                            <div style={{ color: "#888", marginTop: 4 }}>
                              Employee: {row.employee_name || "-"} | Manager: {row.assigned_manager_name || "-"} | Provider: {row.source_provider || "-"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                        email_content_archive ({contentRows.length})
                      </div>
                      <div style={{ maxHeight: 320, overflow: "auto" }}>
                        {!contentRows.length ? <div style={{ padding: 12, fontSize: 12, color: "#666" }}>No archived content rows found.</div> : contentRows.map((row) => (
                          <div key={row.email_db_id} style={{ padding: 12, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                              <strong>{row.serial_number || `Content ${row.email_db_id}`}</strong>
                              <span style={{ color: "#666" }}>{formatDateTime(row.updated_at)}</span>
                            </div>
                            <div>{row.subject || "No subject"}</div>
                            <div style={{ color: "#555", marginTop: 4 }}>
                              {row.project_code || "No project"} | {row.thread_id || "No thread"} | Attachments: {getAttachmentCount(row.attachments_path)} | Body chars: {Number(row.raw_body_length || 0)}
                            </div>
                            {row.ai_summary ? <div style={{ marginTop: 6, padding: "6px 8px", background: "#fafafa", borderRadius: 4, color: "#444" }}>{row.ai_summary}</div> : null}
                            {row.raw_body_preview ? <div style={{ marginTop: 6, color: "#777", whiteSpace: "pre-wrap" }}>{row.raw_body_preview}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ border: "1px solid #e1e1e1", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#f8f9fa", fontSize: 13, fontWeight: 600 }}>
                        tracking_tasks ({trackingRows.length})
                      </div>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", background: "#fff", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#444" }}>
                          <input
                            type="checkbox"
                            checked={areAllVisibleTrackingTasksSelected}
                            onChange={(e) => onToggleAllArchiveTrackingTaskSelections(trackingRows, e.target.checked)}
                            disabled={!trackingRows.length || Boolean(activeTrackingTaskActionKey) || Boolean(activeBulkTrackingAction)}
                          />
                          Select All Visible
                        </label>
                        <span style={{ fontSize: 12, color: "#666" }}>
                          Selected: {selectedVisibleTrackingTaskCount} / {trackingRows.length}
                        </span>
                        <button
                          onClick={onMarkSelectedArchiveTrackingTasksDone}
                          disabled={!selectedTrackingTaskSet.size || Boolean(activeTrackingTaskActionKey) || Boolean(activeBulkTrackingAction)}
                          style={{ fontSize: 12, padding: "6px 10px", background: "#107c10", color: "#fff", border: "none", borderRadius: 4, cursor: !selectedTrackingTaskSet.size || activeTrackingTaskActionKey || activeBulkTrackingAction ? "not-allowed" : "pointer", opacity: !selectedTrackingTaskSet.size || activeTrackingTaskActionKey || activeBulkTrackingAction ? 0.6 : 1 }}
                        >
                          {activeBulkTrackingAction === "done" ? "Saving..." : "Mark Selected Done"}
                        </button>
                        <select
                          value={bulkArchiveTrackingAssignedTo}
                          onChange={(e) => setBulkArchiveTrackingAssignedTo(e.target.value)}
                          disabled={Boolean(activeTrackingTaskActionKey) || Boolean(activeBulkTrackingAction)}
                          style={{ minWidth: 180, fontSize: 12, padding: "6px 8px", border: "1px solid #d1d1d1", borderRadius: 4, background: "#fff", cursor: activeTrackingTaskActionKey || activeBulkTrackingAction ? "not-allowed" : "pointer", opacity: activeTrackingTaskActionKey || activeBulkTrackingAction ? 0.6 : 1 }}
                        >
                          <option value="">{activeBulkTrackingAction === "assign" ? "Assigning..." : "Assign Selected"}</option>
                          {assignableEmployees.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.name || employee.email}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={onAssignSelectedArchiveTrackingTasks}
                          disabled={!selectedTrackingTaskSet.size || Boolean(activeTrackingTaskActionKey) || Boolean(activeBulkTrackingAction)}
                          style={{ fontSize: 12, padding: "6px 10px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 4, cursor: !selectedTrackingTaskSet.size || activeTrackingTaskActionKey || activeBulkTrackingAction ? "not-allowed" : "pointer", opacity: !selectedTrackingTaskSet.size || activeTrackingTaskActionKey || activeBulkTrackingAction ? 0.6 : 1 }}
                        >
                          Apply Assign
                        </button>
                        <button
                          onClick={onExportSelectedArchiveTrackingTasks}
                          disabled={!selectedTrackingTaskSet.size || Boolean(activeTrackingTaskActionKey) || Boolean(activeBulkTrackingAction)}
                          style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: !selectedTrackingTaskSet.size || activeTrackingTaskActionKey || activeBulkTrackingAction ? "not-allowed" : "pointer", opacity: !selectedTrackingTaskSet.size || activeTrackingTaskActionKey || activeBulkTrackingAction ? 0.6 : 1 }}
                        >
                          Export Selected
                        </button>
                      </div>
                      <div style={{ maxHeight: 320, overflow: "auto" }}>
                        {!trackingRows.length ? <div style={{ padding: 12, fontSize: 12, color: "#666" }}>No tracking tasks found.</div> : trackingRows.map((row) => (
                          <div key={row.task_id} style={{ padding: 12, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                            {(() => {
                              const hasExistingTask = Number(row.existing_task_id) > 0;
                              const isOpeningTask = activeTrackingTaskActionKey === `open:${row.existing_task_id}`;
                              const isMarkingDone = activeTrackingTaskActionKey === `done:${row.existing_task_id}`;
                              const isAssigningTask = activeTrackingTaskActionKey === `assign:${row.existing_task_id}`;
                              const isSelected = selectedTrackingTaskSet.has(Number(row.task_id));
                              return (
                                <>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => onToggleArchiveTrackingTaskSelection(row.task_id, e.target.checked)}
                                disabled={Boolean(activeTrackingTaskActionKey) || Boolean(activeBulkTrackingAction)}
                              />
                              <span style={{ fontSize: 11, color: "#666" }}>Select</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                              <strong>{row.source_task_title || row.email_subject || `Task ${row.task_id}`}</strong>
                              <span style={{ color: "#666" }}>{formatDateTime(row.updated_at)}</span>
                            </div>
                            <div style={{ color: "#555" }}>
                              {row.task_type || "general"} | {row.status || "PENDING"} | {row.priority || "medium"} | Due: {formatDateTime(row.due_date)}
                            </div>
                            <div style={{ color: "#777", marginTop: 4 }}>
                              {row.project_code || "No project"} | {row.serial_number || "No serial"} | {row.thread_id || "No thread"}
                            </div>
                            <div style={{ color: "#888", marginTop: 4 }}>
                              Assigned to: {row.assigned_to_name || "-"} | Alerts: {Number(row.alert_count || 0)} | AI tasks: {getAiTaskCount(row.ai_tasks)}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                              <button
                                onClick={() => onOpenTrackingTaskFromArchive(row)}
                                disabled={!hasExistingTask || Boolean(activeTrackingTaskActionKey)}
                                style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: !hasExistingTask || activeTrackingTaskActionKey ? "not-allowed" : "pointer", opacity: !hasExistingTask || activeTrackingTaskActionKey ? 0.6 : 1 }}
                              >
                                {isOpeningTask ? "Opening..." : "Open Task"}
                              </button>
                              <button
                                onClick={() => onMarkArchiveTrackingTaskDone(row)}
                                disabled={!hasExistingTask || Boolean(activeTrackingTaskActionKey) || String(row.status || "").toLowerCase() === "completed"}
                                style={{ fontSize: 12, padding: "6px 10px", background: "#107c10", color: "#fff", border: "none", borderRadius: 4, cursor: !hasExistingTask || activeTrackingTaskActionKey || String(row.status || "").toLowerCase() === "completed" ? "not-allowed" : "pointer", opacity: !hasExistingTask || activeTrackingTaskActionKey || String(row.status || "").toLowerCase() === "completed" ? 0.6 : 1 }}
                              >
                                {isMarkingDone ? "Saving..." : "Mark Done"}
                              </button>
                              <select
                                value={row.assigned_to ?? ""}
                                onChange={(e) => onAssignArchiveTrackingTask(row, e.target.value)}
                                disabled={!hasExistingTask || Boolean(activeTrackingTaskActionKey)}
                                style={{ minWidth: 180, fontSize: 12, padding: "6px 8px", border: "1px solid #d1d1d1", borderRadius: 4, background: "#fff", cursor: !hasExistingTask || activeTrackingTaskActionKey ? "not-allowed" : "pointer", opacity: !hasExistingTask || activeTrackingTaskActionKey ? 0.6 : 1 }}
                              >
                                <option value="">{isAssigningTask ? "Assigning..." : "Assign To"}</option>
                                {assignableEmployees.map((employee) => (
                                  <option key={employee.id} value={employee.id}>
                                    {employee.name || employee.email}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => onOpenRelatedEmailFromTrackingTask(row)}
                                disabled={!row.email_id}
                                style={{ fontSize: 12, padding: "6px 10px", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 4, cursor: row.email_id ? "pointer" : "not-allowed", opacity: row.email_id ? 1 : 0.6 }}
                              >
                                Open Related Email
                              </button>
                            </div>
                            {row.source_task_description ? <div style={{ marginTop: 6, color: "#444" }}>{row.source_task_description}</div> : null}
                            {row.ai_summary ? <div style={{ marginTop: 6, padding: "6px 8px", background: "#fafafa", borderRadius: 4, color: "#444" }}>{row.ai_summary}</div> : null}
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="o365-settings-section" style={{ marginTop: 16 }}>
                <h3>Archives ({archives.length})</h3>
                <div className="o365-settings-body">
                  {!archives.length ? <div style={{ fontSize: 12, color: "#666" }}>No archives yet.</div> : archives.map((archive) => (
                    <div key={archive.id} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 12 }}>
                      <strong>{archive.archive_serial}</strong> — {archive.total_emails} emails | {archive.notes ? `"${archive.notes}" | ` : ""}{formatJordanDateTime(archive.archived_at, { month: "short", day: "2-digit", year: "numeric" })} {archive.archived_by_name ? `by ${archive.archived_by_name}` : ""}
                      <div style={{ fontSize: 10, color: "#888" }}>IDs: {archive.email_ids?.join(", ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="o365-settings-section">
          <h3>Access Restricted</h3>
          <div className="o365-settings-body"><p style={{ fontSize: 12, color: "#666" }}>Your role does not allow access to the admin dashboard.</p></div>
        </div>
      )}
    </div>
  );
}
