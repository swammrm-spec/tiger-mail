# Reply Policy Approval Flow

## الهدف

شرح المسار الكامل للرد الذكي داخل النظام من لحظة فتح `Reply` حتى:

- توليد مسودة الرد عبر `Drafting Assistant`
- فحص المسودة عبر `Response Policy Guard`
- إنتاج `repair suggestions`
- إنتاج `safe rewrite`
- تفعيل `approval lock` عند وجود تغييرات تعاقدية حساسة
- تحويل الإرسال إلى `Submit Approval`
- ثم تنفيذ `Approve / Reject` من المدير أو المسؤول المحدد

## الفكرة العامة

هذا المسار لا يبدأ من شاشة compose كواجهة فقط، بل يعتمد على طبقات متتالية تعمل فوق أرشيف الرسائل وذاكرة المشروع والذاكرة التعاقدية.

التسلسل الأساسي هو:

1. المستخدم يفتح `Reply` أو `Reply All`
2. النظام يبني draft أولي مع quoted history
3. `Drafting Assistant` يولد نص رد مبني على تاريخ المشروع
4. `Response Policy Guard` يفحص المسودة مقابل الالتزامات السابقة
5. النظام يعيد:
   - `issues`
   - `conflicts`
   - `repair_suggestions`
   - `safe_rewrite`
   - `approval_lock`
6. الواجهة تعرض النتائج، وتسمح بالتطبيق أو تمنعه حسب الحساسية
7. عند الإرسال:
   - إما إرسال مباشر
   - أو `Submit Approval`
8. المدير يقرر:
   - `Approve`
   - أو `Reject`
9. إذا رُفضت الرسالة، يعود الموظف لتعديلها ثم `Resubmit`

## المرحلة 1: فتح الرد وبناء جسم الرسالة

الملف: `src/App.jsx`

عند فتح `Reply` أو `Reply All`:

- يتم نسخ عنوان الرسالة الأساسي
- يتم حفظ `reply_source_email_id`
- يتم إدخال quoted original message في `body`
- يتم تجهيز حقول `project_id` وحقول السياق draft metadata

هذه المرحلة مهمة لأن كل ما يلي يعتمد على وجود:

- `reply_source_email_id`
- المسودة الحالية
- جسم الرد القابل للتحرير
- كتلة `Original Message` التي يجب عدم كسرها

## المرحلة 2: `Drafting Assistant`

### الواجهة

الملف: `src/App.jsx`

الدالة الأساسية:

- `handleGenerateReplyDraft()`

عند الضغط على `AI Reply`:

- ترسل الواجهة طلبا إلى:
  - `/api/ai/reply-draft`
- ويتم تمرير:
  - `email_id`
  - `subject`
  - `draft_body`
  - `mode`
  - `project_id`

### الخادم

الملف: `server/index.js`

في route `reply-draft`:

- يتم تحميل `sourceEmail`
- يتم جلب `project`
- يتم جلب تاريخ المشروع عبر `getProjectEmailHistoryForDrafting(...)`
- يتم جلب `contractMemoryEntries`
- يتم جلب `structuredContractClauses`
- ثم يتم استدعاء:
  - `generateReplyDraftWithHistory(...)`

### الناتج

الرد الناتج لا يعتمد فقط على الإيميل الحالي، بل على:

- تاريخ المشروع
- الرسائل السابقة
- `contract_memory`
- `contract_clause_memory`

ثم يتم دمج النص المقترح داخل الجزء القابل للتحرير فقط بواسطة:

- `mergeSuggestedReplyBody(currentBody, suggestedReplyBody)`

وهذا يضمن:

- عدم حذف quoted original message
- عدم كسر تسلسل الرد
- الحفاظ على شكل الرسالة المهنية

## المرحلة 3: تشغيل `Response Policy Guard`

### الواجهة

الدالة الأساسية:

- `runResponsePolicyGuard(...)`

يمكن تشغيلها بطريقتين:

1. يدويًا عبر زر `Policy Guard`
2. تلقائيًا بعد `AI Reply`
3. تلقائيًا بعد `Apply Suggestion`
4. تلقائيًا بعد `Apply Full Safe Rewrite`
5. تلقائيًا عند الإرسال إذا أصبحت نتيجة الفحص قديمة `stale`

### الخادم

الملف: `server/index.js`

المسار:

- `/api/ai/reply-policy-guard`

هذا المسار يجمع نفس السياق التاريخي والتعاقدي:

- `sourceEmail`
- `historyEmails`
- `contractMemoryEntries`
- `structuredContractClauses`
- `project`

ثم يستدعي:

- `generateResponsePolicyGuard(...)`

وبعد ذلك يضيف:

- `approval_lock = resolveSafeRewriteApprovalLock(...)`

## المرحلة 4: ماذا يعيد `Policy Guard`

النتيجة النهائية للـ guard تتضمن عادة:

- `summary`
- `severity`
- `verdict`
- `issues`
- `conflicts`
- `repair_suggestions`
- `safe_rewrite`
- `approval_lock`

