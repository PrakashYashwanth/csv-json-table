// src/webview/components/JsonEditor.ts
var MONACO_VERSION = "0.45.0";
var MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`;
function ensureMonacoEnvironment() {
  const g = globalThis;
  if (g.MonacoEnvironment?.getWorkerUrl) return;
  g.MonacoEnvironment = {
    getWorkerUrl(_moduleId, label) {
      const base = `${MONACO_BASE}/vs`;
      if (label === "json") {
        return `${base}/language/json/json.worker.js`;
      }
      return `${base}/editor/editor.worker.js`;
    }
  };
}
function resolveMonacoTheme() {
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
  const bg = getComputedStyle(body).getPropertyValue("--vscode-editor-background").trim();
  return isDarkBackground(bg) ? "vs-dark" : "vs";
}
function isDarkBackground(color) {
  if (!color) return true;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = n >> 16 & 255;
    const g = n >> 8 & 255;
    const b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1e3 < 128;
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    return (r * 299 + g * 587 + b * 114) / 1e3 < 128;
  }
  return true;
}
function readEditorFont() {
  const cs = getComputedStyle(document.body);
  const family = cs.getPropertyValue("--vscode-editor-font-family").trim();
  const sizeStr = cs.getPropertyValue("--vscode-editor-font-size").trim();
  const size = parseFloat(sizeStr) || 13;
  return {
    family: family || "Menlo, Monaco, 'Courier New', monospace",
    size
  };
}
var JSON_MARKER_OWNER = "cvt-json-parse";
var JsonEditor = class {
  constructor(host) {
    this.host = host;
    this.editor = null;
    this.monacoReady = false;
    this.callbacks = null;
    this.jsonMarkerSub = null;
    this.jsonMarkerTimer = null;
  }
  clearJsonMarkerTimer() {
    if (this.jsonMarkerTimer !== null) {
      clearTimeout(this.jsonMarkerTimer);
      this.jsonMarkerTimer = null;
    }
  }
  syncJsonParseMarkers(monaco, model2) {
    monaco.editor.setModelMarkers(model2, JSON_MARKER_OWNER, []);
    const text = model2.getValue();
    if (text.trim() === "") return;
    try {
      JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lines = text.split("\n");
      const endLine = Math.max(1, lines.length);
      const lastLine = lines[endLine - 1] ?? "";
      const endCol = Math.max(1, lastLine.length + 1);
      monaco.editor.setModelMarkers(model2, JSON_MARKER_OWNER, [
        {
          severity: monaco.MarkerSeverity.Error,
          message: msg,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: endLine,
          endColumn: endCol
        }
      ]);
    }
  }
  wireJsonValidation(monaco) {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: false,
      allowComments: false,
      trailingCommas: "error",
      enableSchemaRequest: false,
      schemaRequest: "ignore",
      schemas: []
    });
    const ed = this.editor;
    const model2 = ed?.getModel?.() ?? null;
    if (!model2) return;
    this.jsonMarkerSub?.dispose();
    this.jsonMarkerSub = model2.onDidChangeContent(() => {
      this.clearJsonMarkerTimer();
      this.jsonMarkerTimer = window.setTimeout(() => {
        this.jsonMarkerTimer = null;
        this.syncJsonParseMarkers(monaco, model2);
      }, 120);
    });
    this.syncJsonParseMarkers(monaco, model2);
  }
  open(initialValue, callbacks) {
    this.callbacks = callbacks;
    ensureMonacoEnvironment();
    const run = () => {
      const monacoNs = globalThis.monaco;
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
            horizontalScrollbarSize: 10
          },
          padding: { top: 8, bottom: 8 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          formatOnPaste: false,
          formatOnType: false
        });
        this.editor.addCommand(monacoNs.KeyCode.Escape, () => {
          this.callbacks?.onCancel();
        });
        this.editor.addCommand(
          monacoNs.KeyMod.CtrlCmd | monacoNs.KeyCode.Enter,
          () => {
            this.callbacks?.onApply();
          }
        );
        this.editor.addCommand(
          monacoNs.KeyMod.CtrlCmd | monacoNs.KeyCode.KeyS,
          () => {
            this.callbacks?.onSaveFile();
          }
        );
        this.wireJsonValidation(monacoNs);
      } else {
        this.editor.setValue(initialValue);
        this.editor.focus();
        const model2 = this.editor.getModel?.();
        if (model2) {
          this.syncJsonParseMarkers(monacoNs, model2);
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
    const req = globalThis.require;
    req.config({ paths: { vs: `${MONACO_BASE}/vs` } });
    req(["vs/editor/editor.main"], () => {
      this.monacoReady = true;
      run();
    });
  }
  /** Call when the overlay becomes visible so the editor measures correctly. */
  layout() {
    this.editor?.layout();
  }
  getValue() {
    return this.editor?.getValue() ?? "";
  }
  focus() {
    this.editor?.focus();
  }
  /** Hide JSON overlay — keep the editor instance (same as original “reuse” path). */
  hide() {
    this.editor?.layout();
  }
  dispose() {
    this.jsonMarkerSub?.dispose();
    this.jsonMarkerSub = null;
    this.clearJsonMarkerTimer();
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    this.callbacks = null;
  }
};

// src/webview/components/VirtualTable.ts
var ROW_HEIGHT = 28;
var BUFFER = 8;
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var VirtualTable = class _VirtualTable {
  constructor(headerHost2, bodyScroll2, virtualInner2, virtTableWrap2, model2, handlers) {
    this.headerHost = headerHost2;
    this.bodyScroll = bodyScroll2;
    this.virtualInner = virtualInner2;
    this.virtTableWrap = virtTableWrap2;
    this.model = model2;
    this.handlers = handlers;
    this.scrollRaf = 0;
    this.scrollSyncLock = false;
    this.resizeState = null;
    this.geomRaf = 0;
    /** Fallback when webview omits click.detail === 2 / dblclick (Electron). */
    this.lastCellClick = null;
    this.menuForCol = null;
    this.boundResizeMove = this.onResizePointerMove.bind(this);
    this.boundResizeUp = this.onResizePointerUp.bind(this);
    this.boundDocPointerDown = this.onDocumentPointerDown.bind(this);
    this.boundMenuKeydown = this.onDocumentKeydownMenu.bind(this);
    this.colMenu = document.createElement("div");
    this.colMenu.className = "cvt-col-menu";
    this.colMenu.setAttribute("role", "menu");
    this.colMenu.hidden = true;
    this.colMenu.innerHTML = "<button type='button' class='cvt-col-menu-item' role='menuitem' data-sort-act='asc'>Sort ascending</button><button type='button' class='cvt-col-menu-item' role='menuitem' data-sort-act='desc'>Sort descending</button><button type='button' class='cvt-col-menu-item' role='menuitem' data-sort-act='clear'>Clear sort</button>";
    document.body.appendChild(this.colMenu);
    this.colMenu.addEventListener("click", (ev) => {
      const t = ev.target.closest(
        "[data-sort-act]"
      );
      if (!t) return;
      ev.preventDefault();
      ev.stopPropagation();
      const act = t.dataset.sortAct;
      const col = this.menuForCol;
      this.closeColMenu();
      if (col === null) return;
      if (act === "asc") this.handlers.onSortAscending(col);
      else if (act === "desc") this.handlers.onSortDescending(col);
      else if (act === "clear") this.handlers.onSortClear();
    });
    document.addEventListener("pointerdown", this.boundDocPointerDown, true);
    document.addEventListener("keydown", this.boundMenuKeydown, true);
    this.bodyScroll.addEventListener(
      "scroll",
      () => {
        this.syncHorizontalScrollFromBody();
        this.scheduleBodyRender();
      },
      { passive: true }
    );
    this.headerHost.addEventListener(
      "scroll",
      () => this.syncHorizontalScrollFromHeader(),
      { passive: true }
    );
    this.virtTableWrap.addEventListener(
      "click",
      (e) => this.onBodyClick(e)
    );
    this.headerHost.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    this.headerHost.addEventListener("drop", (e) => this.onHeaderDrop(e));
  }
  static {
    this.DOUBLE_CLICK_MS = 450;
  }
  closeColMenu() {
    this.colMenu.hidden = true;
    this.menuForCol = null;
  }
  openColMenu(displayCol, anchor) {
    this.menuForCol = displayCol;
    const rect = anchor.getBoundingClientRect();
    const mw = 200;
    this.colMenu.style.position = "fixed";
    this.colMenu.style.minWidth = `${mw}px`;
    this.colMenu.hidden = false;
    let left = rect.right - mw;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = rect.bottom + 4;
    const mh = this.colMenu.getBoundingClientRect().height;
    if (top + mh > window.innerHeight - 8) {
      top = Math.max(8, rect.top - mh - 4);
    }
    this.colMenu.style.left = `${left}px`;
    this.colMenu.style.top = `${top}px`;
    const first = this.colMenu.querySelector(
      "button"
    );
    first?.focus();
  }
  onDocumentPointerDown(e) {
    if (this.colMenu.hidden) return;
    const t = e.target;
    if (this.colMenu.contains(t)) return;
    if (t.closest?.(".col-menu-trigger")) return;
    this.closeColMenu();
  }
  onDocumentKeydownMenu(e) {
    const ke = e;
    if (this.colMenu.hidden || ke.key !== "Escape") return;
    ke.preventDefault();
    ke.stopPropagation();
    this.closeColMenu();
  }
  fullRender() {
    this.renderHeader();
    this.renderBody();
  }
  scheduleBodyRender() {
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.renderBody();
    });
  }
  syncHorizontalScrollFromBody() {
    if (this.scrollSyncLock) return;
    this.scrollSyncLock = true;
    if (this.headerHost.scrollLeft !== this.bodyScroll.scrollLeft) {
      this.headerHost.scrollLeft = this.bodyScroll.scrollLeft;
    }
    this.scrollSyncLock = false;
  }
  syncHorizontalScrollFromHeader() {
    if (this.scrollSyncLock) return;
    this.scrollSyncLock = true;
    if (this.bodyScroll.scrollLeft !== this.headerHost.scrollLeft) {
      this.bodyScroll.scrollLeft = this.headerHost.scrollLeft;
    }
    this.scrollSyncLock = false;
  }
  colgroupHtml() {
    const { columnWidths, displayOrder } = this.model;
    let html = "<colgroup>";
    for (let d = 0; d < displayOrder.length; d++) {
      const w = columnWidths[d] ?? 120;
      html += `<col style='width:${w}px;min-width:${w}px'>`;
    }
    html += "</colgroup>";
    return html;
  }
  tableWidthStyle() {
    const sum = this.model.columnWidths.reduce((a, b) => a + b, 0);
    return sum > 0 ? `width:${sum}px;min-width:${sum}px` : "";
  }
  frozenCellStyle(displayCol, layer, headerRow = "label") {
    const { freezeCount, columnWidths } = this.model;
    const parts = [];
    if (displayCol < freezeCount) {
      let left = 0;
      for (let d = 0; d < displayCol; d++) {
        left += columnWidths[d] ?? 0;
      }
      const z = layer === "header" ? 52 + displayCol : 42 + displayCol;
      parts.push(`position:sticky;left:${left}px;z-index:${z}`);
      if (layer === "body") {
        parts.push("background:var(--vscode-editor-background)");
      } else if (headerRow === "filter") {
        parts.push("background:var(--vscode-editor-background)");
      } else {
        parts.push(
          "background:var(--vscode-sideBarSectionHeader-background,var(--vscode-editorWidget-background))"
        );
      }
    }
    return parts.length ? ` style='${parts.join(";")}'` : "";
  }
  renderHeader() {
    this.closeColMenu();
    const { header, sortState, filterByDisplay, jsonColumns, displayOrder } = this.model;
    const n = displayOrder.length;
    const { freezeCount } = this.model;
    let html = `<table class='cvt-header-table' style='${this.tableWidthStyle()}'>`;
    html += this.colgroupHtml();
    html += "<thead><tr>";
    for (let d = 0; d < n; d++) {
      const phys = displayOrder[d];
      const h = header[phys] ?? "";
      let indicator = "";
      if (sortState.column === d) {
        indicator = sortState.direction === "asc" ? " \u25B2" : " \u25BC";
      }
      const fz = this.frozenCellStyle(d, "header", "label");
      const thClass = d < freezeCount ? "cvt-th cvt-frozen" : "cvt-th cvt-scroll-col";
      html += `<th${fz} data-col='${d}' class='${thClass}'>`;
      html += `<div class='cvt-th-inner'>`;
      html += `<span class='col-drag-handle' draggable='true' data-col='${d}' title='Drag to reorder'>\u283F</span>`;
      html += `<span class='cvt-th-label-cell'><span class='cvt-th-label'>${escapeHtml(h)}${escapeHtml(indicator)}</span></span>`;
      html += `<button type='button' class='col-menu-trigger' data-col='${d}' aria-haspopup='menu' aria-label='Sort column' title='Sort options'>&#8942;</button>`;
      html += `</div>`;
      html += `<div class='resize-handle' data-col='${d}'></div></th>`;
    }
    html += "</tr><tr class='filter-row'>";
    for (let d = 0; d < n; d++) {
      const phys = displayOrder[d];
      const fz = this.frozenCellStyle(d, "header", "filter");
      const fClass = d < freezeCount ? "cvt-filter-td cvt-frozen" : "cvt-filter-td cvt-scroll-col";
      if (jsonColumns.has(phys)) {
        html += `<td${fz} data-col='${d}' class='${fClass}'></td>`;
      } else {
        const val = filterByDisplay[d] ?? "";
        html += `<td${fz} data-col='${d}' class='${fClass}'><input class='filter-input' data-col='${d}' value='${escapeHtml(val)}'></td>`;
      }
    }
    html += "</tr></thead></table>";
    const bodyLeft = this.bodyScroll.scrollLeft;
    this.headerHost.innerHTML = html;
    this.headerHost.scrollLeft = bodyLeft;
    this.headerHost.querySelectorAll(".cvt-th-label").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.handlers.interactionLocked()) return;
        const th = el.closest(".cvt-th");
        const ev = e;
        if (ev.altKey && ev.shiftKey) {
          this.model.setFreezeCount(0);
          return;
        }
        if (ev.altKey) {
          const c = parseInt(th.dataset.col ?? "0", 10);
          this.model.setFreezeCount(c + 1);
          return;
        }
      });
    });
    this.headerHost.querySelectorAll(".col-menu-trigger").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.handlers.interactionLocked()) return;
        const col = parseInt(btn.dataset.col ?? "0", 10);
        const open = this.menuForCol === col && !this.colMenu.hidden;
        if (open) this.closeColMenu();
        else this.openColMenu(col, btn);
      });
    });
    this.headerHost.querySelectorAll(".col-drag-handle").forEach((el) => {
      el.addEventListener("dragstart", (ev) => {
        const e = ev;
        const d = parseInt(el.dataset.col ?? "0", 10);
        e.dataTransfer?.setData("application/x-cvt-col", String(d));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
    });
    this.headerHost.querySelectorAll(".resize-handle").forEach((h) => {
      h.addEventListener("pointerdown", (ev) => {
        const e = ev;
        e.preventDefault();
        e.stopPropagation();
        if (this.handlers.interactionLocked()) return;
        const displayCol = parseInt(h.dataset.col ?? "0", 10);
        const w = this.model.columnWidths[displayCol] ?? 120;
        this.resizeState = { displayCol, startX: e.clientX, startW: w };
        window.addEventListener("pointermove", this.boundResizeMove);
        window.addEventListener("pointerup", this.boundResizeUp);
        h.setPointerCapture(e.pointerId);
      });
    });
    this.headerHost.querySelectorAll(".filter-input").forEach((input) => {
      const el = input;
      const col = parseInt(el.dataset.col ?? "0", 10);
      el.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          this.handlers.onFilterCommit(col, el.value);
        }
      });
    });
  }
  onResizePointerMove(e) {
    if (!this.resizeState) return;
    const dx = e.clientX - this.resizeState.startX;
    this.model.setColumnWidth(
      this.resizeState.displayCol,
      this.resizeState.startW + dx,
      true
    );
    this.scheduleColumnGeometry();
  }
  scheduleColumnGeometry() {
    if (this.geomRaf) return;
    this.geomRaf = requestAnimationFrame(() => {
      this.geomRaf = 0;
      this.applyColumnGeometries();
    });
  }
  /** Update widths + sticky offsets without rebuilding header (keeps filter focus while resizing). */
  applyColumnGeometries() {
    const w = this.model.columnWidths;
    const freeze = this.model.freezeCount;
    const sum = w.reduce((a, b) => a + b, 0);
    const syncTable = (table) => {
      if (!table) return;
      table.style.width = `${sum}px`;
      table.style.minWidth = `${sum}px`;
      table.querySelectorAll("colgroup col").forEach((col, i) => {
        const px = w[i];
        if (px !== void 0) {
          const el = col;
          el.style.width = `${px}px`;
          el.style.minWidth = `${px}px`;
        }
      });
    };
    syncTable(this.headerHost.querySelector("table"));
    syncTable(this.virtTableWrap.querySelector("table"));
    const applySticky = (el, displayCol) => {
      if (displayCol < freeze) {
        let left = 0;
        for (let i = 0; i < displayCol; i++) left += w[i] ?? 0;
        const inHeader = !!el.closest(".cvt-header-table");
        const inBody = !!el.closest(".cvt-body-table");
        const isFilterTd = el.tagName === "TD" && !!el.closest(".filter-row");
        el.style.position = "sticky";
        el.style.left = `${left}px`;
        el.style.zIndex = String(inHeader ? 52 + displayCol : 42 + displayCol);
        if (inBody) {
          el.style.background = "var(--vscode-editor-background)";
        } else if (isFilterTd) {
          el.style.background = "var(--vscode-editor-background)";
        } else if (el.tagName === "TH") {
          el.style.background = "var(--vscode-sideBarSectionHeader-background,var(--vscode-editorWidget-background))";
        }
      } else {
        el.style.position = "";
        el.style.left = "";
        el.style.zIndex = "";
        el.style.background = "";
      }
    };
    this.headerHost.querySelectorAll("[data-col]").forEach((node) => {
      const el = node;
      if (el.classList.contains("resize-handle")) return;
      if (el.classList.contains("col-drag-handle")) return;
      if (el.classList.contains("col-menu-trigger")) return;
      if (el.classList.contains("filter-input")) return;
      const d = parseInt(el.dataset.col ?? "0", 10);
      applySticky(el, d);
    });
    this.virtTableWrap.querySelectorAll("td[data-col]").forEach((node) => {
      const td = node;
      applySticky(td, parseInt(td.dataset.col ?? "0", 10));
    });
  }
  onResizePointerUp() {
    window.removeEventListener("pointermove", this.boundResizeMove);
    window.removeEventListener("pointerup", this.boundResizeUp);
    if (this.geomRaf) {
      cancelAnimationFrame(this.geomRaf);
      this.geomRaf = 0;
    }
    const didResize = this.resizeState !== null;
    this.resizeState = null;
    if (didResize) this.model.notifyChange();
  }
  onHeaderDrop(e) {
    e.preventDefault();
    const raw = e.dataTransfer?.getData("application/x-cvt-col");
    if (raw === void 0 || raw === "") return;
    const from = parseInt(raw, 10);
    const target = e.target.closest(
      "[data-col]"
    );
    if (!target) return;
    const to = parseInt(target.dataset.col ?? "0", 10);
    if (from === to || Number.isNaN(from) || Number.isNaN(to)) return;
    this.model.moveDisplayColumn(from, to);
  }
  renderBody() {
    const n = this.model.filteredRows.length;
    const totalHeight = Math.max(n * ROW_HEIGHT, 0);
    this.virtualInner.style.height = `${totalHeight}px`;
    const st = this.bodyScroll.scrollTop;
    const ch = this.bodyScroll.clientHeight || 1;
    const start = Math.max(0, Math.floor(st / ROW_HEIGHT) - BUFFER);
    const end = Math.min(n, Math.ceil((st + ch) / ROW_HEIGHT) + BUFFER);
    const offsetY = start * ROW_HEIGHT;
    this.virtTableWrap.style.top = `${offsetY}px`;
    const { displayOrder, jsonColumns, selectedRow, selectedCol, freezeCount } = this.model;
    let bodyInner = `<table class='cvt-body-table' style='${this.tableWidthStyle()}'>`;
    bodyInner += this.colgroupHtml();
    bodyInner += "<tbody>";
    for (let r = start; r < end; r++) {
      const row = this.model.filteredRows[r];
      if (!row) continue;
      bodyInner += "<tr>";
      for (let d = 0; d < displayOrder.length; d++) {
        const phys = displayOrder[d];
        const cell = row[phys] ?? "";
        const display = jsonColumns.has(phys) ? this.model.jsonPreview(cell) : cell;
        const isSel = r === selectedRow && d === selectedCol;
        const sel = isSel ? "selected" : "";
        const fr = d < freezeCount ? "cvt-frozen" : "cvt-scroll-col";
        const tab = isSel ? "0" : "-1";
        const fz = this.frozenCellStyle(d, "body");
        const cls = [sel, fr].filter(Boolean).join(" ");
        bodyInner += `<td class='${cls}'${fz} data-row='${r}' data-col='${d}' tabindex='${tab}'>${escapeHtml(display)}</td>`;
      }
      bodyInner += "</tr>";
    }
    bodyInner += "</tbody></table>";
    this.virtTableWrap.innerHTML = bodyInner;
  }
  onBodyClick(e) {
    if (this.handlers.interactionLocked()) return;
    const td = e.target.closest(
      "td[data-row][data-col]"
    );
    if (!td || td.querySelector("input.cellEdit")) return;
    const r = parseInt(td.dataset.row ?? "0", 10);
    const c = parseInt(td.dataset.col ?? "0", 10);
    const now = Date.now();
    if (e.detail === 2) {
      this.lastCellClick = null;
      e.preventDefault();
      this.handlers.onEditCell(r, c);
      return;
    }
    const isTimedDouble = this.lastCellClick !== null && this.lastCellClick.r === r && this.lastCellClick.c === c && now - this.lastCellClick.t < _VirtualTable.DOUBLE_CLICK_MS;
    if (isTimedDouble) {
      e.preventDefault();
      this.lastCellClick = null;
      this.handlers.onEditCell(r, c);
      return;
    }
    this.lastCellClick = { r, c, t: now };
    this.handlers.onSelectCell(r, c);
  }
  /**
   * Update .selected + tabindex on visible cells only — do not replace the body DOM.
   * Replacing innerHTML on every click breaks double-click (first click destroyed the target).
   */
  refreshSelection() {
    const sr = this.model.selectedRow;
    const sc = this.model.selectedCol;
    this.virtTableWrap.querySelectorAll("td[data-row][data-col]").forEach((node) => {
      const td = node;
      if (td.querySelector("input.cellEdit")) return;
      const r = parseInt(td.dataset.row ?? "0", 10);
      const c = parseInt(td.dataset.col ?? "0", 10);
      const isSel = r === sr && c === sc;
      td.classList.toggle("selected", isSel);
      td.tabIndex = isSel ? 0 : -1;
    });
  }
};

