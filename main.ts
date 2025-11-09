import {
  App, Notice, Plugin, PluginSettingTab, Setting, MarkdownView
} from "obsidian";
interface HzSettings {
  buttonLabel: string;
}
const DEFAULT_SETTINGS: HzSettings = {
  buttonLabel: "Zoom"
};

const ZOOM_CMD_ID = "obsidian-zoom:zoom-in";

export default class HeadingZoomInlinePlugin extends Plugin {
  settings: HzSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new HzSettingTab(this.app, this));
    this.installInlineExtension();

    this.addCommand({
      id: "hz-zoom-at-cursor",
      name: "Zoom at current cursor (obsidian-zoom:zoom-in)",
      callback: () => this.zoomAtCurrentCursor(),
    });
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.reinstallInlineExtension();
  }

  private reinstallInlineExtension() {
    this.installInlineExtension();
  }

  private installInlineExtension() {
    const exts = createInlineHeadingButtons({
      label: this.settings.buttonLabel,
      onClick: (line) => this.zoomAtLine(line),
    });
    for (const ext of exts) this.registerEditorExtension(ext);
  }

  private getMarkdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView) ?? null;
  }

  private zoomAtCurrentCursor() {
    const view = this.getMarkdownView();
    if (!view) return;
    const pos = view.editor.getCursor();
    this.zoomAtLine(pos.line);
  }

  private zoomAtLine(line: number) {
    const view = this.getMarkdownView();
    if (!view) return;

    const editor = view.editor;
    const max = Math.max(0, editor.lineCount() - 1);
    const safe = Math.min(Math.max(0, line), max);

    editor.setCursor({ line: safe, ch: 0 });
    // @ts-expect-error
    view.editor.cm?.focus();

    const ok =
      (this.app as any).commands?.executeCommandById?.(ZOOM_CMD_ID) ??
      (globalThis as any).app?.commands?.executeCommandById?.(ZOOM_CMD_ID) ??
      false;

    if (!ok) {
      new Notice(`Failed to execute: ${ZOOM_CMD_ID}\nCheck that the Zoom plugin is enabled.`);
    }
  }
}

import type { Extension, EditorState } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import {
  EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType
} from "@codemirror/view";

function collectHeadingLinesFromState(state: EditorState): number[] {
  const doc = state.doc;
  const out: number[] = [];

  for (let i = 1; i <= doc.lines; i++) {
    const li = doc.line(i);
    const text = li.text;
    if (/^(#{1,6})\s+/.test(text)) {
      out.push(i - 1);
      continue;
    }
    if (/^={3,}\s*$/.test(text) || /^-{3,}\s*$/.test(text)) {
      if (i > 1) {
        const prev = doc.line(i - 1);
        if (prev.text.trim().length > 0) {
          out.push(i - 2);
        }
      }
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

class InlineBtn extends WidgetType {
  constructor(
    private label: string,
    private onClick: (line0: number) => void
  ){ super(); }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "hzb-inline-btn";
    el.textContent = this.label || "Zoom";
    el.title = "Zoom into this heading";
    el.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const pos = view.posAtDOM(el);
      const line0 = view.state.doc.lineAt(pos).number - 1;
      this.onClick(line0);
    });
    return el;
  }
  ignoreEvent() { return false; }
}

function buildInlineDecos(state: any, label: string, onClick: (line: number) => void): DecorationSet {
  const doc = state.doc;
  const targets = collectHeadingLinesFromState(state);
  const widgets: any[] = [];

  for (const ln of targets) {
    if (ln < 0 || ln >= doc.lines) continue;

    const lineInfo = doc.line(ln + 1);
    widgets.push(
      Decoration.widget({
        widget: new InlineBtn(label, onClick),
        side: 1,
      }).range(lineInfo.to)
    );
  }
  return Decoration.set(widgets, true);
}

function createInlineHeadingButtons(opts: {
  label: string;
  onClick: (line0: number) => void;
}): Extension[] {
  const field = StateField.define<DecorationSet>({
    create: (st) => buildInlineDecos(st, opts.label, opts.onClick),
    update: (decos, tr) => {
      if (tr.docChanged || tr.selection) {
        return buildInlineDecos(tr.state, opts.label, opts.onClick);
      }
      return decos.map(tr.changes);
    },
    provide: f => EditorView.decorations.from(f),
  });

  const vp = ViewPlugin.fromClass(class {
    constructor(_v: EditorView) {}
    update(_u: ViewUpdate) {}
  });

  return [vp, field];
}

class HzSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HeadingZoomInlinePlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Heading Zoom Inline" });

    new Setting(containerEl)
      .setName("Button label")
      .setDesc("Text or emoji shown next to headings.")
      .addText(t => t
        .setPlaceholder("+")
        .setValue(this.plugin.settings.buttonLabel)
        .onChange(async v => {
          this.plugin.settings.buttonLabel = v || "+";
          await this.plugin.saveSettings();
        })
      );
  }
}
