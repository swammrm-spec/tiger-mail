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

function normalizeOcrText(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildVisionOcrPrompt(fileName = "") {
  return [
    "Extract the full readable text from this contract-related document or image.",
    "Focus on clauses, prices, payment terms, dates, obligations, penalties, warranties, scope, and legal wording.",
    "Return plain text only.",
    `File name: ${fileName || "attachment"}`
  ].join("\n");
}

async function extractTextWithVisionOcr({ fileBuffer, mimeType = "", fileName = "" } = {}) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
    return "";
  }

  const normalizedMime = String(mimeType || "").trim().toLowerCase() || "application/octet-stream";
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();
  const prompt = buildVisionOcrPrompt(fileName);

  if (geminiConfig) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiConfig.model)}:generateContent?key=${encodeURIComponent(geminiConfig.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096
            },
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: normalizedMime,
                      data: fileBuffer.toString("base64")
                    }
                  }
                ]
              }
            ]
          })
        }
      );
      const json = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = json?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || "";
        const normalized = normalizeOcrText(text);
        if (normalized) {
          return normalized;
        }
      }
    } catch {
      // Fall through to other OCR paths.
    }
  }

  if (openAiConfig && normalizedMime.startsWith("image/")) {
    try {
      const response = await fetch(`${openAiConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: openAiConfig.model,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${normalizedMime};base64,${fileBuffer.toString("base64")}`
                  }
                }
              ]
            }
          ]
        })
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok) {
        const content = json?.choices?.[0]?.message?.content || "";
        const normalized = normalizeOcrText(typeof content === "string" ? content : "");
        if (normalized) {
          return normalized;
        }
      }
    } catch {
      // Ignore OpenAI OCR fallback errors.
    }
  }

  return "";
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

function normalizeContractClauseType(value = "", fallback = "general") {
  const normalized = String(value || fallback || "general").trim().toLowerCase();
  if (["payment_terms", "delivery_deadlines", "penalties", "warranties", "scope_of_work", "general"].includes(normalized)) {
    return normalized;
  }
  return "general";
}

