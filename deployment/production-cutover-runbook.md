# Production Cutover Runbook

## الهدف

هذا الملف هو أقصر مسار تنفيذي فعلي لنشر النظام على الإنتاج مع `PostgreSQL`، ثم التحقق السريع، ثم مسار الطوارئ إذا حدث خلل.

## المتطلبات قبل البدء

- قاعدة `PostgreSQL` جاهزة
- ملف `shared/.env` موجود على السيرفر
- ملفات التهيئة الأولى منفذة عند الحاجة:
  - [create-database.sql](file:///d:/Emailarray/Outlook/deployment/create-database.sql)
  - [app-schema.sql](file:///d:/Emailarray/Outlook/deployment/app-schema.sql)
  - [seed-production-minimum.sql](file:///d:/Emailarray/Outlook/deployment/seed-production-minimum.sql)
- أدوات الجهاز المحلي:
  - `ssh`
  - `scp`
  - `pg_dump`
  - `pg_restore`

## القيم التي ستحتاجها

استبدل هذه القيم قبل التنفيذ:

```text
DB_HOST=localhost
DB_PORT=5432
DB_NAME=engineering_archive
DB_USER=engineering_archive_app
DB_PASSWORD=CHANGE_ME_DB_PASSWORD

DEPLOY_HOST=your-server
DEPLOY_USER=deploy
REMOTE_PATH=/var/www/emailarray-outlook
APP_URL=https://your-app.example.com

PM2_PROCESS=emailarray-outlook
```

## 1) خذ backup قبل النشر

```powershell
.\deployment\backup-postgres.ps1 `
  -HostName "DB_HOST" `
  -Port 5432 `
  -Database "engineering_archive" `
  -UserName "engineering_archive_app" `
  -Password "DB_PASSWORD" `
  -Label "predeploy"
```

### النتيجة المتوقعة

- يتم إنشاء ملف backup داخل `.\.deploy\postgres-backups`

## 2) نفذ النشر

```powershell
.\deployment\deploy-production.ps1 `
  -HostName "DEPLOY_HOST" `
  -UserName "DEPLOY_USER" `
  -RemotePath "/var/www/emailarray-outlook" `
  -RestartMode pm2 `
  -Pm2Process "emailarray-outlook" `
  -AppUrl "https://your-app.example.com"
```

### النتيجة المتوقعة

- يرفع السكربت release جديد
- يحدّث `current`
- يعيد تشغيل الخدمة

## 3) نفذ فحص cutover السريع

نفذ هذه النقاط مباشرة بعد النشر:

1. افتح التطبيق
2. تأكد أن شاشة الدخول تعمل
3. نفذ:

```bash
curl https://your-app.example.com/api/health
```

4. تأكد أن:

```json
{
  "status": "ok",
  "databaseMode": "postgres"
}
```

5. سجل الدخول كأدمن
6. افتح `Pending`
7. افتح الإعدادات

## 4) نفذ post-deploy checks الحرجة

بعد نجاح الفحص السريع، أكمل عبر:

- [post-deploy-checklist.md](file:///d:/Emailarray/Outlook/deployment/post-deploy-checklist.md)

والحد الأدنى العملي من القائمة هو:

- تسجيل دخول الأدمن
- `databaseMode = postgres`
- إنشاء مستخدم ومدير
- اختبار `IMAP`
- اختبار `Pending Approval`
- اختبار `Safe Rewrite Approval Lock`

## 5) إذا فشل النشر: rollback للكود

### عرض الإصدارات المتاحة

```powershell
.\deployment\rollback-release.ps1 `
  -HostName "DEPLOY_HOST" `
  -UserName "DEPLOY_USER" `
  -RemotePath "/var/www/emailarray-outlook" `
  -ListOnly
```

### rollback إلى آخر release سابق

```powershell
.\deployment\rollback-release.ps1 `
  -HostName "DEPLOY_HOST" `
  -UserName "DEPLOY_USER" `
  -RemotePath "/var/www/emailarray-outlook" `
  -RestartMode pm2 `
  -Pm2Process "emailarray-outlook" `
  -AppUrl "https://your-app.example.com" `
  -Force
```

### بعد rollback

- أعد تنفيذ:
  - `/api/health`
  - تسجيل دخول الأدمن
  - فحص `Pending`

## 6) إذا كانت المشكلة بيانات فقط: restore للبيانات

لا تستخدم restore إلا إذا كان الخلل في البيانات فعلًا، وليس مجرد خلل تطبيقي.

```powershell
.\deployment\restore-postgres.ps1 `
  -BackupPath ".\.deploy\postgres-backups\engineering_archive-YYYYMMDD-HHMMSS-predeploy.dump" `
  -HostName "DB_HOST" `
  -Port 5432 `
  -Database "engineering_archive" `
  -UserName "engineering_archive_app" `
  -Password "DB_PASSWORD" `
  -CreatePreRestoreBackup `
  -DropConnections `
  -Force
```

### بعد restore

- نفذ فحصًا سريعًا:
  - `/api/health`
  - تسجيل دخول الأدمن
  - عدد الرسائل
  - `Pending Approval`

## 7) قرار الطوارئ السريع

استخدم هذا القرار المختصر:

- إذا الخدمة لا تقلع أو المسارات الحرجة مكسورة:
  - `rollback-release.ps1`
- إذا الكود سليم لكن البيانات نفسها تضررت:
  - `restore-postgres.ps1`

## 8) المراجع

- [postgresql-setup-notes.md](file:///d:/Emailarray/Outlook/deployment/postgresql-setup-notes.md)
- [post-deploy-checklist.md](file:///d:/Emailarray/Outlook/deployment/post-deploy-checklist.md)
- [rollback-and-recovery.md](file:///d:/Emailarray/Outlook/deployment/rollback-and-recovery.md)
- [backup-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/backup-postgres.ps1)
- [restore-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/restore-postgres.ps1)
- [rollback-release.ps1](file:///d:/Emailarray/Outlook/deployment/rollback-release.ps1)
