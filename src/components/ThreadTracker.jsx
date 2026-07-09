import { useState } from "react";
import { Search, ChevronRight, ChevronDown, Mail, Users, Clock, BarChart3, ArrowLeft, Filter } from "lucide-react";
import { formatJordanDateTime } from "../utils/timezone.js";

function formatDate(d) {
  if (!d) return "";
  return formatJordanDateTime(d, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function highlightText(text, query) {
  if (!text || !query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.replace(regex, '<mark style="background:#fff3cd;padding:0 2px;border-radius:2px">$1</mark>');
}

export default function ThreadTracker({ apiFetch }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadAnalytics, setThreadAnalytics] = useState(null);
  const [expandedEmails, setExpandedEmails] = useState(new Set());
  const [filterParticipant, setFilterParticipant] = useState("");
  const [viewMode, setViewMode] = useState("tree");

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const r = await apiFetch(`/api/admin/thread-tracker/search?q=${encodeURIComponent(searchQuery)}&limit=50`);
      setSearchResults(r.results || []);
      setSelectedThread(null);
      setThreadAnalytics(null);
    } catch (e) {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSelectThread(serial) {
    try {
      const [threadRes, analyticsRes] = await Promise.all([
        apiFetch(`/api/admin/thread-tracker/thread/${encodeURIComponent(serial)}`),
        apiFetch(`/api/admin/thread-tracker/analyze/${encodeURIComponent(serial)}`)
      ]);
      setSelectedThread(threadRes.thread);
      setThreadAnalytics(analyticsRes.analytics);
      setExpandedEmails(new Set());
    } catch (e) {
      console.error("Failed to load thread:", e);
    }
  }

  function toggleEmailExpand(id) {
    setExpandedEmails(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    if (selectedThread) setExpandedEmails(new Set(selectedThread.emails.map(e => e.id)));
  }

  function collapseAll() {
    setExpandedEmails(new Set());
  }

  if (selectedThread) {
    const thread = selectedThread;
    const analytics = threadAnalytics;
    const filteredEmails = filterParticipant
      ? thread.emails.filter(e => e.sender_email === filterParticipant)
      : thread.emails;

    return (
      <div style={{ padding: 0 }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #e1e1e1", background: "#f8f9fa", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => { setSelectedThread(null); setThreadAnalytics(null); setFilterParticipant(""); }} style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <ArrowLeft size={14} /> Back
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a" }}>{thread.subject}</div>
            <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, marginTop: 2 }}>
              {thread.key_code && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: thread.key_color || "#1a237e" }} />
                  [{thread.key_code}] {thread.key_name}
                </span>
              )}
              {thread.project_code && <span>Project: {thread.project_code}</span>}
              <span>Serial: {thread.serial}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setViewMode("tree")} style={{ padding: "4px 10px", fontSize: 11, background: viewMode === "tree" ? "var(--c-primary)" : "#e9ecef", color: viewMode === "tree" ? "#fff" : "#333", border: "none", borderRadius: 4, cursor: "pointer" }}>Tree</button>
            <button onClick={() => setViewMode("timeline")} style={{ padding: "4px 10px", fontSize: 11, background: viewMode === "timeline" ? "var(--c-primary)" : "#e9ecef", color: viewMode === "timeline" ? "#fff" : "#333", border: "none", borderRadius: 4, cursor: "pointer" }}>Timeline</button>
          </div>
        </div>

        <div style={{ display: "flex", height: "calc(100vh - 200px)" }}>
          {/* Left: Thread Tree / Timeline */}
          <div style={{ flex: 2, overflowY: "auto", borderRight: "1px solid #e1e1e1", padding: 16 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button onClick={expandAll} style={{ padding: "3px 10px", fontSize: 11, background: "#e9ecef", border: "none", borderRadius: 4, cursor: "pointer" }}>Expand All</button>
              <button onClick={collapseAll} style={{ padding: "3px 10px", fontSize: 11, background: "#e9ecef", border: "none", borderRadius: 4, cursor: "pointer" }}>Collapse All</button>
            </div>

            {viewMode === "tree" ? (
              <div style={{ position: "relative" }}>
                {/* Timeline line */}
                <div style={{ position: "absolute", left: 19, top: 0, bottom: 0, width: 2, background: "#e0e0e0" }} />

                {filteredEmails.map((email, idx) => {
                  const isExpanded = expandedEmails.has(email.id);
                  const depth = email.thread_depth || 0;
                  const isOriginal = idx === 0;
                  const isReply = email.parent_id || email.approval_root_id;
                  const statusColor = email.approval_status === "approved" ? "#107c10" : email.approval_status === "rejected" ? "#d13438" : email.approval_status === "pending" ? "#ff8c00" : "#999";
                  return (
                    <div key={email.id} style={{ position: "relative", paddingLeft: 30 + depth * 20, marginBottom: 8 }}>
                      {/* Node dot */}
                      <div style={{
                        position: "absolute", left: 14, top: 12, width: 12, height: 12,
                        borderRadius: "50%", background: isOriginal ? "var(--c-primary)" : isReply ? "#107c10" : "#666",
                        border: "2px solid #fff", boxShadow: "0 0 0 1px #e0e0e0", zIndex: 1
                      }} />

                      <div
                        onClick={() => toggleEmailExpand(email.id)}
                        style={{
                          background: isExpanded ? "#f0f4ff" : "#fff",
                          border: "1px solid #e1e1e1",
                          borderRadius: 8,
                          cursor: "pointer",
                          transition: "all 0.15s"
                        }}
                      >
                        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                          {isExpanded ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {email.subject}
                            </div>
                            <div style={{ fontSize: 11, color: "#666", display: "flex", gap: 8, marginTop: 2 }}>
                              <span>{email.sender_name || email.sender_email}</span>
                              <span>{formatDate(email.received_at)}</span>
                              {email.priority === "High" && <span style={{ color: "#d13438", fontWeight: 600 }}>HIGH</span>}
                            </div>
                          </div>
                          {email.approval_status && (
                            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: statusColor, color: "#fff", fontWeight: 500 }}>
                              {email.approval_status}
                            </span>
                          )}
                          {email.version_number > 1 && (
                            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: "#e9ecef", color: "#333" }}>
                              v{email.version_number}
                            </span>
                          )}
                        </div>

                        {isExpanded && (
                          <div style={{ padding: "0 14px 12px 14px", borderTop: "1px solid #f0f0f0", fontSize: 12, color: "#333" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "4px 8px", marginTop: 8 }}>
                              <span style={{ color: "#888", fontWeight: 500 }}>From:</span>
                              <span>{email.sender_name} &lt;{email.sender_email}&gt;</span>
                              <span style={{ color: "#888", fontWeight: 500 }}>To:</span>
                              <span>{email.recipient_email || "-"}</span>
                              <span style={{ color: "#888", fontWeight: 500 }}>Date:</span>
                              <span>{formatDate(email.received_at)}</span>
                              <span style={{ color: "#888", fontWeight: 500 }}>Folder:</span>
                              <span>{email.folder_name}</span>
                              {email.employee_name && (
                                <>
                                  <span style={{ color: "#888", fontWeight: 500 }}>Owner:</span>
                                  <span>{email.employee_name}</span>
                                </>
                              )}
                            </div>
                            {email.body_text && (
                              <div style={{ marginTop: 8, padding: 10, background: "#f8f9fa", borderRadius: 6, fontSize: 11, color: "#555", whiteSpace: "pre-wrap", maxHeight: 150, overflowY: "auto", lineHeight: 1.5 }}>
                                {email.body_text.substring(0, 400)}
                                {email.body_text.length > 400 ? "..." : ""}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Timeline View */
              <div style={{ position: "relative", paddingLeft: 20 }}>
                <div style={{ position: "absolute", left: 9, top: 0, bottom: 0, width: 2, background: "linear-gradient(180deg, var(--c-primary), #107c10)" }} />
                {filteredEmails.map((email, idx) => {
                  const prevDate = idx > 0 ? new Date(filteredEmails[idx - 1].received_at) : null;
                  const currDate = new Date(email.received_at);
                  const gapHours = prevDate ? (currDate - prevDate) / 3600000 : 0;
                  return (
                    <div key={email.id}>
                      {gapHours > 24 && (
                        <div style={{ padding: "4px 0 4px 20px", fontSize: 10, color: "#999", fontStyle: "italic" }}>
                          +{Math.round(gapHours / 24)} day(s) gap
                        </div>
                      )}
                      <div style={{ position: "relative", paddingLeft: 16, marginBottom: 6 }}>
                        <div style={{
                          position: "absolute", left: -2, top: 10, width: 10, height: 10,
                          borderRadius: "50%", background: idx === 0 ? "var(--c-primary)" : "#107c10",
                          border: "2px solid #fff", boxShadow: "0 0 0 1px #e0e0e0", zIndex: 1
                        }} />
                        <div style={{ fontSize: 11, color: "#888" }}>{formatDate(email.received_at)}</div>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{email.sender_name || email.sender_email}</div>
                        <div style={{ fontSize: 11, color: "#555" }}>{email.subject}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Analytics & Participants Panel */}
          <div style={{ width: 320, overflowY: "auto", padding: 16, background: "#f8f9fa" }}>
            {/* Stats */}
            {analytics && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                  <BarChart3 size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Thread Statistics
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Messages", value: analytics.total, color: "#1a237e" },
                    { label: "Participants", value: analytics.participants.length, color: "#107c10" },
                    { label: "Folders", value: analytics.folders.length, color: "#666" },
                    { label: "High Priority", value: analytics.priorities.high, color: "#d13438" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#fff", borderRadius: 6, padding: "8px 10px", border: "1px solid #e1e1e1" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Participants */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                <Users size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Participants
              </h4>
              <div
                onClick={() => setFilterParticipant("")}
                style={{
                  padding: "6px 10px", fontSize: 12, background: !filterParticipant ? "var(--c-primary)" : "#fff",
                  color: !filterParticipant ? "#fff" : "#333", border: "1px solid #e1e1e1", borderRadius: 4,
                  cursor: "pointer", marginBottom: 4, fontWeight: !filterParticipant ? 600 : 400
                }}
              >
                All ({analytics?.total || 0})
              </div>
              {(analytics?.participants || []).map(p => (
                <div
                  key={p.email}
                  onClick={() => setFilterParticipant(p.email === filterParticipant ? "" : p.email)}
                  style={{
                    padding: "6px 10px", fontSize: 12, background: filterParticipant === p.email ? "var(--c-primary)" : "#fff",
                    color: filterParticipant === p.email ? "#fff" : "#333",
                    border: "1px solid #e1e1e1", borderRadius: 4, cursor: "pointer", marginBottom: 4,
                    display: "flex", justifyContent: "space-between", fontWeight: filterParticipant === p.email ? 600 : 400
                  }}
                >
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name || p.email}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.7, flexShrink: 0, marginLeft: 4 }}>
                    S:{p.sent} R:{p.received}
                  </span>
                </div>
              ))}
            </div>

            {/* Folders */}
            {analytics && (
              <div>
                <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                  <Mail size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Folders
                </h4>
                {analytics.folders.map(f => (
                  <div key={f} style={{ padding: "4px 10px", fontSize: 12, color: "#555", borderBottom: "1px solid #f0f0f0" }}>
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e1e1e1", background: "#f8f9fa" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
          <Search size={16} style={{ verticalAlign: "middle", marginRight: 6 }} /> Thread Tracker & Email Report
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by subject, serial, sender, participant, or message content..."
            style={{ flex: 1, padding: "8px 12px", fontSize: 13, border: "1px solid #d1d1d1", borderRadius: 4, boxSizing: "border-box" }}
          />
          <button
            disabled={isSearching || !searchQuery.trim()}
            onClick={handleSearch}
            style={{
              padding: "8px 20px", fontSize: 13, fontWeight: 500,
              background: "var(--c-primary)", color: "#fff", border: "none",
              borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", gap: 6
            }}
          >
            <Search size={14} /> {isSearching ? "Searching..." : "Search"}
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#888" }}>
          Search across all emails: subject, serial number, sender/recipient, body content. Click a result to view the full thread tree with participants and analytics.
        </div>
      </div>

      <div style={{ padding: 18, maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
        {searchResults.length === 0 && !isSearching && (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
            <Search size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 13 }}>Enter a search query to find email threads and correspondence</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Search by subject, serial number (e.g. TECH-20260705-0001), sender email, or any keyword in the message body</div>
          </div>
        )}

        {isSearching && (
          <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
            <div style={{ fontSize: 13 }}>Searching...</div>
          </div>
        )}

        {searchResults.length > 0 && !isSearching && (
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
              Found {searchResults.length} thread(s)
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {searchResults.map(thread => (
                <div
                  key={thread.id}
                  onClick={() => handleSelectThread(thread.serial)}
                  style={{
                    background: "#fff", border: "1px solid #e1e1e1", borderRadius: 8,
                    padding: "12px 16px", cursor: "pointer", transition: "all 0.15s"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-primary)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e1e1e1"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
                        {thread.subject}
                      </div>
                      <div style={{ fontSize: 11, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {thread.key_code && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: thread.key_color || "#1a237e" }} />
                            [{thread.key_code}]
                          </span>
                        )}
                        {thread.project_code && <span>Project: {thread.project_code}</span>}
                        <span>Serial: {thread.serial}</span>
                        <span>By: {thread.sender_name || thread.sender_email}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--c-primary)" }}>{thread.message_count}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>messages</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
                        {thread.participants?.filter(Boolean).length || 0} participants
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(thread.participants || []).filter(Boolean).slice(0, 5).map(p => (
                      <span key={p} style={{ fontSize: 10, padding: "2px 6px", background: "#f0f0f0", borderRadius: 10, color: "#555" }}>
                        {p}
                      </span>
                    ))}
                    {(thread.participants || []).filter(Boolean).length > 5 && (
                      <span style={{ fontSize: 10, padding: "2px 6px", background: "#f0f0f0", borderRadius: 10, color: "#555" }}>
                        +{(thread.participants || []).filter(Boolean).length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
