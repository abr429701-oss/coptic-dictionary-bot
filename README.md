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

**قيود التحويل للاستضافة المجانية:** هذه النسخة لا تنشئ صور Chromium، ولا ترسل نطق TTS، ولا تحوّل الرسائل الصوتية إلى نص. هذه الوظائف موجودة في نسخة Python الأصلية (`bot.py`) لكنها تحتاج خادمًا دائمًا وأدوات نظام خارج نطاق Worker المجاني. كما أن البحث هنا يعتمد المطابقة النصية المباشرة ولا يقدم اقتراحات التهجئة التقريبية الموجودة في نسخة Python.

## النشر التلقائي من GitHub

المستودع الخاص: [abr429701-oss/coptic-dictionary-bot](https://github.com/abr429701-oss/coptic-dictionary-bot). ملفات النشر موجودة في `.github/workflows/deploy.yml`.

1. أنشئ API Token من [صفحة Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) بصلاحية **Edit Cloudflare Workers** للحساب المطلوب، وفعّل عنوان `workers.dev` للحساب مرة واحدة. خذ `Account ID` من لوحة Cloudflare.
2. افتح [صفحة أسرار GitHub Actions للمستودع](https://github.com/abr429701-oss/coptic-dictionary-bot/settings/secrets/actions) وأضف:
   - `CLOUDFLARE_API_TOKEN` — التوكن المحدود لـ Workers.
   - `TELEGRAM_BOT_TOKEN` — توكين البوت من BotFather.
3. من تبويب **Variables** في صفحة الإعدادات نفسها أضف `CLOUDFLARE_ACCOUNT_ID` بمعرّف الحساب.
4. بعد إضافة القيم، يمكن تشغيل GitHub Actions → **Deploy Coptic Dictionary Bot** → **Run workflow**. سيُنشر Worker، ويولّد سرّ webhook عشوائيًا، ويضبط الأسرار ويسجل webhook لدى Telegram. بعد نجاح النشر تُفعّل إعادة النشر التلقائية عند كل دفع إلى `main`.

أسرار GitHub مشفّرة ولا تظهر لي. لا ترسل التوكنات في المحادثة ولا تضعها في الملفات. عنوان Worker وسرّ webhook يُنشآن تلقائيًا.

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
