"""Coptic Dictionary Telegram bot.

Any non-command text is treated as a search query. The bot searches Coptic,
Greek, English transliteration, Arabic meaning, and metadata.
"""
from __future__ import annotations

import json
import asyncio
import html
import logging
import os
import re
import subprocess
import tempfile
import unicodedata
import httpx
import arabic_reshaper
from bidi.algorithm import get_display
from playwright.sync_api import sync_playwright
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz, process
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler,
    filters,
)

BASE = Path(__file__).resolve().parent
DATA_FILE = BASE / "data" / "dictionary.json"
PAGE_SIZE = 1
MAX_MESSAGE = 3900
BOT_TITLE = "📖 القاموس القبطي البحيري"
AUDIO_BASE_URL = os.environ.get(
    "AUDIO_BASE_URL",
    "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio-human",
).rstrip("/")
logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", str(text or "")).casefold().strip()
    # Arabic diacritics and tatweel; normalize common alef variants.
    text = re.sub(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]", "", text)
    text = text.translate(str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي"}))
    return re.sub(r"\s+", " ", text)


def esc(value: Any) -> str:
    # Telegram HTML escaping without importing another dependency.
    return (str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


with DATA_FILE.open(encoding="utf-8") as f:
    RECORDS: list[dict[str, str]] = json.load(f)
SEARCH_TEXT = [normalize(" ".join(str(v) for v in r.values())) for r in RECORDS]


def find_matches(query: str) -> list[int]:
    q = normalize(query)
    if not q:
        return []
    # Substring match is primary and works for a single letter as requested.
    exact = [i for i, text in enumerate(SEARCH_TEXT) if q in text]
    if exact:
        return exact
    # If there is no substring, offer close spelling suggestions.
    choices = process.extract(q, SEARCH_TEXT, scorer=fuzz.WRatio, limit=30, score_cutoff=52)
    return [idx for _, score, idx in choices if score >= 52]


def format_record(record: dict[str, str], number: int) -> str:
    lines = [f"<b>{number}. {esc(record.get('coptic', ''))}</b>"]
    for label, key in (("اليونانية", "greek"), ("النطق", "pronunciation"),
                       ("الإنجليزية", "english"), ("التهجئة", "phonetic"),
                       ("التعريب المُشكّل", "arabic_pronunciation"),
                       ("النوع", "kind"), ("الجنس", "gender"), ("المعنى", "meaning")):
        value = record.get(key, "").strip()
        if value:
            lines.append(f"• <b>{label}:</b> {esc(value)}")
    return "\n".join(lines)


def rtl(text: str) -> str:
    return get_display(arabic_reshaper.reshape(str(text or "—")))


def make_word_card(record: dict[str, str], path: str) -> None:
    """Render exact multilingual text with Chromium's shaping engine."""
    coptic_font = (BASE / "fonts" / "NotoSansCoptic-Regular.ttf").as_uri()
    arabic_font = Path("/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf").as_uri()
    latin_font = Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf").as_uri()
    q = lambda value: html.escape(str(value or "—"))
    meaning = str(record.get("meaning", "—"))[:90]
    markup = f"""<!doctype html><meta charset='utf-8'>
    <style>
      @font-face {{ font-family: Coptic; src: url('{coptic_font}'); }}
      @font-face {{ font-family: Arabic; src: url('{arabic_font}'); }}
      @font-face {{ font-family: Latin; src: url('{latin_font}'); }}
      * {{ box-sizing:border-box }} body {{ margin:0; width:1200px; height:800px; background:#102A43; }}
      .card {{ position:absolute; left:55px; top:55px; width:1090px; height:690px; border-radius:34px;
        background:#F4F7FA; border:4px solid #D9E2EC; color:#102A43; text-align:center; }}
      .brand {{ font:34px Latin; color:#486581; margin-top:50px; }}
      .word {{ font:96px Coptic; margin-top:70px; line-height:1.1; }}
      .trans {{ font:52px Arabic; color:#D64545; direction:rtl; unicode-bidi:plaintext; margin-top:36px; }}
      .meaning {{ font:38px Arabic; direction:rtl; unicode-bidi:plaintext; margin:55px 80px 0; }}
      .note {{ font:32px Arabic; direction:rtl; unicode-bidi:plaintext; color:#627D98; margin-top:55px; }}
    </style>
    <div class='card'>
      <div class='brand'>COPTIC DICTIONARY</div>
      <div class='word'>{q(record.get('coptic'))}</div>
      <div class='trans'>{q(record.get('arabic_pronunciation'))}</div>
      <div class='meaning'>المعنى: {q(meaning)}</div>
      <div class='note'>النطق القبطي البحيري التقريبي</div>
    </div>"""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path="/usr/bin/chromium",
                                              args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1200, "height": 800}, device_scale_factor=1)
        page.set_content(markup, wait_until="load")
        page.evaluate("document.fonts.ready")
        page.screenshot(path=path, type="jpeg", quality=95)
        browser.close()


