// ---------------------------------------------------------------------------
// /copticname — كتابة الاسم بالحروف القبطية
// المستخدم يكتب اسمه بالعربي أو بالإنجليزي، والبوت يرده بالحروف القبطية.
// طريقتان: قايمة أسماء مشهورة جاهزة (الكتابة القبطية الصحيحة 100%)،
// وتحويل تلقائي حرف بحرف لأي اسم تاني (تقريبي: الحروف العربية اللي ملهاش
// مقابل قبطي مباشر زي ع وغ بتتقرب، والحركات بتتخمن لأن الاسم مكتوب من غير
// تشكيل). محلي بالكامل — مفيش أي طلب خارجي ولا تكلفة.
// ---------------------------------------------------------------------------

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/gu;
// نفس التشكيل لكن مع إبقاء الشدة (0651) — عشان التحويل يضاعف الحرف المشدد.
const ARABIC_DIACRITICS_KEEP_SHADDA = /[\u064B-\u0650\u0652\u0670\u0640]/gu;

// حروف عربية → الوحدة القبطية المقابلة (النطق البوهيري الحديث).
// الوحدات بصيغة صغيرة؛ أول حرف من كل كلمة بيتكبّر عند الإخراج
// (نفس شكل القايمة الجاهزة: Ⲁⲃⲣⲁⲙ).
const AR_MAP = {
  "ا": "ⲁ", "أ": "ⲁ", "إ": "ⲁ", "آ": "ⲁ", "ٱ": "ⲁ",
  "ب": "ⲃ", "ت": "ⲧ", "ث": "ⲑ", "ج": "ϫ", "ح": "ϩ", "خ": "ϧ",
  "د": "ⲇ", "ذ": "ⲇ", "ر": "ⲣ", "ز": "ⲍ", "س": "ⲥ", "ش": "ϣ",
  "ص": "ⲥ", "ض": "ⲇ", "ط": "ⲧ", "ظ": "ⲍ", "ع": "ⲁ", "غ": "ⲅ",
  "ف": "ϥ", "ق": "ⲕ", "ك": "ⲕ", "ل": "ⲗ", "م": "ⲙ", "ن": "ⲛ",
  "ه": "ϩ", "ة": "ⲁ", "و": "ⲟⲩ", "ؤ": "ⲟⲩ", "ي": "ⲓ", "ئ": "ⲓ",
  "ى": "ⲁ",
};

// الوحدات الصوتية (حروف العلة) — بين ساكنين يُدرج ⲁ لتقريب النطق.
const VOWEL_UNITS = new Set(["ⲁ", "ⲉ", "ⲏ", "ⲓ", "ⲟ", "ⲱ", "ⲩ", "ⲟⲩ"]);

// كبّر أول حرف قبطي في الكلمة (ⲟⲩ في الأول تبقى Ⲟⲩ).
function capitalizeCoptic(word) {
  return word.replace(/^./u, (ch) => ch.toUpperCase());
}

