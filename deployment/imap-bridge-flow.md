# IMAP Bridge Flow

## الهدف

شرح دورة الرسالة داخل النظام من لحظة وصولها عبر `IMAP watcher` حتى:

- حفظها في `emails`
- مزامنتها إلى `email_registry`
- حفظ محتواها في `email_content_archive`
- تشغيل تحليل `AI`
- إنشاء أو تحديث `tracking_tasks`
- ثم ربطها لاحقا بطبقات `Drafting Assistant` و`Response Policy Guard` و`Approval Workflow`

## الفكرة العامة

المشروع لا يستخدم `Listener.js` منفصل وبسيط، بل يستخدم "جسر بريد" حي داخل `server/mailService.js` يقوم بالمراقبة الدائمة للحسابات النشطة، ويعالج الرسائل الجديدة بطريقة آمنة وقابلة للتوسع.

المسار الأساسي الحالي هو:

1. `startImapWatcher()` يبدأ مراقبة صندوق الوارد للحساب
2. `client.on("mail")` يلتقط وصول رسائل جديدة
3. `processImapWatcherNewMail()` يحدد الرسائل الجديدة فعليا حسب `UID`
4. `fetchImapMessages()` يجلب الرسائل الخام بدون تكرار
5. `simpleParser()` يحول الرسالة إلى كائن قابل للمعالجة
6. `archiveIncomingParsedEmail()` يحفظ الرسالة ويشغل التحليل والأرشفة
7. `syncEmailRegistryForEmail()` يحدث `email_registry` و`email_content_archive`
8. `createInboundAutoTasks()` أو `createTrackingTasksFromBrainAnalysis()` تنشئ مهام المتابعة

## المرحلة 1: تشغيل الـ IMAP Watcher

الملف: `server/mailService.js`

الدوال الأساسية:

- `createImapClient(config)`
- `connectImap(client)`
- `openImapBox(client, boxName, readOnly)`
- `startImapWatcher(userId, config)`

عند تفعيل حساب بريد `IMAP` صالح:

- يتم إنشاء عميل `node-imap`
- يتم فتح صندوق الوارد الفعلي المحدد في الإعدادات
- يتم تخزين حالة `watcher` لكل مستخدم على حدة
- يتم حفظ `lastSeenUid` حتى لا يعاد استيراد الرسائل القديمة

هذا يعني أن النظام لا يعتمد على `UNSEEN` فقط، بل يعتمد على تتبع `UID` لمنع الفقد والتكرار.

## المرحلة 2: اكتشاف الرسائل الجديدة

الدالة: `processImapWatcherNewMail(watcher)`

ما الذي يحدث:

- يتم جلب كل `UIDs` من الصندوق الحالي
- يتم استخراج الرسائل الأحدث من `lastSeenUid`
- يتم ترتيبها تصاعديا لضمان المعالجة بالترتيب
- إذا لم توجد رسائل جديدة، تتوقف العملية بدون أي كتابة غير ضرورية

هذه الطبقة تمنع:

- تكرار الإدخال
- معالجة نفس الرسالة مرتين
- الاعتماد الهش على حالة `read/unread`

## المرحلة 3: جلب الرسالة الخام وتحليلها

الدوال:

- `fetchImapMessages(client, sequenceNumbers)`
- `simpleParser(message.rawEmail)`
- `saveParsedAttachments(parsed)`

في هذه المرحلة:

- يتم جلب الـ raw MIME message
- يتم تحليل `subject`, `from`, `to`, `cc`, `body`, `html`, `attachments`
- يتم حفظ المرفقات محليا

ثم يتم تسليم الناتج إلى:

- `archiveIncomingParsedEmail(...)`

## المرحلة 4: إنشاء السجل الأساسي في `emails`

الدالة المحورية:

- `archiveIncomingParsedEmail(...)`

هذه هي الدالة الأهم في خط الاستقبال، لأنها تنفذ أكثر من طبقة في مكان واحد:

- استخراج النص `textBody` و`htmlBody`
- تحديد المرسل والمستلم الفعلي
- تحديد المالك `effectiveEmployeeId`
- استخراج `messageId`, `inReplyTo`, `references`
- محاولة استرجاع `serial` من:
  - `x-company-serial`
  - `subject`
  - الـ headers
  - أو إنشاء `serial` جديد إذا لم يوجد
