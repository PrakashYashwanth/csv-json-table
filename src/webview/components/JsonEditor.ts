/* global require, monaco */

/**
 * Match the original extension: Monaco from CDN with a stable editor instance
 * (no dispose on every close), proper workers for JSON + line numbers, vs-dark theme.
 */
const MONACO_VERSION = "0.45.0";
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`;

type MonacoEditor = {
  getValue(): string;
  setValue(v: string): void;
  focus(): void;
  dispose(): void;
  layout(): void;
  addCommand(id: number, handler: () => void): void;
};

type ITextModel = {
  getValue(): string;
  onDidChangeContent(listener: () => void): { dispose(): void };
};

type MonacoEditorWithModel = MonacoEditor & {
  getModel(): ITextModel | null;
};

type MonacoNS = {
  MarkerSeverity: { Error: number };
  editor: {
    create(el: HTMLElement, opts: Record<string, unknown>): MonacoEditor;
    setTheme(theme: string): void;
    setModelMarkers(
      model: unknown,
      owner: string,
      markers: Array<{
        severity: number;
        message: string;
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      }>,
    ): void;
  };
  languages: {
    json: {
      jsonDefaults: {
        setDiagnosticsOptions(opts: Record<string, unknown>): void;
      };
    };
  };
  KeyCode: { Escape: number; Enter: number; KeyS: number };
  KeyMod: { CtrlCmd: number };
};

function ensureMonacoEnvironment(): void {
  const g = globalThis as unknown as {
    MonacoEnvironment?: { getWorkerUrl?: (moduleId: string, label: string) => string };
  };
  if (g.MonacoEnvironment?.getWorkerUrl) return;
  g.MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, label: string) {
      const base = `${MONACO_BASE}/vs`;
      if (label === "json") {
        return `${base}/language/json/json.worker.js`;
      }
      return `${base}/editor/editor.worker.js`;
    },
  };
}

function resolveMonacoTheme(): "vs-dark" | "vs" | "hc-black" {
  const body = document.body;
  if (body.classList.contains("vscode-high-contrast-light")) {
    return "vs";
  }
  if (body.classList.contains("vscode-high-contrast")) {
    return "hc-black";
  }
  if (body.classList.contains("vscode-dark")) {
    return "vs-dark";
  }
  if (body.classList.contains("vscode-light")) {
    return "vs";
  }
  const bg = getComputedStyle(body)
    .getPropertyValue("--vscode-editor-background")
    .trim();
  return isDarkBackground(bg) ? "vs-dark" : "vs";
}

function isDarkBackground(color: string): boolean {
  if (!color) return true;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }
  return true;
}

function readEditorFont(): { family: string; size: number } {
  const cs = getComputedStyle(document.body);
  const family = cs.getPropertyValue("--vscode-editor-font-family").trim();
  const sizeStr = cs.getPropertyValue("--vscode-editor-font-size").trim();
  const size = parseFloat(sizeStr) || 13;
  return {
    family: family || "Menlo, Monaco, 'Courier New', monospace",
    size,
  };
}

export interface JsonEditorCallbacks {
  onApply: () => boolean;
  onCancel: () => void;
  onSaveFile: () => void;
}

const JSON_MARKER_OWNER = "cvt-json-parse";

export class JsonEditor {
  private editor: MonacoEditor | null = null;
  private monacoReady = false;
  private callbacks: JsonEditorCallbacks | null = null;
  private jsonMarkerSub: { dispose(): void } | null = null;
  private jsonMarkerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: HTMLElement) {}

  private clearJsonMarkerTimer(): void {
    if (this.jsonMarkerTimer !== null) {
      clearTimeout(this.jsonMarkerTimer);
      this.jsonMarkerTimer = null;
    }
  }

  private syncJsonParseMarkers(monaco: MonacoNS, model: ITextModel): void {
    monaco.editor.setModelMarkers(model, JSON_MARKER_OWNER, []);
    const text = model.getValue();
    if (text.trim() === "") return;
    try {
      JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lines = text.split("\n");
      const endLine = Math.max(1, lines.length);
      const lastLine = lines[endLine - 1] ?? "";
      const endCol = Math.max(1, lastLine.length + 1);
      monaco.editor.setModelMarkers(model, JSON_MARKER_OWNER, [
        {
          severity: monaco.MarkerSeverity.Error,
          message: msg,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: endLine,
          endColumn: endCol,
        },
      ]);
    }
  }

  private wireJsonValidation(monaco: MonacoNS): void {
    // Worker-backed validation can be silent in some webviews; we surface errors via
    // JSON_MARKER_OWNER + setModelMarkers (squiggles + Problems-style message on hover).
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: false,
      allowComments: false,
      trailingCommas: "error",
      enableSchemaRequest: false,
      schemaRequest: "ignore",
      schemas: [],
    });

    const ed = this.editor as MonacoEditorWithModel | null;
    const model = ed?.getModel?.() ?? null;
    if (!model) return;

    this.jsonMarkerSub?.dispose();
    this.jsonMarkerSub = model.onDidChangeContent(() => {
      this.clearJsonMarkerTimer();
      this.jsonMarkerTimer = window.setTimeout(() => {
        this.jsonMarkerTimer = null;
        this.syncJsonParseMarkers(monaco, model);
      }, 120);
    });
    this.syncJsonParseMarkers(monaco, model);
  }

  open(initialValue: string, callbacks: JsonEditorCallbacks): void {
    this.callbacks = callbacks;
    ensureMonacoEnvironment();

    const run = (): void => {
      const monacoNs = (globalThis as unknown as { monaco: MonacoNS }).monaco;
      const theme = resolveMonacoTheme();
      monacoNs.editor.setTheme(theme);

      const { family, size } = readEditorFont();

      if (!this.editor) {
        this.editor = monacoNs.editor.create(this.host, {
          value: initialValue,
          language: "json",
          theme,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: family,
          fontSize: size,
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          glyphMargin: true,
          folding: true,
          scrollBeyondLastLine: false,
          wordWrap: "off",
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: false,
          renderLineHighlight: "line",
          renderValidationDecorations: "on",
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          padding: { top: 8, bottom: 8 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          formatOnPaste: false,
          formatOnType: false,
        });

        this.editor.addCommand(monacoNs.KeyCode.Escape, () => {
          this.callbacks?.onCancel();
        });
        this.editor.addCommand(
          monacoNs.KeyMod.CtrlCmd | monacoNs.KeyCode.Enter,
          () => {
            this.callbacks?.onApply();
          },
        );
        this.editor.addCommand(
          monacoNs.KeyMod.CtrlCmd | monacoNs.KeyCode.KeyS,
          () => {
            this.callbacks?.onSaveFile();
          },
        );
        this.wireJsonValidation(monacoNs);
      } else {
        this.editor.setValue(initialValue);
        this.editor.focus();
        const model = (this.editor as MonacoEditorWithModel).getModel?.();
        if (model) {
          this.syncJsonParseMarkers(monacoNs, model);
        }
      }

      requestAnimationFrame(() => {
        this.editor?.layout();
        requestAnimationFrame(() => this.editor?.layout());
      });
    };

    if (this.monacoReady) {
      setTimeout(run, 0);
      return;
    }

    const req = (
      globalThis as unknown as {
        require: {
          config(c: { paths: Record<string, string> }): void;
          (deps: string[], cb: () => void): void;
        };
      }
    ).require;
    req.config({ paths: { vs: `${MONACO_BASE}/vs` } });
    req(["vs/editor/editor.main"], () => {
      this.monacoReady = true;
      run();
    });
  }

  /** Call when the overlay becomes visible so the editor measures correctly. */
  layout(): void {
    this.editor?.layout();
  }

  getValue(): string {
    return this.editor?.getValue() ?? "";
  }

  focus(): void {
    this.editor?.focus();
  }

  /** Hide JSON overlay — keep the editor instance (same as original “reuse” path). */
  hide(): void {
    this.editor?.layout();
  }

  dispose(): void {
    this.jsonMarkerSub?.dispose();
    this.jsonMarkerSub = null;
    this.clearJsonMarkerTimer();
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    this.callbacks = null;
  }
}
