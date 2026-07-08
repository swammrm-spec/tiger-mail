function normalizeRiskLevel(level = "") {
  const normalized = String(level || "").trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(normalized)) {
    return normalized;
  }
  return "low";
}

function normalizeAnalysisPayload(payload = {}, fallback = {}) {
  const recommendations = Array.isArray(payload?.recommendations)
    ? payload.recommendations.map((item) => String(item || "").trim()).filter(Boolean)
    : fallback.recommendations || [];
  const riskFlags = Array.isArray(payload?.risk_flags)
    ? payload.risk_flags.map((item) => String(item || "").trim()).filter(Boolean)
    : fallback.risk_flags || [];

  return {
    sentiment: String(payload?.sentiment || fallback.sentiment || "Neutral").trim() || "Neutral",
    tone_score: Math.max(1, Math.min(100, Number(payload?.tone_score || fallback.tone_score || 50))),
    recommendations,
    risk_level: normalizeRiskLevel(payload?.risk_level || fallback.risk_level || "low"),
    risk_flags: [...new Set(riskFlags)],
    provider: String(payload?.provider || fallback.provider || "").trim()
  };
}

function normalizePriority(priority = "", fallback = "Medium") {
  const normalized = String(priority || fallback || "Medium").trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Medium";
}

function normalizeDueDate(value = null) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "null") {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeTextArray(value = [], fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeTaskCategory(value = "", fallback = "GENERAL") {
  const normalized = String(value || fallback || "GENERAL").trim().toUpperCase();
  if (["CUSTOMS", "TENDER", "PAYMENT"].includes(normalized)) {
    return normalized;
  }
  return "GENERAL";
}

function normalizeTaskType(value = "", fallbackCategory = "GENERAL") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["customs", "tender", "payment", "general"].includes(normalized)) {
    return normalized;
  }
  const category = normalizeTaskCategory(fallbackCategory);
  if (category === "CUSTOMS") return "customs";
  if (category === "TENDER") return "tender";
  if (category === "PAYMENT") return "payment";
  return "general";
}

function normalizeTaskConfidence(value = "", fallback = "medium") {
  const normalized = String(value || fallback || "medium").trim().toLowerCase();
  if (["high", "medium", "low"].includes(normalized)) {
    return normalized;
  }
  return "medium";
}

function normalizeInboundTask(task = {}, fallbackTask = {}) {
  const category = normalizeTaskCategory(task?.category, fallbackTask?.category);
  return {
    task_description: String(task?.task_description || fallbackTask?.task_description || "").trim(),
    due_date: normalizeDueDate(task?.due_date ?? fallbackTask?.due_date ?? null),
    task_type: normalizeTaskType(task?.task_type, category || fallbackTask?.category),
    category,
    checklist: normalizeTextArray(task?.checklist, fallbackTask?.checklist).slice(0, 8),
    assigned_to_email: String(task?.assigned_to_email || fallbackTask?.assigned_to_email || "").trim(),
    assigned_to_name: String(task?.assigned_to_name || fallbackTask?.assigned_to_name || "").trim(),
    assigned_department: String(task?.assigned_department || fallbackTask?.assigned_department || "").trim(),
    priority: normalizePriority(task?.priority, fallbackTask?.priority || "Medium"),
    confidence: normalizeTaskConfidence(task?.confidence, fallbackTask?.confidence || "medium")
  };
}

function normalizeInboundTaskExtractionPayload(payload = {}, fallback = {}) {
  const fallbackTasks = Array.isArray(fallback?.ai_tasks) ? fallback.ai_tasks : [];
  const nextTasks = Array.isArray(payload?.ai_tasks) ? payload.ai_tasks : fallbackTasks;
  const normalizedTasks = nextTasks
    .map((task, index) => normalizeInboundTask(task, fallbackTasks[index] || {}))
    .filter((task) => task.task_description);

  return {
    sender_email: String(payload?.sender_email || fallback?.sender_email || "").trim(),
    receiver_email: String(payload?.receiver_email || fallback?.receiver_email || "").trim(),
    project_id: String(payload?.project_id || fallback?.project_id || "").trim() || null,
    email_category: normalizeTaskCategory(payload?.email_category, fallback?.email_category || "GENERAL"),
    summary: String(payload?.summary || fallback?.summary || "").trim(),
    priority: normalizePriority(payload?.priority, fallback?.priority || "Medium"),
    routing: {
      suggested_assigned_to_email: String(payload?.routing?.suggested_assigned_to_email || fallback?.routing?.suggested_assigned_to_email || "").trim(),
      suggested_assigned_to_name: String(payload?.routing?.suggested_assigned_to_name || fallback?.routing?.suggested_assigned_to_name || "").trim(),
      suggested_department: String(payload?.routing?.suggested_department || fallback?.routing?.suggested_department || "").trim(),
      reason: String(payload?.routing?.reason || fallback?.routing?.reason || "").trim()
    },
    ai_tasks: normalizedTasks,
    provider: String(payload?.provider || fallback?.provider || "rules").trim() || "rules"
  };
}

