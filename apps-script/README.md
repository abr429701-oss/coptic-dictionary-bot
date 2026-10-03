# Voice archive (Google Apps Script)

كل تسجيل Voice لكلمة (/record) يُرفع إلى Google Drive، ويُكتب في ورقة **Ban** صف واحد لكل كلمة:
`id, word, drive_url, drive_file_id, telegram_file_id, duration_s, full_name, user_id, username`
ورابط الملف بصيغة `https://drive.google.com/file/d/<FILE_ID>/view?usp=drivesdk`.

1. افتح https://script.google.com ← مشروعك وتأكد أن الكود مطابق لـ `Code.gs`.
2. اختر الدالة `testSetup` واضغط **Run** مرة واحدة ووافق على الصلاحيات (Drive + Sheets).
3. **Deploy ← Manage deployments ← Edit (القلم) ← Version: New version ← Deploy** (Execute as: **Me**، Who has access: **Anyone**).
4. انسخ رابط الـ Web app المنشور (ينتهي بـ `/exec`) وضعه في GitHub Actions Secrets باسم `APPS_SCRIPT_URL`، ثم شغّل workflow يدويًا مع `setup_webhook=false` كي ينتقل السر إلى Cloudflare Worker. أو أرسل الرابط للأدمن في البوت بالأمر `/setdrive الرابط`.
5. نفّذ `/drive` للتأكد من الاتصال ثم `/syncdrive` لإعادة محاولة التسجيلات المنتظرة. الرابط المحفوظ عبر `/setdrive` يتقدم على سرّ `APPS_SCRIPT_URL`؛ أرسل `/setdrive reset` للعودة إلى السرّ.

بعد أي تعديل على الكود لازم **New version** وإلا يظل الرابط يشغّل النسخة القديمة. عند تعديل النسخة في عملية نشر قائمة، يبقى رابط `/exec` نفسه عادةً ثابتًا.

## ورقة User (المستخدمون)

عند أول تواصل لمستخدم جديد، وعند إكماله التسجيل، وعند تغيّر اسمه أو يوزره في تيليجرام، يُكتب/يُحدَّث صف له في ورقة **User**: `name, username, id, joined_at, registered_at, updated_at` (مفتاح التحديث هو `id` فلا تتكرر الصفوف). لنقل المستخدمين الحاليين أرسل للأدمن `/syncusers` (دفعات من 30، كرّره حتى تنتهي).

⚠️ أي ورقة داخل نفس الملف تكون عامة لكل من معه الرابط. ملف القاموس مشارك للجميع، فبيانات المستخدمين (الأسماء الحقيقية والأرقام) ستكون ظاهرة. لفصلها، أنشئ ملفًا خاصًا وضع رقمه في `USERS_SHEET_ID` داخل `CONFIG`.

بعد أي تعديل على الكود: **Deploy ← Manage deployments ← Edit ← New version**.
