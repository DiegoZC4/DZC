"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const browserCases = require("./browser-cases.js");

const root = path.resolve(__dirname, "..", "..");
const status = JSON.parse(fs.readFileSync(path.join(root, "apps-to-make", "status.json"), "utf8"));
const drafted = status.filter((item) => item.status === "drafted");
const nonBrowserCoverage = [
  { order: 2, targets: ["apps-to-make/reading-question-cli/reading_questions.py"] },
  { order: 21, targets: ["apps-to-make/rhythm-practice-cli/rhythm_practice.cpp"] },
  { order: 25, targets: ["apps-to-make/spaced-omission-obsidian/manifest.json", "apps-to-make/spaced-omission-obsidian/main.js"] }
];

assert.equal(browserCases.length, 25, "expected one browser case for each HTML draft");
assert.equal(new Set(browserCases.map((item) => item.file)).size, browserCases.length, "browser test files must be unique");

const coveredOrders = new Set([...browserCases.map((item) => item.order), ...nonBrowserCoverage.map((item) => item.order)]);
assert.deepEqual([...drafted.map((item) => item.order).filter((order) => !coveredOrders.has(order))], [], "every drafted idea needs a test");

const coveredPaths = new Set([
  ...browserCases.map((item) => `apps-to-make/${item.file}`),
  ...nonBrowserCoverage.flatMap((item) => item.targets)
]);
const draftedPaths = drafted.flatMap((item) => item.paths).filter((itemPath) => !path.isAbsolute(itemPath));
assert.deepEqual(draftedPaths.filter((itemPath) => !coveredPaths.has(itemPath)), [], "every drafted source path needs test coverage");

let inlineScripts = 0;
for (const testCase of browserCases) {
  assert.equal(typeof testCase.run, "function", `${testCase.file} must define a test function`);
  const sourcePath = path.join(root, "apps-to-make", testCase.file);
  assert.ok(fs.existsSync(sourcePath), `${testCase.file} must exist`);
  const html = fs.readFileSync(sourcePath, "utf8");
  assert.match(html, /<meta\s+name="viewport"/i, `${testCase.file} needs a mobile viewport`);
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    new vm.Script(match[1], { filename: testCase.file });
    inlineScripts += 1;
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "apps-to-make", "spaced-omission-obsidian", "manifest.json"), "utf8"));
assert.ok(manifest.id && manifest.name && manifest.version, "Obsidian manifest must contain identity and version fields");

console.log(`coverage: ${drafted.length} drafted ideas, ${draftedPaths.length} source paths, ${browserCases.length} browser cases, ${inlineScripts} inline scripts`);