def render(query: str, indices: list[int], page: int) -> tuple[str, InlineKeyboardMarkup | None]:
    total_pages = max(1, (len(indices) + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(0, min(page, total_pages - 1))
    start = page * PAGE_SIZE
    chunk = indices[start:start + PAGE_SIZE]
    title = (f"<b>{BOT_TITLE}</b>\n"
             f"🔎 <b>نتائج البحث عن:</b> {esc(query)}\n"
             f"<b>النتائج:</b> {len(indices)} | <b>الصفحة:</b> {page + 1}/{total_pages}\n\n")
    body = "\n\n".join(format_record(RECORDS[i], start + n + 1) for n, i in enumerate(chunk))
    text = (title + body)[:MAX_MESSAGE]
    buttons = []
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("السابق", callback_data=f"p|{page-1}"))
    if page < total_pages - 1:
        nav.append(InlineKeyboardButton("التالي", callback_data=f"p|{page+1}"))
    if nav:
        buttons.append(nav)
    markup = InlineKeyboardMarkup(buttons) if buttons else None
    return text, markup


async def send_search(update: Update, context: ContextTypes.DEFAULT_TYPE, query: str, page: int = 0):
    indices = find_matches(query)
    if not indices:
        await update.effective_message.reply_text(
            f"لم أجد نتائج لـ <b>{esc(query)}</b>.\nجرّب القبطية أو العربية أو الإنجليزية أو تهجئة أقرب.",
            parse_mode=ParseMode.HTML,
        )
        return
    context.user_data["last_query"] = query
    context.user_data["last_indices"] = indices
    text, markup = render(query, indices, page)
    # النص رسالة مستقلة تمامًا بلا أي صوت مرفق أو ذكر لملف داخلها.
    await update.effective_message.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)
    # الصوت ملف منفصل يُرسل في نفس اللحظة مع بطاقة الصورة (بالتوازي) — لا انتظار بينهما.
    await asyncio.gather(
        send_page_card(update.effective_chat.id, indices, page, context),
        send_page_audio(update.effective_chat.id, indices, page, context),
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        f"{BOT_TITLE}\n\nأهلًا بك في القاموس.\n\n"
        "اكتب الكلمة مباشرة بدون أي أمر، مثل:\n"
        "ⲁⲛⲁⲩ\n"
        "water\n"
        "ماء\n\n"
        "سأبحث في القبطية والعربية والإنجليزية والنطق والتهجئة.\n"
        "استخدم /help للمساعدة.",
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)


async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(f"عدد سجلات القاموس المفهرسة: {len(RECORDS):,}")


async def text_search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = (update.effective_message.text or "").strip()
    if query:
        await send_search(update, context, query)


