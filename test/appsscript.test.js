// Runs apps-script/Code.gs against in-memory fakes of the Google services, since it cannot run here for real.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");

class FakeSheet {
  constructor(name, rows = []) { this.name = name; this.data = rows.map((row) => [...row]); }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  appendRow(row) { this.data.push([...row]); }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    const cell = (r, c) => sheet.data[r - 1]?.[c - 1] ?? "";
    return {
      getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => cell(row + i, col + j))),
      getValue: () => cell(row, col),
      setValue: (value) => { sheet.#put(row, col, value); },
      setValues: (values) => values.forEach((vals, i) => vals.forEach((value, j) => sheet.#put(row + i, col + j, value))),
    };
  }
  #put(row, col, value) {
    while (this.data.length < row) this.data.push([]);
    this.data[row - 1][col - 1] = value;
  }
}

function build({ secret = "S3CRET", mainRows = [] } = {}) {
  const props = new Map(secret ? [["SECRET", secret]] : []);
  const files = new Map();
  const folders = [];
  let nextId = 1;
  const makeFile = (blob) => {
    const file = { id: `file${nextId++}`, blob, trashed: false, description: "",
      getId() { return this.id; }, getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; },
      setDescription(text) { this.description = text; }, setTrashed(flag) { this.trashed = flag; }, setSharing() {} };
    files.set(file.id, file);
    return file;
  };
  const makeFolder = (name) => ({ id: `folder${folders.length + 1}`, name, getId() { return this.id; }, getName() { return this.name; },
    getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }, createFile: makeFile });
  const main = new FakeSheet("Dictionary", [["coptic", "greek"], ...mainRows]);
  const sheets = [main];
  const spreadsheet = {
    getName: () => "Coptic dictionary", getSheets: () => sheets, getNumSheets: () => sheets.length,
    getSheetByName: (name) => sheets.find((sheet) => sheet.getName() === name) ?? null,
    insertSheet(name) { const sheet = new FakeSheet(name); sheets.push(sheet); return sheet; },
  };
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { base64Decode: (b64) => [...Buffer.from(b64, "base64")], newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFoldersByName: (name) => { const hit = folders.filter((f) => f.name === name); let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; },
      createFolder: (name) => { const folder = makeFolder(name); folders.push(folder); return folder; },
      getFolderById: (id) => folders.find((f) => f.id === id),
      getFileById: (id) => { if (!files.has(id)) throw new Error("not found"); return files.get(id); },
    },
    SpreadsheetApp: { openById: () => spreadsheet },
    Logger: { log() {} },
  });
  const api = vm.runInContext(`${source}\n({ doPost, doGet })`, context);
  const post = (body) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, api, files, folders, sheets, main, spreadsheet };
}

const audio = Buffer.from([79, 103, 103, 83, 1, 2, 3]).toString("base64");
const upload = (extra = {}) => ({ secret: "S3CRET", action: "upload", id: 7, word: "ⲁⲧⲥ̀ϧⲁⲓ", audio_base64: audio, mime_type: "audio/ogg", file_id: "TG", duration: 3, ...extra });

test("rejects a wrong secret, and refuses everything while no secret is configured", () => {
  assert.equal(build().post({ secret: "nope", action: "ping" }).error, "unauthorized");
  assert.match(build({ secret: "" }).post({ secret: "", action: "ping" }).error, /SECRET is not configured/u);
  assert.equal(JSON.parse(build().api.doGet().text).ok, true);
});

test("ping creates/finds the folder and reports the spreadsheet", () => {
  const world = build();
  const result = world.post({ secret: "S3CRET", action: "ping" });
  assert.equal(result.ok, true);
  assert.equal(result.folder.name, "Coptic Dictionary Voices");
  assert.equal(result.sheet.mainTab, "Dictionary");
  world.post({ secret: "S3CRET", action: "ping" });
  assert.equal(world.folders.length, 1);
});

test("an upload saves the file as <id>.ogg, logs it in the Voices tab, and links matching main-sheet rows", () => {
  const world = build({ mainRows: [["ⲁⲛⲁⲩ", ""], ["ⲁⲧ`ⲥϧⲁⲓ", ""], ["Ⲁⲧⲥ̀ϧⲁⲓ", ""], ["ⲃⲁⲓ", ""]] });
  const result = world.post(upload());
  assert.equal(result.ok, true);
  assert.equal(result.rows_linked, 2);
  const file = world.files.get(result.file_id);
  assert.equal(file.blob.name, "7.ogg");
  assert.deepEqual(file.blob.bytes, [79, 103, 103, 83, 1, 2, 3]);
  assert.equal(file.description, "ⲁⲧⲥ̀ϧⲁⲓ");

  const voices = world.sheets.find((sheet) => sheet.getName() === "Voices");
  assert.deepEqual(voices.data[0].slice(0, 4), ["id", "word", "drive_url", "drive_file_id"]);
  assert.equal(voices.data[1][0], "7");
  assert.equal(voices.data[1][2], result.url);

  assert.equal(world.main.data[0][45], "Voice link");
  assert.equal(world.main.data[2][45], result.url);
  assert.equal(world.main.data[3][45], result.url);
  assert.equal(world.main.data[1][45] ?? "", "");
  assert.equal(world.main.data[4][45] ?? "", "");
});

test("re-recording a word replaces its row and moves the old file to trash", () => {
  const world = build({ mainRows: [["ⲁⲛⲁⲩ", ""]] });
  const first = world.post(upload({ id: 3, word: "ⲁⲛⲁⲩ" }));
  const second = world.post(upload({ id: 3, word: "ⲁⲛⲁⲩ" }));
  assert.notEqual(first.file_id, second.file_id);
  assert.equal(world.files.get(first.file_id).trashed, true);
  assert.equal(world.files.get(second.file_id).trashed, false);
  const voices = world.sheets.find((sheet) => sheet.getName() === "Voices");
  assert.equal(voices.data.length, 2);
  assert.equal(voices.data[1][3], second.file_id);
  assert.equal(world.main.data[1][45], second.url);
});

test("rejects bad input without touching Drive", () => {
  const world = build();
  assert.match(world.post(upload({ audio_base64: "" })).error, /audio_base64/u);
  assert.match(world.post(upload({ id: "7; drop" })).error, /id must be a number/u);
  assert.equal(world.files.size, 0);
});

test("the main sheet link column stays outside the columns the bot reads (A..AS)", () => {
  const column = Number(/MAIN_LINK_COLUMN:\s*(\d+)/u.exec(source)[1]);
  assert.equal(column, 46); // AT; the build script reads indexes 0..44 (A..AS)
});