function normalizeStructuredClauseConfidence(value = "", fallback = "medium") {
  const normalized = String(value || fallback || "medium").trim().toLowerCase();
  if (["high", "medium", "low"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeStructuredContractClausesPayload(payload = {}, fallback = {}) {
  const fallbackClauses = Array.isArray(fallback?.clauses) ? fallback.clauses : [];
  const source = Array.isArray(payload?.clauses) ? payload.clauses : fallbackClauses;
  return {
    clauses: source
      .map((item, index) => {
        const fallbackItem = fallbackClauses[index] || {};
        return {
          clause_type: normalizeContractClauseType(item?.clause_type, fallbackItem?.clause_type || "general"),
          clause_title: String(item?.clause_title || fallbackItem?.clause_title || "").trim(),
          clause_value: String(item?.clause_value || fallbackItem?.clause_value || "").trim(),
          normalized_value: String(item?.normalized_value || fallbackItem?.normalized_value || "").trim(),
          confidence: normalizeStructuredClauseConfidence(item?.confidence, fallbackItem?.confidence || "medium")
        };
      })
      .filter((item) => item.clause_value)
      .slice(0, 8),
    provider: String(payload?.provider || fallback?.provider || "rules").trim() || "rules"
  };
}

function buildStructuredContractClausePrompt({
  snippet = "",
  title = "",
  memoryType = "",
  referenceKey = "",
  sourceFileName = ""
} = {}) {
  return [
    "You are a contract clause structuring engine.",
    "Convert the provided contract snippet into structured clauses.",
    "Return strict JSON only.",
    "JSON schema:",
    "{",
    '  "clauses": [{',
    '    "clause_type": "payment_terms|delivery_deadlines|penalties|warranties|scope_of_work|general",',
    '    "clause_title": "short title",',
    '    "clause_value": "the exact clause meaning in concise text",',
    '    "normalized_value": "normalized summary suitable for search/policy checks",',
    '    "confidence": "high|medium|low"',
    "  }],",
    '  "provider": "openai|gemini|rules"',
    "}",
    "Rules:",
    "- Extract only clauses supported by the snippet.",
    "- Prefer the requested business clause types over generic output.",
    "- If the snippet contains one clause only, return one item.",
    "- Keep clause_value concise but specific.",
    "",
    `Title: ${title || "-"}`,
    `Memory type hint: ${memoryType || "-"}`,
    `Reference: ${referenceKey || "-"}`,
    `Source file: ${sourceFileName || "-"}`,
    "Snippet:",
    snippet || ""
  ].join("\n");
}

function buildRulesFallbackStructuredContractClauses({
  snippet = "",
  title = "",
  memoryType = ""
} = {}) {
  const text = String(snippet || "").trim();
  const lower = text.toLowerCase();
  const clauses = [];

  const pushClause = (clauseType, clauseTitle, clauseValue, normalizedValue, confidence = "medium") => {
    if (!clauseValue) return;
    clauses.push({
      clause_type: normalizeContractClauseType(clauseType),
      clause_title: clauseTitle,
      clause_value: clauseValue.trim(),
      normalized_value: normalizedValue.trim(),
      confidence: normalizeStructuredClauseConfidence(confidence)
    });
  };

  if (/(payment|paid|advance|net\s*\d+|due upon|invoice|remittance|دفعة|دفعات|سداد|فاتورة|تحويل|استحقاق)/i.test(lower) || memoryType === "payment_terms") {
    pushClause(
      "payment_terms",
      "Payment Terms",
      text,
      text.replace(/\s+/g, " ").slice(0, 240),
      memoryType === "payment_terms" ? "high" : "medium"
    );
  }
  if (/(delivery|deliver|within\s+\d+\s+(day|days|week|weeks)|deadline|no later than|موعد تسليم|تسليم|خلال\s+\d+|مهلة|جدول زمني)/i.test(lower) || memoryType === "sla") {
    pushClause(
      "delivery_deadlines",
      "Delivery Deadline",
      text,
      text.replace(/\s+/g, " ").slice(0, 240),
      memoryType === "sla" ? "high" : "medium"
    );
  }
  if (/(penalt|liquidated damages|fine|breach|غرامة|جزاء|تعويض|مخالفة)/i.test(lower) || /penalt/i.test(title || "")) {
    pushClause(
      "penalties",
      "Penalty Clause",
      text,
      text.replace(/\s+/g, " ").slice(0, 240),
      "medium"
    );
  }
  if (/(warrant|guarantee|defect liability|support period|ضمان|كفالة|صلاحية|فترة دعم)/i.test(lower) || memoryType === "legal") {
    pushClause(
      "warranties",
      "Warranty Clause",
      text,
      text.replace(/\s+/g, " ").slice(0, 240),
      memoryType === "legal" ? "medium" : "low"
    );
  }
  if (/(scope of work|statement of work|deliverables|includes|shall provide|نطاق العمل|يشمل|المخرجات|الأعمال المطلوبة|المواصفات)/i.test(lower) || memoryType === "scope") {
    pushClause(
      "scope_of_work",
      "Scope Of Work",
      text,
      text.replace(/\s+/g, " ").slice(0, 240),
      memoryType === "scope" ? "high" : "medium"
    );
  }

  if (!clauses.length && text) {
    pushClause(
      memoryType === "contract" ? "general" : memoryType,
      title || "General Contract Clause",
      text,
      text.replace(/\s+/g, " ").slice(0, 240),
      "low"
    );
  }

  return normalizeStructuredContractClausesPayload({
    clauses,
    provider: "rules"
  });
}

async function extractStructuredContractClauses(context = {}) {
  const openAiConfig = getOpenAiConfig();
  const geminiConfig = getGeminiConfig();
  const fallback = buildRulesFallbackStructuredContractClauses(context);

  if (!openAiConfig && !geminiConfig) {
    return fallback;
  }

  const prompt = buildStructuredContractClausePrompt(context);
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
            { role: "system", content: "You extract structured contract clauses. Return only JSON." },
            { role: "user", content: prompt }
          ]
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error?.message || "OpenAI structured clause extraction failed.");
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
        throw new Error(json?.error?.message || "Gemini structured clause extraction failed.");
      }
      payload = {
        ...parseLlmJson(json?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || ""),
        provider: "gemini"
      };
    }
    return normalizeStructuredContractClausesPayload(payload, fallback);
  } catch {
    return fallback;
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
  structuredContractClauses = [],
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
  const clauseSection = structuredContractClauses.length
    ? structuredContractClauses.map((item, index) => {
      return [
        `Clause #${index + 1}`,
        `Type: ${item.clause_type || "general"}`,
        `Title: ${item.clause_title || "-"}`,
        `Value: ${item.clause_value || "-"}`,
        `Normalized: ${item.normalized_value || "-"}`,
        `Reference: ${item.reference_key || "-"}`
      ].join("\n");
    }).join("\n\n----------------\n\n")
    : "No structured contract clauses were found.";

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
    "- Do not invent facts, approvals, prices, deadlines, or commitments that are not supported by the current email, historical correspondence, structured clauses, or contract memory snippets.",
    "- Use structured contract clauses as the primary contractual source whenever available.",
    "- If the historical context, structured clauses, or contract memory contains previous commitments, preserve continuity and tone.",
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
    contractMemorySection,
    "",
    "Structured contract clauses:",
    clauseSection
  ].join("\n");
}

