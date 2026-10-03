# Voice archive (Google Apps Script)

لا توجد كلمة سر. كل تسجيل Voice لكلمة (/record) يُرفع إلى Google Drive، ويُكتب في ورقة **Ban** صف واحد لكل كلمة:
`id, word, drive_url, drive_file_id, telegram_file_id, duration_s, full_name, user_id, username`
ورابط الملف بصيغة `https://drive.google.com/file/d/<FILE_ID>/view?usp=drivesdk`.

1. افتح https://script.google.com ← مشروعك والصق محتوى `Code.gs` مكان الكود كله.
2. اختر الدالة `testSetup` واضغط **Run** مرة واحدة ووافق على الصلاحيات (Drive + Sheets).
3. **Deploy ← Manage deployments ← Edit (القلم) ← Version: New version ← Deploy** (Execute as: **Me**، Who has access: **Anyone**).
4. انسخ رابط الـ Web app (ينتهي بـ `/exec`) وأرسل للبوت مرة واحدة: `/setdrive الرابط` ثم `/drive` للتأكد.

بعد أي تعديل على الكود لازم **New version** وإلا يظل الرابط يشغّل النسخة القديمة.
