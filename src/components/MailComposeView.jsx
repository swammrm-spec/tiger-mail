import { useState } from "react";
import dayjs from "dayjs";
import { AlertTriangle, Archive, Paperclip, Send, ShieldAlert, Sparkles, X } from "lucide-react";
import { formatJordanDateTime } from "../utils/timezone.js";

function splitEditableReplyBody(text = "") {
  const fullText = String(text || "");
  const marker = "----- Original Message -----";
  const markerIndex = fullText.indexOf(marker);
  return markerIndex === -1 ? fullText.trim() : fullText.slice(0, markerIndex).trim();
}

function buildSafeRewriteDiffRows(currentBody = "", rewrittenBody = "") {
  const currentLines = String(currentBody || "").split(/\r?\n/);
  const rewrittenLines = String(rewrittenBody || "").split(/\r?\n/);
  const maxLines = Math.max(currentLines.length, rewrittenLines.length);
  const rows = [];

  for (let index = 0; index < maxLines; index += 1) {
    const currentLine = String(currentLines[index] || "").trim();
    const rewrittenLine = String(rewrittenLines[index] || "").trim();
    let type = "unchanged";
    if (currentLine && !rewrittenLine) {
      type = "removed";
    } else if (!currentLine && rewrittenLine) {
      type = "added";
    } else if (currentLine !== rewrittenLine) {
      type = "changed";
    }
    rows.push({
      id: `${index}-${type}`,
      index: index + 1,
      type,
      currentLine,
      rewrittenLine
    });
  }

  return rows;
}

