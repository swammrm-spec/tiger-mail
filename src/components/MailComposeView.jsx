import { useState } from "react";
import dayjs from "dayjs";
import { Archive, Paperclip, Send, X } from "lucide-react";

export default function MailComposeView({
  isSendingEmail,
  handleSendEmail,
  isSubmitting,
  canArchive,
  setCurrentView,
  form,
  setForm,
  sensitivityOpts,
  files,
  setFiles,
  showBcc,
  setShowBcc,
  requiresManagerApproval,
  currentUser,
  composeSourceEmail,
  composeAiRecommendations,
  handleSubmit,
  showFrom,
  renderChipEmailInput,
  toInputRef,
  ccInputRef,
  bccInputRef,
  revisionMatchedBlockCount,
  composeReviewScroll,
  revisionPhrases,
  renderInlineReviewOverlay,
  composeTextareaRef,
  handleComposeBodyScroll,
  highlightedRevisionBlocks,
  highlightReviewPhrases,
  displayedApprovalHistory,
  isLoadingApprovalHistory,
  approvalConversationItems,
  getApprovalConversationBadgeClass,
  emailAccounts = [],
  activeAccountId,
  setActiveAccountId,
  emailKeys = [],
  projects = []
}) {
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const activeAccount = emailAccounts.find(a => a.id === activeAccountId) || emailAccounts[0];
  const selectedKey = emailKeys.find(k => k.id === Number(form.email_key_id));
  return (
    <div className="o365-compose">
      <div className="o365-compose-ribbon">
        <div className="o365-ribbon-group">
          <button type="button" className="o365-ribbon-btn o365-ribbon-primary" disabled={isSendingEmail} onClick={handleSendEmail} style={{ minWidth: 60 }}>
            <Send size={20} /><span className="o365-ribbon-btn-label">{isSendingEmail ? "Sending..." : "Send"}</span>
          </button>
          <button className="o365-ribbon-btn" type="submit" form="compose-form" disabled={isSubmitting || !canArchive}>
            <Archive size={20} /><span className="o365-ribbon-btn-label">{isSubmitting ? "Saving..." : "Save"}</span>
          </button>
          <button className="o365-ribbon-btn" onClick={() => setCurrentView("mail")}>
            <X size={20} /><span className="o365-ribbon-btn-label">Cancel</span>
          </button>
        </div>
        <div className="o365-ribbon-group">
          {emailAccounts.length > 1 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555" }}>
              From: <select value={activeAccountId || ""} onChange={(e) => setActiveAccountId(Number(e.target.value))} style={{ width: 180, padding: "2px 4px", fontSize: 11 }}>
                {emailAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.display_name || acc.email_address}</option>
                ))}
              </select>
            </label>
          ) : activeAccount ? (
            <span style={{ fontSize: 11, color: "#555" }}>From: <strong>{activeAccount.display_name || activeAccount.email_address}</strong></span>
          ) : null}
        </div>
        <div className="o365-ribbon-group">
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555" }}>
            Priority: <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={{ width: 80, padding: "2px 4px", fontSize: 11 }}>
              <option>Low</option><option>Normal</option><option>High</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555" }}>
            Sensitivity: <select value={form.sensitivity} onChange={(e) => setForm({ ...form, sensitivity: e.target.value })} style={{ width: 90, padding: "2px 4px", fontSize: 11 }}>
              {sensitivityOpts.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <div className="o365-ribbon-group">
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555", cursor: "pointer" }}>
            <input type="checkbox" checked={form.read_receipt} onChange={(e) => setForm({ ...form, read_receipt: e.target.checked })} style={{ width: 12, height: 12 }} /> Read receipt
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555", cursor: "pointer" }}>
            <input type="checkbox" checked={form.delivery_receipt} onChange={(e) => setForm({ ...form, delivery_receipt: e.target.checked })} style={{ width: 12, height: 12 }} /> Delivery receipt
          </label>
        </div>
        <div className="o365-ribbon-group">
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: "#555" }}>
            <Paperclip size={16} /> Attach
            <input type="file" multiple disabled={!canArchive} onChange={(e) => setFiles(Array.from(e.target.files || []))} style={{ display: "none" }} />
          </label>
          <span style={{ fontSize: 10, color: "#888" }}>{files.length ? `${files.length} file(s)` : ""}</span>
        </div>
        <div className="o365-ribbon-group">
          <label style={{ display: "flex", alignItems: "center", gap: 2, cursor: "pointer", fontSize: 11, color: "#555" }}>
            <input type="checkbox" checked={showBcc} onChange={(e) => setShowBcc(e.target.checked)} style={{ width: 12, height: 12 }} /> Bcc
          </label>
        </div>
      </div>
      {!canArchive ? <div className="o365-error" style={{ margin: 8 }}>Your role does not allow archiving new emails.</div> : null}
      {requiresManagerApproval ? (
        <div className={`o365-compose-banner ${currentUser?.manager_id ? "ai" : "rejected"}`}>
          <div className="o365-compose-banner-title">Approval Routing</div>
          <div>
            {currentUser?.manager_id
              ? "The approval manager is assigned by the admin. You only enter the final recipient and the message content."
              : "No approval manager is assigned to your account yet. The admin must assign a direct manager before this email can be submitted for approval."}
          </div>
        </div>
      ) : null}
      {composeSourceEmail ? (
        <div className="o365-compose-banner rejected">
          <div className="o365-compose-banner-title">Revision Required</div>
          <div>Serial: <strong>{composeSourceEmail.serial}</strong> | Version: <strong>REV{String(composeSourceEmail.version_number || 1).padStart(2, "0")}</strong></div>
          <div style={{ marginTop: 4 }}>Manager Comments: <strong>{form.manager_comments || "No comments were supplied."}</strong></div>
        </div>
      ) : null}
      {composeAiRecommendations.length ? (
        <div className="o365-compose-banner ai">
          <div className="o365-compose-banner-title">AI Draft Guidance</div>
          <ul className="o365-compose-guidance-list">
            {composeAiRecommendations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      <form id="compose-form" onSubmit={handleSubmit} onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) e.preventDefault(); }} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div className="o365-compose-fields">
          {showFrom ? (
            <div className="o365-compose-field">
              <span className="field-label">From</span>
              <div className="field-input">
                <input value={form.sender_name} onChange={(e) => setForm({ ...form, sender_name: e.target.value })} placeholder="Sender name" />
                <span style={{ color: "#ccc" }}>&lt;</span>
                <input type="email" value={form.sender_email} onChange={(e) => setForm({ ...form, sender_email: e.target.value })} placeholder="email" />
                <span style={{ color: "#ccc" }}>&gt;</span>
              </div>
            </div>
          ) : null}
          <div className="o365-compose-field">
            <span className="field-label">To</span>
            {renderChipEmailInput("recipient_email", "Type email and press Enter or comma", toInputRef)}
          </div>
          <div className="o365-compose-field">
            <span className="field-label">Cc</span>
            {renderChipEmailInput("cc_list", "Cc recipients", ccInputRef)}
          </div>
          {showBcc ? (
            <div className="o365-compose-field">
              <span className="field-label">Bcc</span>
              {renderChipEmailInput("bcc_list", "Bcc recipients", bccInputRef)}
            </div>
          ) : null}
          <div className="o365-compose-field" style={{ borderBottom: "none" }}>
            <span className="field-label">Subject</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowKeyDropdown(!showKeyDropdown)}
                  style={{
                    width: 150, padding: "4px 8px", fontSize: 12, borderRadius: 4,
                    border: "1px solid #ccc", background: "#fff", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6, textAlign: "left"
                  }}
                >
                  {selectedKey ? (
                    <>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: selectedKey.color || "#1a237e", flexShrink: 0 }} />
                      <span>[{selectedKey.key_code}] {selectedKey.key_name}</span>
                    </>
                  ) : (
                    <span style={{ color: "#888" }}>Key (optional)</span>
                  )}
                </button>
                {showKeyDropdown && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setShowKeyDropdown(false)} />
                    <div style={{
                      position: "absolute", top: "100%", left: 0, zIndex: 1000,
                      background: "#fff", border: "1px solid #d1d1d1", borderRadius: 6,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.15)", maxHeight: 280, overflowY: "auto",
                      minWidth: 200, padding: 4
                    }}>
                      <div
                        onClick={() => { setForm({ ...form, email_key_id: "" }); setShowKeyDropdown(false); }}
                        style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, color: "#888" }}
                      >
                        No key
                      </div>
                      {emailKeys.map(k => (
                        <div
                          key={k.id}
                          onClick={() => { setForm({ ...form, email_key_id: k.id }); setShowKeyDropdown(false); }}
                          style={{
                            padding: "6px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4,
                            display: "flex", alignItems: "center", gap: 8,
                            background: Number(form.email_key_id) === k.id ? "#e8f0fe" : "transparent"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f0f0f0"}
                          onMouseLeave={(e) => e.currentTarget.style.background = Number(form.email_key_id) === k.id ? "#e8f0fe" : "transparent"}
                        >
                          <span style={{ width: 12, height: 12, borderRadius: "50%", background: k.color || "#1a237e", flexShrink: 0 }} />
                          <span style={{ fontWeight: 600 }}>[{k.key_code}]</span>
                          <span style={{ color: "#555" }}>{k.key_name}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <select
                value={form.project_id}
                onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                style={{ width: 180, padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
              >
                <option value="">Project (optional)</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>[{p.project_code}] {p.project_name}</option>
                ))}
              </select>
            </div>
            <div className="field-input">
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject" required />
            </div>
            <span style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
              {form.email_key_id && form.subject
                ? `Will be sent as: ${emailKeys.find(k => k.id === Number(form.email_key_id))?.key_code || ""}:${String(new Date().getFullYear()).slice(-2)}/${form.subject}`
                : "Select Key to auto-format subject"}
            </span>
          </div>
        </div>
        <div className={`o365-compose-body-shell ${composeSourceEmail ? "with-review" : ""}`}>
          <div className={`o365-compose-editor-stage ${composeSourceEmail ? "with-review" : ""}`}>
            {composeSourceEmail ? (
              <div className="o365-compose-inline-summary">
                <strong>Inline Review Overlay</strong>
                <span>
                  {revisionMatchedBlockCount
                    ? `${revisionMatchedBlockCount} paragraph(s) still match manager feedback.`
                    : "No exact keyword matches detected right now. Keep revising against manager comments."}
                </span>
              </div>
            ) : null}
            <div className={`o365-compose-editor-stack ${composeSourceEmail ? "with-review" : ""}`}>
              {composeSourceEmail ? (
                <div
                  className="o365-compose-inline-overlay"
                  aria-hidden="true"
                  style={{ transform: `translate(${-composeReviewScroll.left}px, ${-composeReviewScroll.top}px)` }}
                >
                  {renderInlineReviewOverlay(form.body, revisionPhrases)}
                </div>
              ) : null}
              <textarea
                ref={composeTextareaRef}
                className={`o365-compose-body ${composeSourceEmail ? "with-inline-review" : ""}`}
                rows={12}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                onScroll={composeSourceEmail ? handleComposeBodyScroll : undefined}
                placeholder="Type your message here"
              />
              {activeAccount?.signature_text ? (
                <div className="o365-compose-signature" style={{ borderTop: "1px solid #e0e0e0", padding: "10px 12px", marginTop: 8, fontSize: 12, color: "#555", background: "#fafafa", borderRadius: "0 0 6px 6px" }}>
                  <div style={{ fontSize: 10, color: "#999", marginBottom: 4 }}>Signature ({activeAccount.display_name || activeAccount.email_address})</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{activeAccount.signature_text}</div>
                </div>
              ) : null}
            </div>
            {composeSourceEmail ? (
              <div className="o365-compose-inline-insights">
                <div className="o365-compose-inline-chip-row">
                  {revisionPhrases.length
                    ? revisionPhrases.map((phrase) => (
                      <span key={phrase} className="o365-compose-inline-chip">{phrase}</span>
                    ))
                    : <span className="o365-compose-inline-empty">No extracted feedback phrases yet.</span>}
                </div>
                <div className="o365-compose-review-list compact">
                  {highlightedRevisionBlocks.length ? highlightedRevisionBlocks.slice(0, 3).map((block, index) => (
                    <div key={`${index}-${block.text.slice(0, 20)}`} className={`o365-compose-review-block ${block.isRejected ? "rejected" : ""}`}>
                      <div className="o365-compose-review-block-title">
                        Paragraph {index + 1}
                        {block.isRejected ? <span>Needs Attention</span> : <span>Reviewed</span>}
                      </div>
                      {block.matches.length ? <div className="o365-compose-review-keywords">Matched phrases: {block.matches.join(" | ")}</div> : null}
                      <div>{highlightReviewPhrases(block.text, block.matches)}</div>
                    </div>
                  )) : <div className="o365-compose-review-empty">Start revising the message body to see highlighted draft sections.</div>}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {files.length ? (
          <div style={{ padding: "8px 16px", borderTop: "1px solid #e1e1e1", background: "#fafafa" }}>
            <strong style={{ fontSize: 11, color: "#666" }}>Attachments ({files.length}):</strong>
            <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
              {files.map((file, index) => (
                <span key={index} style={{ fontSize: 11, padding: "2px 8px", background: "#e1e1e1", borderRadius: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  {file.name} <button type="button" style={{ background: "transparent", border: "none", padding: 0, fontSize: 14, cursor: "pointer", color: "#666" }}
                    onClick={() => setFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>&times;</button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {(composeSourceEmail || displayedApprovalHistory.length) ? (
          <div className="o365-approval-history-panel">
            <div className="o365-approval-panel-title">
              Approval Conversation
              {isLoadingApprovalHistory ? <span style={{ marginLeft: 8, fontWeight: 400, color: "#666" }}>Loading...</span> : null}
            </div>
            {approvalConversationItems.length ? (
              <div className="o365-approval-thread compact">
                {approvalConversationItems.map((item) => (
                  <div key={item.id} className={`o365-approval-thread-item ${item.lane}`}>
                    <div className={`o365-approval-thread-dot ${getApprovalConversationBadgeClass(item.lane)}`}></div>
                    <div className="o365-approval-thread-card">
                      <div className="o365-approval-thread-head">
                        <strong>{item.actorLabel}</strong>
                        <span className={`o365-approval-thread-badge ${getApprovalConversationBadgeClass(item.lane)}`}>{item.summary}</span>
                        <span>{dayjs(item.created_at).format("YYYY-MM-DD HH:mm")}</span>
                      </div>
                      <div className="o365-approval-thread-meta">
                        {item.action_type} | {item.serial_id} | REV{String(item.version_number || 1).padStart(2, "0")}
                      </div>
                      {item.snapshot_subject ? <div className="o365-approval-thread-subject">{item.snapshot_subject}</div> : null}
                      {item.previewText ? <div className="o365-approval-thread-body">{item.previewText}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div style={{ fontSize: 12, color: "#777" }}>No revision history is available yet.</div>}
          </div>
        ) : null}
      </form>
    </div>
  );
}