### أمثلة التعارضات

- `deadline_conflict`
- `payment_mismatch`
- `scope_expansion`
- `unsupported_warranty`
- `general_conflict`

### لماذا هذا مهم

النظام لا يكتفي بقول "هناك مشكلة"، بل يحدد:

- نوع التعارض
- الدليل الموجود في المسودة
- القيمة المتوقعة أو المرجع التعاقدي
- النص البديل أو المسار الآمن

## المرحلة 5: عرض النتائج في الواجهة

الملف: `src/components/MailComposeView.jsx`

داخل compose view تعرض الواجهة:

- Banner لـ `Drafting Assistant`
- Banner لـ `Response Policy Guard`
- قائمة `issues`
- قائمة `Clause conflicts`
- قائمة `Auto-repair suggestions`
- بطاقة `One-click safe rewrite`
- `Safe Rewrite Diff Review`
- بطاقة `Safe Rewrite Approval Lock`

### السلوك الظاهر للمستخدم

- زر `AI Reply` لتوليد draft
- زر `Policy Guard` لفحصه
- زر `Safe Rewrite` لتطبيق إعادة كتابة كاملة
- `Apply Suggestion` لتطبيق إصلاح جزئي
- `Send` قد يتحول إلى `Submit Approval`

## المرحلة 6: `Auto-repair` و`Safe Rewrite`

### تطبيق إصلاح جزئي

الدالة:

- `applyRepairSuggestion(suggestion)`

ما يحدث:

- يتم أخذ `suggested_text`
- دمجه مع الجزء القابل للتحرير
- إعادة تشغيل `Policy Guard` مباشرة

### تطبيق إعادة كتابة كاملة

الدالة:

- `applySafeRewrite()`

ما يحدث:

- يتم أخذ `responsePolicyGuard.safe_rewrite.rewritten_body`
- دمجه في الرد
- إعادة تشغيل `Policy Guard`

### الهدف

- منع التعديلات العمياء
- إبقاء المسودة متزامنة مع آخر نتيجة فحص
- جعل الفحص التالي مبنيًا على النص الجديد فعليًا

## المرحلة 7: `Safe Rewrite Diff Review`

الملف: `src/components/MailComposeView.jsx`

قبل التطبيق، تعرض الواجهة مقارنة بصرية بين:

- النص الحالي `Current`
- النص الآمن `Safe`
- التغييرات التي حدثت سطرًا بسطر

كما تعرض:

- `impact summary`
- عدد الأسطر الحالية
- عدد الأسطر الآمنة
- عدد التغييرات المرئية

الهدف من هذه الطبقة:

- إعطاء المستخدم مراجعة بشرية قبل الدمج
- إظهار ما إذا كان النص شدد أو خفف التزاما تعاقديا
- تقليل احتمال تمرير صياغة غير مقصودة

## المرحلة 8: `Approval Lock`

الملف: `server/index.js`

الدالة الأساسية:

- `resolveSafeRewriteApprovalLock(...)`

تعمل هذه الدالة بعد توليد نتيجة `Policy Guard` وتبحث داخل `conflicts` عن الأنواع الحساسة مثل:

- `payment_mismatch`
- `unsupported_warranty`

إذا وجدت تعارضًا حساسًا:

- `approval_lock.required = true`
- يتم تحديد `approver_id`
- يتم تحديد `approver_name`
- يتم تحديد `sensitive_conflict_types`
- يتم قفل:
  - `apply_safe_rewrite`
  - `send_reply`

### آلية تحديد الـ approver

الأولوية الحالية تكون عادة:

1. المدير المباشر للمستخدم
2. `assigned_manager_id` على الرسالة
3. مدير مالك الرسالة المصدر إن لزم

## المرحلة 9: كيف ينعكس القفل في الواجهة

الملف: `src/components/MailComposeView.jsx`

تحسب الواجهة:

- `isSafeRewriteApprovalLocked`

إذا كان القفل فعالًا والمستخدم ليس هو الـ approver:

- يتعطل `Apply Suggestion`
- يتعطل `Apply Full Safe Rewrite`
- يتعطل زر `Safe Rewrite`
- يتحول زر `Send` إلى `Submit Approval`
- يظهر Banner يوضح:
  - اسم الـ approver
  - سبب القفل
  - أنواع التعارضات الحساسة

أما إذا كان المستخدم نفسه هو الـ approver:

- تبقى إجراءات التطبيق والإرسال متاحة

## المرحلة 10: ماذا يحدث عند الضغط على `Send` أو `Submit Approval`

الملف: `src/App.jsx`

الدالة الأساسية:

- `handleSendEmail()`

### المنطق الداخلي

1. التحقق هل الرسالة reply فعلًا
2. التحقق هل نتيجة `Policy Guard` قديمة
3. إذا كانت قديمة، يعاد تشغيل `runResponsePolicyGuard(...)`
4. فحص `approval_lock`
5. إذا كان القفل blocking:
   - يتم أخذ `safe_rewrite.rewritten_body`
   - دمجه في `resolvedForm.body`
   - حفظ `safeRewriteApprovalLockToUse`