- تشغيل `analyzeIncomingEmail(...)` لتوليد تحليل أولي للمخاطر والنبرة
- تشغيل `identifyProject(parsed)` لربط الرسالة بالمشروع والمفتاح المناسب
- حفظ الرسالة عبر `createEmail(...)`

السجل الناتج في جدول `emails` يحتوي على:

- `serial`
- `subject_key`
- `project_id`
- `risk_level`
- `ai_provider`
- `ai_recommendations`
- `external_message_id`
- بيانات المرفقات والمرسلين والمحتوى

## المرحلة 5: تتبع الخيط وربط الرسالة تاريخيا

داخل `archiveIncomingParsedEmail(...)`:

- إذا وُجد `messageId` يتم استدعاء:
  - `trackEmailThread(messageId, inReplyTo, referencesHeader, serial, archivedEmail.id, subject, senderEmail)`

الهدف:

- بناء thread واضح للرسائل
- تمكين `Drafting Assistant` لاحقا من فهم التسلسل التاريخي
- دعم استرجاع `serial` من المراسلات السابقة عند الردود

## المرحلة 6: كتابة سجل التدقيق والتواصل

بعد إنشاء الرسالة:

- يتم تحديث `recent contacts`
- يتم تسجيل `Incoming Received`
- يتم تسجيل `Incoming Processed`

وهذا يوفر:

- `audit trail`
- مرجعية تشغيلية لما حدث لكل رسالة
- معلومات عن المصدر، المجلد، المرفقات، مستوى الخطر، وربط المشروع

## المرحلة 7: المزامنة إلى `email_registry` و`email_content_archive`

الملف: `server/database.js`

الدالة المحورية:

- `syncEmailRegistryForEmail(emailOrId)`

هذه الدالة تنشئ أو تحدث طبقتين أرشيفيتين:

### 1) `email_registry`

يتم فيها حفظ البيانات المرجعية عالية المستوى مثل:

- `email_id`
- `project_id`
- `employee_id`
- `assigned_manager_id`
- `message_id`
- `thread_id`
- `subject_key`
- `serial_number`
- `folder_name`
- `approval_status`
- `source_provider`
- `risk_level`
- `is_archived`

### 2) `email_content_archive`

يتم فيها حفظ المحتوى النصي والأرشيفي مثل:

- `raw_body`
- `body_html`
- `ai_summary`
- `attachments_path`

هذه الطبقة هي التي تجعل النظام قابلا للبحث والتحليل طويل الأمد، بدلا من الاكتفاء بجدول `emails` التشغيلي فقط.

## المرحلة 8: تحليل AI الوارد

داخل `archiveIncomingParsedEmail(...)` يتم تشغيل مسارين تحليل:

### أ) مسار الاستخراج التشغيلي

الدوال:

- `buildInboundAiExtraction(...)`
- `analyzeInboundTaskExtractionWithLlm(...)`
- `saveAiAnalysis(emailId, extraction, userId)`

النتيجة:

- تصنيف الرسالة
- استخراج المهام
- اقتراح المسؤول
- محاولة تحديد `due date`
- تجهيز بيانات `Task Orchestrator`

### ب) مسار `AI Brain`

الدوال:

- `analyzeEmailBrain(...)`
- `saveAiBrainAnalysis(...)`
- `saveAiBrainSummaryToEmail(...)`

النتيجة:

- `summary`
- `transaction_type`
- `urgency_level`
- `action_items`

## المرحلة 9: إنشاء `tracking_tasks`

بعد اكتمال التحليل:

- يتم تشغيل `createInboundAutoTasks(...)`
- وإذا لم تنشأ مهام كافية من الـ orchestrator، يتم fallback إلى:
  - `createTrackingTasksFromBrainAnalysis(...)`

الهدف:

- عدم ترك أي رسالة دون متابعة
- إنشاء مهمة افتراضية أو فعلية حسب سياق الرسالة
- ربط المهام بالأرشيف عبر `email_db_id`