// أسماء مشهورة بالكتابة القبطية الصحيحة: [عربي، إنجليزي، قبطي].
const KNOWN_NAMES = [
  ["ابرام", "ebram", "Ⲁⲃⲣⲁⲙ"],
  ["ابراهيم", "abraham", "Ⲁⲃⲣⲁⲁⲙ"],
  ["ابراهيم", "ibrahim", "Ⲁⲃⲣⲁⲁⲙ"],
  ["اسحاق", "isaac", "Ⲓⲥⲁⲁⲕ"],
  ["اسحاق", "ishaac", "Ⲓⲥⲁⲁⲕ"],
  ["يعقوب", "jacob", "Ⲓⲁⲕⲱⲃ"],
  ["يعقوب", "yacoub", "Ⲓⲁⲕⲱⲃ"],
  ["يوسف", "joseph", "Ⲓⲱⲥⲏⲫ"],
  ["يوسف", "youssef", "Ⲓⲱⲥⲏⲫ"],
  ["موسى", "moses", "Ⲙⲱⲩⲥⲏⲥ"],
  ["موسى", "moussa", "Ⲙⲱⲩⲥⲏⲥ"],
  ["هارون", "aaron", "Ⲁⲁⲣⲱⲛ"],
  ["هارون", "haroun", "Ⲁⲁⲣⲱⲛ"],
  ["داود", "david", "Ⲇⲁⲩⲓⲇ"],
  ["داود", "daoud", "Ⲇⲁⲩⲓⲇ"],
  ["سليمان", "solomon", "Ⲥⲟⲗⲟⲙⲱⲛ"],
  ["سليمان", "soliman", "Ⲥⲟⲗⲟⲙⲱⲛ"],
  ["دانيال", "daniel", "Ⲇⲁⲛⲓⲏⲗ"],
  ["زكريا", "zachariah", "Ⲍⲁⲭⲁⲣⲓⲁⲥ"],
  ["زكريا", "zakaria", "Ⲍⲁⲭⲁⲣⲓⲁⲥ"],
  ["يحيى", "yahya", "Ⲓⲱⲁⲛⲛⲏⲥ"],
  ["مريم", "mary", "Ⲙⲁⲣⲓⲁ"],
  ["مريم", "mariam", "Ⲙⲁⲣⲓⲁ"],
  ["ماريا", "maria", "Ⲙⲁⲣⲓⲁ"],
  ["يسوع", "jesus", "Ⲓⲏⲥⲟⲩⲥ"],
  ["عيسى", "issa", "Ⲓⲏⲥⲟⲩⲥ"],
  ["بطرس", "peter", "Ⲡⲉⲧⲣⲟⲥ"],
  ["بطرس", "boutros", "Ⲡⲉⲧⲣⲟⲥ"],
  ["بولس", "paul", "Ⲡⲁⲩⲗⲟⲥ"],
  ["بولس", "boulis", "Ⲡⲁⲩⲗⲟⲥ"],
  ["يوحنا", "john", "Ⲓⲱⲁⲛⲛⲏⲥ"],
  ["يوحنا", "youhanna", "Ⲓⲱⲁⲛⲛⲏⲥ"],
  ["مرقس", "mark", "Ⲙⲁⲣⲕⲟⲥ"],
  ["مرقس", "morcos", "Ⲙⲁⲣⲕⲟⲥ"],
  ["متى", "matthew", "Ⲙⲁⲧⲑⲉⲟⲥ"],
  ["متى", "matta", "Ⲙⲁⲧⲑⲉⲟⲥ"],
  ["لوقا", "luke", "Ⲗⲟⲩⲕⲁⲥ"],
  ["لوقا", "louka", "Ⲗⲟⲩⲕⲁⲥ"],
  ["توما", "thomas", "Ⲑⲱⲙⲁⲥ"],
  ["توما", "touma", "Ⲑⲱⲙⲁⲥ"],
  ["سمعان", "simon", "Ⲥⲓⲙⲱⲛ"],
  ["اندراوس", "andrew", "Ⲁⲛⲇⲣⲉⲁⲥ"],
  ["فيلبس", "philip", "Ⲫⲓⲗⲓⲡⲡⲟⲥ"],
  ["برثولماوس", "bartholomew", "Ⲃⲁⲣⲑⲟⲗⲟⲙⲉⲟⲥ"],
  ["استفانوس", "stephen", "Ⲥⲧⲉⲫⲁⲛⲟⲥ"],
  ["صموئيل", "samuel", "Ⲥⲁⲙⲟⲩⲏⲗ"],
  ["عمانوئيل", "emmanuel", "Ⲉⲙⲙⲁⲛⲟⲩⲏⲗ"],
  ["ميخائيل", "michael", "Ⲙⲓⲭⲁⲏⲗ"],
  ["ميخائيل", "mikhael", "Ⲙⲓⲭⲁⲏⲗ"],
  ["غبريال", "gabriel", "Ⲅⲁⲃⲣⲓⲏⲗ"],
  ["روفائيل", "raphael", "Ⲣⲁⲫⲁⲏⲗ"],
  ["سوريال", "suriel", "Ⲥⲟⲩⲣⲓⲏⲗ"],
  ["اليصابات", "elizabeth", "Ⲉⲗⲓⲥⲁⲃⲉⲧ"],
  ["حنة", "hannah", "Ⲁⲛⲛⲁ"],
  ["حنة", "anna", "Ⲁⲛⲛⲁ"],
  ["سارة", "sarah", "Ⲥⲁⲣⲣⲁ"],
  ["هاجر", "hagar", "Ⲁⲅⲁⲣ"],
  ["رفقة", "rebecca", "Ⲣⲉⲃⲉⲕⲕⲁ"],
  ["رفقة", "rebekah", "Ⲣⲉⲃⲉⲕⲕⲁ"],
  ["راحيل", "rachel", "Ⲣⲁⲭⲏⲗ"],
  ["ليئة", "leah", "Ⲗⲉⲁ"],
  ["مينا", "mina", "Ⲙⲏⲛⲁ"],
  ["كيرلس", "cyril", "Ⲕⲩⲣⲓⲗⲗⲟⲥ"],
  ["كيرلس", "kirollos", "Ⲕⲩⲣⲓⲗⲗⲟⲥ"],
  ["كيرلس", "kerolos", "Ⲕⲩⲣⲓⲗⲗⲟⲥ"],
  ["كيرلس", "kyrillos", "Ⲕⲩⲣⲓⲗⲗⲟⲥ"],
  ["شنودة", "shenouda", "Ϣⲉⲛⲟⲩϯⲁ"],
  ["بولا", "paula", "Ⲡⲁⲩⲗⲁ"],
  ["بولا", "bola", "Ⲡⲁⲩⲗⲁ"],
  ["ابانوب", "abanoub", "Ⲁⲡⲁⲛⲟⲩⲃ"],
  ["انطونيوس", "anthony", "Ⲁⲛⲧⲱⲛⲓⲟⲥ"],
  ["انطونيوس", "antonios", "Ⲁⲛⲧⲱⲛⲓⲟⲥ"],
  ["مكاريوس", "makarios", "Ⲙⲁⲕⲁⲣⲓⲟⲥ"],
  ["باخوميوس", "pachomius", "Ⲡⲁϧⲱⲙⲓⲟⲥ"],
  ["باخوميوس", "bakhomios", "Ⲡⲁϧⲱⲙⲓⲟⲥ"],
  ["اثناسيوس", "athanasius", "Ⲁⲑⲁⲛⲁⲥⲓⲟⲥ"],
  ["ديسقوروس", "dioscorus", "Ⲇⲓⲟⲥⲕⲟⲣⲟⲥ"],
  ["ساويرس", "severus", "Ⲥⲉⲩⲏⲣⲟⲥ"],
  ["ساويرس", "sawires", "Ⲥⲉⲩⲏⲣⲟⲥ"],
  ["بيشوي", "bishoy", "Ⲡⲓϣⲱⲓ"],
  ["تادرس", "theodore", "Ⲑⲉⲟⲇⲱⲣⲟⲥ"],
  ["تادرس", "tadros", "Ⲑⲉⲟⲇⲱⲣⲟⲥ"],
  ["فيلوباتير", "philopatir", "Ⲫⲓⲗⲟⲡⲁⲧⲏⲣ"],
  ["مارمينا", "marmina", "Ⲙⲁⲣⲓⲙⲏⲛⲁ"],
  ["كاراس", "karas", "Ⲕⲁⲣⲁⲥ"],
  ["جرجس", "george", "Ⲅⲉⲱⲣⲅⲓⲟⲥ"],
  ["جرجس", "gerges", "Ⲅⲉⲱⲣⲅⲓⲟⲥ"],
  ["جورج", "george", "Ⲅⲉⲱⲣⲅⲓⲟⲥ"],
  ["دميانة", "demiana", "Ⲇⲉⲙⲓⲁⲛⲁ"],
  ["مارينا", "marina", "Ⲙⲁⲣⲓⲛⲁ"],
  ["ميريام", "miriam", "Ⲙⲁⲣⲓⲁⲙ"],
  ["ايريني", "irene", "Ⲉⲓⲣⲏⲛⲏ"],
  ["فيرونيكا", "veronica", "Ⲃⲉⲣⲟⲛⲓⲕⲁ"],
  ["كريستين", "christine", "Ⲭⲣⲓⲥⲧⲓⲛⲏ"],
  ["كرستين", "kristin", "Ⲭⲣⲓⲥⲧⲓⲛⲏ"],
  ["ميرنا", "mirna", "Ⲙⲓⲣⲛⲁ"],
  ["هند", "hend", "Ϩⲉⲛⲇ"],
  ["عبد", "abd", "Ⲁⲃⲇ"],
  ["الله", "allah", "Ⲁⲗⲗⲁϩ"],
  ["عبدالله", "abdullah", "ⲀⲃⲇⲀⲗⲗⲁϩ"],
  ["عبدالرحمن", "abdelrahman", "ⲀⲃⲇⲀⲗⲣⲁϩⲙⲁⲛ"],
  ["محمد", "mohammed", "Ⲙⲟϩⲁⲙⲙⲁⲇ"],
  ["محمد", "mohamed", "Ⲙⲟϩⲁⲙⲙⲁⲇ"],
  ["احمد", "ahmed", "Ⲁϩⲙⲁⲇ"],
  ["محمود", "mahmoud", "Ⲙⲁϩⲙⲟⲩⲇ"],
  ["مصطفى", "mostafa", "Ⲙⲟⲥⲧⲁⲫⲁ"],
  ["عمر", "omar", "Ⲟⲙⲁⲣ"],
  ["عماد", "emad", "Ⲉⲙⲁⲇ"],
  ["باسم", "basim", "ⲃⲁⲥⲓⲙ"],
  ["علي", "ali", "Ⲁⲗⲓ"],
  ["حسن", "hassan", "Ϩⲁⲥⲁⲛ"],
  ["حسين", "hussein", "Ϩⲟⲩⲥⲉⲓⲛ"],
  ["خالد", "khaled", "Ϧⲁⲗⲉⲇ"],
  ["وليد", "walid", "Ⲱⲁⲗⲓⲇ"],
  ["سعيد", "said", "Ⲥⲁⲓⲇ"],
  ["فاطمة", "fatima", "Ⲫⲁϯⲙⲁ"],
  ["عائشة", "aisha", "Ⲁⲓϣⲁ"],
  ["خديجة", "khadija", "Ϧⲁⲇⲓϫⲁ"],
  ["زينب", "zainab", "Ⲍⲉⲓⲛⲁⲃ"],
  ["اسماعيل", "ismail", "Ⲓⲥⲙⲁⲏⲗ"],
  ["يونس", "jonah", "Ⲓⲱⲛⲁⲥ"],
  ["يونس", "younes", "Ⲓⲱⲛⲁⲥ"],
  ["ايوب", "job", "Ⲓⲱⲃ"],
  ["ايوب", "ayoub", "Ⲓⲱⲃ"],
];