function buildContractImpactSummary(conflicts = [], repairSuggestions = []) {
  const source = Array.isArray(conflicts) ? conflicts : [];
  const referenceMap = new Map(
    (Array.isArray(repairSuggestions) ? repairSuggestions : []).map((item) => [item.conflict_type, item.reference_key || ""])
  );
  return source.map((conflict) => {
    const reference = conflict.reference_key || referenceMap.get(conflict.conflict_type) || "";
    const byType = {
      deadline_conflict: {
        tone: "تشديد زمني",
        description: "إزالة موعد أو مدة غير مدعومة وإرجاع الرد إلى الجدول الزمني المعتمد."
      },
      payment_mismatch: {
        tone: "تشديد مالي",
        description: "إلغاء نسب أو مبالغ دفع غير موثقة والرجوع إلى شروط الدفع الحالية."
      },
      scope_expansion: {
        tone: "تقييد النطاق",
        description: "منع توسعة نطاق العمل أو الأعمال الإضافية بدون اعتماد منفصل."
      },
      unsupported_warranty: {
        tone: "تقييد الضمان",
        description: "سحب أي وعد ضمان أو دعم غير منصوص عليه تعاقديًا."
      },
      general_conflict: {
        tone: "تصحيح تعاقدي",
        description: "إعادة الصياغة إلى لغة أكثر تحفظًا واتساقًا مع المرجع الحالي."
      }
    };
    const meta = byType[conflict.conflict_type] || byType.general_conflict;
    return {
      key: `${conflict.conflict_type || "general"}-${reference}-${conflict.expected_value || ""}`,
      tone: meta.tone,
      description: meta.description,
      reference
    };
  });
}

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
  composeReplySourceEmail,
  composeAiRecommendations,
  isGeneratingReplyDraft,
  handleGenerateReplyDraft,
  draftAssistantMeta,
  responsePolicyGuard,
  isCheckingResponsePolicyGuard,
  isResponsePolicyGuardStale,
  handleRunResponsePolicyGuard,
  handleApplyRepairSuggestion,
  handleApplySafeRewrite,
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
  outboundCompanyOptions = [],
  outboundClientOptions = [],
  outgoingReferenceOptions = [],
  professionalOutgoingState = { emailSubject: "", isComplete: false, missing: [], preview: "", previewHtml: "", subjectNo: "", documentNo: "" },
  enforceOutboundSubjectSchema = true
}) {
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const activeAccount = emailAccounts.find(a => a.id === activeAccountId) || emailAccounts[0];
  const selectedKey = emailKeys.find(k => k.id === Number(form.email_key_id));
  const approvalLock = responsePolicyGuard?.approval_lock || null;
  const isSafeRewriteApprovalLocked = Boolean(
    approvalLock?.required
    && Number(approvalLock?.approver_id || 0)
    && Number(approvalLock?.approver_id || 0) !== Number(currentUser?.id || 0)
  );
  const currentEditableBody = splitEditableReplyBody(form.body);
  const rewrittenEditableBody = String(responsePolicyGuard?.safe_rewrite?.rewritten_body || "").trim();
  const safeRewriteDiffRows = buildSafeRewriteDiffRows(currentEditableBody, rewrittenEditableBody);
  const visibleSafeRewriteDiffRows = safeRewriteDiffRows.filter((row) => row.type !== "unchanged").slice(0, 12);
  const contractImpactSummary = buildContractImpactSummary(
    responsePolicyGuard?.conflicts || [],
    responsePolicyGuard?.repair_suggestions || []
  ).slice(0, 6);
  return (
    <div className="o365-compose">
      <div className="o365-compose-ribbon">
        <div className="o365-ribbon-group">
          <button type="button" className="o365-ribbon-btn o365-ribbon-primary" disabled={isSendingEmail} onClick={handleSendEmail} style={{ minWidth: 60 }}>
            <Send size={20} /><span className="o365-ribbon-btn-label">{isSendingEmail ? "Sending..." : isSafeRewriteApprovalLocked ? "Submit Approval" : "Send"}</span>
          </button>
          <button className="o365-ribbon-btn" type="submit" form="compose-form" disabled={isSubmitting || !canArchive}>
            <Archive size={20} /><span className="o365-ribbon-btn-label">{isSubmitting ? "Saving..." : "Save"}</span>
          </button>
          {composeReplySourceEmail ? (
            <button
              type="button"
              className="o365-ribbon-btn"
              disabled={isGeneratingReplyDraft}
              onClick={handleGenerateReplyDraft}
              title="Generate a contextual reply from the project history"
            >
              <Sparkles size={20} /><span className="o365-ribbon-btn-label">{isGeneratingReplyDraft ? "Drafting..." : "AI Reply"}</span>
            </button>
          ) : null}
          {composeReplySourceEmail ? (
            <button
              type="button"
              className="o365-ribbon-btn"
              disabled={isCheckingResponsePolicyGuard}
              onClick={handleRunResponsePolicyGuard}
              title="Validate this reply against historical project commitments"
            >
              <ShieldAlert size={20} /><span className="o365-ribbon-btn-label">{isCheckingResponsePolicyGuard ? "Checking..." : "Policy Guard"}</span>
            </button>
          ) : null}
          {composeReplySourceEmail ? (
            <button
              type="button"
              className="o365-ribbon-btn"
              disabled={isCheckingResponsePolicyGuard || !responsePolicyGuard?.safe_rewrite?.rewritten_body || isSafeRewriteApprovalLocked}
              onClick={handleApplySafeRewrite}
              title="Rewrite the editable draft body using all safe repair suggestions"
            >
              <Sparkles size={20} /><span className="o365-ribbon-btn-label">Safe Rewrite</span>
            </button>
          ) : null}
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
      {composeReplySourceEmail ? (
        <div className="o365-compose-banner ai">
          <div className="o365-compose-banner-title">Drafting Assistant</div>
          <div>
            Source: <strong>{composeReplySourceEmail.subject || composeReplySourceEmail.serial || "Reply draft"}</strong>
          </div>
          <div style={{ marginTop: 4 }}>
            Project: <strong>{draftAssistantMeta?.projectCode || "Will resolve from project history"}</strong>
            {draftAssistantMeta?.projectName ? ` | ${draftAssistantMeta.projectName}` : ""}
          </div>
          <div style={{ marginTop: 4 }}>
            Historical context: <strong>{Number(draftAssistantMeta?.historyCount || 0)}</strong> email(s)
          </div>
          <div style={{ marginTop: 4 }}>
            Contract memory: <strong>{Number(draftAssistantMeta?.contractMemoryCount || 0)}</strong> snippet(s)
          </div>
          <div style={{ marginTop: 4 }}>
            Structured clauses: <strong>{Number(draftAssistantMeta?.contractClauseCount || 0)}</strong> clause(s)
          </div>
          {draftAssistantMeta?.references?.length ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
              References: {draftAssistantMeta.references.slice(0, 5).join(" | ")}
            </div>
          ) : null}
          {draftAssistantMeta?.contractMemoryReferences?.length ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
              Contract refs: {draftAssistantMeta.contractMemoryReferences.slice(0, 5).join(" | ")}
            </div>
          ) : null}
          {draftAssistantMeta?.contractClauseReferences?.length ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
              Clause refs: {draftAssistantMeta.contractClauseReferences.slice(0, 5).join(" | ")}
            </div>
          ) : null}
        </div>
      ) : null}
      {composeReplySourceEmail ? (
        <div className={`o365-compose-banner ${["high", "critical"].includes(String(responsePolicyGuard?.severity || "").toLowerCase()) ? "rejected" : "ai"}`}>
          <div className="o365-compose-banner-title">Response Policy Guard</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
              <AlertTriangle size={14} />
              {responsePolicyGuard
                ? `Verdict: ${responsePolicyGuard.verdict || "clear"} | Severity: ${responsePolicyGuard.severity || "low"}`
                : "No validation has been run for this reply yet."}
            </span>
            {isResponsePolicyGuardStale && responsePolicyGuard ? (
              <span style={{ fontSize: 12, color: "#a4262c" }}>Draft changed after last validation.</span>
            ) : null}
          </div>
          {responsePolicyGuard?.summary ? (
            <div style={{ marginTop: 6 }}>{responsePolicyGuard.summary}</div>
          ) : (
            <div style={{ marginTop: 6 }}>
              Run Policy Guard before sending to check for unsupported promises, deadline changes, pricing exposure, or contract conflicts.
            </div>
          )}
          {approvalLock?.required ? (
            <div className={`o365-safe-rewrite-lock ${isSafeRewriteApprovalLocked ? "locked" : "ready"}`}>
              <div style={{ fontWeight: 600 }}>
                Safe Rewrite Approval Lock
              </div>
              <div style={{ marginTop: 4 }}>
                {approvalLock.summary || approvalLock.reason || "Sensitive contractual changes require approval before apply/send."}
              </div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                Approver: <strong>{approvalLock.approver_name || approvalLock.approver_email || "Not assigned"}</strong>
                {approvalLock.approver_email && approvalLock.approver_name ? ` | ${approvalLock.approver_email}` : ""}
              </div>
              {approvalLock?.sensitive_conflict_types?.length ? (
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  Locked by: {approvalLock.sensitive_conflict_types.join(" | ")}
                </div>
              ) : null}
              {isSafeRewriteApprovalLocked ? (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  Apply actions are disabled. Use <strong>Submit Approval</strong> to route the safe rewrite to the approver.
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  You are the designated approver for this rewrite, so apply/send remains available.
                </div>
              )}
            </div>
          ) : null}
          {responsePolicyGuard?.issues?.length ? (
            <ul className="o365-compose-guidance-list" style={{ marginTop: 8 }}>
              {responsePolicyGuard.issues.slice(0, 5).map((issue, index) => (
                <li key={`${issue.type || "issue"}-${index}`}>
                  <strong>{issue.title || issue.type || "Issue"}:</strong> {issue.details || "Needs review."}
                  {issue.historical_reference ? ` (${issue.historical_reference})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {responsePolicyGuard?.conflicts?.length ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Clause conflicts</div>
              <ul className="o365-compose-guidance-list">
                {responsePolicyGuard.conflicts.slice(0, 4).map((conflict, index) => (
                  <li key={`${conflict.conflict_type || "conflict"}-${index}`}>
                    <strong>{conflict.title || conflict.conflict_type || "Conflict"}:</strong> {conflict.details || "Clause review required."}
                    {conflict.reference_key ? ` (${conflict.reference_key})` : ""}
                    {conflict.expected_value ? ` | Expected: ${conflict.expected_value}` : ""}
                    {conflict.draft_evidence ? ` | Draft: ${conflict.draft_evidence}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {responsePolicyGuard?.repair_suggestions?.length ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Auto-repair suggestions</div>
              <ul className="o365-compose-guidance-list">
                {responsePolicyGuard.repair_suggestions.slice(0, 4).map((suggestion, index) => (
                  <li key={`${suggestion.conflict_type || "repair"}-${index}`}>
                    <strong>{suggestion.title || "Suggested repair"}:</strong> {suggestion.rationale || "Safer contract-aligned wording."}
                    {suggestion.reference_key ? ` (${suggestion.reference_key})` : ""}
                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{suggestion.suggested_text}</div>
                    <button
                      type="button"
                      style={{ marginTop: 8 }}
                      disabled={isSafeRewriteApprovalLocked}
                      onClick={() => handleApplyRepairSuggestion?.(suggestion)}
                    >
                      Apply Suggestion
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {responsePolicyGuard?.safe_rewrite?.rewritten_body ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>One-click safe rewrite</div>
              <div style={{ fontSize: 12, color: "#555" }}>
                {responsePolicyGuard.safe_rewrite.title || "Safe rewrite"}
                {responsePolicyGuard.safe_rewrite.rationale ? `: ${responsePolicyGuard.safe_rewrite.rationale}` : ""}
              </div>
              <div className="o365-safe-rewrite-stats">
                <span>Current lines: {currentEditableBody ? currentEditableBody.split(/\r?\n/).length : 0}</span>
                <span>Safe lines: {rewrittenEditableBody ? rewrittenEditableBody.split(/\r?\n/).length : 0}</span>
                <span>Reviewed changes: {visibleSafeRewriteDiffRows.length}</span>
              </div>
              {contractImpactSummary.length ? (
                <div className="o365-safe-rewrite-impact-list">
                  {contractImpactSummary.map((item) => (
                    <div key={item.key} className="o365-safe-rewrite-impact-chip">
                      <strong>{item.tone}</strong>
                      <span>{item.description}</span>
                      {item.reference ? <span>Ref: {item.reference}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="o365-safe-rewrite-diff">
                <div className="o365-safe-rewrite-diff-head">Safe Rewrite Diff Review</div>
                {visibleSafeRewriteDiffRows.length ? (
                  <div className="o365-safe-rewrite-diff-list">
                    {visibleSafeRewriteDiffRows.map((row) => (
                      <div key={row.id} className={`o365-safe-rewrite-diff-row ${row.type}`}>
                        <div className="o365-safe-rewrite-diff-meta">
                          <span className={`o365-safe-rewrite-badge ${row.type}`}>{row.type}</span>
                          <span>Line {row.index}</span>
                        </div>
                        <div className="o365-safe-rewrite-diff-columns">
                          <div className="o365-safe-rewrite-diff-column current">
                            <div className="o365-safe-rewrite-diff-label">Current</div>
                            <div className="o365-safe-rewrite-diff-text">{row.currentLine || " "}</div>
                          </div>
                          <div className="o365-safe-rewrite-diff-column next">
                            <div className="o365-safe-rewrite-diff-label">Safe</div>
                            <div className="o365-safe-rewrite-diff-text">{row.rewrittenLine || " "}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="o365-safe-rewrite-diff-empty">
                    No visible textual diff was detected, but the safe rewrite remains available for application.
                  </div>
                )}
              </div>
              <button
                type="button"
                style={{ marginTop: 8 }}
                disabled={isSafeRewriteApprovalLocked}
                onClick={handleApplySafeRewrite}
              >
                Apply Full Safe Rewrite
              </button>
            </div>
          ) : null}
          {responsePolicyGuard?.checked_references?.length ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
              Checked references: {responsePolicyGuard.checked_references.join(" | ")}
            </div>
          ) : null}
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
          <div className="o365-compose-field" style={{ borderBottom: "none", flexDirection: "column", alignItems: "stretch", gap: 0 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="field-label">Subject</span>
              <div style={{ flex: 1, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setShowKeyDropdown(!showKeyDropdown)}
                    style={{
                      width: 140, padding: "4px 8px", fontSize: 12, borderRadius: 4,
                      border: "1px solid #ccc", background: "#fff", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6, textAlign: "left"
                    }}
                  >
                    {selectedKey ? (
                      <>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: selectedKey.color || "#1a237e", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>[{selectedKey.key_code}]</span>
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
                <input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Email Subject"
                  required
                  readOnly={enforceOutboundSubjectSchema}
                  style={{ flex: 1, padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
                />
              </div>
            </div>
            {enforceOutboundSubjectSchema ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6, padding: "4px 8px 4px 80px", borderTop: "1px solid #eee" }}>
                <select
                  value={form.outbound_company || ""}
                  onChange={(e) => setForm({ ...form, outbound_company: e.target.value })}
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                >
                  <option value="">Company</option>
                  {outboundCompanyOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <select
                  value={form.outbound_client || ""}
                  onChange={(e) => setForm({ ...form, outbound_client: e.target.value })}
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                >
                  <option value="">Client</option>
                  {outboundClientOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <select
                  value={form.outbound_group_type || "projects"}
                  onChange={(e) => setForm({ ...form, outbound_group_type: e.target.value, outbound_reference_value: "", project_id: "" })}
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                >
                  <option value="projects">Projects</option>
                  <option value="quotations">Quotations</option>
                  <option value="studies">Studies</option>
                  <option value="admin_subjects">Admin Subjects</option>
                </select>
                <select
                  value={form.outbound_reference_value || ""}
                  onChange={(e) => setForm({
                    ...form,
                    outbound_reference_value: e.target.value,
                    project_id: form.outbound_group_type === "projects" ? e.target.value : form.project_id
                  })}
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                >
                  <option value="">Subject Number Reference</option>
                  {outgoingReferenceOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {enforceOutboundSubjectSchema ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6, padding: "4px 8px 4px 80px", borderTop: "1px solid #eee" }}>
                <input value={form.outbound_letter_type || "Letter"} readOnly style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc", background: "#f8f8f8" }} />
                <input
                  value={form.outbound_letter_title || ""}
                  onChange={(e) => setForm({ ...form, outbound_letter_title: e.target.value })}
                  placeholder="Letter Title"
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                />
                <select
                  value={professionalOutgoingState.subjectNo || ""}
                  disabled
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc", background: "#f8f8f8" }}
                >
                  <option value={professionalOutgoingState.subjectNo || ""}>{professionalOutgoingState.subjectNo || "Subject No."}</option>
                </select>
                <input
                  value={form.outbound_document_serial || ""}
                  onChange={(e) => setForm({ ...form, outbound_document_serial: e.target.value.toUpperCase() })}
                  placeholder="Document Serial"
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                />
              </div>
            ) : null}
            {enforceOutboundSubjectSchema ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6, padding: "4px 8px 4px 80px", borderTop: "1px solid #eee" }}>
                <input
                  value={form.outbound_internal_serial || ""}
                  onChange={(e) => setForm({ ...form, outbound_internal_serial: e.target.value.toUpperCase() })}
                  placeholder="Internal Serial"
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                />
                <input
                  type="date"
                  value={form.outbound_subject_date || ""}
                  onChange={(e) => setForm({ ...form, outbound_subject_date: e.target.value })}
                  style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                />
                <input value={professionalOutgoingState.documentNo || ""} readOnly placeholder="Document No." style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc", background: "#f8f8f8" }} />
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Email Subject" required readOnly style={{ padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }} />
              </div>
            ) : null}
            <div style={{ padding: "4px 8px 4px 80px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#888" }}>
                {form.email_key_id && form.subject
                  ? `Will be sent as: ${emailKeys.find(k => k.id === Number(form.email_key_id))?.key_code || ""}:${String(new Date().getFullYear()).slice(-2)}/${form.subject}`
                  : "Select Key to auto-format subject"}
              </span>
              {enforceOutboundSubjectSchema && (
                <span style={{ fontSize: 11, color: professionalOutgoingState.isComplete ? "#107c10" : "#b54708" }}>
                  {professionalOutgoingState.isComplete
                    ? "الكتاب الرسمي جاهز للإرسال."
                    : `الحقول المطلوبة قبل الإرسال: ${(professionalOutgoingState.missing || []).join("، ") || "غير مكتملة"}`}
                </span>
              )}
            </div>
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
                        <span>{formatJordanDateTime(item.created_at, { month: "2-digit", day: "2-digit", year: "numeric" })}</span>
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
      {enforceOutboundSubjectSchema && (
        <OutgoingPreviewPanel professionalOutgoingState={professionalOutgoingState} />
      )}
    </div>
  );
}

function OutgoingPreviewPanel({ professionalOutgoingState }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div style={{ borderTop: "1px solid #e1e1e1", background: "#fafbfc" }}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%", padding: "8px 12px", fontSize: 12, fontWeight: 600,
          background: "transparent", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          color: "#44546f"
        }}
      >
        <span>Outgoing Letter Preview</span>
        <span style={{ fontSize: 10, fontWeight: 400, color: "#888" }}>
          {isExpanded ? "▲ Hide" : "▼ Show"} | HTML + text fallback are generated automatically on send.
        </span>
      </button>
      {isExpanded && (
        <div className="o365-outgoing-preview" style={{ margin: "0 12px 12px", borderRadius: 8 }}>
          <div className="o365-outgoing-preview-canvas" style={{ maxHeight: 300 }}>
            {professionalOutgoingState.previewHtml ? (
              <div
                className="o365-outgoing-preview-document"
                dangerouslySetInnerHTML={{ __html: professionalOutgoingState.previewHtml }}
              />
            ) : (
              <div className="o365-outgoing-preview-empty">املأ حقول الكتاب الرسمي لتظهر المعاينة هنا.</div>
            )}
          </div>
          <div className="o365-outgoing-preview-note">
            يتم تثبيت البيانات الرسمية داخل نص الرسالة والنسخة المنسقة عند الإرسال من الخادم.
          </div>
        </div>
      )}
    </div>
  );
}
