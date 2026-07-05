export function analyzeEmail(email) {
  if (!email) return null;

  const body = (email.body || "").replace(/<[^>]+>/g, " ").trim();
  const subject = email.subject || "";
  const sender = email.sender_email || "";
  const recipient = email.recipient_email || "";
  const fullText = `${subject} ${body}`.toLowerCase();

  const projectPatterns = [
    /(?:project|proj)[\s:\-#]*([A-Z0-9\-\/]+)/i,
    /(?:ref|reference)[\s:\-#]*([A-Z0-9\-\/]+)/i,
    /(?:رقم المرجع|مشروع)[\s:\-#]*([A-Z0-9\-\/\u0600-\u06FF]+)/i,
    /\b([A-Z]{2,4}[\-\/]\d{3,6})\b/,
    /\b(\d{4}\/\d{2,4}\/\d{2,4})\b/,
  ];
  let projectId = null;
  for (const pattern of projectPatterns) {
    const match = subject.match(pattern) || body.match(pattern);
    if (match) { projectId = match[1] || match[0]; break; }
  }

  let emailCategory = "General";
  const catKeywords = {
    "Technical Request": ["technical", " specifications", " requirement", " engineering", " design", " calculation", " drawing", " blueprint", " technical", " فني", " مواصفات", " تصميم", " حسابات"],
    "Quotation Request": ["quotation", " quote", " price", " cost", " budget", " offer", " proposal", " سعر", " عرض", " تكلفة", " ميزانية"],
    "Project Update": ["update", " progress", " status", " completed", " milestone", " report", " تحديث", " تقدم", " حالة", " تقرير"],
    "Complaint": ["complaint", " issue", " problem", " delay", " error", " mistake", " complaint", " شكوى", " مشكلة", " تأخر", " خطأ"],
  };
  let maxScore = 0;
  for (const [cat, keywords] of Object.entries(catKeywords)) {
    const score = keywords.filter(kw => fullText.includes(kw)).length;
    if (score > maxScore) { maxScore = score; emailCategory = cat; }
  }

  const tasks = [];
  const taskPatterns = [
    /(?:please|kindly|req(?:uest)?|need|action|task|todo|to[\s-]do)[\s:]+(.{10,120})/gi,
    /(?:يُرجى|طلب|مهمة|إجراء|تنفيذ)[\s:]+(.{10,120})/g,
    /(?:by\s+(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?))/gi,
  ];
  const dueDatePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g;
  for (const pattern of taskPatterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const desc = match[1]?.trim();
      if (desc && desc.length > 10) {
        let dueDate = null;
        const dateMatch = desc.match(dueDatePattern) || body.match(dueDatePattern);
        if (dateMatch) {
          const parts = dateMatch[0].split(/[\/\-]/);
          if (parts.length === 3) {
            const [d, m, y] = parts;
            dueDate = `${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }
        }
        tasks.push({ task_description: desc.substring(0, 150), due_date: dueDate });
      }
    }
  }

  let priority = "Medium";
  const highKeywords = ["urgent", "asap", "immediately", "critical", "emergency", "deadline", "عاجل", "فوري", "حرج", "alore"];
  const lowKeywords = ["when", "possible", "optional", "low priority", "later", "عند الإمكان", "منخفضة"];
  if (highKeywords.some(kw => fullText.includes(kw))) priority = "High";
  else if (lowKeywords.some(kw => fullText.includes(kw))) priority = "Low";

  const summaryArabic = generateArabicSummary(subject, emailCategory, tasks.length, priority);

  return {
    sender_email: sender,
    receiver_email: recipient,
    project_id: projectId,
    email_category: emailCategory,
    summary: summaryArabic,
    ai_tasks: tasks.slice(0, 5),
    priority,
  };
}

function generateArabicSummary(subject, category, taskCount, priority) {
  const categoryMap = {
    "Technical Request": "طلب فني",
    "Quotation Request": "طلب سعر",
    "Project Update": "تحديث مشروع",
    "Complaint": "شكوى",
    "General": "عام",
  };
  const priorityMap = { "High": "عالي الأولوية", "Medium": "متوسط الأولوية", "Low": "منخفض الأولوية" };

  let summary = `بريد إلكتروني ${categoryMap[category] || "عام"}`;
  if (subject) summary += ` بخصوص "${subject.substring(0, 60)}"`;
  summary += ` - ${priorityMap[priority]}`;
  if (taskCount > 0) summary += ` - يحتوي على ${taskCount} مهمة`;
  summary += ".";
  return summary;
}

export function getPriorityColor(priority) {
  switch (priority) {
    case "High": return "#d13438";
    case "Medium": return "#f57c00";
    case "Low": return "#107c10";
    default: return "#666";
  }
}

export function getCategoryIcon(category) {
  switch (category) {
    case "Technical Request": return "🔧";
    case "Quotation Request": return "💰";
    case "Project Update": return "📊";
    case "Complaint": return "⚠️";
    default: return "📧";
  }
}
