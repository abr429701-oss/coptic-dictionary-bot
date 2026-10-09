From 26a7f376959acc90722b5d391718e1975a2737d0 Mon Sep 17 00:00:00 2001
From: Claude <noreply@anthropic.com>
Date: Fri, 9 Oct 2026 21:52:59 +0000
Subject: [PATCH] New dictionary sheet: new column mapping (A-K), Greek
 language search and Greek UI

---
 scripts/sheet_to_json.py | 46 ++++++++++++++++++++--------------------
 src/index.js             | 36 ++++++++++++++++++++++---------
 src/neural-voice.js      |  5 +++++
 test/worker.test.js      | 21 ++++++++++++++++++
 4 files changed, 75 insertions(+), 33 deletions(-)

diff --git a/scripts/sheet_to_json.py b/scripts/sheet_to_json.py
index 2ecea00..3bf33e2 100644
--- a/scripts/sheet_to_json.py
+++ b/scripts/sheet_to_json.py
@@ -19,21 +19,24 @@ from pathlib import Path
 
 ROOT = Path(__file__).resolve().parent.parent
 
-SHEET_ID = os.environ.get("SHEET_ID", "1kXVA3CNgETqym5Vz3lBUu_2gZ01QNdx7ROtGVnIJp0c")
+SHEET_ID = os.environ.get("SHEET_ID", "14pUNXtrHoMSU9lBWhKQZyspe-DDTMDudSiuL2sJQRUI")
 SHEET_GID = os.environ.get("SHEET_GID", "")
 CSV_FILE = os.environ.get("SHEET_CSV_FILE", "")  # local file, for tests only
 OUT = Path(os.environ.get("OUT_JSON", ROOT / "data" / "dictionary.json"))
 IDS_FILE = Path(os.environ.get("WORD_IDS_JSON", ROOT / "data" / "word_ids.json"))
 MIN_RECORDS = int(os.environ.get("MIN_RECORDS", "8000"))
 
-# Columns: A coptic, B greek, C pronunciation, D english, E phonetic, F kind,
-# G gender, H origin, Z English translation, AA French translation,
-# AB German translation, BM Arabic meanings. BM is the sheet's canonical
-# Arabic column and already contains the meanings separated by Arabic commas.
-TRANSLATION_EN_COLUMN = 25  # Z
-TRANSLATION_FR_COLUMN = 26  # AA
-TRANSLATION_DE_COLUMN = 27  # AB
-MEANING_COLUMN = 64  # BM (A=0, B=1, ..., BM=64)
+# Columns of the "dictionary" tab: A Coptic, B pronunciation (Latin/IPA), C Arabic meaning, D English,
+# E French, F German, G Greek, H word kind, I gender, J origin, K kind + gender (shown in the bot).
+COPTIC_COLUMN = 0  # A
+PRONUNCIATION_COLUMN = 1  # B
+MEANING_COLUMN = 2  # C (Arabic, meanings separated by Arabic commas)
+TRANSLATION_EN_COLUMN = 3  # D
+TRANSLATION_FR_COLUMN = 4  # E
+TRANSLATION_DE_COLUMN = 5  # F
+GREEK_COLUMN = 6  # G
+ORIGIN_COLUMN = 9  # J
+KIND_COLUMN = 10  # K
 
 
 JINKIM = "\u0300"  # combining grave: the real jinkim, drawn over the letter it follows
@@ -51,10 +54,10 @@ def clean_coptic(value: str) -> str:
     return re.sub(r"\s+", " ", text).strip()
 
 
-def arabic_meaning(value: str, translations: list[str]) -> str:
-    """Keep BM Arabic meanings separate when the sheet formula also appends translations."""
+def arabic_meaning(value: str, translations: list[str] | None = None) -> str:
+    """Normalize the separators of the Arabic meanings (and drop any translation that leaked into the cell)."""
     text = value.strip()
