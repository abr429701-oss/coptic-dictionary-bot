// Renders the two exact card layouts supplied by the user.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = path.join(ROOT, "templates");
const FONT_DIR = path.join(ROOT, "fonts");
const COPTIC_FAMILY = existsSync(path.join(FONT_DIR, "coptic-card.ttf")) ? "Coptic Card" : "Noto Sans Coptic";
const FONT_FILES = ["Tajawal-Regular.ttf", "Tajawal-Medium.ttf", "Tajawal-Bold.ttf", "NotoSansCoptic-Regular.ttf", "coptic-card.ttf"]
  .map((file) => path.join(FONT_DIR, file)).filter((file) => existsSync(file));

export const CARD = { first: { width: 1080, height: 2340 }, second: { width: 907, height: 1280 } };
const TEMPLATE_1 = readFileSync(path.join(TEMPLATE_DIR, "card-1.jpg")).toString("base64");
const TEMPLATE_2 = readFileSync(path.join(TEMPLATE_DIR, "card-2.jpg")).toString("base64");
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const fit = (text, size, maxWidth, perChar) => Math.max(Math.round(size * 0.45), Math.min(size, Math.floor(maxWidth / (Array.from(String(text)).length * perChar || 1))));
const wrapArabic = (text, maxChars) => {
  const lines = []; let line = "";
  for (const word of String(text).split(/\s+/u).filter(Boolean)) {
    if (line && Array.from(`${line} ${word}`).length > maxChars) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

function qrSvg(text, x, y, size) {
  const qr = QRCode.create(text || "https://t.me/Uploade33_bot", { errorCorrectionLevel: "M" });
  const cell = size / qr.modules.size;
  let path = "";
  for (let row = 0; row < qr.modules.size; row += 1) for (let col = 0; col < qr.modules.size; col += 1) {
    if (qr.modules.get(row, col)) path += `M${(x + col * cell).toFixed(2)} ${(y + row * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  }
  return `<path d="${path}" fill="#000" shape-rendering="crispEdges"/>`;
}

function textSvg({ x, y, text, size, fill = "#fff", anchor = "middle", family = "Tajawal", weight = 700 }) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" direction="rtl" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}">${esc(text)}</text>`;
}

export function cardSvg({ word, meaning, typeLabel, origin, qrText }) {
  const lines = wrapArabic(meaning, 25);
  const meaningText = lines.map((line, i) => textSvg({ x: 540, y: 960 + i * 74, text: line, size: lines.length > 1 ? 58 : fit(line, 78, 760, 0.52) })).join("");
  const wordSize = fit(word, 150, 760, 0.62);
  const typeSize = fit(typeLabel || "—", 43, 275, 0.42);
  const originSize = fit(origin || "—", 43, 275, 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2340" viewBox="0 0 1080 2340">
<image href="data:image/jpeg;base64,${TEMPLATE_1}" width="1080" height="2340"/>
<rect x="145" y="600" width="790" height="190" fill="#1e1e1e"/>
${textSvg({ x: 540, y: 750, text: word, size: wordSize, fill: "#c8a851", family: COPTIC_FAMILY })}
<rect x="130" y="855" width="820" height="180" fill="#1e1e1e"/>
${meaningText}
<rect x="135" y="1115" width="355" height="165" rx="25" fill="#29211f"/><rect x="545" y="1115" width="355" height="165" rx="25" fill="#282722"/>
${textSvg({ x: 312, y: 1180, text: "النوع", size: 30, fill: "#b9b2b2", weight: 400 })}
${textSvg({ x: 722, y: 1180, text: "الأصل", size: 30, fill: "#b9b2b2", weight: 400 })}
${textSvg({ x: 312, y: 1260, text: typeLabel || "—", size: typeSize, fill: "#cc4444" })}
${textSvg({ x: 722, y: 1260, text: origin || "—", size: originSize, fill: "#c8a851" })}
<rect x="405" y="1360" width="270" height="270" rx="38" fill="#fff"/>${qrSvg(qrText, 428, 1383, 224)}
</svg>`;
}

export function secondCardSvg({ word, meaning, typeLabel, origin, qrText }) {
  const lines = wrapArabic(meaning, 24);
  const meaningText = lines.map((line, i) => textSvg({ x: 670, y: 430 + i * 62, text: line, size: lines.length > 1 ? 47 : fit(line, 65, 350, 0.52) })).join("");
  const type = typeLabel || "—";
  const date = "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="907" height="1280" viewBox="0 0 907 1280">
<image href="data:image/jpeg;base64,${TEMPLATE_2}" width="907" height="1280"/>
<rect x="455" y="300" width="440" height="500" fill="#4a4a4a"/>
${textSvg({ x: 850, y: 370, text: "الكلمة:", size: 31, fill: "#f2d000", anchor: "end" })}
${textSvg({ x: 590, y: 370, text: word, size: fit(word, 49, 300, 0.58), fill: "#fff" })}
${textSvg({ x: 850, y: 470, text: "المعنى:", size: 31, fill: "#f2d000", anchor: "end" })}
${meaningText}
${textSvg({ x: 850, y: 580, text: "النوع:", size: 31, fill: "#f2d000", anchor: "end" })}
${textSvg({ x: 590, y: 580, text: type, size: fit(type, 43, 260, 0.45), fill: "#fff" })}
${textSvg({ x: 850, y: 690, text: "الأصل:", size: 31, fill: "#f2d000", anchor: "end" })}
${textSvg({ x: 590, y: 690, text: origin || "—", size: fit(origin || "—", 43, 260, 0.45), fill: "#fff" })}
<rect x="30" y="745" width="845" height="105" fill="#4a4a4a"/>
<rect x="330" y="1005" width="250" height="250" rx="34" fill="#fff"/>${qrSvg(qrText, 350, 1025, 210)}
${date ? textSvg({ x: 600, y: 850, text: date, size: 30, fill: "#fff" }) : ""}
</svg>`;
}

function render(svg, width) {
  return new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Tajawal" }, fitTo: { mode: "width", value: width } }).render().asPng();
}

export function renderCard(data) { return render(cardSvg(data), CARD.first.width); }
export function renderSecondCard(data) { return render(secondCardSvg(data), CARD.second.width); }
export function renderCards(data) { return { first: renderCard(data), second: renderSecondCard(data) }; }
