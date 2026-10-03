# أرشفة الصوت في Google Drive عبر Apps Script

1. افتح مشروع Apps Script والصق محتوى `Code.gs` كاملًا. في المشروع الحالي، استخدم إعداد **Script properties** بدل وضع الأسرار داخل الشيفرة.
2. أضف `SECRET` إلى **Script properties** بقيمة طويلة وعشوائية. لا تضعها في ملفات المستودع أو رسائل تيليجرام.
3. أبقِ `FOLDER_ID` الحالي في **Script properties** إذا كان موجودًا؛ وإلا ينشئ السكربت مجلدًا باسم `Coptic Dictionary Voices` في Drive.
4. اختر `testSetup` وشغّلها مرة واحدة من المحرر للموافقة على صلاحيات Drive وSheets.
5. من **Deploy → Manage deployments → Edit → New version → Deploy** حدّث نشر Web app الحالي، مع **Execute as: Me** و**Who has access: Anyone**.
6. ضع رابط النشر المنتهي بـ `/exec` في سر GitHub Actions باسم `APPS_SCRIPT_URL`، وضع قيمة الخاصية `SECRET` في سر باسم `APPS_SCRIPT_SECRET`. ينقل workflow هذه القيم إلى أسرار Cloudflare Worker؛ لا تُرسلها إلى البوت ولا تضعها في الشيفرة.
7. بعد ضبط السرّين، يرفع `/record` كل تسجيل Voice تلقائيًا إلى Drive ويضيف رابط الملف إلى عمود `Voice link` في الشيت. لا حاجة إلى `/setdrive`.

بعد أي تعديل على الكود يجب نشر **New version** حتى يستخدم رابط الويب النسخة الجديدة. يضيف السكربت عمود `Voice link` بعد آخر عمود مستخدم؛ لا يفترض أن العمود AT فارغ ولا يكتب فوق بيانات القاموس الموجودة.
