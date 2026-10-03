# Voice archive (Google Apps Script)

1. افتح https://script.google.com ← مشروع جديد (أو المشروع الحالي) والصق محتوى `Code.gs` مكان الكود كله.
2. من أيقونة الترس (Project Settings) ← **Script properties** ← أضف `SECRET` بقيمة كلمة سر طويلة عشوائية (احتفظ بها).
3. (اختياري) ضع `FOLDER_ID` في Script properties أو داخل `CONFIG`، وإلا يُنشأ فولدر باسم `Coptic Dictionary Voices` في Drive.
4. اختر الدالة `testSetup` من القائمة أعلى المحرر واضغط **Run** مرة واحدة من المحرر ووافق على الصلاحيات (Drive + Sheets).
5. **Deploy ← Manage deployments ← Edit (القلم) ← Version: New version ← Deploy.**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. انسخ رابط الـ Web app (ينتهي بـ `/exec`).
7. في بوت تيليجرام (كأدمن) أرسل: `/setdrive رابط_الويب_آب كلمة_السر` ثم `/drive` للتأكد.

بعد أي تعديل على الكود لازم **New version** وإلا يظل الرابط يشغّل النسخة القديمة.

يحفظ البوت روابط التسجيلات وبياناتها في تبويب `Ban` داخل جدول بيانات القاموس، بترتيب الأعمدة: `id`, `word`, `drive_url`, `drive_file_id`, `telegram_file_id`, `duration_s`, `updated_at`. إذا كان التبويب فارغًا يبدأ الجدول من العمود A؛ وإذا كانت فيه بيانات أخرى، يضيف الجدول بعد آخر عمود مستخدم. إعادة تسجيل الكلمة تحدّث صفّها حسب المعرّف الدائم.
