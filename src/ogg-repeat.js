// Repeats a single-word Ogg/Opus voice file N times (with a short pause) inside ONE valid
// Ogg Opus stream, so the file stored on GitHub stays small and the bot makes it play 3 times.
// Only files tagged by scripts/gen_audio_ipa_reader.mjs (marker below) are repeated; anything
// else is returned untouched, so older already-repeated files are never repeated again.
export const SINGLE_WORD_MARKER = "once-v1";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) !== 0 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export function oggCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ bytes[i]]) >>> 0;
  return crc >>> 0;
}

export function parseOggPages(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pages = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || bytes[offset] !== 0x4f || bytes[offset + 1] !== 0x67 || bytes[offset + 2] !== 0x67 || bytes[offset + 3] !== 0x53) {
      throw new Error("Invalid Ogg page");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 27);
    const segmentCount = bytes[offset + 26];
    const lacing = bytes.slice(offset + 27, offset + 27 + segmentCount);
    let dataLength = 0;
    for (const length of lacing) dataLength += length;
    const dataStart = offset + 27 + segmentCount;
    if (dataStart + dataLength > bytes.length) throw new Error("Truncated Ogg page");
    const lo = view.getUint32(6, true);
    const hi = view.getUint32(10, true);
    pages.push({
      type: bytes[offset + 5],
      granule: hi === 0xffffffff && lo === 0xffffffff ? -1 : hi * 4294967296 + lo,
      serial: view.getUint32(14, true),
      lacing,
      data: bytes.slice(dataStart, dataStart + dataLength),
    });
    offset = dataStart + dataLength;
  }
  return pages;
}

function buildPage({ type, granule, serial, sequence, lacing, data }) {
  const out = new Uint8Array(27 + lacing.length + data.length);
  const view = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, type], 0);
  if (granule < 0) {
    view.setUint32(6, 0xffffffff, true);
    view.setUint32(10, 0xffffffff, true);
  } else {
    view.setUint32(6, granule % 4294967296, true);
    view.setUint32(10, Math.floor(granule / 4294967296), true);
  }
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  out.set(data, 27 + lacing.length);
  view.setUint32(22, oggCrc(out), true);
  return out;
}

// Samples (at 48 kHz) that one Opus packet decodes to, from its TOC byte.
function packetSamples(toc, countByte) {
  const config = toc >> 3;
  let frame; // in 1/10 ms units to keep integers (2.5 ms = 25)
  if (config < 12) frame = [100, 200, 400, 600][config % 4];
  else if (config < 16) frame = config % 2 === 0 ? 100 : 200;
  else frame = [25, 50, 100, 200][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (countByte & 0x3f) : 2;
  return (frame * frames * 48) / 10;
}

function totalPacketSamples(audioPages) {
  let samples = 0;
  let toc = -1;
  let countByte = 0;
  for (const page of audioPages) {
    let position = 0;
    for (const length of page.lacing) {
      if (toc < 0) {
        toc = page.data[position];
        countByte = page.data[position + 1] ?? 0;
      }
      position += length;
      if (length < 255) {
        samples += packetSamples(toc, countByte);
        toc = -1;
      }
    }
  }
  return samples;
}

function includesAscii(bytes, text) {
  const needle = Array.from(text, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function repeatSingleWordOgg(input, { times = 3, pauseMs = 700, requireMarker = true } = {}) {
  if (!(times > 1)) return input;
  const pages = parseOggPages(input);
  if (pages.length < 3) return input;
  const [head, tags] = pages;
  const audio = pages.slice(2);
  const headText = new TextDecoder().decode(head.data.subarray(0, 8));
  const tagsText = new TextDecoder().decode(tags.data.subarray(0, 8));
  if (headText !== "OpusHead" || tagsText !== "OpusTags" || head.data[9] !== 1) return input; // mono only
  if (requireMarker && !includesAscii(tags.data, SINGLE_WORD_MARKER)) return input; // not a single-word file
  if (audio.some((page) => page.serial !== head.serial)) return input;

  const copySamples = totalPacketSamples(audio);
  const gapPackets = Math.max(0, Math.round(pauseMs / 20));
  const gapSamples = gapPackets * 960;
  const stride = copySamples + gapSamples;
  const gap = new Uint8Array(gapPackets * 3);
  for (let i = 0; i < gapPackets; i++) gap.set([0xf8, 0xff, 0xfe], i * 3);

  const output = [];
  let sequence = 0;
  const push = (page, extra = {}) => output.push(buildPage({ ...page, serial: head.serial, sequence: sequence++, ...extra }));
  push(head);
  push(tags);
  for (let copy = 0; copy < times; copy++) {
    audio.forEach((page, index) => {
      const last = copy === times - 1 && index === audio.length - 1;
      const keepEos = last ? page.type : page.type & ~0x04;
      // The first page of every later copy must not continue a packet from the previous page.
      push(page, {
        type: copy > 0 && index === 0 ? keepEos & ~0x01 : keepEos,
        granule: page.granule < 0 ? -1 : page.granule + copy * stride,
      });
    });
    if (copy < times - 1 && gapPackets) {
      push({ type: 0, lacing: new Uint8Array(gapPackets).fill(3), data: gap }, { granule: (copy + 1) * stride });
    }
  }
  const total = output.reduce((sum, page) => sum + page.length, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const page of output) {
    result.set(page, at);
    at += page.length;
  }
  return result.buffer;
}

// True when the file was built by the single-word generator (new voice), false for older files.
export function isSingleWordOgg(input) {
  try {
    const pages = parseOggPages(input);
    return pages.length > 2 && includesAscii(pages[1].data, SINGLE_WORD_MARKER);
  } catch {
    return false;
  }
}