const KNOWN_BY_KEY = new Map();
for (const [ar, en, coptic] of KNOWN_NAMES) {
  KNOWN_BY_KEY.set(normalizeArabicWord(ar), coptic);
  KNOWN_BY_KEY.set(en.toLowerCase(), coptic);
}

// توحيد الكلمة العربية للمطابقة: شيل التشكيل والتطويل، وحّد الهمزات، ة→ه، ى→ي.
export function normalizeArabicWord(word) {
  return String(word ?? "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ة/gu, "ه")
    .replace(/ى/gu, "ي")
    .trim();
}

// تحويل كلمة عربية واحدة حرف بحرف، مع إدراج Ⲁ بين ساكنين متتاليين
// (لأن الاسم مكتوب من غير تشكيل) ومضاعفة الحرف عند الشدة.
function transliterateArabicWord(word) {
  const clean = String(word ?? "").replace(ARABIC_DIACRITICS_KEEP_SHADDA, "").replace(/[أإآٱ]/gu, "ا");
  const units = [];
  for (const ch of clean) {
    if (ch === "ّ") {
      const last = units[units.length - 1];
      if (last && !VOWEL_UNITS.has(last)) units.push(last);
      continue;
    }
    const unit = AR_MAP[ch];
    if (unit) units.push(unit);
  }
  const out = [];
  for (let i = 0; i < units.length; i++) {
    out.push(units[i]);
    const next = units[i + 1];
    if (next && !VOWEL_UNITS.has(units[i]) && !VOWEL_UNITS.has(next)) out.push("ⲁ");
  }
  return capitalizeCoptic(out.join(""));
}

// الخريطة الإنجليزية مأخوذة حرفيًا من شاشة "الاسم بالقبطي" في تطبيق
// الأندرويد (components/NameInCopticScreen.tsx) — نفس النتيجة في
// التطبيق والبوت لنفس الاسم. ملاحظاتها: g → ϫ (الجيم المصرية)،
// w → ⲱ، ch → ⲭ، ea → ⲏ.
const EN_DIGRAPHS = {
  "sh": "ϣ", "ch": "ⲭ", "ph": "ⲫ", "th": "ⲑ", "ps": "ⲯ",
  "ks": "ⲝ", "gh": "ⲅ", "kh": "ϧ", "ea": "ⲏ",
};
const EN_MAP = {
  "a": "ⲁ", "b": "ⲃ", "c": "ⲕ", "d": "ⲇ", "e": "ⲉ",
  "f": "ϥ", "g": "ϫ", "h": "ϩ", "i": "ⲓ", "j": "ϫ",
  "k": "ⲕ", "l": "ⲗ", "m": "ⲙ", "n": "ⲛ", "o": "ⲟ",
  "p": "ⲡ", "q": "ⲕ", "r": "ⲣ", "s": "ⲥ", "t": "ⲧ",
  "u": "ⲟⲩ", "v": "ⲃ", "w": "ⲱ", "x": "ⲝ", "y": "ⲓ", "z": "ⲍ",
};

// تحويل كلمة إنجليزية واحدة — نفس منطق التطبيق: الثنائيات أولًا، ثم
// حرف بحرف، وقاعدة c (قبل e/i/y تبقى ⲥ)، مع الحفاظ على حالة الحروف
// (الحرف الكبير في الإدخال → حرف قبطي كبير).
function transliterateEnglishWord(word) {
  const text = String(word ?? "");
  let result = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const nextChar = i < text.length - 1 ? text[i + 1] : "";
    const lowerPair = (char + nextChar).toLowerCase();
    const lowerChar = char.toLowerCase();
    const isUpper = char === char.toUpperCase() && char !== char.toLowerCase();
    const up = (unit) => (isUpper ? unit.toUpperCase() : unit);
    if (EN_DIGRAPHS[lowerPair]) { result += up(EN_DIGRAPHS[lowerPair]); i += 2; continue; }
    if (EN_MAP[lowerChar]) {
      let mapped = EN_MAP[lowerChar];
      if (lowerChar === "c") {
        const nextLower = nextChar.toLowerCase();
        if (["e", "i", "y"].includes(nextLower)) mapped = "ⲥ";
      }
      result += up(mapped);
      i++;
      continue;
    }
    i++;
  }
  return result;
}

