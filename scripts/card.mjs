// Professional multilingual word-card renderer for Telegram.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "fonts");
const COPTIC_FAMILY = "Naqlun";
const FONT_FILES = ["Tajawal-Regular.ttf", "Tajawal-Medium.ttf", "Tajawal-Bold.ttf", "gabriel_arshiagelos.ttf"]
  .map((file) => path.join(FONT_DIR, file)).filter((file) => existsSync(file));
export const CARD = { width: 907, height: 1280 };

const LABELS = {
  ar: { word: "الكلمة", meaning: "المعنى", kind: "النوع", origin: "الأصل", direction: "rtl", brand: "القاموس القبطي" },
  en: { word: "Word", meaning: "Meaning", kind: "Part of speech", origin: "Origin", direction: "ltr", brand: "Coptic Dictionary" },
  fr: { word: "Mot", meaning: "Sens", kind: "Nature", origin: "Origine", direction: "ltr", brand: "Dictionnaire copte" },
  de: { word: "Wort", meaning: "Bedeutung", kind: "Wortart", origin: "Herkunft", direction: "ltr", brand: "Koptisches Wörterbuch" },
};

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const fit = (value, max = 54, min = 27, chars = 22) => Math.max(min, Math.min(max, Math.floor((chars * max) / Math.max(chars, Array.from(String(value ?? "")).length))));
const wrap = (value, max = 28, limit = 3) => {
  const words = String(value ?? "").split(/\s+/u).filter(Boolean);
  const lines = []; let line = "";
  for (const word of words) {
    if (line && Array.from(`${line} ${word}`).length > max) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, limit);
};

function text({ x, y, value, size, fill = "#f8fafc", family = "Tajawal", weight = 700, anchor = "middle", direction = "ltr", opacity = 1 }) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" direction="${direction}" unicode-bidi="plaintext" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}" opacity="${opacity}">${esc(value)}</text>`;
}

function qrSvg(value, x, y, size) {
  const qr = QRCode.create(value || "https://t.me/Uploade33_bot", { errorCorrectionLevel: "M" });
  const cell = size / qr.modules.size; let d = "";
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let col = 0; col < qr.modules.size; col += 1) {
      if (qr.modules.get(row, col)) d += `M${(x + col * cell).toFixed(2)} ${(y + row * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<path d="${d}" fill="#0b1220" shape-rendering="crispEdges"/>`;
}

function field({ y, label, value, direction, multi = false }) {
  const lines = wrap(value, multi ? 30 : 25, multi ? 3 : 1);
  const valueY = y + (lines.length > 1 ? 52 : 63);
  return `<rect x="76" y="${y}" width="755" height="${multi ? 154 : 126}" rx="26" fill="#111d31" stroke="#243b5a" stroke-width="2"/>`
    + text({ x: 453, y: y + 37, value: label.toUpperCase(), size: 20, fill: "#7dd3fc", weight: 700, direction })
    + lines.map((line, index) => text({ x: 453, y: valueY + index * 38, value: line, size: fit(line, multi ? 39 : 45, 25, multi ? 29 : 22), fill: "#f8fafc", weight: 700, direction })).join("");
}

export function cardSvg({ word, meaning, typeLabel, origin, qrText, dateText = "", language = "ar", logo = "Ⲭⲏⲙⲓ" }) {
  const ui = LABELS[language] ?? LABELS.ar;
  const direction = ui.direction;
  const safeMeaning = meaning || "—";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="907" height="1280" viewBox="0 0 907 1280">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07111f"/><stop offset="0.55" stop-color="#10243c"/><stop offset="1" stop-color="#07111f"/></linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d3ee"/><stop offset="0.5" stop-color="#fbbf24"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.28"/></filter>
</defs>
<rect width="907" height="1280" fill="url(#bg)"/>
<circle cx="78" cy="128" r="180" fill="#22d3ee" opacity="0.07"/><circle cx="850" cy="1060" r="230" fill="#fbbf24" opacity="0.05"/>
<rect x="42" y="42" width="823" height="1196" rx="42" fill="none" stroke="#284765" stroke-width="2"/>
<rect x="76" y="76" width="755" height="8" rx="4" fill="url(#accent)"/>
${text({ x: 453, y: 151, value: logo, size: 67, family: COPTIC_FAMILY, fill: "#fbbf24", weight: 700 })}
${text({ x: 453, y: 190, value: ui.brand, size: 18, fill: "#94a3b8", weight: 500, direction })}
<path d="M160 228H746" stroke="#365878" stroke-width="2"/><circle cx="145" cy="228" r="6" fill="#22d3ee"/><circle cx="762" cy="228" r="6" fill="#fbbf24"/>
${field({ y: 272, label: ui.word, value: word, direction })}
${field({ y: 424, label: ui.meaning, value: safeMeaning, direction, multi: true })}
${field({ y: 596, label: ui.kind, value: typeLabel || "—", direction })}
${field({ y: 748, label: ui.origin, value: origin || "—", direction })}
<rect x="76" y="916" width="755" height="2" fill="#365878"/>
<rect x="329" y="960" width="249" height="249" rx="28" fill="#f8fafc" filter="url(#shadow)"/>${qrSvg(qrText, 350, 981, 207)}
${text({ x: 453, y: 1230, value: String(dateText).split("|")[0] || "", size: 17, fill: "#94a3b8", weight: 500, direction })}
</svg>`;
}

export function renderCard(data) {
  return new Resvg(cardSvg(data), {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Tajawal" },
    fitTo: { mode: "width", value: CARD.width },
  }).render().asPng();
}
