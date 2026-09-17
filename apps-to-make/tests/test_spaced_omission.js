"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let randomValue = 0;
const testMath = Object.create(Math);
testMath.random = () => randomValue;
const notices = [];

class MockPlugin {
  async loadData() { return this.loadedData || {}; }
  async saveData(value) { this.savedData = JSON.parse(JSON.stringify(value)); }
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
}

class MockPluginSettingTab {}
class MockSetting {}
class MockTFile {
  constructor(filePath, modified = Date.now()) {
    this.path = filePath;
    this.basename = path.basename(filePath, ".md");
    this.stat = { mtime: modified };
  }
}

const moduleRecord = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, "..", "spaced-omission-obsidian", "main.js"), "utf8");
vm.runInNewContext(source, {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require(name) {
    assert.equal(name, "obsidian");
    return {
      Notice: class { constructor(message) { notices.push(message); } },
      Plugin: MockPlugin,
      PluginSettingTab: MockPluginSettingTab,
      Setting: MockSetting,
      TFile: MockTFile
    };
  },
  Math: testMath,
  Date,
  Object,
  Number,
  String,
  Array,
  Map,
  Set,
  console
}, { filename: "spaced-omission/main.js" });

const SpacedOmissionPlugin = moduleRecord.exports;

async function run() {
  let assertions = 0;
  const check = (condition, message) => {
    assertions += 1;
    assert.ok(condition, message);
  };

  const now = Date.now();
  const day = 86_400_000;
  const active = new MockTFile("Active.md", now - 100 * day);
  const old = new MockTFile("Research/Old.md", now - 120 * day);
  const young = new MockTFile("Research/Young.md", now - 2 * day);
  const excluded = new MockTFile("Templates/Template.md", now - 200 * day);
  const plugin = new SpacedOmissionPlugin();
  plugin.settings = {
    minimumAgeDays: 7,
    historyWindowDays: 90,
    ageExponent: 2,
    excludedFolders: " Templates, /Attachments/ ",
    seen: {}
  };
  plugin.app = {
    workspace: { getActiveFile: () => active },
    vault: { getMarkdownFiles: () => [active, old, young, excluded] }
  };

  assert.deepEqual(Array.from(plugin.excludedPrefixes()), ["Templates", "Attachments"]);
  assertions += 1;
  const eligible = plugin.eligibleFiles();
  assert.equal(eligible.length, 1);
  assertions += 1;
  assert.equal(eligible[0].file, old);
  assertions += 1;
  assert.equal(eligible[0].weight, 90 ** 2);
  assertions += 1;

  const candidates = [{ id: "first", weight: 1 }, { id: "second", weight: 3 }];
  randomValue = 0.1;
  assert.equal(plugin.chooseWeighted(candidates).id, "first");
  assertions += 1;
  randomValue = 0.9;
  assert.equal(plugin.chooseWeighted(candidates).id, "second");
  assertions += 1;

  let opened = null;
  plugin.app.workspace.getLeaf = () => ({ openFile: async (file) => { opened = file; } });
  plugin.eligibleFiles = () => [{ file: old, ageDays: 44.8, weight: 1 }];
  plugin.chooseWeighted = (items) => items[0];
  await plugin.surfaceNote();
  assert.equal(opened, old);
  assertions += 1;
  check(plugin.settings.seen[old.path] > 0, "surfaced note receives a timestamp");
  assert.equal(plugin.savedData.seen[old.path], plugin.settings.seen[old.path]);
  assertions += 1;
  check(notices.at(-1).includes("Surfaced after 44 days"), "surface notice reports note age");

  plugin.app.workspace.getActiveFile = () => old;
  await plugin.markCurrentSeen();
  check(plugin.settings.seen[old.path] > 0, "mark seen records the active note");
  await plugin.forgetCurrent();
  assert.equal(plugin.settings.seen[old.path], undefined);
  assertions += 1;
  check(notices.at(-1).includes("Forgot surfacing history"), "forget action reports completion");

  plugin.app.workspace.getActiveFile = () => null;
  await plugin.markCurrentSeen();
  check(notices.at(-1).includes("No note is active"), "missing active note is handled safely");

  console.log(`spaced-omission: ${assertions} assertions passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
