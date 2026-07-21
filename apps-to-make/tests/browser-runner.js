(function () {
  "use strict";

  const cases = globalThis.APP_BROWSER_TEST_CASES || [];
  const byId = (id) => document.getElementById(id);
  let running = false;

  function printable(value) {
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "string") return JSON.stringify(value);
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  function snapshotStorage(keys) {
    return new Map(keys.map((key) => [key, localStorage.getItem(key)]));
  }

  function restoreStorage(snapshot) {
    for (const [key, value] of snapshot) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }

  class Checks {
    constructor(frame) {
      this.frame = frame;
      this.win = frame.contentWindow;
      this.doc = frame.contentDocument;
      this.assertions = 0;
      this.failures = [];
    }

    fail(label, detail) {
      this.failures.push(`${label}: ${detail}`);
    }

    ok(value, label) {
      this.assertions += 1;
      if (!value) this.fail(label, `expected truthy, received ${printable(value)}`);
      return value;
    }

    equal(actual, expected, label) {
      this.assertions += 1;
      if (!Object.is(actual, expected)) this.fail(label, `expected ${printable(expected)}, received ${printable(actual)}`);
      return actual;
    }

    deepEqual(actual, expected, label) {
      this.assertions += 1;
      const left = JSON.stringify(actual);
      const right = JSON.stringify(expected);
      if (left !== right) this.fail(label, `expected ${right}, received ${left}`);
      return actual;
    }

    near(actual, expected, tolerance, label) {
      this.assertions += 1;
      if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
        this.fail(label, `expected ${expected} +/- ${tolerance}, received ${printable(actual)}`);
      }
      return actual;
    }

    matches(actual, pattern, label) {
      this.assertions += 1;
      if (!pattern.test(String(actual))) this.fail(label, `expected ${printable(actual)} to match ${pattern}`);
      return actual;
    }

    eval(expression) {
      return this.win.eval(expression);
    }

    id(id) {
      const element = this.doc.getElementById(id);
      if (!element) throw new Error(`Missing #${id}`);
      return element;
    }

    input(id, value, eventName = "input") {
      const element = this.id(id);
      element.value = value;
      element.dispatchEvent(new this.win.Event(eventName, { bubbles: true }));
      return element;
    }

    click(target) {
      const element = typeof target === "string"
        ? (this.doc.getElementById(target) || this.doc.querySelector(target))
        : target;
      if (!element) throw new Error(`Missing click target: ${target}`);
      element.click();
      return element;
    }

    async waitFor(predicate, label, timeout = 5000) {
      const started = performance.now();
      while (performance.now() - started < timeout) {
        let value = false;
        try { value = await predicate(); } catch { value = false; }
        if (value) {
          this.assertions += 1;
          return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      this.assertions += 1;
      this.fail(label, `condition did not become true within ${timeout} ms`);
      return false;
    }
  }

  function resultRow(testCase) {
    const row = document.createElement("article");
    row.className = "case";
    row.innerHTML = `<span class="order">#${String(testCase.order).padStart(2, "0")}</span><div><strong>${testCase.name}</strong><div class="muted mono">${testCase.file}</div></div><span class="status">queued</span>`;
    byId("results").append(row);
    return row;
  }

  function loadFrame(file) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.className = "test-frame";
      const timer = setTimeout(() => reject(new Error(`Timed out loading ${file}`)), 8000);
      frame.onload = () => {
        clearTimeout(timer);
        setTimeout(() => resolve(frame), 40);
      };
      frame.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Failed to load ${file}`));
      };
      frame.src = `../${file}?automated-test=${Date.now()}`;
      document.body.append(frame);
    });
  }

  async function runCase(testCase, row) {
    const status = row.querySelector(".status");
    const storage = snapshotStorage(testCase.storageKeys || []);
    for (const key of testCase.storageKeys || []) localStorage.removeItem(key);
    let frame;
    let checks;
    try {
      status.textContent = "running";
      frame = await loadFrame(testCase.file);
      checks = new Checks(frame);
      checks.ok(checks.doc.title.length > 0, "document has a title");
      checks.ok(checks.doc.querySelector("h1"), "document has a primary heading");
      await testCase.run(checks);
    } catch (error) {
      if (!checks) checks = { assertions: 0, failures: [] };
      checks.failures.push(`uncaught test error: ${error.stack || error.message}`);
    } finally {
      frame?.remove();
      restoreStorage(storage);
    }

    const passed = checks.failures.length === 0;
    row.classList.add(passed ? "pass" : "fail");
    status.textContent = passed ? `${checks.assertions} passed` : `${checks.failures.length} failed`;
    if (!passed) {
      const details = document.createElement("pre");
      details.className = "details";
      details.textContent = checks.failures.join("\n");
      row.append(details);
    }
    return { order: testCase.order, file: testCase.file, name: testCase.name, passed, assertions: checks.assertions, failures: checks.failures };
  }

  async function runAll() {
    if (running) return;
    running = true;
    byId("run").disabled = true;
    byId("results").replaceChildren();
    byId("summary").textContent = "Running";
    byId("progress").style.width = "0";
    byId("assertions").textContent = "0 assertions";
    document.body.dataset.testDone = "false";
    document.body.dataset.testPassed = "false";
    const rows = cases.map(resultRow);
    const results = [];
    let assertionCount = 0;

    for (let index = 0; index < cases.length; index += 1) {
      const result = await runCase(cases[index], rows[index]);
      results.push(result);
      assertionCount += result.assertions;
      byId("progress").style.width = `${(index + 1) / cases.length * 100}%`;
      byId("assertions").textContent = `${assertionCount} assertions`;
    }

    const failed = results.filter((result) => !result.passed);
    byId("summary").textContent = failed.length ? `${failed.length} / ${results.length} apps failed` : `${results.length} / ${results.length} apps passed`;
    byId("run").disabled = false;
    running = false;
    const report = { done: true, passed: !failed.length, assertionCount, results };
    globalThis.__BROWSER_TEST_RESULTS__ = report;
    document.body.dataset.testDone = "true";
    document.body.dataset.testPassed = String(report.passed);
    document.body.dataset.assertions = String(assertionCount);
  }

  byId("run").addEventListener("click", runAll);
  runAll();
}());