function stripCodeFences(value = "") {
  return String(value || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function parseLlmJson(value = "") {
  const cleaned = stripCodeFences(value);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("LLM response did not contain valid JSON.");
    }
    return JSON.parse(match[0]);
  }
}

function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini"
  };
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash"
  };
}

function buildAnalysisPrompt({ subject, body, recipientEmail, ccList }) {
  return [
    "You are a professional email compliance and approval assistant for an enterprise Outlook-like approval system.",
    "Analyze the draft and return strict JSON only.",
    "Required JSON shape:",
    "{",
    '  "sentiment": "Neutral|Positive|Urgent|Urgent but polite|Other",',
    '  "tone_score": 1-100,',
    '  "recommendations": ["short action-oriented recommendations"],',
    '  "risk_level": "low|medium|high|critical",',
    '  "risk_flags": ["dangerous-language","liability-language","pricing-risk","multi-recipient", "..."]',
    "}",
    "Rules:",
    "- Focus on dangerous language, legal liability, guarantees, penalties, aggressive contract wording, pricing exposure, and professionalism.",
    "- If there is no real risk, return risk_level=low and an empty or minimal risk_flags array.",
    "- Recommendations must be concise and suitable for a manager approval dashboard.",
    "",
    `Subject: ${subject || ""}`,
    `To: ${recipientEmail || ""}`,
    `CC: ${ccList || ""}`,
    "Body:",
    body || ""
  ].join("\n");
}

function buildInboundTaskExtractionPrompt({
  subject,
  body,
  senderEmail,
  recipientEmail,
  ccList,
  receivedAt,
  activeProjects = [],
  candidateAssignees = []
}) {
  const assigneeLines = candidateAssignees.length
    ? candidateAssignees.map((candidate) => `- ${candidate.name || "Unknown"} | ${candidate.email || ""} | role: ${candidate.role || ""} | department: ${candidate.department || ""}`).join("\n")
    : "- No assignee directory was provided";
  const projectLine = activeProjects.length
    ? `Active projects: ${activeProjects.join(", ")}`
    : "Active projects: none provided";

  return [
    "You are an enterprise email operations assistant.",
    "Analyze the incoming email and extract actionable tasks for workflow automation.",
    "Return strict JSON only.",
    "JSON schema:",
    "{",
    '  "sender_email": "string",',
    '  "receiver_email": "string",',
    '  "project_id": "PROJECT-CODE or null",',
    '  "email_category": "CUSTOMS|TENDER|PAYMENT|GENERAL",',
    '  "summary": "One concise Arabic sentence",',
    '  "priority": "High|Medium|Low",',
    '  "routing": {',
    '    "suggested_assigned_to_email": "email or empty",',
    '    "suggested_assigned_to_name": "name or empty",',
    '    "suggested_department": "department or empty",',
    '    "reason": "short explanation"',
    "  },",
    '  "ai_tasks": [{',
    '    "task_description": "clear action statement",',
    '    "due_date": "YYYY-MM-DD or null",',
    '    "task_type": "customs|tender|payment|general",',
    '    "category": "CUSTOMS|TENDER|PAYMENT|GENERAL",',
    '    "checklist": ["step 1", "step 2"],',
    '    "assigned_to_email": "email or empty",',
    '    "assigned_to_name": "name or empty",',
    '    "assigned_department": "department or empty",',
    '    "priority": "High|Medium|Low",',
    '    "confidence": "high|medium|low"',
    "  }]",
    "}",
    "Rules:",
    "- Infer due_date only when the email clearly states or strongly implies one; otherwise null.",
    "- Prefer CUSTOMS, TENDER, or PAYMENT when applicable; otherwise GENERAL.",
    "- If the best assignee is unclear, leave assignee fields empty.",
    "- Checklist items must be short and operational.",
    "- Use the provided assignee directory only; do not invent employees.",
    projectLine,
    "Available assignees:",
    assigneeLines,
    "",
    `Subject: ${subject || ""}`,
    `From: ${senderEmail || ""}`,
    `To: ${recipientEmail || ""}`,
    `CC: ${ccList || ""}`,
    `Date: ${receivedAt || ""}`,
    "Body:",
    body || ""
  ].join("\n");
}

