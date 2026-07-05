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

export { analyzeDraftWithLlm };
