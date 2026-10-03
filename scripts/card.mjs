// Draws one word card (1080 x 1330 PNG) in the dictionary's dark/gold design.
// Uses resvg (no browser), so it runs in GitHub Actions in milliseconds per card.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "fonts");
// Drop the dictionary's own Coptic font at fonts/coptic-card.ttf (family name below) to use it automatically.
const COPTIC_FAMILY = existsSync(path.join(FONT_DIR, "coptic-card.ttf")) ? "Coptic Card" : "Noto Sans Coptic";
const FONT_FILES = ["Tajawal-Regular.ttf", "Tajawal-Medium.ttf", "Tajawal-Bold.ttf", "NotoSansCoptic-Regular.ttf", "coptic-card.ttf"]
  .map((file) => path.join(FONT_DIR, file))
  .filter((file) => existsSync(file));

export const CARD = { width: 1080, height: 1330 };
const COLORS = {
  bg: "#1e1e1e", circleTop: "#232220", circleBottom: "#21201e", gold: "#c8a851", bar: "#85713c",
  divider: "#48402b", white: "#f0f0f0", label: "#8d8989", footer: "#5b5131", footerLine: "#403b28",
};
// Gender/type colour (the "النوع" box); unknown values use gold.
const TYPE_STYLES = {
  red: { fill: "#29211f", stroke: "#4c2a29", accent: "#cc4444" },
  blue: { fill: "#1f232b", stroke: "#2a3a55", accent: "#4a8fd6" },
  gold: { fill: "#282722", stroke: "#463f2d", accent: "#c8a851" },
};

export function typeStyle(value) {
  const text = String(value ?? "");
  if (/مؤنث/u.test(text)) return TYPE_STYLES.red;
  if (/مذكر/u.test(text)) return TYPE_STYLES.blue;
  return TYPE_STYLES.gold;
}

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Font size that keeps `text` inside maxWidth (rough per-character estimate), never above `size`.
function fit(text, size, maxWidth, perChar) {
  const length = Array.from(String(text)).length || 1;
  return Math.max(Math.round(size * 0.45), Math.min(size, Math.floor(maxWidth / (length * perChar))));
}

function wrapArabic(text, maxChars) {
  const words = String(text).split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && Array.from(`${line} ${word}`).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function qrGroup(text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const cell = size / count;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) path += `M${(x + col * cell).toFixed(2)} ${(y + row * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<path d="${path}" fill="#000" shape-rendering="crispEdges"/>`;
}

export function cardSvg({ word, meaning, typeLabel, origin, qrText }) {
  const wordSize = fit(word, 158, 860, 0.62);
  const lines = wrapArabic(meaning, 22);
  const meaningSize = lines.length > 1 ? 62 : fit(meaning, 80, 880, 0.52);
  const lineHeight = Math.round(meaningSize * 1.25);
  const firstBaseline = lines.length > 1 ? 448 : 468;
  const meaningSvg = lines.map((line, index) =>
    `<text x="540" y="${firstBaseline + index * lineHeight}" text-anchor="middle" direction="rtl" font-family="Tajawal" font-weight="700" font-size="${meaningSize}" fill="${COLORS.white}">${esc(line)}</text>`).join("");
  const style = typeStyle(typeLabel);
  const box = (x, label, value, colors) => {
    const cx = x + 201.5;
    const valueSize = fit(value, 42, 350, 0.42);
    return `<rect x="${x + 1.5}" y="533.5" width="400" height="277" rx="44" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3"/>
<text x="${cx}" y="607" text-anchor="middle" direction="rtl" font-family="Tajawal" font-weight="400" font-size="27" fill="${COLORS.label}">${esc(label)}</text>
<rect x="${cx - 44}" y="653" width="88" height="6" rx="3" fill="${colors.accent}"/>
<text x="${cx}" y="734" text-anchor="middle" direction="rtl" font-family="Tajawal" font-weight="700" font-size="${valueSize}" fill="${colors.accent}">${esc(value)}</text>`;
  };
  const gold = TYPE_STYLES.gold;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
<defs><clipPath id="card"><rect width="1080" height="1330" rx="60"/></clipPath></defs>
<rect width="1080" height="1330" rx="60" fill="${COLORS.bg}"/>
<g clip-path="url(#card)"><circle cx="854" cy="222" r="310" fill="${COLORS.circleTop}"/><circle cx="197" cy="1033" r="238" fill="${COLORS.circleBottom}"/></g>
<rect x="78" y="3" width="922" height="10" fill="${COLORS.bar}"/>
<text x="540" y="257" text-anchor="middle" font-family="${COPTIC_FAMILY}" font-size="${wordSize}" fill="${COLORS.gold}">${esc(word)}</text>
<rect x="447" y="337" width="186" height="4" fill="${COLORS.divider}"/>
${meaningSvg}
${box(118, "النوع", typeLabel || "—", style)}
${box(555, "الأصل", origin || "—", gold)}
<rect x="417" y="887" width="243" height="243" rx="36" fill="#fff"/>
${qrGroup(qrText, 437, 907, 203)}
<rect x="78" y="1243" width="365" height="4" fill="${COLORS.footerLine}"/><rect x="634" y="1243" width="365" height="4" fill="${COLORS.footerLine}"/>
<text x="540" y="1268" text-anchor="middle" font-family="${COPTIC_FAMILY}" font-weight="700" font-size="58" fill="${COLORS.footer}">ⲭⲏⲙⲓ</text>
</svg>`;
}

export function renderCard(data) {
  const resvg = new Resvg(cardSvg(data), {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Tajawal" },
    fitTo: { mode: "width", value: CARD.width },
  });
  return resvg.render().asPng();
}