6. إذا كان هناك خطر مرتفع بدون approval lock:
   - تظهر رسالة تأكيد قبل الإرسال
7. عند بناء `FormData`:
   - يتم تمرير `force_manager_approval = true`
   - ويتم تمرير `forced_manager_id`

### لماذا يتم حقن `safe_rewrite` تلقائيا عند القفل

لأن الطلب المرسل للموافقة يجب أن يمثل:

- النص الآمن النهائي
- لا النص غير المصحح
- ولا مسودة مخالفة ما زالت تحتوي التعارض الحساس

## المرحلة 11: تحويل الإرسال إلى `Pending Approval`

الملف: `server/index.js`

الدوال الأساسية:

- `handleComposeSendRoute(req, res)`
- `submitPendingApprovalFromCompose(req, user, employeeId, options)`

إذا كان:

- المستخدم أصلا ضمن مسار موافقات عادي
- أو تم تفعيل `force_manager_approval`

فإن النظام:

- لا يرسل الرسالة مباشرة
- بل ينشئ `Pending Approval`
- ويبني `action_links`
- ويرسل إشعار المدير
- ويرسل إشعار Telegram إذا كان مفعلا

والنتيجة المرجعة للواجهة:

- `pending_approval: true`
- `serial`
- `manager_notification`

## المرحلة 12: قرار المدير `Approve / Reject`

الملف: `server/index.js`

الدوال الأساسية:

- `handleManagerDecisionRoute(req, res, action)`
- `executeApprovalAction(...)`

### إذا اختار المدير `Approve`

يحدث التالي:

- يتم تنفيذ `approveEmail(...)`
- يتم إلغاء صلاحية action links السابقة
- يتم تجهيز المرفقات
- يتم تنفيذ `deliverApprovalEmail(...)`
- يتم تسجيل `approve_send` أو `approve_queue`

### إذا اختار المدير `Reject`

يحدث التالي:

- يتم تنفيذ `rejectEmail(...)`
- تحفظ ملاحظات المدير
- يتم إلغاء صلاحية action links
- يتم تسجيل `reject_secure_action`
- تعود الرسالة للموظف كنسخة قابلة للتعديل وإعادة التقديم

## المرحلة 13: `Resubmit` بعد الرفض

المسار:

- `/api/approvals/:id/resubmit`

الهدف:

- السماح للموظف بتعديل النسخة المرفوضة
- ثم إعادة إرسالها لنفس workflow

وفي النسخة الحالية:

- إذا كان هناك `forced_manager_id` ناتج من `approval_lock`
- يتم الحفاظ عليه داخل `resubmit`
- حتى لا ترجع الرسالة إلى مدير افتراضي مختلف

وهذا مهم جدا في سيناريو:

- `Safe Rewrite Approval Lock`
- ثم `Reject`
- ثم تعديل
- ثم `Resubmit`

## ما الذي يجعل هذا المسار آمنًا

لأن النظام يجمع بين:

- سياق تاريخي للمشروع
- ذاكرة تعاقدية
- كشف تعارض clause-by-clause
- إصلاحات تلقائية
- مراجعة بصرية
- قفل موافقة للتغييرات عالية الحساسية
- Workflow موافقات فعلي بدل الاكتفاء بتحذير بصري

## أفضل نقاط الفحص عند وجود مشكلة

إذا ظهرت مشكلة في الردود أو الموافقات، فابدأ بهذا الترتيب:

1. هل `reply_source_email_id` موجود؟
2. هل `Drafting Assistant` أعاد `context` صحيح؟
3. هل `runResponsePolicyGuard()` يعمل على آخر نسخة من المسودة؟
4. هل `responsePolicyGuard.checked_body` يطابق النص الحالي؟
5. هل `approval_lock.required` صحيح؟
6. هل `approver_id` تم حله بنجاح؟
7. هل `force_manager_approval` و`forced_manager_id` ذهبا مع الطلب؟
8. هل الرد خُزن كـ `pending_approval` بدل الإرسال المباشر؟
9. هل المدير نفذ `approve` أو `reject` على السجل الصحيح؟
10. هل `resubmit` حافظ على نفس الـ approver عند وجود قفل حساس؟

## الخلاصة المختصرة

المسار الكامل هو:

`Reply` -> `Drafting Assistant` -> `Response Policy Guard` -> `Repair Suggestions / Safe Rewrite` -> `Diff Review` -> `Approval Lock` -> `Submit Approval` -> `Approve / Reject` -> `Resubmit if needed`

هذا هو العمود الفقري لأي تطوير لاحق يخص:

- الردود الذكية
- الحماية التعاقدية
- مراجعة الصياغات الحساسة
- اعتماد المدير
- تتبع دورة الرد من البداية للنهاية
