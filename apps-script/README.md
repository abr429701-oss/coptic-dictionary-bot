# Voice archive (Google Apps Script)

كل تسجيل Voice من `/record` يُرفع إلى Google Drive، ويُكتب في ورقة **upload** صف واحد بهذه الأعمدة:
`id, word, drive_url, drive_file_id, telegram_file_id, duration_s, full_name, user_id, username, file_name, updated_at`.
العمود الثاني (`word`) يظل الكلمة القبطية فقط. أما اسم الملف في Drive فيُبنى من صف الكلمة في ورقة `dictionary` بصيغة: **العربي الكامل - القبطي.ogg** (أو `.mp3` حسب نوع الملف).

## التشغيل

1. افتح Google Apps Script وتأكد أن الكود مطابق لـ `Code.gs`.
2. شغّل `testSetup` مرة واحدة ووافق على صلاحيات Drive وSheets.
3. Deploy → Manage deployments → Edit → **Version: New version** → Execute as **Me** وWho has access **Anyone**.
4. ضع رابط `/exec` في GitHub Actions Secret باسم `APPS_SCRIPT_URL` أو أرسله للأدمن عبر `/setdrive <الرابط>`.
5. استخدم `/drive` لفحص الاتصال، ثم `/syncdrive` لمصالحة Drive مع Sheet ورفع التسجيلات القديمة المعلقة.

## المزامنة ثنائية الاتجاه

- حذف ملف الصوت من Drive يحذف صفه من `upload`، ثم يحذف البوت تسجيله المحلي عند تشغيل `/syncdrive` أو `/drive`.
- حذف صف من `upload` يضع ملف Drive المرتبط به في المهملات، باستخدام manifest محفوظ في Script Properties.
- حذف تسجيل من البوت عبر `/voice_delete <كلمة>` أو `/voice_delete_many كلمة1|كلمة2` يحذف من البوت وDrive و`upload` معًا.
- `/voice_delete_all` يحذف كل التسجيلات بعد تأكيد الأدمن.
- بعد تعديل Apps Script يجب إنشاء **New version** حتى يعمل الرابط بنفس النسخة الجديدة.

## المستخدمون

المستخدمون الجدد والقدامى يُكتبون/يُحدّثون في ورقة **users** بمفتاح Telegram ID، لمنع التكرار. شغّل `/syncusers` عدة مرات حتى تظهر رسالة اكتمال كل الدفعات؛ هذا يرحّل المستخدمين القدامى أيضًا، وليس الجدد فقط.
