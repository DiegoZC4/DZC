const { Notice, Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const DEFAULTS = {
  minimumAgeDays: 7,
  historyWindowDays: 90,
  ageExponent: 1.7,
  excludedFolders: ".obsidian, Templates, Attachments",
  seen: {}
};

module.exports = class SpacedOmissionPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());

    this.addRibbonIcon("shuffle", "Surface a neglected note", () => this.surfaceNote());
    this.addCommand({
      id: "surface-neglected-note",
      name: "Surface a neglected note",
      callback: () => this.surfaceNote()
    });
    this.addCommand({
      id: "mark-current-note-seen",
      name: "Mark current note as seen",
      callback: () => this.markCurrentSeen()
    });
    this.addCommand({
      id: "forget-current-note-history",
      name: "Forget current note history",
      callback: () => this.forgetCurrent()
    });
    this.addSettingTab(new SpacedOmissionSettings(this.app, this));
  }

  excludedPrefixes() {
    return this.settings.excludedFolders
      .split(",")
      .map((value) => value.trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
  }

  eligibleFiles() {
    const now = Date.now();
    const day = 86_400_000;
    const excluded = this.excludedPrefixes();
    const active = this.app.workspace.getActiveFile();

    return this.app.vault.getMarkdownFiles().flatMap((file) => {
      if (file === active || excluded.some((prefix) => file.path === prefix || file.path.startsWith(prefix + "/"))) {
        return [];
      }
      const lastSeen = Number(this.settings.seen[file.path] || file.stat.mtime || 0);
      const ageDays = Math.max(0, (now - lastSeen) / day);
      if (ageDays < this.settings.minimumAgeDays) return [];
      const cappedAge = Math.min(ageDays, this.settings.historyWindowDays);
      const weight = Math.max(0.001, cappedAge ** this.settings.ageExponent);
      return [{ file, ageDays, weight }];
    });
  }

  chooseWeighted(candidates) {
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let cursor = Math.random() * total;
    for (const candidate of candidates) {
      cursor -= candidate.weight;
      if (cursor <= 0) return candidate;
    }
    return candidates.at(-1);
  }

  async surfaceNote() {
    const candidates = this.eligibleFiles();
    if (!candidates.length) {
      new Notice("No neglected notes match the current minimum age and exclusions.");
      return;
    }
    const chosen = this.chooseWeighted(candidates);
    await this.app.workspace.getLeaf(false).openFile(chosen.file);
    this.settings.seen[chosen.file.path] = Date.now();
    await this.saveSettings();
    new Notice(`Surfaced after ${Math.floor(chosen.ageDays)} days: ${chosen.file.basename}`);
  }

  async markCurrentSeen() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return new Notice("No note is active.");
    this.settings.seen[file.path] = Date.now();
    await this.saveSettings();
    new Notice(`Marked seen: ${file.basename}`);
  }

  async forgetCurrent() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return new Notice("No note is active.");
    delete this.settings.seen[file.path];
    await this.saveSettings();
    new Notice(`Forgot surfacing history: ${file.basename}`);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};

class SpacedOmissionSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Spaced Omission" });
    containerEl.createEl("p", {
      text: "Notes become eligible after the minimum age. Among eligible notes, older notes receive more lottery weight."
    });

    new Setting(containerEl)
      .setName("Minimum age")
      .setDesc("Days after a note was last surfaced or modified before it can return.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.minimumAgeDays))
        .onChange(async (value) => {
          this.plugin.settings.minimumAgeDays = Math.max(0, Number(value) || 0);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Weight saturation")
      .setDesc("Age in days after which additional neglect no longer adds selection weight.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.historyWindowDays))
        .onChange(async (value) => {
          this.plugin.settings.historyWindowDays = Math.max(1, Number(value) || 90);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Age exponent")
      .setDesc("1 is linear. Larger values favor the most neglected notes more strongly.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.ageExponent))
        .onChange(async (value) => {
          this.plugin.settings.ageExponent = Math.max(0, Number(value) || 1);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Comma-separated vault-relative folder paths.")
      .addTextArea((text) => text
        .setValue(this.plugin.settings.excludedFolders)
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Clear surfacing history")
      .setDesc(`${Object.keys(this.plugin.settings.seen).length} notes currently have explicit history.`)
      .addButton((button) => button
        .setWarning()
        .setButtonText("Clear")
        .onClick(async () => {
          this.plugin.settings.seen = {};
          await this.plugin.saveSettings();
          this.display();
        }));
  }
}
