# بوت القاموس القبطي البحيري

بوت Telegram يبحث في القاموس المرفق (16,297 سجلًا) بالقبطية واليونانية والنطق والإنجليزية والعربية. المستودع **خاص** لأن بيانات القاموس مرفقة.

## الاستضافة المجانية المقترحة

استخدمت **Cloudflare Workers** بدل جلسة polling دائمة: Telegram يرسل كل تحديث إلى Worker عبر HTTPS webhook، فلا نحتاج خادمًا يعمل بلا توقف. توفر الخطة المجانية حاليًا حتى **100,000 طلب يوميًا** و10 ms من CPU لكل طلب؛ هذه حدود استخدام وليست ضمان توفر/اتفاقية خدمة، وقد تتغير.

مصادر رسمية: [أسعار Workers](https://www.cloudflare.com/plans/) و[حدود المنصة](https://developers.cloudflare.com/workers/platform/limits/). خيار Oracle Always Free يوفر VM مجانية بلا مدة محددة، لكنه يطلب بطاقة للتحقق ويمكن استرداد الآلات قليلة الاستخدام؛ لذلك لم أختره لهذا المشروع.

## ما تدعمه نسخة Cloudflare

- `/start` و`/help` و`/stats`.
- بحث نصي عربي/قبطي/يوناني/إنجليزي، مع تطبيع الحركات العربية وبعض اختلافات الألف والياء.
- صفحات نتائج بأزرار السابق/التالي.
- حماية webhook برمز Telegram السري.
- للأدمن: تسجيل النطق الحقيقي كلمةً كلمةً من داخل Telegram عبر `/record`؛ يحفظ Worker `file_id` الأصلي، ويرفع Voice إلى Google Drive ويكتب رابطه في Sheet تلقائيًا عند إعداد أسرار الخادم. لا حاجة إلى `/setdrive` ولا لإرسال رابط أو كلمة سر في المحادثة.
- إذا كان للكلمة أكثر من معنى مفصول بفاصلة في بيانات القاموس، يعرض البوت معنى واحدًا في كل مرة مع زر inline لعرض المعنى التالي.

**قيود الاستضافة المجانية:** هذه النسخة لا تنشئ صور Chromium ولا تحوّل الرسائل الصوتية الواردة إلى نص. يمكن للأدمن تسجيل ملفات Voice أصلية من Telegram وحفظها وإعادة إرسالها؛ والكلمات التي لا تملك تسجيلًا تستخدم نطق TTS الاحتياطي. وظائف الصور والتحويل الصوتي المتقدم موجودة في نسخة Python الأصلية (`bot.py`) وتحتاج خادمًا دائمًا وأدوات نظام إضافية. كما أن البحث هنا يعتمد المطابقة النصية المباشرة ولا يقدم اقتراحات التهجئة التقريبية الموجودة في نسخة Python.

## النشر التلقائي من GitHub

المستودع الخاص: [abr429701-oss/coptic-dictionary-bot](https://github.com/abr429701-oss/coptic-dictionary-bot). ملفات النشر موجودة في `.github/workflows/deploy.yml`.

1. أنشئ API Token من [صفحة Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) بصلاحية **Edit Cloudflare Workers** للحساب المطلوب، وفعّل عنوان `workers.dev` للحساب مرة واحدة. خذ `Account ID` من لوحة Cloudflare.
2. افتح [صفحة أسرار GitHub Actions للمستودع](https://github.com/abr429701-oss/coptic-dictionary-bot/settings/secrets/actions) وأضف:
   - `CLOUDFLARE_API_TOKEN` — التوكن المحدود لـ Workers.
   - `TELEGRAM_BOT_TOKEN` — توكين البوت من BotFather.
   - `APPS_SCRIPT_URL` — رابط Apps Script المنشور والمنتهي بـ `/exec`.
   - `APPS_SCRIPT_SECRET` — القيمة السرية المخزنة في **Script properties** في Apps Script.
3. من تبويب **Variables** في صفحة الإعدادات نفسها أضف `CLOUDFLARE_ACCOUNT_ID` بمعرّف الحساب.
4. بعد إضافة القيم، شغّل GitHub Actions → **Deploy Coptic Dictionary Bot** → **Run workflow**. لتحديث أسرار Drive دون إعادة ضبط Telegram webhook، اختر `setup_webhook=false`. يضع workflow أسرار Apps Script على Worker؛ بعد ذلك يعمل رفع `/record` تلقائيًا. بعد نجاح النشر تُفعّل إعادة النشر التلقائية عند كل دفع إلى `main`.

أسرار GitHub مشفّرة ولا تظهر لي. لا ترسل التوكنات أو رابط Apps Script وكلمة سره إلى البوت أو المحادثة، ولا تضعها في ملفات المستودع. عنوان Worker وسرّ webhook يُنشآن تلقائيًا.

## تسجيل النطق الحقيقي من Telegram

الأدمن المحدد في `ADMIN_CHAT_ID` أو المعرّف الافتراضي يستطيع إرسال `/record` (أو `/Record`) في محادثة خاصة مع البوت. سيعرض البوت كلمة واحدة، ثم:

1. سجّلها من زر الميكروفون في Telegram كرسالة **Voice**.
2. يحفظ البوت `file_id` الأصلي للتسجيل في Durable Object، ثم يرفع الملف إلى Drive ويضيف رابطه إلى Sheet تلقائيًا عند تهيئة أسرار Worker.
3. يعرض الكلمة التالية تلقائيًا.
4. أرسل `/record_stop` للإيقاف، ثم `/record` للاستكمال من أول كلمة لم تُسجّل.

عند بحث أي مستخدم عن كلمة لها تسجيل محفوظ، يرسل البوت نفس رسالة الصوت الأصلية عبر Telegram. الكلمات غير المسجلة تستخدم النطق الاحتياطي الموجود في النسخة الحالية إلى أن يتم تسجيلها.

## الاختبار محليًا

```bash
npm ci
npm test
npm run dev
```

للتشغيل المحلي، انسخ `.dev.vars.example` إلى `.dev.vars` (المستبعد من Git) وضع فيه `TELEGRAM_BOT_TOKEN` و`WEBHOOK_SECRET`.

## نسخة Python الأصلية

تظل `bot.py` و`requirements.txt` متاحة كما وردت في الأرشيف للتشغيل على خادم يدعم Python وChromium وffmpeg. ميزة تحويل الصوت تحتاج كذلك إلى `manus-speech-to-text`، وهي ليست مثبتة تلقائيًا على الاستضافة العامة.

## أمان التوكن

إذا سبق مشاركة توكين Telegram في محادثة أو مستودع أو سجل بناء، ألغِه من `@BotFather` عبر `/revoke`، ثم أضف التوكن البديل إلى GitHub Actions Secrets فقط. لا ترسله في الرسائل.

## مزامنة القاموس من Google Sheets

مصدر البيانات الآن شيت عام (`SHEET_ID` داخل `scripts/sheet_to_json.py`). يعمل GitHub Actions كل 30 دقيقة: ينزّل الشيت كـ CSV ويحوّله إلى `data/dictionary.json`، وإذا تغيّرت البيانات يحفظها وينشر الـ Worker تلقائيًا. لا يتغيّر شيء في الـ Worker نفسه أثناء الطلبات، فلا تتأثر حدود الاستخدام ولا السرعة. تشغيل يدوي: Actions ← Deploy Coptic Dictionary Bot ← Run workflow.