وفي قاعدة البيانات يتم حفظ نسخة متزامنة من المهمة داخل:

- `tracking_tasks`

وذلك عبر:

- `syncTrackingTaskRecord(taskOrId)`

## المرحلة 10: أين تبدأ طبقات `approval/policy`

المسار الوارد السابق يجهز "الذاكرة التشغيلية" للنظام. بعد ذلك تبدأ طبقات الرد والموافقة عندما يفتح المستخدم الرد على رسالة موجودة.

الملفات الأساسية:

- `server/index.js`
- `server/aiAnalysisService.js`
- `src/App.jsx`
- `src/components/MailComposeView.jsx`

التسلسل المنطقي:

1. المستخدم يفتح `Reply` على رسالة مؤرشفة
2. `Drafting Assistant` يستدعي `generateReplyDraftWithHistory(...)`
3. النظام يقرأ:
   - الرسالة الأصلية
   - تاريخ المشروع
   - `email_registry`
   - `contract_memory`
   - `contract_clause_memory`
4. ثم `Response Policy Guard` يستدعي `generateResponsePolicyGuard(...)`
5. يتم اكتشاف التعارضات مثل:
   - `payment_mismatch`
   - `unsupported_warranty`
   - `deadline_conflict`
   - `scope_expansion`
6. إذا نتج `safe_rewrite` حساس، يتم تفعيل:
   - `approval_lock`
7. عند الإرسال:
   - إما إرسال مباشر
   - أو `Submit Approval`
   - أو قفل كامل حتى اعتماد المدير/المسؤول المحدد

## لماذا هذا التصميم أفضل من `Listener.js` التقليدي

لأن `Listener.js` الخام عادة ينفذ فقط:

- اتصال IMAP
- التقاط رسالة جديدة
- `simpleParser`
- `saveToDatabase`

أما الجسر الحالي في المشروع فيضيف فوق ذلك:

- منع التكرار عبر `UID` و`external_message_id`
- حفظ المرفقات
- توليد `serial`
- ربط المشروع تلقائيا
- أرشفة مزدوجة في `email_registry` و`email_content_archive`
- تحليل AI وتشغيل `Task Orchestrator`
- بناء thread history
- تجهيز طبقات الرد الذكي والموافقات
- استعادة الاتصال تلقائيا عند فشل IMAP

## المكونات الرئيسية التي يجب مراقبتها تشغيليا

- `IMAP watcher` لكل حساب
- `lastSeenUid`
- نجاح `archiveIncomingParsedEmail(...)`
- نجاح `syncEmailRegistryForEmail(...)`
- نجاح `saveAiAnalysis(...)`
- نجاح `createInboundAutoTasks(...)`
- وجود fallback إلى `createTrackingTasksFromBrainAnalysis(...)`
- صحة `approval_lock` في الردود الحساسة

## أفضل نقطة لفحص الأعطال

إذا وصلت رسالة ولم تظهر في النظام، فالتشخيص الصحيح يكون بهذا الترتيب:

1. هل `IMAP watcher` متصل؟
2. هل `client.on("mail")` اشتغل؟
3. هل الرسالة دخلت `fetchImapMessages()`؟
4. هل `simpleParser()` نجح؟
5. هل `createEmail()` أنشأ سجلًا في `emails`؟
6. هل `syncEmailRegistryForEmail()` كتب في `email_registry` و`email_content_archive`؟
7. هل `saveAiAnalysis()` نجح؟
8. هل تم إنشاء `tracking_tasks` أو fallback task؟

## خلاصة مختصرة

دورة الرسالة في النظام هي:

`IMAP watcher` -> `fetch/raw email` -> `simpleParser` -> `archiveIncomingParsedEmail` -> `emails` -> `email_registry` -> `email_content_archive` -> `AI extraction` -> `tracking_tasks` -> `Drafting Assistant / Policy Guard / Approval`

هذا هو المسار الصحيح الذي يجب البناء عليه عند أي تطوير لاحق يخص:

- الاستقبال اللحظي
- الأرشفة طويلة الأمد
- التتبع التشغيلي
- الردود الذكية
- الحماية التعاقدية
- الموافقات الإدارية
