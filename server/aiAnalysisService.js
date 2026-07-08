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

function normalizeDraftReplyPayload(payload = {}, fallback = {}) {
  const guidanceSource = Array.isArray(payload?.guidance)
    ? payload.guidance
    : Array.isArray(fallback?.guidance)
      ? fallback.guidance
      : [];
  const referencesSource = Array.isArray(payload?.historical_references)
    ? payload.historical_references
    : Array.isArray(fallback?.historical_references)
      ? fallback.historical_references
      : [];

  return {
    subject: String(payload?.subject || fallback?.subject || "").trim(),
    reply_body: String(payload?.reply_body || fallback?.reply_body || "").trim(),
    guidance: guidanceSource.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6),
    historical_references: referencesSource.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8),
    language: String(payload?.language || fallback?.language || "auto").trim() || "auto",
    provider: String(payload?.provider || fallback?.provider || "rules").trim() || "rules"
  };
}

function buildHistoricalReplyPrompt({
  sourceEmail = {},
  historyEmails = [],
  contractMemoryEntries = [],
  project = null,
  requestedSubject = "",
  existingDraftBody = "",
  replyMode = "reply"
} = {}) {
  const historySection = historyEmails.length
    ? historyEmails.map((item, index) => {
      return [
        `History #${index + 1}`,
        `Serial: ${item.serial_number || "-"}`,
        `Thread: ${item.thread_id || "-"}`,
        `Subject: ${item.subject || "-"}`,
        `From: ${item.sender_name || ""} <${item.sender_email || ""}>`,
        `To: ${item.recipient_email || ""}`,
        `Date: ${item.sent_at || item.received_at || ""}`,
        `AI Summary: ${item.ai_summary || "-"}`,
        "Body Excerpt:",
        item.body_excerpt || "-"
      ].join("\n");
    }).join("\n\n----------------\n\n")
    : "No historical project emails were found.";
  const contractMemorySection = contractMemoryEntries.length
    ? contractMemoryEntries.map((item, index) => {
      return [
        `Contract Memory #${index + 1}`,
        `Type: ${item.memory_type || "general"}`,
        `Title: ${item.title || "-"}`,
        `Reference: ${item.reference_key || "-"}`,
        `Source File: ${item.source_file_name || "-"}`,
        `Snippet: ${item.snippet || "-"}`
      ].join("\n");
    }).join("\n\n----------------\n\n")
    : "No structured contract memory snippets were found.";

  return [
    "You are an enterprise email drafting assistant for a project-based Outlook workflow.",
    "Your job is to draft a reply that is consistent with the historical correspondence of the same project.",
    "Return strict JSON only.",
    "JSON schema:",
    "{",
    '  "subject": "final reply subject",',
    '  "reply_body": "professional plain-text email body only, ready to paste before the quoted original message",',
    '  "guidance": ["short guidance bullets explaining why this draft matches the project history"],',
    '  "historical_references": ["serial or subject references you relied on"],',
    '  "language": "ar|en|mixed",',
    '  "provider": "openai|gemini|rules"',
    "}",
    "Rules:",
    "- Use the same working language as the incoming email unless the historical context strongly indicates a different language.",
    "- Do not invent facts, approvals, prices, deadlines, or commitments that are not supported by the current email, historical correspondence, or contract memory snippets.",
    "- If the historical context or contract memory contains previous commitments, preserve continuity and tone.",
    "- If the current draft body contains user notes, incorporate them without duplicating the quoted original message.",
    "- Keep the reply concise, professional, and operational.",
    "- reply_body must NOT include markdown fences or explanations.",
    "",
    `Reply mode: ${replyMode || "reply"}`,
    `Project: ${project?.project_code || "Unknown"} | ${project?.project_name || ""}`,
    `Requested subject: ${requestedSubject || sourceEmail?.subject || ""}`,
    "",
    "Current email to reply to:",
    `Subject: ${sourceEmail?.subject || ""}`,
    `From: ${sourceEmail?.sender_name || ""} <${sourceEmail?.sender_email || ""}>`,
    `To: ${sourceEmail?.recipient_email || ""}`,
    `CC: ${sourceEmail?.cc_list || ""}`,
    `Date: ${sourceEmail?.sent_at || sourceEmail?.received_at || ""}`,
    "Body:",
    sourceEmail?.body || "",
    "",
    "Existing draft body before the quoted original message:",
    existingDraftBody || "",
    "",
    "Historical project context:",
    historySection,
    "",
    "Structured contract memory:",
    contractMemorySection
  ].join("\n");
}