function buildRulesFallbackReplyDraft({
  sourceEmail = {},
  project = null,
  historyEmails = [],
  contractMemoryEntries = [],
  structuredContractClauses = [],
  requestedSubject = ""
} = {}) {
  const subject = String(
    requestedSubject
    || sourceEmail?.subject
    || "RE: Follow-up"
  ).trim();
  const primaryReference = structuredContractClauses[0]?.reference_key || contractMemoryEntries[0]?.reference_key || historyEmails[0]?.serial_number || historyEmails[0]?.subject || "";
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
      contractMemoryEntries.length ? `Used ${contractMemoryEntries.length} contract memory snippet(s)` : "No contract memory snippets were available",
      structuredContractClauses.length ? `Used ${structuredContractClauses.length} structured contract clause(s)` : "No structured contract clauses were available"
    ],
    historical_references: [
      ...structuredContractClauses.map((item) => item.reference_key || item.clause_title || "").filter(Boolean),
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

function normalizeClauseConflictType(value = "", fallback = "general_conflict") {
  const normalized = String(value || fallback || "general_conflict").trim().toLowerCase();
  if (["deadline_conflict", "payment_mismatch", "scope_expansion", "unsupported_warranty", "general_conflict"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizePolicyConflicts(value = [], fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source
    .map((item) => ({
      conflict_type: normalizeClauseConflictType(item?.conflict_type, "general_conflict"),
      clause_type: String(item?.clause_type || "general").trim() || "general",
      severity: normalizePolicySeverity(item?.severity, "medium"),
      title: String(item?.title || "").trim(),
      details: String(item?.details || "").trim(),
      reference_key: String(item?.reference_key || "").trim(),
      expected_value: String(item?.expected_value || "").trim(),
      draft_evidence: String(item?.draft_evidence || "").trim()
    }))
    .filter((item) => item.title || item.details || item.expected_value || item.draft_evidence);
}

function normalizeRepairSuggestions(value = [], fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source
    .map((item) => ({
      conflict_type: normalizeClauseConflictType(item?.conflict_type, "general_conflict"),
      title: String(item?.title || "").trim(),
      suggested_text: String(item?.suggested_text || "").trim(),
      rationale: String(item?.rationale || "").trim(),
      reference_key: String(item?.reference_key || "").trim()
    }))
    .filter((item) => item.suggested_text);
}

function normalizeSafeRewrite(value = {}, fallback = {}) {
  return {
    title: String(value?.title || fallback?.title || "").trim(),
    rewritten_body: String(value?.rewritten_body || fallback?.rewritten_body || "").trim(),
    rationale: String(value?.rationale || fallback?.rationale || "").trim()
  };
}

function extractPercentTokens(text = "") {
  const matches = String(text || "").match(/\b\d{1,3}\s?%/g);
  return matches ? [...new Set(matches.map((item) => item.replace(/\s+/g, "")))] : [];
}

function extractCurrencyTokens(text = "") {
  const matches = String(text || "").match(/(?:usd|jod|eur|sar|aed|\$|€|دولار|دينار|ريال|درهم)\s?\d[\d,\.]*|\b\d[\d,\.]*\s?(?:usd|jod|eur|sar|aed|دولار|دينار|ريال|درهم)\b/gi);
  return matches ? [...new Set(matches.map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()))] : [];
}

function extractDurationTokens(text = "") {
  const matches = String(text || "").match(/\b\d+\s?(?:day|days|week|weeks|month|months|year|years|يوم|أيام|اسبوع|أسبوع|أسابيع|شهر|أشهر|سنة|سنوات)\b/gi);
  return matches ? [...new Set(matches.map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()))] : [];
}

function collectClauseComparableTokens(text = "") {
  return [
    ...extractDraftDates(text),
    ...extractPercentTokens(text),
    ...extractCurrencyTokens(text),
    ...extractDurationTokens(text)
  ];
}

function overlapCount(left = [], right = []) {
  const rightSet = new Set((right || []).map((item) => String(item || "").toLowerCase()));
  return (left || []).filter((item) => rightSet.has(String(item || "").toLowerCase())).length;
}

function buildClauseConflictIssue(conflict = {}) {
  const typeMap = {
    deadline_conflict: "deadline",
    payment_mismatch: "pricing",
    scope_expansion: "scope",
    unsupported_warranty: "legal",
    general_conflict: "general"
  };
  return {
    type: typeMap[conflict.conflict_type] || "general",
    title: conflict.title || "Clause conflict detected",
    severity: normalizePolicySeverity(conflict.severity, "medium"),
    details: conflict.details || "Contract conflict requires review.",
    supported_by_history: false,
    historical_reference: conflict.reference_key || ""
  };
}

function buildRepairSuggestionFromConflict(conflict = {}) {
  const reference = conflict.reference_key ? ` بحسب المرجع ${conflict.reference_key}` : "";
  const expected = conflict.expected_value ? ` ${conflict.expected_value}` : "";
  const byType = {
    deadline_conflict: {
      title: "صياغة بديلة لموعد التسليم",
      suggested_text: `نشير إلى أن الجدول الزمني المعتمد حاليًا${reference} هو:${expected} وعليه سنلتزم بما هو معتمد تعاقديًا أو نرفع أي تعديل مقترح للمراجعة والاعتماد قبل تأكيده.`,
      rationale: "يزيل الموعد غير المدعوم ويعيد الرد إلى المدة أو التاريخ المعتمد."
    },
    payment_mismatch: {
      title: "صياغة بديلة لشروط الدفع",
      suggested_text: `لغايات الدقة التعاقدية، تبقى شروط الدفع المعتمدة${reference} كما يلي:${expected} وأي تعديل مالي أو نسبة دفعات إضافية يحتاج إلى مراجعة واعتماد رسمي قبل تأكيده.`,
      rationale: "يمنع تثبيت شروط دفع جديدة ويعيد الرد إلى الشرط المالي القائم."
    },
    scope_expansion: {
      title: "صياغة بديلة لنطاق العمل",
      suggested_text: `نؤكد أن نطاق العمل الحالي${reference} يقتصر على:${expected} وأي أعمال إضافية أو توسعة في النطاق سيتم التعامل معها كطلب منفصل بعد المراجعة الفنية والتجارية اللازمة.`,
      rationale: "يمنع توسيع النطاق مجانًا أو ضمنيًا بدون سند تعاقدي."
    },
    unsupported_warranty: {
      title: "صياغة بديلة للضمان",
      suggested_text: `فيما يتعلق بالضمان أو الدعم، نعتمد فقط ما هو منصوص عليه${reference}${expected ? ` وهو:${expected}` : ""}، وأي تمديد أو التزام إضافي يحتاج إلى اعتماد تعاقدي صريح قبل تأكيده.`,
      rationale: "يسحب وعد الضمان غير المدعوم ويعيده إلى النص المعتمد."
    },
    general_conflict: {
      title: "صياغة بديلة آمنة",
      suggested_text: `حرصًا على الالتزام بالتعاقد الحالي${reference}، سنعتمد ما هو منصوص عليه حاليًا${expected ? ` وهو:${expected}` : ""}، وأي تغيير مقترح سيتم تأكيده بعد المراجعة والاعتماد الرسمي.`,
      rationale: "يوفر صياغة حذرة عند وجود تعارض عام غير مصنف."
    }
  };
  return {
    conflict_type: conflict.conflict_type || "general_conflict",
    title: byType[conflict.conflict_type || "general_conflict"]?.title || byType.general_conflict.title,
    suggested_text: byType[conflict.conflict_type || "general_conflict"]?.suggested_text || byType.general_conflict.suggested_text,
    rationale: byType[conflict.conflict_type || "general_conflict"]?.rationale || byType.general_conflict.rationale,
    reference_key: conflict.reference_key || ""
  };
}

function buildRepairSuggestionsFromConflicts(conflicts = []) {
  return normalizeRepairSuggestions(
    (Array.isArray(conflicts) ? conflicts : []).map((conflict) => buildRepairSuggestionFromConflict(conflict)),
    []
  ).slice(0, 6);
}

function splitDraftReplySections(draftBody = "") {
  const text = String(draftBody || "");
  const marker = "----- Original Message -----";
  const markerIndex = text.indexOf(marker);
  const editableBody = markerIndex === -1 ? text.trim() : text.slice(0, markerIndex).trim();
  const quotedBlock = markerIndex === -1 ? "" : text.slice(markerIndex).trim();
  return { editableBody, quotedBlock };
}

function buildFallbackSafeRewrite({
  draftSubject = "",
  draftBody = "",
  repairSuggestions = [],
  project = null
} = {}) {
  const { editableBody } = splitDraftReplySections(draftBody);
  const lines = editableBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const greeting = lines.find((line) => /^(dear|hello|hi|السادة|السيد|الأخوة|تحية)/i.test(line)) || "";
  const closingCandidates = lines.filter((line) => /^(best regards|regards|sincerely|thanks|مع الشكر|وتفضلوا|وتفضلوا بقبول|تحياتي)/i.test(line));
  const closing = closingCandidates[closingCandidates.length - 1] || "";
  const uniqueRepairs = [...new Set((repairSuggestions || []).map((item) => String(item?.suggested_text || "").trim()).filter(Boolean))];
  const rewrittenBody = [
    greeting,
    uniqueRepairs.join("\n\n") || editableBody,
    closing
  ].filter(Boolean).join("\n\n").trim();

  return normalizeSafeRewrite({
    title: project?.project_code ? `Safe rewrite for ${project.project_code}` : "Safe rewrite",
    rewritten_body: rewrittenBody,
    rationale: uniqueRepairs.length
      ? "يجمع هذا النص كل اقتراحات الإصلاح المتوافقة في مسودة واحدة أكثر أمانًا واتساقًا مع العقد."
      : "لم تكن هناك اقتراحات إصلاح كافية لإعادة كتابة المسودة تلقائيًا."
  });
}

function detectClauseConflicts({
  structuredContractClauses = [],
  historyEmails = [],
  draftSubject = "",
  draftBody = ""
} = {}) {
  const draftText = `${draftSubject || ""}\n${draftBody || ""}`;
  const normalizedDraft = draftText.toLowerCase();
  const historyText = historyEmails
    .map((item) => `${item.subject || ""}\n${item.ai_summary || ""}\n${item.body_excerpt || ""}`)
    .join("\n")
    .toLowerCase();
  const draftDateTokens = extractDraftDates(draftText);
  const draftPaymentTokens = [...extractPercentTokens(draftText), ...extractCurrencyTokens(draftText)];
  const draftDurationTokens = extractDurationTokens(draftText);
  const conflicts = [];

  for (const clause of structuredContractClauses || []) {
    const clauseType = String(clause?.clause_type || "general").toLowerCase();
    const clauseText = `${clause?.clause_title || ""}\n${clause?.clause_value || ""}\n${clause?.normalized_value || ""}`;
    const clauseTokens = collectClauseComparableTokens(clauseText);
    const referenceKey = clause?.reference_key || "";

    if (clauseType === "delivery_deadlines" && (draftDateTokens.length || draftDurationTokens.length || containsAny(normalizedDraft, ["deliver by", "delivery by", "موعد التسليم", "سيتم التسليم", "within", "خلال"]))) {
      const draftTokens = [...draftDateTokens, ...draftDurationTokens];
      const clauseOverlap = overlapCount(draftTokens, clauseTokens);
      const historyOverlap = overlapCount(draftTokens, collectClauseComparableTokens(historyText));
      if (draftTokens.length && !clauseOverlap && !historyOverlap) {
        conflicts.push({
          conflict_type: "deadline_conflict",
          clause_type: clauseType,
          severity: "high",
          title: "تعارض في موعد التسليم",
          details: "مسودة الرد تقترح موعدًا أو مدة تسليم تختلف عن البند التعاقدي الحالي ولا يظهر لها دعم واضح في المراسلات اللاحقة.",
          reference_key: referenceKey,
          expected_value: clause.normalized_value || clause.clause_value || "",
          draft_evidence: draftTokens.join(", ")
        });
      }
    }

    if (clauseType === "payment_terms" && (draftPaymentTokens.length || containsAny(normalizedDraft, ["payment", "invoice", "advance", "دفعة", "دفعات", "سداد", "فاتورة"]))) {
      const clauseOverlap = overlapCount(draftPaymentTokens, clauseTokens);
      const historyOverlap = overlapCount(draftPaymentTokens, collectClauseComparableTokens(historyText));
      if (draftPaymentTokens.length && !clauseOverlap && !historyOverlap) {
        conflicts.push({
          conflict_type: "payment_mismatch",
          clause_type: clauseType,
          severity: "high",
          title: "اختلاف في شروط الدفع",
          details: "المسودة تحتوي على نسب أو مبالغ أو شروط دفع لا تتطابق مع البند التعاقدي الحالي ولا مع المراسلات اللاحقة.",
          reference_key: referenceKey,
          expected_value: clause.normalized_value || clause.clause_value || "",
          draft_evidence: draftPaymentTokens.join(", ")
        });
      }
    }

    if (clauseType === "scope_of_work" && containsAny(normalizedDraft, ["additional", "extra", "also include", "in addition", "free of charge", "إضافة", "إضافي", "يشمل أيضًا", "بدون تكلفة", "مجاني"])) {
      const clauseLower = clauseText.toLowerCase();
      const historySupportsExpansion = containsAny(historyText, ["additional", "extra", "change request", "variation", "إضافة", "إضافي", "أعمال إضافية", "تغيير نطاق"]);
      if (!historySupportsExpansion && !containsAny(clauseLower, ["additional", "extra", "variation", "إضافة", "إضافي"])) {
        conflicts.push({
          conflict_type: "scope_expansion",
          clause_type: clauseType,
          severity: "high",
          title: "توسعة نطاق غير مدعومة",
          details: "مسودة الرد توسّع نطاق العمل أو تضيف التزامًا إضافيًا لا يظهر في البند الحالي ولا في المراسلات اللاحقة.",
          reference_key: referenceKey,
          expected_value: clause.normalized_value || clause.clause_value || "",
          draft_evidence: draftText.slice(0, 220).trim()
        });
      }
    }

    if (clauseType === "warranties" && containsAny(normalizedDraft, ["warranty", "guarantee", "support period", "extended support", "ضمان", "كفالة", "تمديد الضمان", "فترة دعم"])) {
      const draftWarrantyTokens = [...draftDurationTokens, ...extractPercentTokens(draftText)];
      const clauseOverlap = overlapCount(draftWarrantyTokens, clauseTokens);
      const historySupportsWarranty = containsAny(historyText, ["warranty", "guarantee", "support period", "ضمان", "كفالة", "فترة دعم"]);
      if ((!draftWarrantyTokens.length && !historySupportsWarranty) || (draftWarrantyTokens.length && !clauseOverlap && !historySupportsWarranty)) {
        conflicts.push({
          conflict_type: "unsupported_warranty",
          clause_type: clauseType,
          severity: "critical",
          title: "ضمان غير مدعوم تعاقديًا",
          details: "المسودة تقدّم ضمانًا أو فترة دعم لا تتطابق مع البند الحالي ولا يوجد ما يدعمها بوضوح في المراسلات اللاحقة.",
          reference_key: referenceKey,
          expected_value: clause.normalized_value || clause.clause_value || "",
          draft_evidence: draftText.slice(0, 220).trim()
        });
      }
    }
  }

  if (!structuredContractClauses.some((item) => String(item?.clause_type || "").toLowerCase() === "warranties")
    && containsAny(normalizedDraft, ["warranty", "guarantee", "support period", "ضمان", "كفالة", "فترة دعم"])) {
    conflicts.push({
      conflict_type: "unsupported_warranty",
      clause_type: "warranties",
      severity: "critical",
      title: "ضمان مذكور دون بند تعاقدي",
      details: "المسودة تحتوي على ضمان أو فترة دعم، لكن لا يوجد بند ضمان منظم ضمن العقد الحالي يمكن الاستناد إليه.",
      reference_key: structuredContractClauses[0]?.reference_key || "",
      expected_value: "",
      draft_evidence: draftText.slice(0, 220).trim()
    });
  }

  return normalizePolicyConflicts(conflicts, []);
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
  const fallbackConflicts = Array.isArray(fallback?.conflicts) ? fallback.conflicts : [];
  const fallbackRepairSuggestions = Array.isArray(fallback?.repair_suggestions) ? fallback.repair_suggestions : [];
  const fallbackSafeRewrite = fallback?.safe_rewrite || {};

  return {
    verdict: normalizePolicyVerdict(payload?.verdict, fallback?.verdict || "clear"),
    severity: normalizePolicySeverity(payload?.severity, fallback?.severity || "low"),
    summary: String(payload?.summary || fallback?.summary || "").trim(),
    issues: normalizePolicyIssues(payload?.issues, fallback?.issues),
    conflicts: normalizePolicyConflicts(payload?.conflicts, fallbackConflicts),
    repair_suggestions: normalizeRepairSuggestions(payload?.repair_suggestions, fallbackRepairSuggestions),
    safe_rewrite: normalizeSafeRewrite(payload?.safe_rewrite, fallbackSafeRewrite),
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
  structuredContractClauses = [],
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
  const clauseSection = structuredContractClauses.length
    ? structuredContractClauses.map((item, index) => [
      `Clause #${index + 1}`,
      `Type: ${item.clause_type || "general"}`,
      `Title: ${item.clause_title || "-"}`,
      `Value: ${item.clause_value || "-"}`,
      `Normalized: ${item.normalized_value || "-"}`,
      `Reference: ${item.reference_key || "-"}`
    ].join("\n")).join("\n\n----------------\n\n")
    : "No structured contract clauses were found.";

  return [
    "You are a Response Policy Guard for an enterprise email system.",
    "Review the proposed reply draft against the historical project correspondence, structured contract memory, and structured contract clauses.",
    "Identify contradictions, unsupported promises, pricing exposure, deadline changes, legal commitments, approval claims, and mismatches against contractual clauses.",
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
    '  "conflicts": [{',
    '    "conflict_type": "deadline_conflict|payment_mismatch|scope_expansion|unsupported_warranty|general_conflict",',
    '    "clause_type": "payment_terms|delivery_deadlines|penalties|warranties|scope_of_work|general",',
    '    "severity": "low|medium|high|critical",',
    '    "title": "short conflict title",',
    '    "details": "clear Arabic explanation",',
    '    "reference_key": "contract clause reference or empty",',
    '    "expected_value": "what the current clause expects",',
    '    "draft_evidence": "what in the draft triggered the conflict"',
    "  }],",
    '  "repair_suggestions": [{',
    '    "conflict_type": "deadline_conflict|payment_mismatch|scope_expansion|unsupported_warranty|general_conflict",',
    '    "title": "short repair title",',
    '    "suggested_text": "safe alternative wording ready to paste into the reply",',
    '    "rationale": "why this wording is safer",',
    '    "reference_key": "contract clause reference or empty"',
    "  }],",
    '  "safe_rewrite": {',
    '    "title": "short label for the rewritten draft",',
    '    "rewritten_body": "full safe replacement for the editable draft body only",',
    '    "rationale": "why the full rewrite is safer"',
    "  },",
    '  "supported_points": ["claims in the draft that are supported by history"],',
    '  "checked_references": ["serials or subjects used for validation"],',
    '  "provider": "openai|gemini|rules"',
    "}",
    "Rules:",
    "- Focus on unsupported promises, delivery commitments, approvals, legal guarantees, price/discount statements, payment confirmations, deadline commitments, and scope changes.",
    "- Compare the draft clause-by-clause against the current contract clauses and any supporting later correspondence.",
    "- Use the explicit conflict types when applicable: deadline_conflict, payment_mismatch, scope_expansion, unsupported_warranty.",
    "- When conflicts exist, provide repair_suggestions with contract-safe wording that removes or softens the conflicting promise.",
    "- When there are multiple compatible repair suggestions, also return safe_rewrite as one cohesive replacement for the editable draft body.",
    "- If the draft introduces a strong promise without historical support, severity should be high or critical.",
    "- If the draft contradicts an earlier rejection, limitation, or unresolved issue, verdict should be review_required or blocked.",
    "- Use Arabic in summary/details when possible.",
    "- Do not invent references; only cite references present in the provided history, structured clauses, or contract memory.",
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
    contractMemorySection,
    "",
    "Structured contract clauses:",
    clauseSection
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
  structuredContractClauses = [],
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
  const structuredClauseText = structuredContractClauses
    .map((item) => `${item.clause_type || ""}\n${item.clause_title || ""}\n${item.clause_value || ""}\n${item.normalized_value || ""}\n${item.reference_key || ""}`)
    .join("\n")
    .toLowerCase();
  const evidenceText = `${historyText}\n${contractMemoryText}\n${structuredClauseText}`;
  const references = [
    ...structuredContractClauses.map((item) => item.reference_key || item.clause_title || "").filter(Boolean),
    ...contractMemoryEntries.map((item) => item.reference_key || item.title || "").filter(Boolean),
    ...historyEmails.map((item) => item.serial_number || item.subject || "").filter(Boolean)
  ].slice(0, 8);
  const issues = [];
  const supportedPoints = [];
  const conflicts = detectClauseConflicts({
    structuredContractClauses,
    historyEmails,
    draftSubject,
    draftBody
  });
  const repairSuggestions = buildRepairSuggestionsFromConflicts(conflicts);
  const safeRewrite = buildFallbackSafeRewrite({
    draftSubject,
    draftBody,
    repairSuggestions,
    project
  });

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

  for (const conflict of conflicts) {
    issues.push(buildClauseConflictIssue(conflict));
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
      ? `تم رصد ${issues.length} نقطة تحتاج مراجعة قبل اعتماد الرد${conflicts.length ? `، منها ${conflicts.length} تعارضات تعاقدية مباشرة` : ""}.`
      : `لم يتم رصد تعارضات واضحة في مسودة الرد الحالية${project?.project_code ? ` ضمن المشروع ${project.project_code}` : ""}.`,
    issues,
    conflicts,
    repair_suggestions: repairSuggestions,
    safe_rewrite: safeRewrite,
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
  extractStructuredContractClauses,
  generateReplyDraftWithHistory,
  generateResponsePolicyGuard,
  extractTextWithVisionOcr
};
