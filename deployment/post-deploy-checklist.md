# Post-Deploy Checklist

## الهدف

هذه القائمة مخصصة للتحقق العملي بعد النشر على `PostgreSQL` والإنتاج، بحيث تتأكد أن النظام لا يقلع فقط، بل يعمل 1:1 في أهم المسارات التشغيلية:

- تسجيل الدخول
- قاعدة البيانات الإنتاجية
- إدارة المستخدمين والمديرين
- استقبال البريد
- مسار `Pending Approval`
- مسار `Safe Rewrite Approval Lock`

## قبل البدء

تأكد أنك أنهيت هذه الخطوات أولًا:

- [create-database.sql](file:///d:/Emailarray/Outlook/deployment/create-database.sql)
- [app-schema.sql](file:///d:/Emailarray/Outlook/deployment/app-schema.sql)
- [seed-production-minimum.sql](file:///d:/Emailarray/Outlook/deployment/seed-production-minimum.sql)
- [postgresql-setup-notes.md](file:///d:/Emailarray/Outlook/deployment/postgresql-setup-notes.md)

## بيانات الدخول الأولية

إذا استخدمت ملف `seed-production-minimum.sql` كما هو:

- Admin email: `m.safadi@audit.techno-grp.com`
- Admin password: `ChangeMeAdmin!234`

بعد أول دخول:

- غيّر كلمة المرور فورًا
- حدّث إعدادات البريد الحقيقية
- لا تترك بيانات placeholder في `app_settings`

## 1) فحص إقلاع الخادم

### المطلوب

- تأكد أن الخدمة تعمل بدون crash
- تأكد أن `dist` يتم تقديمه من الخادم

### التحقق

- افتح الصفحة الرئيسية للتطبيق
- تأكد أن شاشة تسجيل الدخول تظهر
- تأكد أن ملفات الواجهة ليست `404`

### النتيجة المتوقعة

- الواجهة تحمل بنجاح
- لا توجد أخطاء بيضاء أو `Not found`

### عند الفشل

- راجع `NODE_ENV=production`
- راجع `SERVE_DIST=true`
- راجع أن `npm run build` تم قبل التشغيل

## 2) فحص `databaseMode = postgres`

### المطلوب

التأكد أن التطبيق لم يرجع إلى `pg-mem` بالخطأ.

### التحقق

استدعِ endpoint الصحة:

```bash
curl https://YOUR_APP_URL/api/health
```

أو محليًا:

```bash
curl http://127.0.0.1:3001/api/health
```

### النتيجة المتوقعة

يجب أن يحتوي الرد على:

```json
{
  "status": "ok",
  "databaseMode": "postgres"
}
```

### المرجع

- [index.js](file:///d:/Emailarray/Outlook/server/index.js#L2169-L2174)

### عند الفشل

- إذا ظهر `pg-mem`:
  - راجع `DATABASE_URL`
  - راجع صلاحية الاتصال بقاعدة PostgreSQL
  - راجع ملف `.env` الفعلي على السيرفر

## 3) فحص تسجيل دخول الأدمن

### المطلوب

التأكد أن الأدمن الأول يعمل ويمكنه الوصول للواجهة الإدارية.

### التحقق

- سجل الدخول بحساب الأدمن
- افتح:
  - إدارة الموظفين
  - الإعدادات
  - الأرشيف الإداري

### النتيجة المتوقعة

- تسجيل الدخول ينجح
- لا توجد أخطاء صلاحيات
- تظهر أدوات الإدارة الأساسية

### عند الفشل

- راجع أن الأدمن موجود فعليًا في جدول `users`
- راجع أن `role = 'Admin'`
- راجع أن `id = 1` للحساب الأساسي إذا اعتمدت على ملف الـ seed الحالي

## 4) فحص إنشاء مستخدم ومدير

### المطلوب

التأكد من أن مسار `Direct Manager` يعمل من أول مرة.

### التحقق

أنشئ مستخدمين من الواجهة:

- مستخدم موظف
- مستخدم مدير

ثم:

- اربط الموظف بمدير مباشر
- احفظ التغييرات

### النتيجة المتوقعة

- المستخدمان يُنشآن بنجاح
- علاقة `manager_id` تُحفظ
- يظهر المدير ضمن workflow لاحقًا

### تحقق إضافي مهم

- افتح قائمة الموظفين مرة أخرى
- تأكد أن المدير ما زال مربوطًا بعد refresh

## 5) فحص إعدادات البريد الفعلية

### المطلوب

التأكد أن الحساب البريدي الحقيقي للمستخدم أو المدير تم إدخاله بشكل صحيح.

### التحقق

من شاشة الإعدادات أو حسابات البريد:

- أدخل إعدادات `IMAP` أو `Graph`
- احفظ
- شغّل اختبار الاتصال إذا كان متاحًا

### النتيجة المتوقعة

- الحفظ ينجح
- اختبار الاتصال ينجح
- لا تظهر أخطاء مصادقة أو خادم

### المرجع

- [mailService.js](file:///d:/Emailarray/Outlook/server/mailService.js#L3396-L3429)

## 6) فحص استقبال `IMAP`

### المطلوب

التأكد أن `IMAP watcher` أو الاستقبال الخلفي يسحب الرسائل فعليًا ويؤرشفها.

### التحقق

- أرسل رسالة اختبار إلى الحساب المرتبط بالمستخدم
- انتظر دورة التزامن أو trigger الوصول
- افتح `Inbox`

### النتيجة المتوقعة

- الرسالة تظهر في `Inbox`
- يتم أرشفتها في النظام
- لا تضيع بين الواجهة وقاعدة البيانات

### تحقق أعمق

- تأكد أن الرسالة وصلت أيضًا إلى:
  - `email_registry`
  - `email_content_archive`

### المرجع

- [imap-bridge-flow.md](file:///d:/Emailarray/Outlook/deployment/imap-bridge-flow.md)
- [mailService.js](file:///d:/Emailarray/Outlook/server/mailService.js#L873-L971)
- [mailService.js](file:///d:/Emailarray/Outlook/server/mailService.js#L3372-L3394)

### عند الفشل

- راجع إعدادات الحساب
- راجع سجلات الخادم
- راجع أن الرسالة ليست مكررة بـ `external_message_id`

## 7) فحص `Pending Approval`

### المطلوب

التأكد أن المستخدم غير المصرح له بالإرسال المباشر يمر فعليًا عبر الموافقة.

### التحقق

- سجل الدخول كمستخدم موظف مربوط بمدير
- أنشئ رسالة جديدة خارجية
- اضغط `Send`

### النتيجة المتوقعة

- لا يتم الإرسال المباشر
- تظهر رسالة نجاح تشير إلى:
  - `submitted for manager approval`
  - أو `pending approval`
- تظهر الرسالة عند المدير داخل قائمة `Pending`

### المرجع

- [index.js](file:///d:/Emailarray/Outlook/server/index.js#L648-L692)

### فحص المدير

- سجل الدخول بالمدير
- افتح `Pending`
- افتح الرسالة

### النتيجة المتوقعة

- الرسالة موجودة
- المدير يستطيع `Approve` أو `Reject`

## 8) فحص `Approve / Reject`

### المطلوب

التأكد أن دورة القرار تعمل فعلًا.

### اختبار `Approve`

- افتح رسالة pending عند المدير
- اختر `Approve`

### النتيجة المتوقعة

- تتغير حالة الرسالة من pending
- تُرسل الرسالة أو تُوضع في queue إذا فشل SMTP

### اختبار `Reject`

- أنشئ رسالة pending أخرى
- اختر `Reject`
- أضف تعليقًا إداريًا واضحًا

### النتيجة المتوقعة

- تعود للموظف كنسخة قابلة للمراجعة
- يظهر تعليق المدير
- يمكن إعادة الإرسال لاحقًا عبر `Resubmit`

### المرجع

- [index.js](file:///d:/Emailarray/Outlook/server/index.js#L464-L528)
- [reply-policy-approval-flow.md](file:///d:/Emailarray/Outlook/deployment/reply-policy-approval-flow.md)

## 9) فحص `Drafting Assistant`

### المطلوب

التأكد أن الرد الذكي يستخدم سياق المشروع.

### التحقق

- افتح رسالة مشروع لها تاريخ سابق
- اضغط `Reply`
- اضغط `AI Reply`

### النتيجة المتوقعة

- يتم توليد مسودة
- يظهر `Drafting Assistant` context
- يظهر عدد `history emails`
- يظهر عدد `contract memory`
- يظهر عدد `structured clauses` إذا كانت موجودة

## 10) فحص `Response Policy Guard`

### المطلوب

التأكد أن فحص السياسات التعاقدية يعمل قبل الإرسال.

### التحقق

- بعد توليد draft أو كتابة reply يدوي
- اضغط `Policy Guard`

### النتيجة المتوقعة

- يظهر verdict
- يظهر severity
- تظهر `issues` أو `conflicts` إذا وجدت
- تظهر `repair suggestions` أو `safe rewrite` إذا لزم

### المرجع

- [reply-policy-approval-flow.md](file:///d:/Emailarray/Outlook/deployment/reply-policy-approval-flow.md)

## 11) فحص `Safe Rewrite Approval Lock`

### المطلوب

التأكد أن التغييرات الحساسة مثل:

- `payment_mismatch`
- `unsupported_warranty`

لا يمكن تطبيقها أو إرسالها مباشرة بدون موافقة المسؤول المحدد.

### سيناريو الاختبار

- افتح Reply على رسالة مشروع تعاقدية
- أنشئ مسودة تتضمن تعارضًا حساسًا
- شغّل `Policy Guard`

### النتيجة المتوقعة

- `approval_lock.required = true`
- يظهر Banner خاص بـ `Safe Rewrite Approval Lock`
- يتغير زر `Send` إلى `Submit Approval`
- تتعطل:
  - `Apply Suggestion`
  - `Apply Full Safe Rewrite`
  - `Safe Rewrite`

### بعد الإرسال

- يتم إرسال النسخة الآمنة نفسها لمسار الموافقة
- تظهر كطلب pending عند approver المحدد

### المرجع

- [reply-policy-approval-flow.md](file:///d:/Emailarray/Outlook/deployment/reply-policy-approval-flow.md)
- [index.js](file:///d:/Emailarray/Outlook/server/index.js#L1418-L1439)

## 12) فحص `Resubmit` بعد الرفض

### المطلوب

التأكد أن إعادة التقديم بعد الرفض لا تكسر مسار الـ approver، خصوصًا في حالة `Safe Rewrite Approval Lock`.

### التحقق

- ارفض رسالة sensitive من المدير
- ارجع للموظف
- عدّل الرد
- اضغط `Resubmit`

### النتيجة المتوقعة

- تعود الرسالة لنفس workflow
- لا يضيع الـ approver المحدد
- لا تتحول إلى إرسال مباشر بالخطأ

## 13) فحص AI والأرشفة معًا

### المطلوب

التأكد أن الرسائل المستقبلة لا تُحفظ فقط، بل تصبح جاهزة للتحليل والمتابعة.

### التحقق

- بعد استقبال رسالة جديدة
- افتح الأرشيف الإداري أو أدوات المتابعة

### النتيجة المتوقعة

- للرسالة سجل في `email_registry`
- لها محتوى في `email_content_archive`
- لها تحليل في `ai_analysis` عند نجاح المسار
- وقد تظهر لها `tracking_tasks` إذا استدعى الأمر

## 14) قائمة نجاح نهائية

اعتبر النشر ناجحًا إذا تحققت هذه النقاط كلها:

- الأدمن يسجل الدخول
- `/api/health` يعيد `databaseMode = postgres`
- إنشاء المستخدمين والمديرين يعمل
- إعدادات البريد تحفظ وتنجح
- استقبال IMAP يعمل
- `Pending Approval` يظهر عند المدير
- `Approve / Reject` يعملان
- `Drafting Assistant` يولد ردًا
- `Policy Guard` يفحص الرد
- `Safe Rewrite Approval Lock` يمنع الحسّاس من التطبيق أو الإرسال المباشر
- `Resubmit` يعمل بعد الرفض

## عند وجود مشكلة

ابدأ بهذا الترتيب:

1. راجع `deployment/.env`
2. راجع `/api/health`
3. راجع سجلات الخادم
4. راجع اتصال PostgreSQL
5. راجع حسابات البريد
6. راجع صلاحيات المستخدم/المدير
7. راجع مسار الرسالة في `email_trail`

## مراجع مرتبطة

- [postgresql-setup-notes.md](file:///d:/Emailarray/Outlook/deployment/postgresql-setup-notes.md)
- [imap-bridge-flow.md](file:///d:/Emailarray/Outlook/deployment/imap-bridge-flow.md)
- [reply-policy-approval-flow.md](file:///d:/Emailarray/Outlook/deployment/reply-policy-approval-flow.md)