async def voice_search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Transcribe a Telegram voice note, then run the normal dictionary search."""
    voice = update.effective_message.voice or update.effective_message.audio
    if not voice:
        return
    try:
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "voice.ogg"
            wav = Path(folder) / "voice.wav"
            tg_file = await context.bot.get_file(voice.file_id)
            await tg_file.download_to_drive(source)
            await asyncio.to_thread(
                subprocess.run,
                ["ffmpeg", "-y", "-i", str(source), "-ar", "16000", "-ac", "1", str(wav)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            result = await asyncio.to_thread(
                subprocess.run,
                ["manus-speech-to-text", str(wav)],
                check=True, capture_output=True, text=True,
            )
            query = result.stdout.strip()
        if not query:
            await update.effective_message.reply_text("لم أستطع فهم الفويس. أرسل الكلمة بوضوح مرة أخرى.")
            return
        await update.effective_message.reply_text(f"سمعت: {query}")
        await send_search(update, context, query)
    except Exception:
        log.exception("Voice transcription failed")
        await update.effective_message.reply_text("تعذر تحويل الفويس إلى نص الآن. جرّب تسجيلًا أوضح.")


async def set_profile_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Use the received photo as the bot avatar, then lock to that chat."""
    owner_file = BASE / "data" / "owner_chat_id.txt"
    owner = owner_file.read_text().strip() if owner_file.exists() else ""
    chat_id = str(update.effective_chat.id)
    if owner and owner != chat_id:
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    try:
        photo = update.effective_message.photo[-1]
        tg_file = await context.bot.get_file(photo.file_id)
        with tempfile.NamedTemporaryFile(suffix=".jpg") as image:
            await tg_file.download_to_drive(image.name)
            image.flush()
            image.seek(0)
            payload = {"type": "static", "photo": "attach://profile_photo"}
            url = f"https://api.telegram.org/bot{context.bot.token}/setMyProfilePhoto"
            with open(image.name, "rb") as handle:
                response = await asyncio.to_thread(
                    httpx.post, url,
                    data={"photo": json.dumps(payload)},
                    files={"profile_photo": ("profile.jpg", handle, "image/jpeg")},
                    timeout=30.0,
                )
            response.raise_for_status()
            result = response.json()
            if not result.get("ok"):
                raise RuntimeError(result)
        owner_file.write_text(chat_id, encoding="utf-8")
        await update.effective_message.reply_text("تم تعيين الصورة بنجاح كصورة بروفايل للبوت.")
    except Exception:
        log.exception("Profile photo update failed")
        await update.effective_message.reply_text("تعذر تعيين الصورة. أرسل صورة JPG مربعة مرة أخرى.")


async def page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    indices = context.user_data.get("last_indices", [])
    text_query = context.user_data.get("last_query", "")
    if not indices:
        await query.edit_message_text("انتهت جلسة البحث. أرسل الكلمة مرة أخرى.")
        return
    page = int((query.data or "p|0").split("|", 1)[1])
    text, markup = render(text_query, indices, page)
    await query.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)
    await send_page_card(update.effective_chat.id, indices, page, context)
    await send_page_audio(update.effective_chat.id, indices, page, context)


async def send_page_card(chat_id: int, indices: list[int], page: int, context: ContextTypes.DEFAULT_TYPE):
    for index in indices[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]:
        try:
            record = RECORDS[index]
            with tempfile.NamedTemporaryFile(suffix=".jpg") as image:
                await asyncio.to_thread(make_word_card, record, image.name)
                image.seek(0)
                await context.bot.send_photo(chat_id=chat_id, photo=image,
                                             caption=f"📖 بطاقة الكلمة: {record.get('coptic', '')}")
        except Exception:
            log.exception("Word card generation failed for record %s", index)


async def download_prebuilt_audio(record: dict[str, str]) -> bytes:
    """Download Matthew/IPA Reader audio from the public audio-human branch.

    Uses a non-blocking async client (no thread hop) so the download runs
    concurrently with card rendering and arrives as fast as possible.
    """
    word_id = record.get("id")
    if word_id in (None, ""):
        raise ValueError("record has no permanent audio id")
    url = f"{AUDIO_BASE_URL}/{word_id}.ogg"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=5.0), follow_redirects=True
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


async def send_page_audio(chat_id: int, indices: list[int], page: int, context: ContextTypes.DEFAULT_TYPE):
    """Send the prebuilt Matthew voice for the records shown on this page.

    Runs concurrently with send_page_card: the voice file is fetched and
    uploaded in parallel, so text, card and audio land at the same moment.
    """
    await context.bot.send_chat_action(chat_id=chat_id, action="upload_voice")
    for index in indices[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]:
        record = RECORDS[index]
        if not (record.get("pronunciation") or "").strip():
            continue
        try:
            audio_bytes = await download_prebuilt_audio(record)
            with tempfile.NamedTemporaryFile(suffix=".ogg") as audio:
                audio.write(audio_bytes)
                audio.flush()
                audio.seek(0)
                await context.bot.send_voice(
                    chat_id=chat_id,
                    voice=audio,
                    caption=f"🔊 {record.get('coptic', '')} — Matthew / IPA",
                )
        except Exception:
            log.exception("Prebuilt audio download failed for record %s", index)