// src/webview/models/EditorViewModel.ts
var EditorViewModel = class {
  constructor() {
    this.editingRow = null;
    this.editingCol = null;
  }
  clear() {
    this.editingRow = null;
    this.editingCol = null;
  }
  set(r, c) {
    this.editingRow = r;
    this.editingCol = c;
  }
};

// src/shared/jsonColumns.ts
function detectJsonColumnIndices(rows) {
  const jsonColumns = /* @__PURE__ */ new Set();
  for (const row of rows) {
    row.forEach((cell, i) => {
      if (typeof cell !== "string") return;
      const t = cell.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          JSON.parse(t);
          jsonColumns.add(i);
        } catch {
        }
      }
    });
  }
  return jsonColumns;
}

// src/webview/columnSizing.ts
var measureCanvas = null;
function getMeasureContext() {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  return measureCanvas.getContext("2d");
}
function measureTextWidth(text, fontCss) {
  const ctx = getMeasureContext();
  if (!ctx) return text.length * 8;
  ctx.font = fontCss;
  return ctx.measureText(text).width;
}
function fontFromElement(el) {
  const cs = getComputedStyle(el);
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}
function getEditorFontCss() {
  const table = document.createElement("table");
  table.className = "cvt-body-table";
  table.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
  table.innerHTML = "<tbody><tr><td>M</td></tr></tbody>";
  document.body.appendChild(table);
  const td = table.querySelector("td");
  const font = fontFromElement(td);
  document.body.removeChild(table);
  return font;
}
function getHeaderFontCss() {
  const table = document.createElement("table");
  table.className = "cvt-header-table";
  table.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
  table.innerHTML = "<thead><tr><th class='cvt-th'>M</th></tr></thead>";
  document.body.appendChild(table);
  const th = table.querySelector("th");
  const font = fontFromElement(th);
  document.body.removeChild(table);
  return font;
}
function jsonPreviewForMeasure(cell) {
  try {
    const obj = JSON.parse(cell);
    const keys = Object.keys(obj).slice(0, 3);
    return `{${keys.join(",")}}`;
  } catch {
    return "JSON";
  }
}
function computeAutoColumnWidths(opts) {
  const n = opts.displayOrder.length;
  const widths = new Array(n);
  const sample = Math.min(opts.rows.length, opts.sampleMaxRows);
  const pad = opts.cellPaddingExtra;
  const sortReservePx = measureTextWidth(" \u25BC", opts.headerFontCss);
  const chrome = opts.headerChromeExtraPx;
  for (let d = 0; d < n; d++) {
    const phys = opts.displayOrder[d];
    const title = opts.header[phys] ?? "";
    let headerPx = measureTextWidth(title, opts.headerFontCss) + sortReservePx + chrome;
    let maxPx = headerPx;
    for (let r = 0; r < sample; r++) {
      const row = opts.rows[r];
      if (!row) continue;
      const raw = row[phys] ?? "";
      const shown = opts.jsonColumns.has(phys) ? jsonPreviewForMeasure(raw) : raw;
      maxPx = Math.max(maxPx, measureTextWidth(shown, opts.cellFontCss) + pad);
    }
    const w = Math.ceil(maxPx);
    widths[d] = Math.min(opts.maxWidth, Math.max(opts.minWidth, w));
  }
  return widths;
}

