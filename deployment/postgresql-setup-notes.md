# PostgreSQL Setup Notes

## الهدف

هذه الملفات مخصصة لتشغيل المشروع على `PostgreSQL` الإنتاجي بدل الاعتماد على `pg-mem` المحلي.

الملفات المضافة:

- [create-database.sql](file:///d:/Emailarray/Outlook/deployment/create-database.sql)
- [app-schema.sql](file:///d:/Emailarray/Outlook/deployment/app-schema.sql)
- [seed-production-minimum.sql](file:///d:/Emailarray/Outlook/deployment/seed-production-minimum.sql)
- [backup-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/backup-postgres.ps1)
- [restore-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/restore-postgres.ps1)

## ترتيب التنفيذ

1. نفذ `create-database.sql` وأنت متصل بقاعدة `postgres`
2. اتصل بعد ذلك بقاعدة `engineering_archive`
3. نفذ `app-schema.sql`
4. نفذ `seed-production-minimum.sql` إذا كانت القاعدة جديدة وفارغة
5. اضبط متغير البيئة `DATABASE_URL` ليشير إلى PostgreSQL
6. اضبط `NODE_ENV=production` و`SERVE_DIST=true`
7. شغّل التطبيق

## أمثلة تشغيل

### 1) إنشاء القاعدة والمستخدم

```bash
psql -U postgres -d postgres -f deployment/create-database.sql
```

### 2) إنشاء الجداول

```bash
psql -U engineering_archive_app -d engineering_archive -f deployment/app-schema.sql
```

### 3) إدخال الحد الأدنى التشغيلي

```bash
psql -U engineering_archive_app -d engineering_archive -f deployment/seed-production-minimum.sql
```

## DATABASE_URL

مثال:

```env
DATABASE_URL=postgresql://engineering_archive_app:CHANGE_ME_STRONG_PASSWORD@localhost:5432/engineering_archive
```

## متغيرات تشغيل الإنتاج

حتى يخدم الخادم ملفات `dist` في الإنتاج، استخدم أيضًا:

```env
NODE_ENV=production
SERVE_DIST=true
```

## كيف يختار المشروع قاعدة البيانات

في `server/database.js`:

- إذا كان `DATABASE_URL` موجودًا، يعمل التطبيق على `PostgreSQL`
- إذا لم يكن موجودًا، يعود إلى `pg-mem`

هذا يعني:

- `Local dev` يمكن أن يستمر على `pg-mem`
- `Production` يجب أن يستخدم `DATABASE_URL` مع PostgreSQL

## ملاحظة مهمة

ملف `app-schema.sql` مبني على الحالة النهائية الحالية للـ schema داخل `server/database.js`، وهو مناسب جدًا لـ:

- بيئة جديدة
- قاعدة PostgreSQL فارغة
- نشر إنتاجي أولي

أما إذا كان لديك قاعدة أقدم موجودة مسبقًا، فالتطبيق ما زال يملك أيضًا منطق `ALTER TABLE IF NOT EXISTS` داخل `server/database.js` لاستكمال بعض الحقول التطورية عند الإقلاع.

## ما الذي يغطيه الـ schema

يشمل الجداول الأساسية للتشغيل الكامل، مثل:

- `users`
- `folders`
- `emails`
- `attachments`
- `email_registry`
- `email_content_archive`
- `ai_analysis`
- `tasks`
- `tracking_tasks`
- `projects`
- `email_keys`
- `approval_logs`
- `approval_action_tokens`
- `contract_memory`
- `contract_clause_memory`
- `email_accounts`

## التوصية العملية

- استخدم `pg-mem` محليًا فقط عند الحاجة إلى تطوير سريع أو تشغيل بدون PostgreSQL
- استخدم `PostgreSQL` في أي بيئة شبه إنتاجية أو إنتاجية
- بعد أول تشغيل ناجح على PostgreSQL، اترك التطبيق يكمل أي bootstrap أو migration خفيفة مدمجة في `server/database.js`
- استخدم [backup-postgres.ps1](file:///d:/Emailarray/Outlook/deployment/backup-postgres.ps1) قبل أي نشر إنتاجي أو restore
