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

export { analyzeDraftWithLlm, analyzeInboundTaskExtractionWithLlm };