// src/webview/models/TableViewModel.ts
var MIN_COL_WIDTH = 48;
var MAX_COL_WIDTH = 640;
var AUTO_SAMPLE_ROWS = 500;
function isValidDisplayOrderPermutation(order, n) {
  if (order.length !== n) return false;
  const seen = /* @__PURE__ */ new Set();
  for (const x of order) {
    if (!Number.isInteger(x) || x < 0 || x >= n || seen.has(x)) return false;
    seen.add(x);
  }
  return seen.size === n;
}
function mapIndexAfterColumnMove(i, from, to) {
  if (i === from) return to;
  if (from < to) {
    if (i > from && i <= to) return i - 1;
  } else if (from > to) {
    if (i >= to && i < from) return i + 1;
  }
  return i;
}
var TableViewModel = class {
  constructor() {
    this.header = [];
    this.rows = [];
    this.filteredRows = [];
    /** Display column d shows physical column `displayOrder[d]`. */
    this.displayOrder = [];
    /** Pixel width per display column. */
    this.columnWidths = [];
    /** Filter text per display column (substring match on physical cell). */
    this.filterByDisplay = [];
    /** First `freezeCount` display columns use sticky positioning when scrolling. */
    this.freezeCount = 0;
    this.sortState = { column: null, direction: null };
    this.jsonColumns = /* @__PURE__ */ new Set();
    this.rowIdentityMap = /* @__PURE__ */ new Map();
    this.selectedRow = 0;
    this.selectedCol = 0;
    this.undoStack = [];
    this.redoStack = [];
  }
  setOnChange(cb) {
    this.onChange = cb;
  }
  clearHistory() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
  /** Physical column index for the cell shown at display column `d`. */
  physicalCol(d) {
    return this.displayOrder[d] ?? d;
  }
  /** Raw cell value in filtered view (rows are stored in physical column order). */
  cellAtFiltered(filteredRow, displayCol) {
    const row = this.filteredRows[filteredRow];
    if (!row) return "";
    return row[this.physicalCol(displayCol)] ?? "";
  }
  applyAutoColumnWidths() {
    const n = this.header.length;
    if (n === 0) {
      this.columnWidths = [];
      return;
    }
    this.columnWidths = computeAutoColumnWidths({
      header: this.header,
      rows: this.rows,
      displayOrder: this.displayOrder,
      jsonColumns: this.jsonColumns,
      sampleMaxRows: AUTO_SAMPLE_ROWS,
      cellFontCss: getEditorFontCss(),
      headerFontCss: getHeaderFontCss(),
      minWidth: MIN_COL_WIDTH,
      maxWidth: MAX_COL_WIDTH,
      cellPaddingExtra: 28,
      /** Drag grip + resize strip + th padding — must fit full header row. */
      headerChromeExtraPx: 88
    });
  }
  /**
   * @param silent - if true, do not notify (use while dragging; call `notifyChange()` after).
   */
  setColumnWidth(displayCol, widthPx, silent = false) {
    if (displayCol < 0 || displayCol >= this.columnWidths.length) return;
    const w = Math.min(
      MAX_COL_WIDTH,
      Math.max(MIN_COL_WIDTH, Math.round(widthPx))
    );
    if (this.columnWidths[displayCol] === w) return;
    this.columnWidths[displayCol] = w;
    if (!silent) this.onChange?.();
  }
  notifyChange() {
    this.onChange?.();
  }
  moveDisplayColumn(from, to) {
    const n = this.displayOrder.length;
    if (n === 0 || from === to || from < 0 || to < 0 || from >= n || to >= n) {
      return;
    }
    const move = (arr) => {
      const [x] = arr.splice(from, 1);
      arr.splice(to, 0, x);
    };
    move(this.displayOrder);
    move(this.columnWidths);
    move(this.filterByDisplay);
    if (this.sortState.column !== null) {
      this.sortState = {
        column: mapIndexAfterColumnMove(this.sortState.column, from, to),
        direction: this.sortState.direction
      };
    }
    this.selectedCol = mapIndexAfterColumnMove(this.selectedCol, from, to);
    this.pipeline();
  }
  setFreezeCount(count) {
    const n = this.header.length;
    const c = Math.max(0, Math.min(n, Math.floor(count)));
    if (this.freezeCount === c) return;
    this.freezeCount = c;
    this.onChange?.();
  }
  headersMatch(a, b) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  /**
   * Replace row data from disk while keeping filters, sort, column order, widths, and freeze
   * when the header row is unchanged (typical after Save).
   * Returns false if the CSV shape/header changed — caller should full `initialize()` instead.
   */
  applyReloadKeepingUi(csv) {
    const parsed = Papa.parse(csv.trim(), { skipEmptyLines: false });
    const data = parsed.data;
    if (data.length === 0) return false;
    const newHeader = data[0].map((c) => String(c ?? ""));
    if (!this.headersMatch(this.header, newHeader)) return false;
    const savedFilters = [...this.filterByDisplay];
    const savedOrder = [...this.displayOrder];
    const savedWidths = [...this.columnWidths];
    const savedSort = { ...this.sortState };
    const savedFreeze = this.freezeCount;
    const newRows = data.slice(1).map((r) => r.map((c) => String(c ?? "")));
    this.header = newHeader;
    this.rows = newRows;
    this.jsonColumns.clear();
    for (const i of detectJsonColumnIndices(this.rows)) {
      this.jsonColumns.add(i);
    }
    const n = this.header.length;
    if (savedFilters.length === n) {
      this.filterByDisplay = savedFilters;
    } else {
      this.filterByDisplay = new Array(n).fill("");
    }
    if (isValidDisplayOrderPermutation(savedOrder, n)) {
      this.displayOrder = savedOrder;
    } else {
      this.displayOrder = Array.from({ length: n }, (_, i) => i);
    }
    if (savedWidths.length === n) {
      this.columnWidths = savedWidths;
    } else {
      this.applyAutoColumnWidths();
    }
    this.freezeCount = Math.max(0, Math.min(n, savedFreeze));
    if (savedSort.column !== null && savedSort.direction !== null && savedSort.column >= 0 && savedSort.column < n) {
      this.sortState = {
        column: savedSort.column,
        direction: savedSort.direction
      };
    } else {
      this.sortState = { column: null, direction: null };
    }
    this.rebuildIdentityMap();
    this.clearHistory();
    this.pipeline();
    return true;
  }
  initialize(csv) {
    this.sortState = { column: null, direction: null };
    this.freezeCount = 0;
    const parsed = Papa.parse(csv.trim(), { skipEmptyLines: false });
    const data = parsed.data;
    if (data.length === 0) {
      this.header = [];
      this.rows = [];
      this.filteredRows = [];
      this.displayOrder = [];
      this.columnWidths = [];
      this.filterByDisplay = [];
      this.jsonColumns.clear();
    } else {
      this.header = data[0].map((c) => String(c ?? ""));
      this.rows = data.slice(1).map((r) => r.map((c) => String(c ?? "")));
      this.filteredRows = [...this.rows];
      const n = this.header.length;
      this.displayOrder = Array.from({ length: n }, (_, i) => i);
      this.filterByDisplay = new Array(n).fill("");
      this.jsonColumns.clear();
      for (const i of detectJsonColumnIndices(this.rows)) {
        this.jsonColumns.add(i);
      }
      this.applyAutoColumnWidths();
    }
    this.rebuildIdentityMap();
    this.selectedRow = 0;
    this.selectedCol = 0;
    this.clearHistory();
    this.pipeline();
  }
  rebuildIdentityMap() {
    this.rowIdentityMap.clear();
    this.rows.forEach((row, index) => this.rowIdentityMap.set(row, index));
  }
  pipeline() {
    this.applyFilters();
    this.applySort();
    if (this.filteredRows.length === 0) {
      this.selectedRow = 0;
    } else {
      this.selectedRow = Math.min(
        this.selectedRow,
        this.filteredRows.length - 1
      );
    }
    this.onChange?.();
  }
  applyFilters() {
    this.filteredRows = this.rows.filter((row) => {
      for (let d = 0; d < this.displayOrder.length; d++) {
        const term = this.filterByDisplay[d];
        if (!term) continue;
        const phys = this.displayOrder[d];
        const cell = row[phys] ?? "";
        if (!String(cell).toLowerCase().includes(term.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }
  applySort() {
    if (this.sortState.column === null || this.sortState.direction === null) {
      return;
    }
    const d = this.sortState.column;
    const phys = this.displayOrder[d];
    const dir = this.sortState.direction;
    this.filteredRows.sort((a, b) => {
      let A = a[phys] ?? "";
      let B = b[phys] ?? "";
      if (!isNaN(Number(A)) && !isNaN(Number(B))) {
        A = Number(A);
        B = Number(B);
      }
      if (A < B) return dir === "asc" ? -1 : 1;
      if (A > B) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }
  /** `displayCol` is the visible column index. */
  setSortColumn(displayCol, direction) {
    if (displayCol < 0 || displayCol >= this.displayOrder.length) return;
    this.sortState = { column: displayCol, direction };
    this.pipeline();
  }
  clearSort() {
    this.sortState = { column: null, direction: null };
    this.pipeline();
  }
  setFilter(displayCol, value) {
    if (displayCol < 0 || displayCol >= this.filterByDisplay.length) return;
    this.filterByDisplay[displayCol] = value;
    this.pipeline();
  }
  realIndexForFilteredRow(filteredRowIndex) {
    const row = this.filteredRows[filteredRowIndex];
    return row !== void 0 ? this.rowIdentityMap.get(row) : void 0;
  }
  pushHistory(entry) {
    this.undoStack.push(entry);
    this.redoStack.length = 0;
  }
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.rows[entry.rowIndex][entry.colIndex] = entry.oldValue;
    this.pipeline();
    return true;
  }
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.rows[entry.rowIndex][entry.colIndex] = entry.newValue;
    this.pipeline();
    return true;
  }
  setCellFromFiltered(filteredRowIndex, displayCol, newValue) {
    const real = this.realIndexForFilteredRow(filteredRowIndex);
    if (real === void 0) return;
    const phys = this.physicalCol(displayCol);
    const oldValue = this.rows[real][phys];
    if (oldValue === newValue) return;
    this.pushHistory({
      rowIndex: real,
      colIndex: phys,
      oldValue,
      newValue
    });
    this.rows[real][phys] = newValue;
    this.pipeline();
  }
  toCsvString() {
    return Papa.unparse([this.header, ...this.rows]);
  }
  jsonPreview(cell) {
    try {
      const obj = JSON.parse(cell);
      const keys = Object.keys(obj).slice(0, 3);
      return `{${keys.join(",")}}`;
    } catch {
      return "JSON";
    }
  }
  /** Cumulative left offset in px for sticky frozen columns up to (but not including) `displayCol`. */
  stickyLeftOffset(displayCol) {
    let sum = 0;
    for (let d = 0; d < displayCol && d < this.columnWidths.length; d++) {
      sum += this.columnWidths[d] ?? 0;
    }
    return sum;
  }
};

// src/webview/main.ts
var api = acquireVsCodeApi();
var baselineCsv = "";
var isDirty = false;
function setDirty(val) {
  if (isDirty === val) return;
  console.log("[Webview] setDirty:", val);
  isDirty = val;
  api.postMessage({ command: "dirty", isDirty });
}
var model = new TableViewModel();
var editorVm = new EditorViewModel();
var headerHost = document.getElementById("headerHost");
var bodyScroll = document.getElementById("bodyScroll");
bodyScroll.tabIndex = 0;
var tableRoot = document.getElementById("tableRoot");
var virtualInner = document.getElementById("virtualInner");
var virtTableWrap = document.getElementById("virtTable");
var overlay = document.getElementById("editorOverlay");
var monacoHost = document.getElementById("monacoEditor");
var inlineEditing = false;
var gridKeysEnabled = false;
function isTypingTarget(t) {
  if (!t || !t.closest) return false;
  const el = t;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return true;
  if (el.isContentEditable) return true;
  if (el.closest("#monacoEditor")) return true;
  return false;
}
function focusSelectedCellAfterPaint() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const td = virtTableWrap.querySelector(
        "td.selected"
      );
      if (td) td.focus({ preventScroll: true });
      else bodyScroll.focus({ preventScroll: true });
    });
  });
}
tableRoot.addEventListener(
  "mousedown",
  (e) => {
    const el = e.target;
    if (el.closest("input.filter-input") || el.closest("input.cellEdit")) {
      gridKeysEnabled = false;
      return;
    }
    if (el.closest(".resize-handle") || el.closest(".col-drag-handle")) {
      gridKeysEnabled = false;
      return;
    }
    if (el.closest("#virtTable") && el.closest("td[data-row][data-col]")) {
      gridKeysEnabled = true;
      return;
    }
    gridKeysEnabled = false;
  },
  true
);
var jsonEditor = new JsonEditor(monacoHost);
var vtable = new VirtualTable(
  headerHost,
  bodyScroll,
  virtualInner,
  virtTableWrap,
  model,
  {
    onSelectCell(r, c) {
      model.selectedRow = r;
      model.selectedCol = c;
      vtable.refreshSelection();
      gridKeysEnabled = true;
      focusSelectedCellAfterPaint();
    },
    onEditCell(r, c) {
      beginEditAt(r, c);
    },
    onFilterCommit(col, value) {
      model.setFilter(col, value);
    },
    onSortAscending(col) {
      model.setSortColumn(col, "asc");
    },
    onSortDescending(col) {
      model.setSortColumn(col, "desc");
    },
    onSortClear() {
      model.clearSort();
    },
    interactionLocked: () => inlineEditing
  }
);
function beginEditAt(r, c) {
  model.selectedRow = r;
  model.selectedCol = c;
  vtable.refreshSelection();
  editorVm.set(r, c);
  if (model.jsonColumns.has(model.physicalCol(c))) {
    openJsonEditor();
  } else {
    setTimeout(() => inlineEdit(r, c), 0);
  }
}
model.setOnChange(() => vtable.fullRender());
function ensureSelectionVisible() {
  const rows = model.filteredRows.length;
  const cols = model.displayOrder.length;
  if (rows === 0 || cols === 0) return;
  const r = Math.max(0, Math.min(rows - 1, model.selectedRow));
  const c = Math.max(0, Math.min(cols - 1, model.selectedCol));
  const rowTop = r * ROW_HEIGHT;
  const rowBottom = rowTop + ROW_HEIGHT;
  const st = bodyScroll.scrollTop;
  const ch = bodyScroll.clientHeight;
  if (rowTop < st) bodyScroll.scrollTop = rowTop;
  else if (rowBottom > st + ch) bodyScroll.scrollTop = rowBottom - ch;
  let cellLeft = 0;
  for (let i = 0; i < c; i++) cellLeft += model.columnWidths[i] ?? 0;
  const cellRight = cellLeft + (model.columnWidths[c] ?? 0);
  const sl = bodyScroll.scrollLeft;
  const cw = bodyScroll.clientWidth;
  if (cellLeft < sl) bodyScroll.scrollLeft = cellLeft;
  else if (cellRight > sl + cw) bodyScroll.scrollLeft = cellRight - cw;
}
document.addEventListener(
  "keydown",
  (e) => {
    if (inlineEditing || overlay.style.display === "block") return;
    if (!gridKeysEnabled) return;
    if (isTypingTarget(e.target)) return;
    const ae = document.activeElement;
    if (ae && isTypingTarget(ae)) return;
    const onSelectedCell = ae?.matches?.("td.selected") === true && virtTableWrap.contains(ae);
    const onBodyScroller = ae === bodyScroll;
    if (!onSelectedCell && !onBodyScroller) return;
    const rowCount = model.filteredRows.length;
    const colCount = model.displayOrder.length;
    if (rowCount === 0 || colCount === 0) return;
    const k = e.key;
    if (k !== "Enter" && k !== "ArrowUp" && k !== "ArrowDown" && k !== "ArrowLeft" && k !== "ArrowRight") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (k === "Enter") {
      const r = Math.max(0, Math.min(rowCount - 1, model.selectedRow));
      const c = Math.max(0, Math.min(colCount - 1, model.selectedCol));
      beginEditAt(r, c);
      return;
    }
    let dr = 0;
    let dc = 0;
    if (k === "ArrowUp") dr = -1;
    else if (k === "ArrowDown") dr = 1;
    else if (k === "ArrowLeft") dc = -1;
    else if (k === "ArrowRight") dc = 1;
    model.selectedRow = Math.max(
      0,
      Math.min(rowCount - 1, model.selectedRow + dr)
    );
    model.selectedCol = Math.max(
      0,
      Math.min(colCount - 1, model.selectedCol + dc)
    );
    vtable.refreshSelection();
    requestAnimationFrame(() => {
      ensureSelectionVisible();
      requestAnimationFrame(() => {
        const td = virtTableWrap.querySelector(
          "td.selected"
        );
        if (td) td.focus({ preventScroll: true });
        else bodyScroll.focus({ preventScroll: true });
      });
    });
  },
  true
);
function initialize(csv) {
  console.log("[Webview] initialize called, csv length:", csv.length);
  baselineCsv = csv;
  model.initialize(csv);
}
function openJsonEditor() {
  const r = editorVm.editingRow;
  const c = editorVm.editingCol;
  if (r === null || c === null) return;
  let value = model.cellAtFiltered(r, c);
  try {
    value = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
  }
  overlay.style.display = "block";
  jsonEditor.open(value, {
    onApply: () => applyJsonEdit(),
    onCancel: () => closeEditor(),
    onSaveFile: () => save()
  });
  requestAnimationFrame(() => {
    jsonEditor.layout();
    requestAnimationFrame(() => jsonEditor.layout());
  });
}
function applyJsonEdit() {
  const r = editorVm.editingRow;
  const c = editorVm.editingCol;
  if (r === null || c === null) return false;
  try {
    const parsed = JSON.parse(jsonEditor.getValue());
    const valStr = JSON.stringify(parsed);
    model.setCellFromFiltered(r, c, valStr);
    setDirty(true);
    closeEditor();
    return true;
  } catch {
    return false;
  }
}
function closeEditor() {
  overlay.style.display = "none";
  jsonEditor.hide();
  editorVm.clear();
}
function inlineEdit(r, c) {
  if (inlineEditing) return;
  inlineEditing = true;
  const cell = virtTableWrap.querySelector(
    `td[data-row='${r}'][data-col='${c}']`
  );
  if (!cell) {
    inlineEditing = false;
    return;
  }
  const oldValue = model.cellAtFiltered(r, c);
  cell.innerHTML = "<input class='cellEdit'>";
  const input = cell.querySelector("input");
  input.value = oldValue;
  input.focus();
  input.select();
  const commit = () => {
    if (!inlineEditing) return;
    inlineEditing = false;
    const next = input.value;
    if (next !== oldValue) {
      model.setCellFromFiltered(r, c, next);
      setDirty(true);
    } else {
      model.pipeline();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
    }
    if (e.key === "Escape") {
      inlineEditing = false;
      model.pipeline();
    }
  });
  input.addEventListener("blur", () => {
    if (inlineEditing) commit();
  });
}
function save() {
  if (overlay.style.display === "block") {
    if (!applyJsonEdit()) return;
  }
  const newCsv = model.toCsvString();
  api.postMessage({ command: "save", data: newCsv });
  baselineCsv = newCsv;
  setDirty(false);
}
overlay.addEventListener("click", (e) => {
  if (e.target.id === "editorOverlay") {
    closeEditor();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay.style.display === "block") {
    e.preventDefault();
    closeEditor();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    e.preventDefault();
    const changed = e.shiftKey ? model.redo() : model.undo();
    if (changed) setDirty(true);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
});
window.addEventListener("message", (event) => {
  const msg = event.data;
  console.log(
    "[Webview] Received message:",
    msg.command,
    msg.reason,
    "isDirty:",
    isDirty,
    "skipDirtyConfirm:",
    msg.skipDirtyConfirm
  );
  if (msg.command === "reload" && typeof msg.data === "string") {
    console.log(
      "[Webview] Reload - data length:",
      msg.data.length,
      "baseline length:",
      baselineCsv.length,
      "are equal:",
      msg.data === baselineCsv
    );
    const skipConfirm = msg.skipDirtyConfirm === true;
    if (isDirty && msg.data !== baselineCsv && !skipConfirm) {
      console.log("[Webview] Dirty + external data differs \u2014 asking user (legacy path)");
      const shouldReload = confirm(
        "The file changed on disk. Reload and discard your table edits?"
      );
      if (!shouldReload) {
        console.log("[Webview] User chose to keep table edits");
        return;
      }
      console.log("[Webview] User chose to reload from disk");
    }
    if (msg.reason === "save" && model.applyReloadKeepingUi(msg.data)) {
      baselineCsv = msg.data;
    } else {
      initialize(msg.data);
    }
    setDirty(false);
  }
});
api.postMessage({ command: "ready" });
