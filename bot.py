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
from gtts import gTTS
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
SEARCH_TEXT = [normalize(" ".join(r.values())) for r in RECORDS]


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
    await update.effective_message.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)
    await send_page_card(update.effective_chat.id, indices, page, context)
    await send_page_audio(update.effective_chat.id, indices, page, context)


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


async def send_page_audio(chat_id: int, indices: list[int], page: int, context: ContextTypes.DEFAULT_TYPE):
    """Send audio automatically for the six records shown on this page."""
    for index in indices[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]:
        record = RECORDS[index]
        spoken = (record.get("phonetic") or record.get("english") or "").strip()
        if not spoken:
            continue
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3") as audio:
                await asyncio.to_thread(gTTS(text=spoken, lang="en", tld="com", slow=False).save, audio.name)
                audio.seek(0)
                await context.bot.send_voice(chat_id=chat_id, voice=audio,
                                             caption=f"🔊 {record.get('coptic', '')} — {spoken}")
        except Exception:
            log.exception("Automatic TTS generation failed for record %s", index)


async def audio_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer("جارٍ تجهيز النطق...")
    try:
        index = int((query.data or "a|0").split("|", 1)[1])
        record = RECORDS[index]
    except (ValueError, IndexError):
        await query.message.reply_text("تعذر تحديد الكلمة.")
        return
    # The workbook's phonetic English column is the best input for Google's
    # English voice; Coptic itself is not a supported Google TTS language.
    spoken = (record.get("phonetic") or record.get("english") or "").strip()
    if not spoken:
        await query.message.reply_text("لا يوجد نطق مسجل لهذه الكلمة.")
        return
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3") as audio:
            gTTS(text=spoken, lang="en", tld="com", slow=False).save(audio.name)
            audio.seek(0)
            await query.message.reply_voice(voice=audio, caption=f"النطق التقريبي: {spoken}")
    except Exception:
        log.exception("TTS generation failed")
        await query.message.reply_text("تعذر إنشاء الصوت الآن. جرّب مرة أخرى بعد قليل.")


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in the environment before starting the bot.")
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("stats", stats))
    app.add_handler(CallbackQueryHandler(audio_callback, pattern=r"^a\|"))
    app.add_handler(CallbackQueryHandler(page_callback, pattern=r"^p\|"))
    app.add_handler(MessageHandler(filters.PHOTO, set_profile_photo))
    app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, voice_search))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_search))
    log.info("Starting bot with %s records", len(RECORDS))
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
