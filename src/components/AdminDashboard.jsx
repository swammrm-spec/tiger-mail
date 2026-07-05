import dayjs from "dayjs";
import { Download, RefreshCw, UserCog } from "lucide-react";
import ThreadTracker from "./ThreadTracker.jsx";

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
  archives
}) {
  return (
    <div className="o365-admin">
      {canAccessAdmin ? (
        <>
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
            <ThreadTracker apiFetch={apiFetch} />
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
                        <div>Last Reminder: {item.last_reminder_at ? dayjs(item.last_reminder_at).format("MMM D, HH:mm") : "Not sent yet"}</div>
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
                        <span style={{ color: "#888", marginLeft: 8 }}>{row.folder_name} | {row.employee_name ? `Employee ${row.employee_name}` : ""} | {row.serialized ? "Serialized" : ""} | {dayjs(row.received_at).format("MMM D, YYYY h:mm A")}</span>
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
                <h3>Archives ({archives.length})</h3>
                <div className="o365-settings-body">
                  {!archives.length ? <div style={{ fontSize: 12, color: "#666" }}>No archives yet.</div> : archives.map((archive) => (
                    <div key={archive.id} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 12 }}>
                      <strong>{archive.archive_serial}</strong> — {archive.total_emails} emails | {archive.notes ? `"${archive.notes}" | ` : ""}{dayjs(archive.archived_at).format("MMM D, YYYY h:mm A")} {archive.archived_by_name ? `by ${archive.archived_by_name}` : ""}
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