const HAS_ARABIC = /[\u0600-\u06FF]/u;
const HAS_LATIN = /[A-Za-z]/u;

// الاسم كاملًا (كلمة أو أكثر) → القبطي، أو null لو مفيش حروف صالحة.
export function transliterateNameToCoptic(name) {
  const raw = String(name ?? "").replace(ARABIC_DIACRITICS_KEEP_SHADDA, "").trim();
  if (!raw || raw.length > 60) return null;
  const words = raw.split(/[\s\-]+/u).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (!words.every((w) => HAS_ARABIC.test(w) || HAS_LATIN.test(w))) return null;
  if (!words.every((w) => (w.match(/[\u0600-\u06FFA-Za-z]/gu) ?? []).length >= 1)) return null;
  const letters = words.join("").replace(/[^A-Za-z\u0600-\u06FF]/gu, "");
  if (letters.length < 2) return null;
  const parts = words.map((w) => {
    const key = HAS_ARABIC.test(w) ? normalizeArabicWord(w) : w.toLowerCase();
    return KNOWN_BY_KEY.get(key) ?? (HAS_ARABIC.test(w) ? transliterateArabicWord(w) : transliterateEnglishWord(w));
  });
  const result = parts.join(" ").trim();
  return result || null;
}

// نص الرد الكامل كما طُلب: «كتابة اسمك بالقبطية: <الاسم>»، أو null للإدخال غير الصالح.
export function copticNameReply(name) {
  const coptic = transliterateNameToCoptic(name);
  return coptic ? `كتابة اسمك بالقبطية: ${coptic}` : null;
}
