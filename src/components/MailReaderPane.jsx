import { useState, useMemo } from "react";
import dayjs from "dayjs";
import { Check, Forward, Mail, Reply, ReplyAll, Trash2, X, Calendar, MapPin, Clock, Users, User, Paperclip, Sparkles, ZoomIn, ZoomOut, RotateCcw, AlertTriangle, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { analyzeEmail, getPriorityColor, getCategoryIcon } from "../utils/emailAnalyzer";

export default function MailReaderPane({
  selectedEmail,
  highlightText,
  highlightTerms,
  currentUser,
  selectedVisibleAttachmentCards,
  handleDownloadAllAttachments,
  selectedEmailHtmlDocument,
  readingHtmlFrameRef,
  handleReadingFrameLoad,
  readingHtmlFrameHeight,
  renderPlainEmailBody,
  isManager,
  managerDecisionNotes,
  setManagerDecisionNotes,
  handleApproveEmail,
  handleRejectEmail,
  prepareReplyDraft,
  handleDeleteAction,
  handleMoreAction,
  handleRetryEmail,
  isRetryingEmail,
  handleRecallEmail,
  moveTarget,
  setMoveTarget,
  dataFolders,
  handleMoveEmail,
  isMovingEmail,
  approvalConversationItems,
  getApprovalConversationBadgeClass,
  calendarEvent
}) {
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const zoomIn = () => setZoomLevel(prev => Math.min(prev + 10, 200));
  const zoomOut = () => setZoomLevel(prev => Math.max(prev - 10, 50));
  const zoomReset = () => setZoomLevel(100);

  const handleAnalyze = async () => {
    if (aiAnalysis) { setShowAnalysis(!showAnalysis); return; }
    setIsAnalyzing(true);
    try {
      const token = localStorage.getItem("emailarray_token");
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ email_id: selectedEmail.id }),
      });
      const data = await res.json();
      if (data.analysis) {
        setAiAnalysis(data.analysis);
        setShowAnalysis(true);
      }
    } catch (err) {
      const result = analyzeEmail(selectedEmail);
      setAiAnalysis(result);
      setShowAnalysis(true);
    }
    setIsAnalyzing(false);
  };

  if (!selectedEmail) {
    return <div className="o365-empty">Select an email to read.</div>;
  }

  const senderInitial = (selectedEmail.sender_name?.[0] || selectedEmail.sender_email?.[0] || "?").toUpperCase();

  return (
    <>
      {/* HEADER */}
      <div className="reader-header">
        <div className="reader-header-top">
          <h2 className="reader-subject">{highlightText(selectedEmail.subject, highlightTerms)}</h2>
        </div>

        <div className="reader-meta">
          <div className="reader-sender-row">
            <div className="reader-avatar">{senderInitial}</div>
            <div className="reader-sender-info">
              <div className="reader-sender-name">{highlightText(selectedEmail.sender_name || selectedEmail.sender_email, highlightTerms)}</div>
              <div className="reader-sender-email">{highlightText(selectedEmail.sender_email, highlightTerms)}</div>
            </div>
            <div className="reader-date">
              {dayjs(selectedEmail.sent_at || selectedEmail.received_at).format("ddd, MMM D, YYYY HH:mm")}
            </div>
          </div>

          <div className="reader-recipients">
            <span className="reader-recipient-item"><span className="reader-recipient-label">To:</span> {highlightText(selectedEmail.recipient_email || currentUser?.email || "", highlightTerms)}</span>
            {selectedEmail.cc_list ? <span className="reader-recipient-item"><span className="reader-recipient-label">CC:</span> {highlightText(selectedEmail.cc_list, highlightTerms)}</span> : null}
            {selectedEmail.bcc_list ? <span className="reader-recipient-item"><span className="reader-recipient-label">BCC:</span> {highlightText(selectedEmail.bcc_list, highlightTerms)}</span> : null}
          </div>
        </div>

        {selectedEmail.serial || selectedEmail.approval_status === "pending" || selectedEmail.approval_status === "rejected" || selectedEmail.sensitivity || selectedEmail.priority === "High" || selectedEmail.priority === "Low" || selectedEmail.read_receipt || selectedEmail.delivery_receipt || selectedEmail.recalled ? (
          <div className="reader-badges">
            {selectedEmail.serial ? <span className="reader-badge primary">{selectedEmail.serial}</span> : null}
            {selectedEmail.approval_status === "pending" && selectedEmail.employee_name ? <span className="reader-badge warning">From Employee: {selectedEmail.employee_name} ({selectedEmail.employee_email})</span> : null}
            {selectedEmail.approval_status === "rejected" && selectedEmail.rejection_reason ? <span className="reader-badge danger">Rejection Reason: {selectedEmail.rejection_reason}</span> : null}
            {selectedEmail.sensitivity && selectedEmail.sensitivity !== "Normal" ? <span className="reader-badge sensitive">{selectedEmail.sensitivity}</span> : null}
            {selectedEmail.priority === "High" ? <span className="reader-badge danger">High Priority</span> : null}
            {selectedEmail.priority === "Low" ? <span className="reader-badge muted">Low Priority</span> : null}
            {selectedEmail.read_receipt ? <span className="reader-badge info">Read Receipt</span> : null}
            {selectedEmail.delivery_receipt ? <span className="reader-badge info">Delivery Receipt</span> : null}
            {selectedEmail.recalled ? <span className="reader-badge danger">Recalled</span> : null}
          </div>
        ) : null}
      </div>

      {/* TOOLBAR */}
      <div className="reader-toolbar">
        <div className="reader-toolbar-left">
          {selectedEmail.approval_status === "pending" && isManager ? (
            <>
              <textarea
                className="reader-comment-input"
                rows={1}
                value={managerDecisionNotes[selectedEmail.id] || ""}
                onChange={(e) => setManagerDecisionNotes((prev) => ({ ...prev, [selectedEmail.id]: e.target.value }))}
                placeholder="Manager comments"
              />
              <button className="reader-toolbar-btn approve" onClick={() => handleApproveEmail(selectedEmail.id, managerDecisionNotes[selectedEmail.id] || "")}><Check size={14} /> Approve</button>
              <button className="reader-toolbar-btn reject" onClick={() => handleRejectEmail(selectedEmail.id, managerDecisionNotes[selectedEmail.id] || "")}><X size={14} /> Reject</button>
              <span className="reader-toolbar-separator"></span>
            </>
          ) : null}
          <button className="reader-toolbar-btn" onClick={() => prepareReplyDraft("reply")} title="Reply"><Reply size={14} /> Reply</button>
          <button className="reader-toolbar-btn" onClick={() => prepareReplyDraft("replyAll")} title="Reply All"><ReplyAll size={14} /> Reply all</button>
          <button className="reader-toolbar-btn" onClick={() => prepareReplyDraft("forward")} title="Forward"><Forward size={14} /> Forward</button>
        </div>
        <div className="reader-toolbar-right">
          <span className="reader-toolbar-separator"></span>
          <button className="reader-toolbar-btn" onClick={zoomOut} title="Zoom Out"><ZoomOut size={14} /></button>
          <span className="reader-zoom-label" onClick={zoomReset} title="Reset zoom" style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-secondary-text)", padding: "0 4px", cursor: "pointer", minWidth: 36, textAlign: "center" }}>{zoomLevel}%</span>
          <button className="reader-toolbar-btn" onClick={zoomIn} title="Zoom In"><ZoomIn size={14} /></button>
          <span className="reader-toolbar-separator"></span>
          <button className={`reader-toolbar-btn ${showAnalysis ? "ai-active" : ""}`} onClick={handleAnalyze} disabled={isAnalyzing} title="AI Email Analysis">
            {isAnalyzing ? <span className="ai-spinner"></span> : <Sparkles size={14} />}
            {showAnalysis ? "Hide AI" : "AI Assist"}
          </button>
          <button className="reader-toolbar-btn" onClick={() => handleDeleteAction([selectedEmail.id])} title="Delete"><Trash2 size={14} /> Trash</button>
          {selectedEmail.folder_name === "Outbox" ? <button className="reader-toolbar-btn retry" onClick={handleRetryEmail} disabled={isRetryingEmail}>{isRetryingEmail ? "..." : "Retry"}</button> : null}
          {(selectedEmail.folder_name === "Sent" || selectedEmail.folder_name === "Outbox") && !selectedEmail.recalled ? <button className="reader-toolbar-btn recall" onClick={handleRecallEmail}>Recall</button> : null}
        </div>
      </div>

      {/* AI ANALYSIS CARD */}
      {showAnalysis && aiAnalysis && (
        <div className="ai-analysis-card">
          <div className="ai-analysis-header">
            <div className="ai-analysis-title">
              <Sparkles size={16} />
              <span>AI Email Analysis</span>
            </div>
            <button className="ai-analysis-close" onClick={() => setShowAnalysis(false)}><X size={14} /></button>
          </div>
          <div className="ai-analysis-body">
            <div className="ai-analysis-grid">
              <div className="ai-field">
                <span className="ai-field-label">Category</span>
                <span className="ai-field-value">{getCategoryIcon(aiAnalysis.email_category)} {aiAnalysis.email_category}</span>
              </div>
              <div className="ai-field">
                <span className="ai-field-label">Priority</span>
                <span className="ai-priority-badge" style={{ background: getPriorityColor(aiAnalysis.priority) + "18", color: getPriorityColor(aiAnalysis.priority) }}>
                  {aiAnalysis.priority === "High" ? "🔴" : aiAnalysis.priority === "Medium" ? "🟡" : "🟢"} {aiAnalysis.priority}
                </span>
              </div>
              {aiAnalysis.project_id && (
                <div className="ai-field">
                  <span className="ai-field-label">Project ID</span>
                  <span className="ai-field-value ai-project-id">{aiAnalysis.project_id}</span>
                </div>
              )}
              <div className="ai-field">
                <span className="ai-field-label">From</span>
                <span className="ai-field-value">{aiAnalysis.sender_email}</span>
              </div>
              <div className="ai-field">
                <span className="ai-field-label">To</span>
                <span className="ai-field-value">{aiAnalysis.receiver_email}</span>
              </div>
            </div>
            <div className="ai-summary">
              <span className="ai-field-label">Summary</span>
              <p>{aiAnalysis.summary}</p>
            </div>
            {aiAnalysis.ai_tasks.length > 0 && (
              <div className="ai-tasks">
                <span className="ai-field-label"><FileText size={13} /> Extracted Tasks ({aiAnalysis.ai_tasks.length})</span>
                {aiAnalysis.ai_tasks.map((task, i) => (
                  <div key={i} className="ai-task-item">
                    <div className="ai-task-check"><Check size={12} /></div>
                    <div className="ai-task-content">
                      <span className="ai-task-desc">{task.task_description}</span>
                      {task.due_date && <span className="ai-task-due">Due: {task.due_date}</span>}
                      {task.assigned_to_name || task.assigned_to_email || task.assigned_department ? (
                        <span className="ai-task-due">
                          Assigned: {task.assigned_to_name || task.assigned_to_email || task.assigned_department}
                        </span>
                      ) : null}
                      {Array.isArray(task.checklist) && task.checklist.length ? (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#666" }}>
                          {task.checklist.map((item, checklistIndex) => (
                            <div key={`${i}-${checklistIndex}`}>- {item}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CALENDAR EVENT */}
      {calendarEvent ? (
        <div className="reader-calendar-card">
          <div className="reader-calendar-header">
            <Calendar size={16} />
            <span className="reader-calendar-title">Meeting Invitation</span>
            {calendarEvent.status ? (
              <span className={`reader-calendar-status ${calendarEvent.status.toLowerCase()}`}>{calendarEvent.status}</span>
            ) : null}
          </div>
          <div className="reader-calendar-grid">
            <div className="reader-calendar-row">
              <div className="reader-calendar-icon"><Calendar size={13} /></div>
              <div className="reader-calendar-content">
                <div className="reader-calendar-label">Starts</div>
                <div className="reader-calendar-value">{calendarEvent.start || "Not specified"}</div>
              </div>
            </div>
            <div className="reader-calendar-row">
              <div className="reader-calendar-icon"><Clock size={13} /></div>
              <div className="reader-calendar-content">
                <div className="reader-calendar-label">Ends</div>
                <div className="reader-calendar-value">{calendarEvent.end || "Not specified"}</div>
              </div>
            </div>
            {calendarEvent.location ? (
              <div className="reader-calendar-row">
                <div className="reader-calendar-icon"><MapPin size={13} /></div>
                <div className="reader-calendar-content">
                  <div className="reader-calendar-label">Location</div>
                  <div className="reader-calendar-value">{calendarEvent.location}</div>
                </div>
              </div>
            ) : null}
            {calendarEvent.organizer ? (
              <div className="reader-calendar-row">
                <div className="reader-calendar-icon"><User size={13} /></div>
                <div className="reader-calendar-content">
                  <div className="reader-calendar-label">Organizer</div>
                  <div className="reader-calendar-value">{calendarEvent.organizer}</div>
                </div>
              </div>
            ) : null}
            {calendarEvent.attendees.length > 0 ? (
              <div className="reader-calendar-row">
                <div className="reader-calendar-icon"><Users size={13} /></div>
                <div className="reader-calendar-content">
                  <div className="reader-calendar-label">Attendees ({calendarEvent.attendees.length})</div>
                  <div className="reader-calendar-attendees">
                    {calendarEvent.attendees.map((att, i) => (
                      <span key={i} className={`reader-calendar-attendee ${att.role === "OPT-PARTICIPANT" ? "optional" : ""}`}>
                        {att.name}
                        {att.role === "OPT-PARTICIPANT" ? " (Optional)" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {calendarEvent.description && calendarEvent.description.trim() ? (
              <div className="reader-calendar-row">
                <div className="reader-calendar-icon"><Paperclip size={13} /></div>
                <div className="reader-calendar-content">
                  <div className="reader-calendar-label">Description</div>
                  <div className="reader-calendar-value desc">{calendarEvent.description}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ATTACHMENTS */}
      {selectedVisibleAttachmentCards.length ? (
        <div className="reader-attachments">
          <div className="reader-attachments-header">
            <div className="reader-attachments-title">
              <Paperclip size={14} />
              <span>{selectedVisibleAttachmentCards.length} Attachment{selectedVisibleAttachmentCards.length > 1 ? "s" : ""}</span>
            </div>
            <button className="reader-download-all" onClick={handleDownloadAllAttachments}>Download All</button>
          </div>
          <div className="reader-attachments-grid">
            {selectedVisibleAttachmentCards.map((att) => {
              const previewMeta = att.previewMeta;
              const isImage = previewMeta.kind === "image";
              return (
                <div key={att.id} className="reader-attachment-card">
                  <a href={att.file_path} target="_blank" rel="noopener noreferrer" className="reader-attachment-link">
                    {isImage ? (
                      <div className="reader-attachment-preview img">
                        <img src={att.file_path} alt={att.file_name} loading="lazy" />
                      </div>
                    ) : (
                      <div className="reader-attachment-preview" style={{ background: previewMeta.bg, color: previewMeta.accent }}>
                        <div className="reader-attachment-ext">{previewMeta.label}</div>
                      </div>
                    )}
                    <div className="reader-attachment-info">
                      <div className="reader-attachment-name">{att.file_name}</div>
                      <div className="reader-attachment-size">{att.sizeLabel}</div>
                    </div>
                  </a>
                  <div className="reader-attachment-actions">
                    <a href={att.file_path} target="_blank" rel="noopener noreferrer">Open</a>
                    <a href={att.file_path} download={att.file_name}>Download</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* BODY */}
      {selectedEmailHtmlDocument ? (
        <div className="reader-body html" style={{ overflow: "auto" }}>
          <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left", width: `${10000 / zoomLevel}%` }}>
            <iframe
              ref={readingHtmlFrameRef}
              title={`email-${selectedEmail.id}`}
              srcDoc={selectedEmailHtmlDocument}
              onLoad={handleReadingFrameLoad}
              sandbox="allow-same-origin"
              style={{ width: "100%", height: readingHtmlFrameHeight, border: "none", background: "#fff" }}
            />
          </div>
        </div>
      ) : (
        <div className="reader-body text" style={{ fontSize: `${14 * (zoomLevel / 100)}px` }}>{renderPlainEmailBody(selectedEmail.body || selectedEmail.preview || "", highlightTerms)}</div>
      )}

      {/* APPROVAL GUIDANCE */}
      {(selectedEmail.manager_comments || selectedEmail.ai_recommendations) ? (
        <div className="reader-approval-guidance">
          <div className="reader-approval-guidance-title">Approval Guidance</div>
          {selectedEmail.manager_comments ? <div className="reader-approval-guidance-text"><strong>Manager Comments:</strong> {selectedEmail.manager_comments}</div> : null}
          {selectedEmail.ai_recommendations ? <div className="reader-approval-guidance-text"><strong>AI Recommendations:</strong> {selectedEmail.ai_recommendations}</div> : null}
        </div>
      ) : null}

      {/* APPROVAL CONVERSATION */}
      {(selectedEmail.approval_status && selectedEmail.approval_status !== "none") ? (
        <div className="reader-approval-thread">
          <div className="reader-approval-thread-title">Approval Conversation</div>
          {approvalConversationItems.length ? (
            <div className="reader-approval-timeline">
              {approvalConversationItems.map((item) => (
                <div key={item.id} className={`reader-approval-item ${item.lane}`}>
                  <div className={`reader-approval-dot ${getApprovalConversationBadgeClass(item.lane)}`}></div>
                  <div className="reader-approval-card">
                    <div className="reader-approval-card-head">
                      <strong>{item.actorLabel}</strong>
                      <span className={`reader-approval-badge ${getApprovalConversationBadgeClass(item.lane)}`}>{item.summary}</span>
                      <span className="reader-approval-date">{dayjs(item.created_at).format("ddd MM/DD HH:mm")}</span>
                    </div>
                    <div className="reader-approval-meta">
                      {item.action_type} | {item.serial_id} | REV{String(item.version_number || 1).padStart(2, "0")}
                    </div>
                    {item.snapshot_subject ? <div className="reader-approval-subject">{item.snapshot_subject}</div> : null}
                    {item.previewText ? <div className="reader-approval-body">{item.previewText}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="reader-approval-empty">Open the dedicated history drawer to review the full serialized workflow.</div>
          )}
        </div>
      ) : null}
    </>
  );
}
