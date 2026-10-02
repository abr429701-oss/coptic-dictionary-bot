# بوت القاموس القبطي البحيري

بوت Telegram يبحث في القاموس المرفق (16,297 سجلًا) بالقبطية واليونانية والنطق والإنجليزية والعربية. مستودع المشروع خاص افتراضيًا لأن بيانات القاموس مرفقة.

## الاستضافة المجانية المقترحة

استخدمت **Cloudflare Workers** بدل جلسة polling دائمة: Telegram يرسل كل تحديث إلى Worker عبر HTTPS webhook، فلا نحتاج خادمًا يعمل بلا توقف. توفر الخطة المجانية حاليًا حتى **100,000 طلب يوميًا** و10 ms من CPU لكل طلب؛ هذه حدود استخدام وليست ضمان توفر/اتفاقية خدمة. قد تتغير حدود الخطة.

مصادر رسمية: [أسعار Workers](https://www.cloudflare.com/plans/) و[حدود المنصة](https://developers.cloudflare.com/workers/platform/limits/). خيار Oracle Always Free يوفر VM مجانية بلا مدة محددة، لكنه يطلب بطاقة للتحقق، ويمكن استرداد الآلات قليلة الاستخدام؛ لذلك لم أختره لهذا المشروع.

## ما تدعمه نسخة Cloudflare

- `/start` و`/help` و`/stats`.
- بحث نصي عربي/قبطي/يوناني/إنجليزي، مع تطبيع الحركات العربية وبعض اختلافات الألف والياء.
- صفحات نتائج بأزرار السابق/التالي.
- حماية webhook برمز Telegram السري.

**قيود التحويل للاستضافة المجانية:** هذه النسخة لا تنشئ صور Chromium، ولا ترسل نطق TTS، ولا تحوّل الرسائل الصوتية إلى نص. هذه الوظائف موجودة في نسخة Python الأصلية (`bot.py`) لكنها تحتاج خادمًا دائمًا وأدوات نظام خارج نطاق Worker المجاني. كما أن البحث هنا يعتمد المطابقة النصية المباشرة ولا يقدم اقتراحات التهجئة التقريبية في نسخة Python.

## النشر التلقائي من GitHub

الملفات جاهزة للنشر بـ Wrangler عبر GitHub Actions (`.github/workflows/deploy.yml`). يلزم إعداد حساب Cloudflare مجاني مرة واحدة وربط أسرار GitHub؛ لا تضع توكين Telegram في الكود أو Git.

1. أنشئ حسابًا في [Cloudflare](https://dash.cloudflare.com/sign-up) وفعّل عنوان `workers.dev` للحساب.
2. أنشئ API Token بصلاحية **Edit Cloudflare Workers**، وخذ `Account ID` من لوحة Cloudflare.
3. في مستودع GitHub افتح **Settings → Secrets and variables → Actions** وأضف:
   - **Repository secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`.
   - **Repository variables:** `CF_DEPLOY_ENABLED=true`, `WORKER_URL=https://coptic-dictionary-bot.<workers-subdomain>.workers.dev`.
4. أنشئ `WEBHOOK_SECRET` عشوائيًا من أحرف وأرقام و`_` و`-` (مثل ناتج `openssl rand -hex 32`). لا تستخدم توكين Telegram كـ webhook secret.
5. شغّل يدويًا GitHub Actions → **Deploy Coptic Dictionary Bot** → **Run workflow**. بعد نجاحه يتولى الـ workflow رفع Worker، وضع أسرار Telegram في إعدادات Worker، وتسجيل webhook. كل دفع لاحق إلى فرع `main` يعيد النشر تلقائيًا.

تُحفظ التوكينات في GitHub Actions Secrets ثم تُنقل كأسرار Worker؛ لا تُطبع في السجلات ولا تدخل Git. لا أضع أسرارًا حقيقية في الملفات.

## الاختبار محليًا

```bash
npm ci
npm test
npm run dev
```

للتشغيل المحلي، أنشئ `.dev.vars` (المستبعد من Git) وضع فيه `TELEGRAM_BOT_TOKEN` و`WEBHOOK_SECRET`.

## نسخة Python الأصلية

تظل `bot.py` و`requirements.txt` متاحة كما وردت في الأرشيف للتشغيل على خادم يدعم Python وChromium وffmpeg. في هذه النسخة تحتاج ميزة الصوت كذلك إلى `manus-speech-to-text`، وهي ليست مثبتة تلقائيًا على الاستضافة العامة.

## أمان التوكن

إذا سبق مشاركة توكين Telegram في محادثة أو مستودع أو سجل بناء، ألغِه من `@BotFather` عبر `/revoke`، ثم أضف التوكن البديل إلى GitHub Actions Secrets فقط. لا ترسله في الرسائل.
