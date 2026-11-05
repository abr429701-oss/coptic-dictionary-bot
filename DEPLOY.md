# دليل نشر وتشغيل بوت القاموس القبطي

البوت يعمل على **Cloudflare Workers** (لا يحتاج خادمًا دائم التشغيل) والنشر **تلقائي بالكامل** عبر GitHub Actions: أي دفع (push) إلى فرع `main` يُنشئ Worker جديدًا ويحدّث رابط الويب هوك تلقائيًا (عند ضبط `setup_webhook=true`).

---

## الخطوة 1: المتطلبات (مرة واحدة فقط)

1. **حساب Cloudflare** (الخطة المجانية تكفي): فعّل عنوان `workers.dev` مرة واحدة من لوحة التحكم.
2. **API Token من Cloudflare**: من [صفحة API Tokens](https://dash.cloudflare.com/profile/api-tokens) أنشئ توكنًا بصلاحية **Edit Cloudflare Workers** على الحساب.
3. **Account ID**: انسخه من الصفحة الرئيسية للوحة Cloudflare (Right sidebar → Account ID).
4. **توكن البوت من @BotFather** في تيليجرام.
5. **اختياري: رابط Apps Script** (`APPS_SCRIPT_URL`) لأرشفة التسجيلات الصوتية على Google Drive — يجب أن ينتهي بـ `/exec`.

## الخطوة 2: إضافة الأسرار والمتغيرات في GitHub

افتح [صفحة أسرار الإجراءات](https://github.com/abr429701-oss/coptic-dictionary-bot/settings/secrets/actions) للمستودع:

**تبويب Secrets (أسرار مشفرة):**
| الاسم | القيمة |
|---|---|
| `CLOUDFLARE_API_TOKEN` | توكن Cloudflare بصلاحية Edit Workers |
| `TELEGRAM_BOT_TOKEN` | توكن البوت من @BotFather |
| `APPS_SCRIPT_URL` | اختياري — رابط Web App من Apps Script ينتهي بـ `/exec` |

**تبويب Variables (متغيرات عامة):**
| الاسم | القيمة |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | معرّف حساب Cloudflare |

> ملاحظة أمنية: الأسرار مشفرة ولا تظهر في سجلات البناء. لا تضع التوكنات في ملفات الكود أبدًا. ملفا `.env` و`.dev.vars` مستبعدان من Git عبر `.gitignore`.

## الخطوة 3: النشر الأولي (مع ضبط الويب هوك)

1. ادفع الكود إلى `main` (أو شغّل الإجراء يدويًا):
   GitHub → Actions → **Deploy Coptic Dictionary Bot** → **Run workflow** → اترك `setup_webhook=true`.
2. سيقوم الإجراء تلقائيًا بـ:
   - بناء `dictionary.json` من Google Sheet ورسم بطاقات الكلمات.
   - تثبيت الاعتماديات وتشغيل الاختبارات.
   - `wrangler deploy` لنشر Worker (الرابط عادة: `https://coptic-dictionary-bot.<حسابك>.workers.dev`).
   - توليد سر ويب هوك عشوائي ورفعه إلى Worker كـ `secret`.
   - تسجيل رابط الويب هوك في تيليجرام (`setWebhook`) مع السر.
3. تحقق من نجاح التسجيل في آخر خطوة (Show webhook status) — يجب أن يظهر `url` غير فارغ و`last_error: null`.

## الخطوة 4: التحديثات اللاحقة

لكل تعديل لاحق على الكود: فقط **ادفع إلى `main`** وسيُعاد النشر تلقائيًا. **لا** تحتاج لإعادة ضبط الويب هوك كل مرة؛ إذا شغّلت يدويًا اضبط `setup_webhook=false` لتجنب إعادة توليد السر.

## التحقق من عمل البوت

- أرسل `/start` للبوت في تيليجرام — يجب أن يرد بصورة الترحيب وقائمة الأوامر.
- للأدمن (المعرّف في `data/owner_chat_id.txt` = `813894692`، أو عبر متغير `ADMIN_CHAT_ID`): أرسل `/admin` لفتح لوحة التحكم، و`/botinfo` للتشخيص، و`/usage` لاستخدام Worker.
- فعّل Inline من @BotFather: `/setinline` ← اختر البوت ← اكتب نصًا مثل «اكتب كلمة قبطية أو عربية».

## المصادقة الثنائية للأدمن (/2fa)

- الأدمن يفعّلها عبر `/2fa setup` ثم يمسح رمز QR بمصادق (Google Authenticator / Authy / إلخ).
- بعد التفعيل، كل أمر إداري حساس (بث، حظر، تعديل جماعي، حذف...) يتطلب `/2fa verify <الرمز>` كل 30 دقيقة.
- للحالة: `/2fa status`؛ للإلغاء: `/2fa off`.

## التشغيل المحلي (للتطوير فقط)

```bash
npm ci
cp .dev.vars.example .dev.vars   # ضع TELEGRAM_BOT_TOKEN و WEBHOOK_SECRET تجريبيين
npm run build:search-index
npm test
npm run dev                      # wrangler dev محلي
```

## حل المشكلات الشائعة

| المشكلة | الحل |
|---|---|
| فشل `wrangler deploy` بـ "Missing secret" | تأكد من إضافة `CLOUDFLARE_API_TOKEN` و`CLOUDFLARE_ACCOUNT_ID` في صفحة الإعدادات. |
| البوت لا يرد | تحقق من `getWebhookInfo`: تأكد أن `url` يشير إلى Worker وأن `allowed_updates` تشمل `message,callback_query,inline_query`. |
| `APPS_SCRIPT_URL` خطأ | يجب أن يكون رابط `https://script.google.com/.../exec` صالحًا؛ هو اختياري وبدونه يعمل البوت بدون أرشفة Drive فقط. |
| فشل الاختبارات في سجل البناء | معروف ومسموح به (`continue-on-error`): بعض الاختبارات لها قيم شيت قديمة ثابتة؛ لا يمنع النشر. |
| تغيير توكن البوت | ألغِ القديم من @BotFather بـ `/revoke`، حدّث `TELEGRAM_BOT_TOKEN` في أسرار GitHub، ثم شغّل الإجراء بـ `setup_webhook=true`. |

## البنية التقنية

- **وقت التشغيل**: Cloudflare Worker (ESM, Node 22 compatibility).
- **الثبات**: Durable Object (`UserStore`) مع SQLite داخلي للمستخدمين والإعدادات وسجل التدقيق.
- **البيانات**: `data/dictionary.json` (16,297 مدخل) يُعاد بناؤه كل 30 دقيقة من Google Sheet.
- **الصوت**: تسجيلات بشرية محفوظة كـ `file_id` في DO + ملفات Miguel المسبقة البناء في فرع `audio` (Amazon Polly / IPA Reader).
- **النشر**: `.github/workflows/deploy.yml` — يُنفذ على push إلى main، وجدول كل 30 دقيقة، وأحداث `sheet-changed`.