-    for translation in translations:
+    for translation in translations or []:
         if not translation:
             continue
         text = re.sub(
@@ -144,7 +147,8 @@ def download() -> str:
 
 def main() -> None:
     rows = list(csv.reader(io.StringIO(download())))
-    if not rows or "coptic" not in (rows[0][0] if rows[0] else "").lower():
+    first_header = (rows[0][0] if rows and rows[0] else "").lower()
+    if not rows or not ("coptic" in first_header or "القبطية" in first_header):
         raise SystemExit("Unexpected sheet content (is the sheet shared as 'Anyone with the link'?).")
 
     records = []
@@ -152,20 +156,16 @@ def main() -> None:
         def cell(index: int) -> str:
             return row[index].strip() if index < len(row) else ""
 
-        translations = [cell(TRANSLATION_EN_COLUMN), cell(TRANSLATION_FR_COLUMN), cell(TRANSLATION_DE_COLUMN)]
         record = {
-            "coptic": clean_coptic(cell(0)),
-            "greek": cell(1),
-            "pronunciation": cell(2),
-            "english": cell(3),
-            "phonetic": cell(4),
-            "kind": cell(5),
-            "gender": cell(6),
-            "origin": cell(7),
+            "coptic": clean_coptic(cell(COPTIC_COLUMN)),
+            "greek": cell(GREEK_COLUMN),
+            "pronunciation": cell(PRONUNCIATION_COLUMN),
+            "kind": cell(KIND_COLUMN),
+            "origin": cell(ORIGIN_COLUMN),
             "translation_en": cell(TRANSLATION_EN_COLUMN),
             "translation_fr": cell(TRANSLATION_FR_COLUMN),
             "translation_de": cell(TRANSLATION_DE_COLUMN),
-            "meaning": arabic_meaning(cell(MEANING_COLUMN), translations),
+            "meaning": arabic_meaning(cell(MEANING_COLUMN)),
         }
         if not any(record.values()):
             continue
diff --git a/src/index.js b/src/index.js
index eb7fff5..7f31170 100644
--- a/src/index.js
+++ b/src/index.js
@@ -13,11 +13,14 @@ const BROADCAST_MAX_TRANSIENT_RETRIES = 5;
 const FIRST_TIME_TEXT =
   "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة, الرجاء إدخال اسمك ثلاثي للبدء في استخدام القاموس القبطي الناطق";
 const NAME_RETRY_TEXT = "الرجاء إدخال اسمك ثلاثيًا (ثلاث كلمات على الأقل) بالحروف فقط، مثل: مينا جرجس بشرى.";
-const HELP_TEXT = `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والنطق والتهجئة.\n\nاكتب الكلمة أو أول حروفها لتظهر لك اقتراحات بالكلمات التي تبدأ بها.\n\n⌨️ لا يوجد كيبورد قبطي على جهازك؟ أرسل /keyboard لتكتب الكلمة بالأزرار.`;
+const HELP_TEXT = `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والفرنسية والألمانية واليونانية والنطق.\n\nاكتب الكلمة أو أول حروفها لتظهر لك اقتراحات بالكلمات التي تبدأ بها.\n\n⌨️ لا يوجد كيبورد قبطي على جهازك؟ أرسل /keyboard لتكتب الكلمة بالأزرار.`;
 
 const ACCENT_MAP = { ὲ: "ⲉ", έ: "ⲉ", ὶ: "ⲓ", ί: "ⲓ", ὸ: "ⲟ", ό: "ⲟ", ὼ: "ⲱ", ώ: "ⲱ", ὴ: "ⲏ", ή: "ⲏ", ὰ: "ⲁ", ά: "ⲁ", ὺ: "ⲩ", ύ: "ⲩ" };
 const ALEF_MAP = { أ: "ا", إ: "ا", آ: "ا", ٱ: "ا", ى: "ي", ة: "ه" };
 
+// Plain Greek (no Coptic letters): fold accents and the final sigma, so "άβατος" finds "αβατος".
+const GREEK_TEXT = /[\u0370-\u03e1\u03f0-\u03ff\u1f00-\u1fff]/u;
+const COPTIC_MAIN_LETTER = /[\u2c80-\u2cff]/u;
 const PLAIN_ASCII = /^[\x20-\x5f\x61-\x7e]*$/u;
 const MARK_CHARS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/u;
 const MARK_CHARS_ALL = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu;
@@ -31,6 +34,9 @@ function normalize(value) {
   const text = String(value ?? "");
   if (PLAIN_ASCII.test(text)) return text.toLowerCase().replace(/\s+/gu, " ").trim();
   let out = text.normalize("NFKC").toLowerCase();
+  if (GREEK_TEXT.test(out) && !COPTIC_MAIN_LETTER.test(out)) {
+    return out.normalize("NFD").replace(MARK_CHARS_ALL, "").normalize("NFC").replace(/ς/gu, "σ").replace(/`/gu, "").replace(/\s+/gu, " ").trim();
+  }
   if (MARK_CHARS.test(out)) out = out.replace(MARK_CHARS_ALL, "");
   if (FOLD_CHARS.test(out)) out = out.replace(FOLD_CHARS_ALL, (char) => FOLD_MAP[char] ?? "");
   return out.replace(/\s+/gu, " ").trim();
@@ -94,12 +100,14 @@ const UI_TEXT = {
   en: { word: "Word", meaning: "Meaning", kind: "Part of speech", origin: "Origin", more: "There is another meaning for the word you searched", next: "Click here to view it", end: "No more meanings are available for this word", choose: "Choose from the following suggestions:", previous: "Previous", pageNext: "Next", noResult: "The dictionary is still under development; this word will be added later" },
   fr: { word: "Mot", meaning: "Sens", kind: "Nature", origin: "Origine", more: "Il existe un autre sens pour le mot recherché", next: "Cliquez ici pour l’afficher", end: "Il n’y a plus de sens disponible pour ce mot", choose: "Choisissez parmi les suggestions suivantes :", previous: "Précédent", pageNext: "Suivant", noResult: "Le dictionnaire est encore en développement ; ce mot sera ajouté plus tard" },
   de: { word: "Wort", meaning: "Bedeutung", kind: "Wortart", origin: "Herkunft", more: "Es gibt eine weitere Bedeutung für das gesuchte Wort", next: "Hier klicken, um sie anzuzeigen", end: "Für dieses Wort sind keine weiteren Bedeutungen verfügbar", choose: "Wählen Sie aus den folgenden Vorschlägen:", previous: "Zurück", pageNext: "Weiter", noResult: "Das Wörterbuch wird noch entwickelt; dieses Wort wird später hinzugefügt" },
+  el: { word: "Λέξη", meaning: "Σημασία", kind: "Μέρος του λόγου", origin: "Προέλευση", more: "Υπάρχει και άλλη σημασία για τη λέξη που αναζητήσατε", next: "Πατήστε εδώ για να τη δείτε", end: "Δεν υπάρχουν άλλες διαθέσιμες σημασίες για αυτή τη λέξη", choose: "Επιλέξτε από τις παρακάτω προτάσεις:", previous: "Προηγούμενο", pageNext: "Επόμενο", noResult: "Το λεξικό βρίσκεται ακόμη υπό ανάπτυξη· η λέξη αυτή θα προστεθεί αργότερα" },
 };
 
 const VALUE_TRANSLATIONS = {
-  en: { "اسم": "noun", "فعل": "verb", "صفة": "adjective", "ظرف": "adverb", "حرف جر": "preposition", "أداة ربط": "conjunction", "رقم": "numeral", "ضمير": "pronoun", "حرف": "letter", "أداة": "particle", "أداة نفي": "negative particle", "جملة": "sentence", "بادئة": "prefix", "زائدة": "suffix", "أداة استفهام": "interrogative particle", "أداة تعريف": "definite article", "أداة تنكير": "indefinite article", "صيغة تفضيل": "comparative form", "حال": "adverbial", "اسم موصول": "relative noun", "قبطية": "Coptic", "يونانية": "Greek", "عبرية": "Hebrew", "لاتينية": "Latin", "آرامية": "Aramaic", "سريانية": "Syriac" },
-  fr: { "اسم": "nom", "فعل": "verbe", "صفة": "adjectif", "ظرف": "adverbe", "حرف جر": "préposition", "أداة ربط": "conjonction", "رقم": "numéral", "ضمير": "pronom", "حرف": "lettre", "أداة": "particule", "أداة نفي": "particule négative", "جملة": "phrase", "بادئة": "préfixe", "زائدة": "suffixe", "أداة استفهام": "particule interrogative", "أداة تعريف": "article défini", "أداة تنكير": "article indéfini", "صيغة تفضيل": "comparatif", "حال": "adverbial", "اسم موصول": "nom relatif", "قبطية": "copte", "يونانية": "grec", "عبرية": "hébreu", "لاتينية": "latin", "آرامية": "araméen", "سريانية": "syriaque" },
-  de: { "اسم": "Substantiv", "فعل": "Verb", "صفة": "Adjektiv", "ظرف": "Adverb", "حرف جر": "Präposition", "أداة ربط": "Konjunktion", "رقم": "Zahlwort", "ضمير": "Pronomen", "حرف": "Buchstabe", "أداة": "Partikel", "أداة نفي": "Verneinungspartikel", "جملة": "Satz", "بادئة": "Präfix", "زائدة": "Suffix", "أداة استفهام": "Fragepartikel", "أداة تعريف": "bestimmter Artikel", "أداة تنكير": "unbestimmter Artikel", "صيغة تفضيل": "Komparativ", "حال": "adverbial", "اسم موصول": "Relativnomen", "قبطية": "Koptisch", "يونانية": "Griechisch", "عبرية": "Hebräisch", "لاتينية": "Lateinisch", "آرامية": "Aramäisch", "سريانية": "Syrisch" },
+  en: { "اسم": "noun", "فعل": "verb", "صفة": "adjective", "ظرف": "adverb", "حرف جر": "preposition", "أداة ربط": "conjunction", "رقم": "numeral", "ضمير": "pronoun", "حرف": "letter", "أداة": "particle", "أداة نفي": "negative particle", "جملة": "sentence", "بادئة": "prefix", "زائدة": "suffix", "أداة استفهام": "interrogative particle", "أداة تعريف": "definite article", "أداة تنكير": "indefinite article", "صيغة تفضيل": "comparative form", "حال": "adverbial", "اسم موصول": "relative noun", "مذكر": "masculine", "مؤنث": "feminine", "جمع": "plural", "أمر": "imperative", "قبطي": "Coptic", "قبطية": "Coptic", "يوناني": "Greek", "يوناتي": "Greek", "يونانية": "Greek", "عبري": "Hebrew", "عبرية": "Hebrew", "لاتيني": "Latin", "لاتينية": "Latin", "آرامي": "Aramaic", "آرامية": "Aramaic", "سرياني": "Syriac", "سريانية": "Syriac" },
+  fr: { "اسم": "nom", "فعل": "verbe", "صفة": "adjectif", "ظرف": "adverbe", "حرف جر": "préposition", "أداة ربط": "conjonction", "رقم": "numéral", "ضمير": "pronom", "حرف": "lettre", "أداة": "particule", "أداة نفي": "particule négative", "جملة": "phrase", "بادئة": "préfixe", "زائدة": "suffixe", "أداة استفهام": "particule interrogative", "أداة تعريف": "article défini", "أداة تنكير": "article indéfini", "صيغة تفضيل": "comparatif", "حال": "adverbial", "اسم موصول": "nom relatif", "مذكر": "masculin", "مؤنث": "féminin", "جمع": "pluriel", "أمر": "impératif", "قبطي": "copte", "قبطية": "copte", "يوناني": "grec", "يوناتي": "grec", "يونانية": "grec", "عبري": "hébreu", "عبرية": "hébreu", "لاتيني": "latin", "لاتينية": "latin", "آرامي": "araméen", "آرامية": "araméen", "سرياني": "syriaque", "سريانية": "syriaque" },
+  de: { "اسم": "Substantiv", "فعل": "Verb", "صفة": "Adjektiv", "ظرف": "Adverb", "حرف جر": "Präposition", "أداة ربط": "Konjunktion", "رقم": "Zahlwort", "ضمير": "Pronomen", "حرف": "Buchstabe", "أداة": "Partikel", "أداة نفي": "Verneinungspartikel", "جملة": "Satz", "بادئة": "Präfix", "زائدة": "Suffix", "أداة استفهام": "Fragepartikel", "أداة تعريف": "bestimmter Artikel", "أداة تنكير": "unbestimmter Artikel", "صيغة تفضيل": "Komparativ", "حال": "adverbial", "اسم موصول": "Relativnomen", "مذكر": "maskulin", "مؤنث": "feminin", "جمع": "Plural", "أمر": "Imperativ", "قبطي": "Koptisch", "قبطية": "Koptisch", "يوناني": "Griechisch", "يوناتي": "Griechisch", "يونانية": "Griechisch", "عبري": "Hebräisch", "عبرية": "Hebräisch", "لاتيني": "Lateinisch", "لاتينية": "Lateinisch", "آرامي": "Aramäisch", "آرامية": "Aramäisch", "سرياني": "Syrisch", "سريانية": "Syrisch" },
+  el: { "اسم": "ουσιαστικό", "فعل": "ρήμα", "صفة": "επίθετο", "ظرف": "επίρρημα", "حرف جر": "πρόθεση", "أداة ربط": "σύνδεσμος", "رقم": "αριθμητικό", "ضمير": "αντωνυμία", "حرف": "γράμμα", "أداة": "μόριο", "أداة نفي": "αρνητικό μόριο", "جملة": "πρόταση", "بادئة": "πρόθημα", "زائدة": "επίθημα", "أداة استفهام": "ερωτηματικό μόριο", "أداة تعريف": "οριστικό άρθρο", "أداة تنكير": "αόριστο άρθρο", "صيغة تفضيل": "συγκριτικός τύπος", "حال": "επιρρηματικός προσδιορισμός", "اسم موصول": "αναφορική αντωνυμία", "مذكر": "αρσενικό", "مؤنث": "θηλυκό", "جمع": "πληθυντικός", "أمر": "προστακτική", "قبطي": "κοπτικά", "قبطية": "κοπτικά", "يوناني": "ελληνικά", "يوناتي": "ελληνικά", "يونانية": "ελληνικά", "عبري": "εβραϊκά", "عبرية": "εβραϊκά", "لاتيني": "λατινικά", "لاتينية": "λατινικά", "آرامي": "αραμαϊκά", "آرامية": "αραμαϊκά", "سرياني": "συριακά", "سريانية": "συριακά" },
 };
 
 function uiLanguage(searchKey = "") {
@@ -111,9 +119,14 @@ function uiTextFor(searchKey = "") {
   return UI_TEXT[uiLanguage(searchKey)] ?? UI_TEXT.ar;
 }
 
+// Translates a whole value ("حرف جر") or, failing that, each of its words ("اسم مذكر" -> "noun masculine").
+// A part that has no translation stays as written in the sheet.
 function localizedValue(value, language) {
   const raw = String(value ?? "").trim();
-  return VALUE_TRANSLATIONS[language]?.[raw] ?? raw;
+  const table = VALUE_TRANSLATIONS[language];
+  if (!table || !raw) return raw;
+  if (table[raw]) return table[raw];
+  return raw.split(/(\s*[،,]\s*|\s+)/u).map((part) => (/^\s*[،,]?\s*$/u.test(part) ? part : table[part] ?? part)).join("");
 }
 
 function splitMeaning(value) {
@@ -129,7 +142,7 @@ const searchIndex = lazy(() => {
     text.push(normalize(SEARCH_FIELDS.map((key) => record[key] ?? "").join(" ")));
     const parts = splitMeaning(record.meaning).map(normalize);
     meaning.push(parts.map(toTokens));
-    const keys = [record.coptic, record.greek, record.english, record.phonetic].map(normalize);
+    const keys = [record.coptic, record.greek, record.english, record.phonetic, record.pronunciation].map(normalize);
     prefix.push(keys.concat(parts).filter(Boolean));
   }
   return { text, meaning, prefix };
@@ -167,8 +180,9 @@ function suggestionLabel(record, normalizedQuery) {
     const meanings = splitMeaning(record.meaning);
     return (meanings[part >= 0 ? part : 0] || meanings[0] || record.english || "—").trim().slice(0, 48);
   }
-  if (COPTIC_LETTER.test(normalizedQuery)) return String(record.coptic ?? "").replaceAll("`", "").trim().slice(0, 48) || "—";
   const kind = scriptKind(normalizedQuery);
+  if (kind === "cop") return String(record.coptic ?? "").replaceAll("`", "").trim().slice(0, 48) || "—";
+  if (kind === "el") return String(record.greek ?? "").replaceAll("`", "").trim().slice(0, 48) || "—";
   if (kind === "fr") return String(record.translation_fr ?? "").trim().slice(0, 48) || "—";
   if (kind === "de") return String(record.translation_de ?? "").trim().slice(0, 48) || "—";
   if (kind === "en") return String(record.translation_en ?? record.english ?? "").trim().slice(0, 48) || String(record.phonetic ?? "").trim().slice(0, 48) || "—";
@@ -325,6 +339,7 @@ function moreMeaning(options, baseIndex, nextStep = 1, callbackFor = undefined,
 // 2) otherwise -> the unique words that start with what was typed, as buttons; tapping one shows it.
 function scriptKind(key) {
   if (ARABIC_LETTER.test(key)) return "ar";
+  if (GREEK_TEXT.test(key) && !COPTIC_MAIN_LETTER.test(key)) return "el";
   if (COPTIC_LETTER.test(key)) return "cop";
   if (LATIN_LETTER.test(key)) {
     const normalized = normalize(key);
@@ -338,9 +353,10 @@ function scriptKind(key) {
 
 const WORD_FIELDS = {
   cop: ["coptic"],
-  en: ["english", "phonetic", "translation_en"],
+  en: ["english", "phonetic", "translation_en", "pronunciation"],
   fr: ["translation_fr"],
   de: ["translation_de"],
+  el: ["greek"],
   other: ["greek", "pronunciation"],
 };
 const wordIndexes = {};
@@ -521,7 +537,7 @@ function speechSpelling(record) {
   // Prefer the sheet's IPA pronunciation, converted to an English-friendly
   // phoneme spelling. Google Translate TTS does not parse IPA syntax itself.
   const ipa = String(record?.pronunciation || "").trim();
-  const sheetSpelling = String(record?.english || record?.phonetic || "").trim();
+  const sheetSpelling = String(record?.english || record?.phonetic || record?.pronunciation || "").trim();
   const usesIpa = Boolean(ipa);
   let word = (ipa || sheetSpelling).trim();
   word = word
@@ -1178,7 +1194,7 @@ export class UserStore {
           id: record.id,
           coptic: record.coptic ?? "",
           pronunciation: record.pronunciation ?? "",
-          english: record.english ?? "",
+          english: record.translation_en ?? record.english ?? "",
           meaning: record.meaning ?? "",
           recorded: voiced.size,
           total: recordIndexById().size,
diff --git a/src/neural-voice.js b/src/neural-voice.js
index 60e7e68..70be42e 100644
--- a/src/neural-voice.js
+++ b/src/neural-voice.js
@@ -45,6 +45,11 @@ const IPA_REPLACEMENTS = new Map([
   ["ú", "u"],
   ["û", "u"],
   ["ü", "u"],
+  ["ā", "a"],
+  ["ē", "e"],
+  ["ī", "i"],
+  ["ō", "o"],
+  ["ū", "u"],
 
   // Greek letters sometimes present in pronunciation data.
   ["α", "a"],
diff --git a/test/worker.test.js b/test/worker.test.js
index 47be36d..ecdd47d 100644
--- a/test/worker.test.js
+++ b/test/worker.test.js
@@ -1565,3 +1565,24 @@ test("archive group that Telegram upgraded to a supergroup is re-linked automati
     globalThis.fetch = original;
   }
 });
+
+test("a Greek word is found and answered with Greek labels and the Coptic word", async () => {
+  const calls = [];
+  fakeTelegramApi(calls);
+  await worker.fetch(updateRequest({ message: { text: "αναυ", chat: { id: 8 } } }), env);
+  const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
+  assert.ok(message);
+  assert.match(message.text, /<b>Λέξη:<\/b> αναυ/u);
+  assert.match(message.text, /<b>Σημασία:<\/b> ⲁⲛⲁⲩ/u);
+  assert.match(message.text, /<b>Μέρος του λόγου:<\/b> ρήμα/u);
+});
+
+test("Greek search ignores accents, capitals and the final sigma", async () => {
+  const calls = [];
+  fakeTelegramApi(calls);
+  await worker.fetch(updateRequest({ message: { text: "ΆΒΑΤΟΣ", chat: { id: 8 } } }), env);
+  const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
+  assert.ok(message);
+  assert.match(message.text, /ⲁⲃⲁⲧⲟⲥ/u);
+  assert.match(message.text, /Λέξη/u);
+});
-- 
2.43.0