function buildRulesFallbackReplyDraft({
  sourceEmail = {},
  project = null,
  historyEmails = [],
  contractMemoryEntries = [],
  requestedSubject = ""
} = {}) {
  const subject = String(
    requestedSubject
    || sourceEmail?.subject
    || "RE: Follow-up"
  ).trim();
  const primaryReference = contractMemoryEntries[0]?.reference_key || historyEmails[0]?.serial_number || historyEmails[0]?.subject || "";
  const likelyArabic = /[\u0600-\u06FF]/.test(`${sourceEmail?.subject || ""}\n${sourceEmail?.body || ""}`);
  const replyBody = likelyArabic
    ? [
      `السادة الكرام،`,
      "",
      `نشكر رسالتكم بخصوص ${project?.project_code ? `المشروع ${project.project_code}` : "الموضوع المشار إليه"}.`,
      primaryReference ? `قمنا بمراجعة المراسلات السابقة ذات الصلة، بما في ذلك المرجع ${primaryReference}.` : "قمنا بمراجعة المراسلات السابقة ذات الصلة ضمن نفس المشروع.",
      "سنقوم بمتابعة المطلوب والعودة إليكم بالتحديث المناسب في أقرب وقت.",
      "",
      "مع الشكر،"
    ].join("\n")
    : [
      "Dear Team,",
      "",
      `Thank you for your message regarding ${project?.project_code ? `project ${project.project_code}` : "the referenced matter"}.`,
      primaryReference
        ? `We reviewed the related historical correspondence, including reference ${primaryReference}.`
        : "We reviewed the related historical correspondence for this project.",
      "We will follow up on the requested points and revert with the appropriate update shortly.",
      "",
      "Best regards,"
    ].join("\n");

  return normalizeDraftReplyPayload({
    subject,
    reply_body: replyBody,
    guidance: [
      project?.project_code ? `Linked to project ${project.project_code}` : "Generated from current email context",
      historyEmails.length ? `Used ${historyEmails.length} historical project email(s)` : "No historical project emails were available",
      contractMemoryEntries.length ? `Used ${contractMemoryEntries.length} contract memory snippet(s)` : "No contract memory snippets were available"
    ],
    historical_references: [
      ...contractMemoryEntries.map((item) => item.reference_key || item.title || "").filter(Boolean),
      ...historyEmails.map((item) => item.serial_number || item.subject || "").filter(Boolean)
    ].slice(0, 8),
    language: likelyArabic ? "ar" : "en",
    provider: "rules"
  });
}

async function generateReplyDraftWithHistory(context = {}) {
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();
  const fallback = buildRulesFallbackReplyDraft(context);

  if (!openAiConfig && !geminiConfig) {
    return fallback;
  }

  const prompt = buildHistoricalReplyPrompt(context);
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
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You draft enterprise email replies. Return only JSON." },
            { role: "user", content: prompt }
          ]
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error?.message || "OpenAI reply drafting request failed.");
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
              temperature: 0.2,
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
        throw new Error(json?.error?.message || "Gemini reply drafting request failed.");
      }
      payload = {
        ...parseLlmJson(json?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || ""),
        provider: "gemini"
      };
    }

    return normalizeDraftReplyPayload(payload, fallback);
  } catch {
    return fallback;
  }
}

