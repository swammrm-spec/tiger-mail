# Rollback And Recovery

## الهدف

هذا الملف يوضح ماذا تفعل إذا فشل النشر أو حدث خلل بعده، وكيف:

- ترجع بسرعة إلى إصدار كود سابق
- تقلل زمن التوقف
- تتحقق من سلامة البيانات بعد الرجوع
- تميز بين rollback للكود وrecovery للبيانات

## مبدأ مهم جدًا

يوجد نوعان مختلفان من الاستعادة:

### 1) `Code Rollback`

إرجاع التطبيق إلى إصدار سابق من مجلدات `releases` عبر تغيير الرابط:

- `current -> releases/<previous-release>`

### 2) `Data Recovery`

استعادة البيانات من backup.

في بيئة `PostgreSQL` الإنتاجية:

- المرجع الأساسي لاستعادة البيانات يجب أن يكون backup خارجي لـ PostgreSQL مثل:
  - `pg_dump`
  - `pg_restore`

أما أدوات النسخ الاحتياطي داخل التطبيق فهي مفيدة تشغيليًا، لكن لا يجب اعتبارها البديل الوحيد عن نسخ PostgreSQL الاحتياطية الرسمية.

## ما الذي يملكه المشروع حاليًا

### في النشر

سكربت [deploy-production.ps1](file:///d:/Emailarray/Outlook/deployment/deploy-production.ps1) ينشر كل إصدار داخل:

- `REMOTE_PATH/releases/<release-id>`

ثم يوجّه:

- `REMOTE_PATH/current`

إلى الإصدار الجديد.

هذا يعني أن rollback للكود ممكن بسرعة نسبيًا بمجرد إعادة توجيه `current` إلى release أقدم.

### في البيانات

داخل المشروع توجد أدوات backup إدارية مثل:

- `createBackupSnapshot(...)`
- `createDailyArchiveExport(...)`
- `listBackups()`
- `restoreBackupByName(...)`

المراجع:

- [database.js](file:///d:/Emailarray/Outlook/server/database.js#L307-L375)
- [index.js](file:///d:/Emailarray/Outlook/server/index.js#L1903-L1943)

### تحذير تشغيلي

هذه الأدوات مرتبطة أساسًا بحالة التخزين الداخلي للتطبيق، وهي ممتازة كطبقة إضافية، لكن في إنتاج PostgreSQL يجب أن يكون عندك أيضًا:

- backup دوري لقاعدة PostgreSQL نفسها
- آلية restore مجربة مسبقًا

## متى تقرر rollback

نفّذ rollback إذا ظهر واحد أو أكثر من التالي مباشرة بعد النشر:

- التطبيق لا يقلع
- شاشة الدخول لا تفتح
- `/api/health` لا يعمل
- `databaseMode` ليس `postgres`
- أخطاء حرجة في تسجيل الدخول
- كسر واضح في `Pending Approval`
- كسر في استقبال البريد
- خلل يمنع المدير من `Approve / Reject`

إذا كانت المشكلة صغيرة وغير قاطعة، قد يكون hotfix أسرع من rollback.

## قاعدة العمل قبل أي نشر

قبل كل نشر إنتاجي:

1. خذ backup من PostgreSQL
2. احتفظ بالإصدار السابق داخل `releases`
3. تأكد أن `.env` محفوظ في `shared/.env`
4. نفذ [post-deploy-checklist.md](file:///d:/Emailarray/Outlook/deployment/post-deploy-checklist.md) مباشرة بعد الإقلاع

## النسخ الاحتياطي الموصى به لـ PostgreSQL

### Backup منطقي سريع

```bash
pg_dump -U engineering_archive_app -d engineering_archive -Fc -f engineering_archive-predeploy.dump
```

### Restore لاحق

```bash
pg_restore -U engineering_archive_app -d engineering_archive --clean --if-exists engineering_archive-predeploy.dump
```

### ملاحظة

- لا تنفذ restore على قاعدة الإنتاج مباشرة إلا إذا كنت متأكدًا من الحاجة
- الأفضل غالبًا تجربة restore أولًا على قاعدة staging أو قاعدة مؤقتة

## سيناريو 1: فشل الإقلاع بعد النشر

### الأعراض

- الخدمة لا تعمل
- `pm2` أو `systemd` يظهر crash loop
- الصفحة لا تفتح

### التصرف السريع

1. لا تعدّل قاعدة البيانات مباشرة
2. حدّد آخر release ناجح
3. أعد توجيه `current` إليه
4. أعد تشغيل الخدمة
5. افحص `/api/health`

### مثال rollback يدوي على السيرفر

```bash
cd /YOUR_REMOTE_PATH
ls -1 releases
ln -sfn /YOUR_REMOTE_PATH/releases/PREVIOUS_RELEASE /YOUR_REMOTE_PATH/current
cd /YOUR_REMOTE_PATH/current
pm2 restart emailarray-outlook --update-env
```

إذا كنت تستخدم `systemd`:

```bash
sudo systemctl restart emailarray-outlook
sudo systemctl status emailarray-outlook --no-pager -l
```

### التحقق بعد الرجوع

- افتح التطبيق
- نفذ `/api/health`
- تأكد أن `databaseMode = postgres`
- نفذ أول 3 إلى 5 بنود من [post-deploy-checklist.md](file:///d:/Emailarray/Outlook/deployment/post-deploy-checklist.md)

## سيناريو 2: الإقلاع ناجح لكن الواجهة أو المسارات الحرجة مكسورة

### أمثلة

- الأدمن لا يستطيع الدخول
- `Pending Approval` اختفت
- `Safe Rewrite Approval Lock` لا يعمل
- `IMAP` توقف

### القرار

إذا كان الخلل يمس المسارات الحرجة المباشرة:

- rollback للكود غالبًا أفضل من محاولة تصحيح سريع داخل الإنتاج

### الخطوات

1. وثّق آخر release سيئ
2. ارجع إلى release سابق
3. نفذ checklist مختصر بعد rollback:
  - login
  - `/api/health`
  - `Pending Approval`
  - `IMAP receive`

## سيناريو 3: مشكلة بيانات بعد migration أو seed أو تعديل إداري

### أمثلة

- بيانات seed خاطئة
- مستخدمون أو مديرون تم إنشاؤهم بشكل غير صحيح
- إعدادات البريد حُفظت بقيم خاطئة

### القرار

إذا كانت المشكلة بيانات فقط والكود سليم:

- لا تحتاج دائمًا إلى rollback للكود
- قد تحتاج فقط إلى:
  - تصحيح SQL يدوي
  - أو restore للبيانات

### أفضل ترتيب

1. قيّم حجم الضرر
2. إذا كان الضرر محدودًا:
   - نفذ إصلاح SQL محدود
3. إذا كان الضرر واسعًا:
   - استخدم backup PostgreSQL
4. بعد الاستعادة:
   - شغّل checklist مختصر

## سيناريو 4: استخدام أدوات backup الداخلية للتطبيق

المسارات الإدارية الموجودة:

- `GET /api/admin/backups`
- `POST /api/admin/backups/create`
- `POST /api/admin/backups/daily-export`
- `POST /api/admin/backups/restore`

المراجع:

- [index.js](file:///d:/Emailarray/Outlook/server/index.js#L1903-L1943)

### متى تستخدمها

- لنسخ تشغيلية إضافية
- لتجارب محلية أو بيئات غير حرجة
- كطبقة أمان إضافية داخل النظام

### متى لا تعتمد عليها وحدها

- في استعادة إنتاج PostgreSQL الحرجة
- عند الحاجة إلى rollback كامل مضمون للبيانات

## فحص ما بعد rollback

بعد أي rollback للكود أو restore للبيانات، لا تعتبر العملية ناجحة إلا إذا تحققت هذه النقاط:

1. `/api/health` يعمل
2. `databaseMode = postgres`
3. الأدمن يسجل الدخول
4. قائمة الموظفين تعمل
5. `Pending Approval` تعمل
6. `IMAP` أو الاستقبال الخلفي يعمل
7. لا توجد أخطاء حرجة في logs

## فحص سلامة البيانات بعد recovery

### افحص على الأقل

- وجود الأدمن
- وجود المجلدات الأساسية
- وجود `app_settings`
- وجود `projects`
- وجود `emails`
- وجود `email_registry`
- وجود `email_content_archive`
- وجود `tracking_tasks`

### أسئلة تحقق مهمة

- هل عاد عدد الرسائل منطقيًا؟
- هل ما زالت علاقات المدير/الموظف صحيحة؟
- هل الرسائل pending ما زالت مرتبطة بمديريها؟
- هل `approval_logs` ما زالت موجودة؟
- هل `email_registry` و`email_content_archive` متسقان؟

## أوامر تحقق SQL سريعة

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM folders;
SELECT COUNT(*) FROM emails;
SELECT COUNT(*) FROM email_registry;
SELECT COUNT(*) FROM email_content_archive;
SELECT COUNT(*) FROM tracking_tasks;
SELECT COUNT(*) FROM approval_logs;
```

### تحقق من الأدمن

```sql
SELECT id, name, email, role, is_active
FROM users
WHERE email = 'm.safadi@audit.techno-grp.com';
```

### تحقق من وضع الموافقات المعلقة

```sql
SELECT id, serial, approval_status, assigned_manager_id, employee_id
FROM emails
WHERE approval_status = 'pending'
ORDER BY id DESC
LIMIT 20;
```

## أفضل ممارسة تشغيلية

لكل نشر إنتاجي:

1. خذ `pg_dump`
2. نفذ النشر
3. نفذ [post-deploy-checklist.md](file:///d:/Emailarray/Outlook/deployment/post-deploy-checklist.md)
4. إذا فشل بند حرج:
   - rollback للكود أولًا إن كان الخلل تطبيقيًا
   - restore للبيانات فقط إذا كانت المشكلة بيانات

## ما الذي يمكن تحسينه لاحقًا

لجعل rollback أسرع وأكثر أمانًا لاحقًا، أقترح مستقبلًا:

- توثيق release marker يربط كل deploy مع backup محدد

## السكربتات التشغيلية الجاهزة

الآن توجد سكربتات PowerShell فعلية داخل `deployment`:

- [backup-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/backup-postgres.ps1)
- [restore-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/restore-postgres.ps1)
- [rollback-release.ps1](file:///d:/Emailarray/Outlook/deployment/rollback-release.ps1)

### 1) أخذ backup من PostgreSQL

```powershell
.\deployment\backup-postgres.ps1 `
  -HostName localhost `
  -Port 5432 `
  -Database engineering_archive `
  -UserName engineering_archive_app `
  -Password "CHANGE_ME" `
  -Label predeploy
```

### 2) استعادة backup من PostgreSQL

```powershell
.\deployment\restore-postgres.ps1 `
  -BackupPath .\.deploy\postgres-backups\engineering_archive-YYYYMMDD-HHMMSS-predeploy.dump `
  -HostName localhost `
  -Port 5432 `
  -Database engineering_archive `
  -UserName engineering_archive_app `
  -Password "CHANGE_ME" `
  -CreatePreRestoreBackup `
  -DropConnections `
  -Force
```

### 3) عرض الإصدارات المتاحة قبل rollback

```powershell
.\deployment\rollback-release.ps1 `
  -HostName your-server `
  -UserName deploy `
  -RemotePath /var/www/emailarray-outlook `
  -ListOnly
```

### 4) تنفيذ rollback فعلي إلى release أقدم

```powershell
.\deployment\rollback-release.ps1 `
  -HostName your-server `
  -UserName deploy `
  -RemotePath /var/www/emailarray-outlook `
  -RestartMode pm2 `
  -Pm2Process emailarray-outlook `
  -Force
```

أو إلى release محدد:

```powershell
.\deployment\rollback-release.ps1 `
  -HostName your-server `
  -UserName deploy `
  -RemotePath /var/www/emailarray-outlook `
  -ReleaseId 20260709-120000 `
  -Force
```

## الخلاصة

في هذا المشروع:

- rollback للكود يتم أساسًا عبر `releases/current`
- recovery للبيانات في إنتاج PostgreSQL يجب أن يعتمد على backup PostgreSQL حقيقي
- أدوات backup الداخلية مفيدة، لكنها طبقة إضافية وليست البديل الكامل

والمسار الصحيح عند الطوارئ هو:

`diagnose quickly -> decide code vs data issue -> rollback code if needed -> restore data if needed -> run post-deploy checks again`
