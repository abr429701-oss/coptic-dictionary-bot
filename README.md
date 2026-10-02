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

الملفات جاهزة للنشر بـ GitHub Actions (`.github/workflows/deploy.yml`). أنشأت المستودع الخاص: [abr429701-oss/coptic-dictionary-bot](https://github.com/abr429701-oss/coptic-dictionary-bot).

1. افتح [صفحة إنشاء Cloudflare API Token](https://dash.cloudflare.com/profile/api-tokens)، وأنشئ token مخصصًا بصلاحية **Edit Cloudflare Workers** للحساب المطلوب، وفعّل عنوان `workers.dev` للحساب مرة واحدة. خذ `Account ID` من لوحة Cloudflare.
2. افتح [صفحة أسرار GitHub Actions للمستودع](https://github.com/abr429701-oss/coptic-dictionary-bot/settings/secrets/actions) وأضف السرّين التاليين:
   - `CLOUDFLARE_API_TOKEN` — التوكن المخصص لـ Workers.
   - `TELEGRAM_BOT_TOKEN` — توكين البوت من BotFather.
3. من تبويب **Variables** في صفحة GitHub نفسها أضف:
   - `CLOUDFLARE_ACCOUNT_ID` — معرّف الحساب.
   - `CF_DEPLOY_ENABLED` بقيمة `true`.
4. شغّل GitHub Actions → **Deploy Coptic Dictionary Bot** → **Run workflow**. سيُنشر Worker، ويولّد سير العمل سرّ webhook عشوائيًا، ويضبط أسرار Worker ويسجل webhook لدى Telegram. بعد ذلك كل دفع إلى فرع `main` ينشر التغييرات تلقائيًا.

أسرار GitHub مشفّرة ولا تظهر لي. لا ترسل التوكنات في المحادثة ولا تضعها في الملفات. عنوان Worker يُستخرج تلقائيًا من نتيجة النشر، ولا تحتاج إدخاله يدويًا.

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