async def audio_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer("جارٍ تجهيز النطق...")
    try:
        index = int((query.data or "a|0").split("|", 1)[1])
        record = RECORDS[index]
    except (ValueError, IndexError):
        await query.message.reply_text("تعذر تحديد الكلمة.")
        return
    if not (record.get("pronunciation") or "").strip():
        await query.message.reply_text("لا يوجد نطق مسجل لهذه الكلمة.")
        return
    try:
        audio_bytes = await download_prebuilt_audio(record)
        with tempfile.NamedTemporaryFile(suffix=".ogg") as audio:
            audio.write(audio_bytes)
            audio.flush()
            audio.seek(0)
            await query.message.reply_voice(voice=audio, caption="النطق: Matthew / IPA — بطيء × 3")
    except Exception:
        log.exception("Prebuilt audio download failed")
        await query.message.reply_text("الصوت لم يُولَّد لهذه الكلمة بعد. شغّل Workflow الصوت ثم جرّب مرة أخرى.")


# ===================== ADMIN FEATURES (Python) =====================
ADMIN_DATA_FILE = BASE / "data" / "admin_data.json"


def _load_admin_data() -> dict:
    if ADMIN_DATA_FILE.exists():
        try:
            return json.loads(ADMIN_DATA_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"users": {}, "bans": {}, "broadcast": None}


def _save_admin_data(data: dict) -> None:
    ADMIN_DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _owner_id() -> int:
    owner_file = BASE / "data" / "owner_chat_id.txt"
    if owner_file.exists():
        try:
            return int(owner_file.read_text().strip())
        except (ValueError, TypeError):
            pass
    return 0


def _is_admin(update: Update) -> bool:
    return update.effective_user is not None and update.effective_user.id == _owner_id()


async def _track_user(update: Update) -> None:
    user = update.effective_user
    if not user:
        return
    import time as _time
    data = _load_admin_data()
    uid = str(user.id)
    entry = data["users"].get(uid, {})
    entry["name"] = (user.full_name or "")[:60]
    entry["username"] = user.username or ""
    entry["searches"] = int(entry.get("searches", 0)) + 1
    entry["last_active"] = int(_time.time())
    data["users"][uid] = entry
    _save_admin_data(data)


async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    data = _load_admin_data()
    users = len(data["users"])
    bans = len(data["bans"])
    total_searches = sum(int(u.get("searches", 0)) for u in data["users"].values())
    text = (
        "🎛 <b>لوحة تحكم الأدمن</b>\n\n"
        f"👥 المستخدمون: <b>{users}</b>\n"
        f"🔍 إجمالي البحث: <b>{total_searches}</b>\n"
        f"🚫 المحظورون: <b>{bans}</b>\n"
        f"📚 سجلات القاموس: <b>{len(RECORDS):,}</b>\n\n"
        "<b>الأوامر:</b>\n"
        "/reload — إعادة تحميل القاموس\n"
        "/users — قائمة المستخدمين\n"
        "/topusers — الأكثر نشاطًا\n"
        "/ban &lt;id&gt; — حظر مستخدم\n"
        "/unban &lt;id&gt; — رفع الحظر\n"
        "/broadcast &lt;نص&gt; — إرسال جماعي\n"
        "/setname &lt;اسم&gt; — تغيير اسم البوت\n"
        "/setabout &lt;نص&gt; — النص القصير (About)\n"
        "/setdescription &lt;نص&gt; — الوصف الكامل\n"
        "/exportusers — تصدير المستخدمين CSV\n"
        "/botinfo — معلومات البوت\n"
        "/leave &lt;chat_id&gt; — مغادرة مجموعة\n"
        "/setcommands — تحديث قائمة الأوامر"
    )
    await update.effective_message.reply_text(text, parse_mode=ParseMode.HTML)