function normalizePolicySeverity(value = "", fallback = "low") {
  const normalized = String(value || fallback || "low").trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizePolicyVerdict(value = "", fallback = "clear") {
  const normalized = String(value || fallback || "clear").trim().toLowerCase();
  if (["clear", "review_required", "blocked"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizePolicyIssues(value = [], fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source
    .map((item) => ({
      type: String(item?.type || "general").trim() || "general",
      title: String(item?.title || "").trim(),
      severity: normalizePolicySeverity(item?.severity, "medium"),
      details: String(item?.details || "").trim(),
      supported_by_history: Boolean(item?.supported_by_history),
      historical_reference: String(item?.historical_reference || "").trim()
    }))
    .filter((item) => item.title || item.details);
}

function normalizeResponsePolicyGuardPayload(payload = {}, fallback = {}) {
  const supportedPointsSource = Array.isArray(payload?.supported_points)
    ? payload.supported_points
    : Array.isArray(fallback?.supported_points)
      ? fallback.supported_points
      : [];
  const checkedReferencesSource = Array.isArray(payload?.checked_references)
    ? payload.checked_references
    : Array.isArray(fallback?.checked_references)
      ? fallback.checked_references
      : [];

  return {
    verdict: normalizePolicyVerdict(payload?.verdict, fallback?.verdict || "clear"),
    severity: normalizePolicySeverity(payload?.severity, fallback?.severity || "low"),
    summary: String(payload?.summary || fallback?.summary || "").trim(),
    issues: normalizePolicyIssues(payload?.issues, fallback?.issues),
    supported_points: supportedPointsSource.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8),
    checked_references: checkedReferencesSource.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 10),
    provider: String(payload?.provider || fallback?.provider || "rules").trim() || "rules"
  };
}

function buildResponsePolicyGuardPrompt({
  sourceEmail = {},
  project = null,
  historyEmails = [],
  contractMemoryEntries = [],
  draftSubject = "",
  draftBody = ""
} = {}) {
  const historySection = historyEmails.length
    ? historyEmails.map((item, index) => [
      `History #${index + 1}`,
      `Serial: ${item.serial_number || "-"}`,
      `Subject: ${item.subject || "-"}`,
      `Date: ${item.sent_at || item.received_at || ""}`,
      `AI Summary: ${item.ai_summary || "-"}`,
      "Body Excerpt:",
      item.body_excerpt || "-"
    ].join("\n")).join("\n\n----------------\n\n")
    : "No historical project emails were found.";
  const contractMemorySection = contractMemoryEntries.length
    ? contractMemoryEntries.map((item, index) => [
      `Contract Memory #${index + 1}`,
      `Type: ${item.memory_type || "general"}`,
      `Title: ${item.title || "-"}`,
      `Reference: ${item.reference_key || "-"}`,
      `Source File: ${item.source_file_name || "-"}`,
      `Snippet: ${item.snippet || "-"}`
    ].join("\n")).join("\n\n----------------\n\n")
    : "No structured contract memory snippets were found.";

  return [
    "You are a Response Policy Guard for an enterprise email system.",
    "Review the proposed reply draft against the historical project correspondence and structured contract memory.",
    "Identify contradictions, unsupported promises, pricing exposure, deadline changes, legal commitments, approval claims, and mismatches against contractual snippets.",
    "Return strict JSON only.",
    "JSON schema:",
    "{",
    '  "verdict": "clear|review_required|blocked",',
    '  "severity": "low|medium|high|critical",',
    '  "summary": "short Arabic summary",',
    '  "issues": [{',
    '    "type": "commitment|deadline|pricing|legal|approval|scope|general",',
    '    "title": "short issue title",',
    '    "severity": "low|medium|high|critical",',
    '    "details": "clear explanation in Arabic",',
    '    "supported_by_history": true/false,',
    '    "historical_reference": "serial/subject or empty"',
    "  }],",
    '  "supported_points": ["claims in the draft that are supported by history"],',
    '  "checked_references": ["serials or subjects used for validation"],',
    '  "provider": "openai|gemini|rules"',
    "}",
    "Rules:",
    "- Focus on unsupported promises, delivery commitments, approvals, legal guarantees, price/discount statements, payment confirmations, deadline commitments, and scope changes.",
    "- If the draft introduces a strong promise without historical support, severity should be high or critical.",
    "- If the draft contradicts an earlier rejection, limitation, or unresolved issue, verdict should be review_required or blocked.",
    "- Use Arabic in summary/details when possible.",
    "- Do not invent references; only cite references present in the provided history or contract memory.",
    "",
    `Project: ${project?.project_code || "Unknown"} | ${project?.project_name || ""}`,
    "Current source email:",
    `Subject: ${sourceEmail?.subject || ""}`,
    `From: ${sourceEmail?.sender_name || ""} <${sourceEmail?.sender_email || ""}>`,
    `Body: ${sourceEmail?.body || ""}`,
    "",
    "Proposed draft to validate:",
    `Subject: ${draftSubject || ""}`,
    "Body:",
    draftBody || "",
    "",
    "Historical project context:",
    historySection,
    "",
    "Structured contract memory:",
    contractMemorySection
  ].join("\n");
}

function containsAny(text = "", patterns = []) {
  const normalized = String(text || "").toLowerCase();
  return patterns.some((pattern) => normalized.includes(String(pattern).toLowerCase()));
}

function extractDraftDates(text = "") {
  const matches = String(text || "").match(/\b\d{4}-\d{2}-\d{2}\b/g);
  return matches ? [...new Set(matches)] : [];
}

function buildRulesFallbackResponsePolicyGuard({
  sourceEmail = {},
  project = null,
  historyEmails = [],
  contractMemoryEntries = [],
  draftSubject = "",
  draftBody = ""
} = {}) {
  const draftText = `${draftSubject || ""}\n${draftBody || ""}`.toLowerCase();
  const historyText = historyEmails
    .map((item) => `${item.subject || ""}\n${item.ai_summary || ""}\n${item.body_excerpt || ""}`)
    .join("\n")
    .toLowerCase();
  const contractMemoryText = contractMemoryEntries
    .map((item) => `${item.title || ""}\n${item.snippet || ""}\n${item.reference_key || ""}`)
    .join("\n")
    .toLowerCase();
  const evidenceText = `${historyText}\n${contractMemoryText}`;
  const references = [
    ...contractMemoryEntries.map((item) => item.reference_key || item.title || "").filter(Boolean),
    ...historyEmails.map((item) => item.serial_number || item.subject || "").filter(Boolean)
  ].slice(0, 8);
  const issues = [];
  const supportedPoints = [];

  const strongCommitmentPatterns = ["guarantee", "guaranteed", "commit", "committed", "we confirm", "confirmed", "نضمن", "التزام", "نؤكد", "ملتزمون"];
  if (containsAny(draftText, strongCommitmentPatterns) && !containsAny(evidenceText, strongCommitmentPatterns)) {
    issues.push({
      type: "commitment",
      title: "التزام جديد غير مدعوم",
      severity: "high",
      details: "مسودة الرد تحتوي على تعهد أو تأكيد قوي لا يظهر بوضوح في المراسلات السابقة للمشروع.",
      supported_by_history: false,
      historical_reference: references[0] || ""
    });
  } else if (containsAny(draftText, strongCommitmentPatterns)) {
    supportedPoints.push("يوجد في التاريخ ما يدعم وجود التزام أو تأكيد مشابه.");
  }

  const pricingPatterns = ["price", "pricing", "discount", "quotation", "quoted", "usd", "jod", "eur", "$", "سعر", "خصم", "عرض سعر", "دولار", "يورو"];
  if (containsAny(draftText, pricingPatterns) && !containsAny(evidenceText, pricingPatterns)) {
    issues.push({
      type: "pricing",
      title: "إشارة سعرية جديدة",
      severity: "high",
      details: "المسودة تتضمن سعرًا أو خصمًا أو عرضًا ماليًا جديدًا غير ظاهر في السجل التاريخي المتاح.",
      supported_by_history: false,
      historical_reference: references[0] || ""
    });
  }

  const legalPatterns = ["liability", "penalty", "waive", "indemnity", "guarantee", "legal", "مسؤولية", "غرامة", "إعفاء", "ضمان", "التزام قانوني"];
  if (containsAny(draftText, legalPatterns) && !containsAny(evidenceText, legalPatterns)) {
    issues.push({
      type: "legal",
      title: "التزام قانوني أو تعاقدي غير موثق",
      severity: "critical",
      details: "المسودة تحتوي على لغة قانونية أو ضمانات أو تنازلات لا يدعمها تاريخ المشروع الحالي.",
      supported_by_history: false,
      historical_reference: references[0] || ""
    });
  }

  const approvalPatterns = ["approved", "approval granted", "confirmed by management", "approved internally", "موافقة", "تمت الموافقة", "اعتماد", "مصادق"];
  const negativeApprovalHistory = ["rejected", "not approved", "pending approval", "مرفوض", "لم تتم الموافقة", "بانتظار الموافقة"];
  if (containsAny(draftText, approvalPatterns) && containsAny(evidenceText, negativeApprovalHistory)) {
    issues.push({
      type: "approval",
      title: "احتمال تعارض مع حالة الموافقات السابقة",
      severity: "high",
      details: "المسودة توحي بوجود موافقة أو اعتماد، بينما السجل التاريخي يحتوي مؤشرات على رفض أو انتظار موافقة.",
      supported_by_history: false,
      historical_reference: references[0] || ""
    });
  }

  const draftDates = extractDraftDates(draftText);
  const unsupportedDates = draftDates.filter((date) => !evidenceText.includes(date));
  if (unsupportedDates.length) {
    issues.push({
      type: "deadline",
      title: "موعد جديد يحتاج مراجعة",
      severity: "medium",
      details: `المسودة تتضمن موعدًا أو تاريخًا (${unsupportedDates.join(", ")}) لا يظهر ضمن السياق التاريخي المتاح.`,
      supported_by_history: false,
      historical_reference: references[0] || ""
    });
  }

  const verdict = issues.some((item) => item.severity === "critical")
    ? "blocked"
    : issues.some((item) => item.severity === "high" || item.severity === "medium")
      ? "review_required"
      : "clear";
  const severity = issues.some((item) => item.severity === "critical")
    ? "critical"
    : issues.some((item) => item.severity === "high")
      ? "high"
      : issues.some((item) => item.severity === "medium")
        ? "medium"
        : "low";

  return normalizeResponsePolicyGuardPayload({
    verdict,
    severity,
    summary: issues.length
      ? `تم رصد ${issues.length} نقطة تحتاج مراجعة قبل اعتماد الرد.`
      : `لم يتم رصد تعارضات واضحة في مسودة الرد الحالية${project?.project_code ? ` ضمن المشروع ${project.project_code}` : ""}.`,
    issues,
    supported_points: supportedPoints,
    checked_references: references,
    provider: "rules"
  });
}

async function generateResponsePolicyGuard(context = {}) {
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();
  const fallback = buildRulesFallbackResponsePolicyGuard(context);

  if (!openAiConfig && !geminiConfig) {
    return fallback;
  }

  const prompt = buildResponsePolicyGuardPrompt(context);
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
            { role: "system", content: "You validate enterprise email replies. Return only JSON." },
            { role: "user", content: prompt }
          ]
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error?.message || "OpenAI response policy guard request failed.");
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
        throw new Error(json?.error?.message || "Gemini response policy guard request failed.");
      }
      payload = {
        ...parseLlmJson(json?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || ""),
        provider: "gemini"
      };
    }

    return normalizeResponsePolicyGuardPayload(payload, fallback);
  } catch {
    return fallback;
  }
}

export {
  analyzeDraftWithLlm,
  analyzeInboundTaskExtractionWithLlm,
  analyzeEmailBrain,
  normalizeEmailBrainPayload,
  generateReplyDraftWithHistory,
  generateResponsePolicyGuard
};