async function callOpenAiAnalysis(draft) {
  const config = getOpenAiConfig();
  if (!config) return null;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only JSON." },
        { role: "user", content: buildAnalysisPrompt(draft) }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "OpenAI analysis request failed.");
  }

  const content = payload?.choices?.[0]?.message?.content || "";
  return {
    ...parseLlmJson(content),
    provider: "openai"
  };
}

async function callGeminiAnalysis(draft) {
  const config = getGeminiConfig();
  if (!config) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildAnalysisPrompt(draft) }]
          }
        ]
      })
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Gemini analysis request failed.");
  }

  const content = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || "";
  return {
    ...parseLlmJson(content),
    provider: "gemini"
  };
}

async function analyzeDraftWithLlm(draft, fallbackAnalysis) {
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();
  if (!openAiConfig && !geminiConfig) {
    return normalizeAnalysisPayload({ provider: "rules" }, fallbackAnalysis);
  }

  try {
    const payload = openAiConfig
      ? await callOpenAiAnalysis(draft)
      : await callGeminiAnalysis(draft);
    return normalizeAnalysisPayload(payload, fallbackAnalysis);
  } catch {
    return normalizeAnalysisPayload({ provider: "rules" }, fallbackAnalysis);
  }
}

async function analyzeInboundTaskExtractionWithLlm(draft, fallbackAnalysis = {}) {
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();
  if (!openAiConfig && !geminiConfig) {
    return normalizeInboundTaskExtractionPayload({ provider: "rules" }, fallbackAnalysis);
  }

  const prompt = buildInboundTaskExtractionPrompt(draft);
  try {
    let payload = null;
    if (openAiConfig) {
      const response = await fetch(`${openAiConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: openAiConfig.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return only JSON." },
            { role: "user", content: prompt }
          ]
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error?.message || "OpenAI inbound extraction request failed.");
      }
      payload = {
        ...parseLlmJson(json?.choices?.[0]?.message?.content || ""),
        provider: "openai"
      };
    } else {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiConfig.model)}:generateContent?key=${encodeURIComponent(geminiConfig.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json"
            },
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ]
          })
        }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error?.message || "Gemini inbound extraction request failed.");
      }
      payload = {
        ...parseLlmJson(json?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || ""),
        provider: "gemini"
      };
    }

    return normalizeInboundTaskExtractionPayload(payload, fallbackAnalysis);
  } catch {
    return normalizeInboundTaskExtractionPayload({ provider: "rules" }, fallbackAnalysis);
  }
}

function normalizeTransactionType(value = "", fallback = "general") {
  const normalized = String(value || "").trim().toLowerCase();
  const validTypes = ["tender", "contract", "payment", "customs", "invoice", "inquiry", "complaint", "renewal", "submission", "procurement", "accounting", "approval", "general"];
  if (validTypes.includes(normalized)) return normalized;
  return fallback;
}

function normalizeUrgencyLevel(value = "", fallback = "low") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(normalized)) return normalized;
  return fallback;
}

function normalizeBoolean(value) {
  return Boolean(value === true || value === "true" || value === 1 || value === "1");
}

function normalizeDeadlineDate(value = null) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "null" || normalized.toLowerCase() === "none") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return null;
}

function normalizeActionItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({
      description: String(item?.description || item || "").trim(),
      assignee: String(item?.assignee || "").trim(),
      due_date: normalizeDeadlineDate(item?.due_date),
      priority: normalizePriority(item?.priority, "Medium")
    }))
    .filter(item => item.description);
}

function normalizeEmailBrainPayload(payload = {}, fallback = {}) {
  return {
    transaction_type: normalizeTransactionType(payload?.transaction_type, fallback?.transaction_type || "general"),
    has_deadline: normalizeBoolean(payload?.has_deadline ?? fallback?.has_deadline ?? false),
    deadline_date: normalizeDeadlineDate(payload?.deadline_date ?? fallback?.deadline_date ?? null),
    needs_response: normalizeBoolean(payload?.needs_response ?? fallback?.needs_response ?? false),
    summary: String(payload?.summary || fallback?.summary || "").trim() || "No summary available",
    urgency_level: normalizeUrgencyLevel(payload?.urgency_level, fallback?.urgency_level || "low"),
    action_items: normalizeActionItems(payload?.action_items || fallback?.action_items || []),
    key_entities: {
      people: Array.isArray(payload?.key_entities?.people) ? payload.key_entities.people.map(String).filter(Boolean) : [],
      organizations: Array.isArray(payload?.key_entities?.organizations) ? payload.key_entities.organizations.map(String).filter(Boolean) : [],
      amounts: Array.isArray(payload?.key_entities?.amounts) ? payload.key_entities.amounts.map(String).filter(Boolean) : [],
      dates: Array.isArray(payload?.key_entities?.dates) ? payload.key_entities.dates.map(String).filter(Boolean) : [],
      references: Array.isArray(payload?.key_entities?.references) ? payload.key_entities.references.map(String).filter(Boolean) : []
    },
    response_suggestion: String(payload?.response_suggestion || fallback?.response_suggestion || "").trim(),
    provider: String(payload?.provider || fallback?.provider || "rules").trim() || "rules"
  };
}

function buildEmailBrainPrompt({
  subject,
  body,
  senderEmail,
  senderName,
  recipientEmail,
  recipientName,
  ccList,
  receivedAt,
  attachments = [],
  emailKeys = [],
  activeProjects = []
}) {
  const keyList = emailKeys.length
    ? emailKeys.map(k => `- ${k.code || k.key_code || k} (${k.description || ""})`).join("\n")
    : "- No email keys provided";
  const projectList = activeProjects.length
    ? `Active projects: ${activeProjects.join(", ")}`
    : "Active projects: none provided";
  const attachmentInfo = attachments.length
    ? `Attachments: ${attachments.join(", ")}`
    : "No attachments";

  return [
    "You are an expert email analysis engine for a government/corporate tender and procurement system.",
    "Analyze the incoming email and extract structured business intelligence.",
    "Return strict JSON only, no markdown, no explanations outside JSON.",
    "",
    "Required JSON schema:",
    "{",
    '  "transaction_type": "tender|contract|payment|customs|invoice|inquiry|complaint|renewal|submission|procurement|accounting|approval|general",',
    '  "has_deadline": true/false,',
    '  "deadline_date": "YYYY-MM-DD or null (only if explicitly stated or strongly implied)",',
    '  "needs_response": true/false,',
    '  "summary": "Concise Arabic summary (max 2 sentences) of the email purpose and key points",',
    '  "urgency_level": "low|medium|high|critical",',
    '  "action_items": [{',
    '    "description": "clear action statement",',
    '    "assignee": "name or role if mentioned, empty otherwise",',
    '    "due_date": "YYYY-MM-DD or null",',
    '    "priority": "High|Medium|Low"',
    '  }],',
    '  "key_entities": {',
    '    "people": ["names mentioned"],',
    '    "organizations": ["company/agency names"],',
    '    "amounts": ["monetary amounts with currency if present"],',
    '    "dates": ["dates mentioned in the email"],',
    '    "references": ["reference numbers, tender numbers, contract IDs, etc."]',
    '  },',
    '  "response_suggestion": "Brief suggestion for how to respond (1-2 sentences, empty if no response needed)"',
    "}",
    "",
    "Rules:",
    "- transaction_type must be one of the listed values.",
    "- has_deadline=true ONLY if the email explicitly mentions a deadline or due date.",
    "- deadline_date must be a real date mentioned in the email; null if not found.",
    "- needs_response=true if the email asks a question, requests information, or requires acknowledgment.",
    "- urgency_level: critical=legal/action-immediate, high=time-sensitive, medium=normal-business, low=FYI.",
    "- action_items: Extract ALL actionable items. Empty array if nothing actionable.",
    "- key_entities: Extract ALL mentioned people, companies, amounts, dates, and reference numbers.",
    "- response_suggestion: Practical suggestion for reply (in Arabic if email is Arabic).",
    "- All fields must be present even if empty/null/default.",
    "",
    "Available email key codes (for classification):",
    keyList,
    "",
    projectList,
    "",
    `Subject: ${subject || ""}`,
    `From: ${senderName || ""} <${senderEmail || ""}>`,
    `To: ${recipientName || ""} <${recipientEmail || ""}>`,
    `CC: ${ccList || ""}`,
    `Date: ${receivedAt || ""}`,
    attachmentInfo,
    "Body:",
    body || ""
  ].join("\n");
}

async function callOpenAiBrain(analysisContext) {
  const config = getOpenAiConfig();
  if (!config) return null;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are an email analysis engine. Return only JSON." },
        { role: "user", content: buildEmailBrainPrompt(analysisContext) }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "OpenAI brain analysis request failed.");
  }

  const content = payload?.choices?.[0]?.message?.content || "";
  return {
    ...parseLlmJson(content),
    provider: "openai"
  };
}

async function callGeminiBrain(analysisContext) {
  const config = getGeminiConfig();
  if (!config) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildEmailBrainPrompt(analysisContext) }]
          }
        ]
      })
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Gemini brain analysis request failed.");
  }

  const content = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || "";
  return {
    ...parseLlmJson(content),
    provider: "gemini"
  };
}

function buildRulesFallbackBrain(context) {
  const { subject = "", body = "", senderEmail = "", receivedAt = "" } = context;
  const text = `${subject} ${body}`.toLowerCase();
  const recommendations = [];

  const transactionPatterns = {
    tender: /\b(tender|rfp|rfq|bid|proposal|ctb|tenderer)\b/i,
    contract: /\b(contract|agreement|memorandum|mou|amendment)\b/i,
    payment: /\b(payment|invoice|bill|receipt|remittance|bank transfer)\b/i,
    customs: /\b(customs|clearance|duty|tariff|import|export|custom)\b/i,
    renewal: /\b(renewal|renew|extend|extension)\b/i,
    submission: /\b(submission|submit|submitting|submitted)\b/i,
    procurement: /\b(procurement|purchasing|purchase order|po)\b/i,
    accounting: /\b(accounting|financial|budget|expense|ledger)\b/i,
    approval: /\b(approve|approval|authorized|authorization)\b/i,
    inquiry: /\b(inquiry|enquiry|information|question|request)\b/i,
    complaint: /\b(complaint|issue|problem|dissatisfied|feedback)\b/i
  };

  let transactionType = "general";
  for (const [type, pattern] of Object.entries(transactionPatterns)) {
    if (pattern.test(text)) {
      transactionType = type;
      break;
    }
  }

  const hasDeadline = /\b(deadline|due date|before|by\s+\w+\s+\d|expire|expires?|last day|final date)\b/i.test(text);
  let deadlineDate = null;
  if (hasDeadline) {
    const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) deadlineDate = dateMatch[1];
  }

  const needsResponse = /\b(please|kindly|confirm|acknowledge|reply|respond|feedback|let me know|what do you think)\b/i.test(text);

  const isUrgent = /\b(urgent|asap|immediately|critical|emergency|time.sensitive)\b/i.test(text);
  const isHighPriority = /\b(important|priority|high|deadline|expir)\b/i.test(text);
  const urgencyLevel = isUrgent ? "critical" : isHighPriority ? "high" : "low";

  const summaryParts = [];
  if (transactionType !== "general") summaryParts.push(`Transaction type: ${transactionType}`);
  if (hasDeadline) summaryParts.push(`Has deadline`);
  if (needsResponse) summaryParts.push(`Requires response`);
  if (urgencyLevel !== "low") summaryParts.push(`Urgency: ${urgencyLevel}`);

  const summary = summaryParts.length > 0 ? summaryParts.join(". ") + "." : `Email from ${senderEmail || "unknown sender"}. Subject: ${subject || "No subject"}.`;

  return {
    transaction_type: transactionType,
    has_deadline: hasDeadline,
    deadline_date: deadlineDate,
    needs_response: needsResponse,
    summary: summary,
    urgency_level: urgencyLevel,
    action_items: needsResponse ? [{ description: `Reply to ${senderEmail || "sender"}`, assignee: "", due_date: null, priority: isUrgent ? "High" : "Medium" }] : [],
    key_entities: { people: [], organizations: [], amounts: [], dates: deadlineDate ? [deadlineDate] : [], references: [] },
    response_suggestion: needsResponse ? `Reply to acknowledge receipt and address the ${transactionType} inquiry.` : "",
    provider: "rules"
  };
}

async function analyzeEmailBrain(context) {
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();

  const fallback = buildRulesFallbackBrain(context);

  if (!openAiConfig && !geminiConfig) {
    return normalizeEmailBrainPayload(fallback, fallback);
  }

  try {
    const payload = openAiConfig
      ? await callOpenAiBrain(context)
      : await callGeminiBrain(context);
    return normalizeEmailBrainPayload(payload, fallback);
  } catch (error) {
    console.error("[AI-BRAIN] LLM analysis failed, using rules fallback:", error.message);
    return normalizeEmailBrainPayload(fallback, fallback);
  }
}

export {
  analyzeDraftWithLlm,
  analyzeInboundTaskExtractionWithLlm,
  analyzeEmailBrain,
  normalizeEmailBrainPayload
};