async def admin_reload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    global RECORDS, SEARCH_TEXT
    with DATA_FILE.open(encoding="utf-8") as f:
        RECORDS = json.load(f)
    SEARCH_TEXT = [normalize(" ".join(str(v) for v in r.values())) for r in RECORDS]
    await update.effective_message.reply_text(f"✅ تمت إعادة تحميل القاموس: {len(RECORDS):,} سجل.")


async def admin_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    data = _load_admin_data()
    users = sorted(data["users"].items(), key=lambda kv: -int(kv[1].get("searches", 0)))[:30]
    lines = [f"👥 <b>المستخدمون</b> ({len(data['users'])}):", ""]
    for uid, u in users:
        ban = " 🚫" if uid in data["bans"] else ""
        uname = f" (@{u['username']})" if u.get("username") else ""
        lines.append(f"• <code>{uid}</code> — {esc(u.get('name', ''))}{uname} — {u.get('searches', 0)} بحث{ban}")
    await update.effective_message.reply_text("\n".join(lines)[:3500], parse_mode=ParseMode.HTML)


async def admin_topusers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    data = _load_admin_data()
    top = sorted(data["users"].items(), key=lambda kv: -int(kv[1].get("searches", 0)))[:15]
    lines = ["🏆 <b>الأكثر نشاطًا</b>", ""]
    for i, (uid, u) in enumerate(top, 1):
        lines.append(f"{i}. {esc(u.get('name', '—'))} — <b>{u.get('searches', 0)}</b> بحث")
    await update.effective_message.reply_text("\n".join(lines)[:3500], parse_mode=ParseMode.HTML)


async def admin_ban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    if not context.args or not context.args[0].isdigit():
        await update.effective_message.reply_text("✏️ الاستخدام: /ban <user_id> [سبب]")
        return
    uid = context.args[0]
    reason = " ".join(context.args[1:])[:120]
    import time as _time
    data = _load_admin_data()
    data["bans"][uid] = {"reason": reason, "at": int(_time.time())}
    _save_admin_data(data)
    await update.effective_message.reply_text(f"🚫 تم حظر المستخدم <code>{uid}</code>.", parse_mode=ParseMode.HTML)


async def admin_unban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    if not context.args or not context.args[0].isdigit():
        await update.effective_message.reply_text("✏️ الاستخدام: /unban <user_id>")
        return
    uid = context.args[0]
    data = _load_admin_data()
    data["bans"].pop(uid, None)
    _save_admin_data(data)
    await update.effective_message.reply_text(f"✅ تم رفع الحظر عن <code>{uid}</code>.", parse_mode=ParseMode.HTML)


async def admin_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        await update.effective_message.reply_text("هذه الخاصية متاحة لمالك البوت فقط.")
        return
    text = " ".join(context.args or [])
    if not text:
        await update.effective_message.reply_text("✏️ الاستخدام: /broadcast <نص الرسالة>")
        return
    data = _load_admin_data()
    sent, failed = 0, 0
    for uid in list(data["users"].keys()):
        if uid in data["bans"] or int(uid) == _owner_id():
            continue
        try:
            await context.bot.send_message(chat_id=int(uid), text=text)
            sent += 1
            await asyncio.sleep(0.05)
        except Exception:
            failed += 1
    await update.effective_message.reply_text(f"📢 اكتمل الإرسال: وصل {sent}، فشل {failed}.")


