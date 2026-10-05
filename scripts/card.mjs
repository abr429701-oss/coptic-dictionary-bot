// Renders the single card layout supplied by the user.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "fonts");
const TEMPLATE = readFileSync(path.join(ROOT, "templates", "card.jpg")).toString("base64");
const COPTIC_FAMILY = "Naqlun";
const FONT_FILES = ["Tajawal-Regular.ttf", "Tajawal-Medium.ttf", "Tajawal-Bold.ttf", "gabriel_arshiagelos.ttf"]
  .map((file) => path.join(FONT_DIR, file)).filter((file) => existsSync(file));
export const CARD = { width: 907, height: 1280 };
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const fit = (text, size, maxWidth, perChar) => Math.max(Math.round(size * 0.45), Math.min(size, Math.floor(maxWidth / (Array.from(String(text)).length * perChar || 1))));
const wrap = (value, max = 20) => {
  const words = String(value ?? "").split(/\s+/u).filter(Boolean); const lines = []; let line = "";
  for (const word of words) { if (line && Array.from(`${line} ${word}`).length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
  if (line) lines.push(line); return lines.slice(0, 3);
};
function qrSvg(text, x, y, size) {
  const qr = QRCode.create(text || "https://t.me/Uploade33_bot", { errorCorrectionLevel: "M" }); const cell = size / qr.modules.size; let path = "";
  for (let row = 0; row < qr.modules.size; row += 1) for (let col = 0; col < qr.modules.size; col += 1) if (qr.modules.get(row, col)) path += `M${(x + col * cell).toFixed(2)} ${(y + row * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  return `<path d="${path}" fill="#000" shape-rendering="crispEdges"/>`;
}
function text({ x, y, value, size, fill = "#fff", family = "Tajawal", weight = 700, anchor = "middle" }) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" direction="rtl" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}">${esc(value)}</text>`;
}

export function cardSvg({ word, meaning, typeLabel, origin, qrText, dateText = "" }) {
  const meaningLines = wrap(meaning, 18);
  // Keep the meaning typography identical whether the entry has one meaning or several.
  const meaningSvg = meaningLines.map((line, i) => text({ x: 600, y: 470 + i * 60, value: line, size: 42 })).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="907" height="1280" viewBox="0 0 907 1280">
<image href="data:image/jpeg;base64,${TEMPLATE}" width="907" height="1280"/>
<!-- Cover only the sample values; the supplied layout remains unchanged. -->
<rect x="455" y="300" width="440" height="505" fill="#4c4c4c"/>
${text({ x: 850, y: 370, value: "الكلمة:", size: 31, fill: "#f2d000", anchor: "end" })}
${text({ x: 600, y: 370, value: word, size: fit(word, 49, 280, 0.58), family: COPTIC_FAMILY })}
${text({ x: 850, y: 470, value: "المعنى:", size: 31, fill: "#f2d000", anchor: "end" })}
${meaningSvg}
${text({ x: 850, y: 580, value: "النوع:", size: 31, fill: "#f2d000", anchor: "end" })}
${text({ x: 600, y: 580, value: typeLabel || "—", size: fit(typeLabel || "—", 43, 250, 0.45) })}
${text({ x: 850, y: 690, value: "الأصل:", size: 31, fill: "#f2d000", anchor: "end" })}
${text({ x: 600, y: 690, value: origin || "—", size: fit(origin || "—", 43, 250, 0.45) })}
<rect x="30" y="745" width="845" height="105" fill="#4c4c4c"/>
${text({ x: 450, y: 790, value: `التاريخ الميلادي: ${String(dateText).split("|")[0] ?? ""}`, size: 21, fill: "#d0d0d0", weight: 400 })}
${text({ x: 450, y: 825, value: `التاريخ القبطي: ${String(dateText).split("|")[1] ?? ""}`, size: 21, fill: "#d0d0d0", weight: 400 })}
<rect x="330" y="1005" width="250" height="250" rx="34" fill="#fff"/>${qrSvg(qrText, 350, 1025, 210)}
</svg>`;
}
export function renderCard(data) {
  return new Resvg(cardSvg(data), { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Tajawal" }, fitTo: { mode: "width", value: CARD.width } }).render().asPng();
}
