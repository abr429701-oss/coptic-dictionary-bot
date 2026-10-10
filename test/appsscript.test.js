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
      createTextFinder: (needle) => {
        let exact = false;
        const finder = {
          matchEntireCell(value) { exact = value; return finder; },
          matchCase() { return finder; },
          findNext() {
            for (let i = 0; i < numRows; i += 1) {
              const value = cell(row + i, col);
              if (exact ? String(value) === String(needle) : String(value).includes(String(needle))) {
                return { getRow: () => row + i };
              }
            }
            return null;
          },
        };
        return finder;
      },
    };
  }
  #put(row, col, value) {
    while (this.data.length < row) this.data.push([]);
    this.data[row - 1][col - 1] = value;
  }
}

function build() {
  const props = new Map();
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
  const makeFolder = (name) => ({ id: `folder${folders.length + 1}`, name, getId() { return this.id; }, getName() { return this.name; }, isTrashed() { return false; },
    getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }, createFile: makeFile });
  // Match the production Apps Script configuration: fixed folder and upload tab.
  folders.push(makeFolder("dic_final"));
  const main = new FakeSheet("Dictionary", [["coptic", "greek"]]);
  const uploadSheet = new FakeSheet("upload");
  const sheets = [main, uploadSheet];
  const spreadsheet = {
    getName: () => "Coptic dictionary", getSheets: () => sheets, getNumSheets: () => sheets.length,
    getSheetByName: (name) => sheets.find((sheet) => sheet.getName() === name) ?? null,
    insertSheet(name) { const sheet = new FakeSheet(name); sheets.push(sheet); return sheet; },
  };
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { base64Decode: (b64) => [...Buffer.from(b64, "base64")], newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFoldersByName: (name) => { const hit = folders.filter((f) => f.name === name); let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; },
      createFolder: (name) => { const folder = makeFolder(name); folders.push(folder); return folder; },
      getFolderById: (id) => folders[0],
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
const upload = (extra = {}) => ({ action: "upload", id: 7, word: "ⲁⲧⲥ̀ϧⲁⲓ", audio_base64: audio, mime_type: "audio/ogg", file_id: "TG", duration: 3, by: { id: "813894692" }, ...extra });

test("answers ping and GET with no password of any kind", () => {
  assert.equal(build().post({ action: "ping" }).ok, true);
  assert.equal(JSON.parse(build().api.doGet().text).ok, true);
});

test("ping creates/finds the folder and reports the spreadsheet", () => {
  const world = build();
  const result = world.post({ action: "ping" });
  assert.equal(result.ok, true);
  assert.equal(result.folder.name, "dic_final");
  assert.equal(result.sheet.tab, "upload");
  world.post({ action: "ping" });
  assert.equal(world.folders.length, 1);
});

const by = { name: "مينا ميخائيل جرجس", id: "813894692", username: "mina" };

test("an upload saves <id>.ogg and writes one Ban row with the drive link, recorder name, id and username", () => {
  const world = build();
  const result = world.post(upload({ by }));
  assert.equal(result.ok, true);
  const file = world.files.get(result.file_id);
  assert.equal(file.blob.name, "7.ogg");
  assert.deepEqual(file.blob.bytes, [79, 103, 103, 83, 1, 2, 3]);
  assert.equal(result.url, `https://drive.google.com/file/d/${result.file_id}/view?usp=drivesdk`);

  const ban = world.sheets.find((sheet) => sheet.getName() === "upload");
  assert.deepEqual(ban.data[0], ["id", "word", "drive_url", "drive_file_id", "telegram_file_id", "duration_s"]);
  assert.deepEqual(ban.data[1], ["7", "ⲁⲧⲥ̀ϧⲁⲓ", result.url, result.file_id, "TG", 3]);
  assert.equal(world.sheets.some((sheet) => sheet.getName() === "Voices"), false);
});

test("re-recording a word replaces its Ban row and moves the old file to trash", () => {
  const world = build();
  const first = world.post(upload({ id: 3, word: "ⲁⲛⲁⲩ", by }));
  const second = world.post(upload({ id: 3, word: "ⲁⲛⲁⲩ", by }));
  assert.notEqual(first.file_id, second.file_id);
  assert.equal(world.files.get(first.file_id).trashed, true);
  assert.equal(world.files.get(second.file_id).trashed, false);
  const ban = world.sheets.find((sheet) => sheet.getName() === "upload");
  assert.equal(ban.data.length, 2);
  assert.equal(ban.data[1][3], second.file_id);
});

test("rejects bad input without touching Drive", () => {
  const world = build();
  assert.match(world.post(upload({ audio_base64: "" })).error, /audio_base64/u);
  assert.match(world.post(upload({ id: "7; drop" })).error, /id must be a number/u);
  assert.equal(world.files.size, 0);
});

test("users are added to the User tab and updated by Telegram id without duplicates", () => {
  const world = build();
  const first = world.post({ action: "users", users: [
    { id: "11", name: "مينا جرجس", username: "mina", joined_at: "2026-10-01", registered_at: "" },
    { id: "12", name: "Mark", username: "@mark", joined_at: "2026-10-02", registered_at: "" },
  ] });
  assert.deepEqual([first.added, first.updated], [2, 0]);
  const tab = world.sheets.find((sheet) => sheet.getName() === "User");
  assert.deepEqual(tab.data[0].slice(0, 3), ["name", "username", "id"]);
  assert.deepEqual(tab.data[1].slice(0, 3), ["مينا جرجس", "@mina", "11"]);
  assert.equal(tab.data[2][1], "@mark");

  const again = world.post({ action: "users", users: [{ id: "11", name: "مينا جرجس بشرى", username: "", joined_at: "", registered_at: "2026-10-03" }] });
  assert.deepEqual([again.added, again.updated], [0, 1]);
  assert.equal(tab.data.length, 3);
  assert.deepEqual(tab.data[1].slice(0, 5), ["مينا جرجس بشرى", "@mina", "11", "2026-10-01", "2026-10-03"]);
  assert.equal(world.post({ action: "users", users: [{ id: "x; drop" }] }).added, 0);
});