async def admin_setname(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    name = " ".join(context.args or [])
    if not name:
        await update.effective_message.reply_text("✏️ /setname <الاسم الجديد>")
        return
    ok = await context.bot.set_my_name(name[:64])
    await update.effective_message.reply_text("✅ تم تغيير اسم البوت." if ok else "❌ فشل التغيير.")


async def admin_setabout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    about = " ".join(context.args or [])
    if not about:
        await update.effective_message.reply_text("✏️ /setabout <النص القصير>")
        return
    ok = await context.bot.set_my_short_description(about[:120])
    await update.effective_message.reply_text("✅ تم تغيير النص القصير." if ok else "❌ فشل.")


async def admin_setdescription(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    desc = " ".join(context.args or [])
    if not desc:
        await update.effective_message.reply_text("✏️ /setdescription <الوصف الكامل>")
        return
    ok = await context.bot.set_my_description(desc[:255])
    await update.effective_message.reply_text("✅ تم تغيير الوصف." if ok else "❌ فشل.")


async def admin_exportusers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    import csv, io
    data = _load_admin_data()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["user_id", "name", "username", "searches", "last_active"])
    for uid, u in data["users"].items():
        w.writerow([uid, u.get("name", ""), u.get("username", ""), u.get("searches", 0), u.get("last_active", "")])
    buf.seek(0)
    bio = io.BytesIO(buf.getvalue().encode("utf-8-sig"))
    bio.name = "users.csv"
    await update.effective_message.reply_document(bio, caption=f"👥 تصدير {len(data['users'])} مستخدم.")


async def admin_botinfo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    me = await context.bot.get_me()
    data = _load_admin_data()
    text = (
        f"🤖 <b>{esc(me.full_name)}</b> (@{esc(me.username)})\n"
        f"🆔 <code>{me.id}</code>\n"
        f"👥 المستخدمون: {len(data['users'])}\n"
        f"🚫 المحظورون: {len(data['bans'])}\n"
        f"📚 السجلات: {len(RECORDS):,}"
    )
    await update.effective_message.reply_text(text, parse_mode=ParseMode.HTML)


async def admin_leave(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    if not context.args or not context.args[0].lstrip("-").isdigit():
        await update.effective_message.reply_text("✏️ /leave <chat_id>")
        return
    ok = await context.bot.leave_chat(int(context.args[0]))
    await update.effective_message.reply_text("✅ غادر البوت المجموعة." if ok else "❌ فشل المغادرة.")


async def admin_setcommands(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_admin(update):
        return
    from telegram import BotCommand
    user_cmds = [
        BotCommand("start", "بدء الاستخدام"),
        BotCommand("help", "المساعدة"),
        BotCommand("stats", "إحصائيات القاموس"),
    ]
    admin_cmds = user_cmds + [
        BotCommand("admin", "لوحة تحكم الأدمن"),
        BotCommand("reload", "إعادة تحميل القاموس"),
        BotCommand("broadcast", "إرسال جماعي"),
        BotCommand("users", "قائمة المستخدمين"),
        BotCommand("ban", "حظر مستخدم"),
    ]
    await context.bot.set_my_commands(user_cmds)
    if _owner_id():
        await context.bot.set_my_commands(admin_cmds, scope={"type": "chat", "chat_id": _owner_id()})
    await update.effective_message.reply_text("✅ تم تحديث قائمة الأوامر.")


async def text_search_tracked(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _track_user(update)
    uid = str(update.effective_user.id) if update.effective_user else ""
    data = _load_admin_data()
    if uid in data["bans"]:
        await update.effective_message.reply_text("🚫 تم حظرك من استخدام البوت.")
        return
    await text_search(update, context)


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in the environment before starting the bot.")
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("stats", stats))
    # ---- Admin commands (Python) ----
    app.add_handler(CommandHandler("admin", admin_panel))
    app.add_handler(CommandHandler("reload", admin_reload))
    app.add_handler(CommandHandler("users", admin_users))
    app.add_handler(CommandHandler("topusers", admin_topusers))
    app.add_handler(CommandHandler("ban", admin_ban))
    app.add_handler(CommandHandler("unban", admin_unban))
    app.add_handler(CommandHandler("broadcast", admin_broadcast))
    app.add_handler(CommandHandler("setname", admin_setname))
    app.add_handler(CommandHandler("setabout", admin_setabout))
    app.add_handler(CommandHandler("setdescription", admin_setdescription))
    app.add_handler(CommandHandler("exportusers", admin_exportusers))
    app.add_handler(CommandHandler("botinfo", admin_botinfo))
    app.add_handler(CommandHandler("leave", admin_leave))
    app.add_handler(CommandHandler("setcommands", admin_setcommands))
    app.add_handler(CallbackQueryHandler(audio_callback, pattern=r"^a\|"))
    app.add_handler(CallbackQueryHandler(page_callback, pattern=r"^p\|"))
    app.add_handler(MessageHandler(filters.PHOTO, set_profile_photo))
    app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, voice_search))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_search_tracked))
    log.info("Starting bot with %s records", len(RECORDS))
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
