import type { TableViewModel } from "../models/TableViewModel";

export const ROW_HEIGHT = 28;
const BUFFER = 8;

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface VirtualTableHandlers {
  onSelectCell: (filteredRow: number, col: number) => void;
  onEditCell: (filteredRow: number, col: number) => void;
  onSortAscending: (displayCol: number) => void;
  onSortDescending: (displayCol: number) => void;
  onSortClear: () => void;
  onFilterCommit: (col: number, value: string) => void;
  onAddRow: () => void;
  onToggleRowCheck: (filteredRow: number) => void;
  onDeleteRows: () => void;
  interactionLocked: () => boolean;
}

/**
 * Sticky header + filter row; virtualized body rows for large CSVs.
 * Columns use display order, auto/measured widths, resize, reorder (drag handle), freeze (Alt+click).
 */
export class VirtualTable {
  private scrollRaf = 0;
  private scrollSyncLock = false;
  private resizeState: {
    displayCol: number;
    startX: number;
    startW: number;
  } | null = null;
  private geomRaf = 0;
  private boundResizeMove: (e: PointerEvent) => void;
  private boundResizeUp: (e: PointerEvent) => void;
  /** Fallback when webview omits click.detail === 2 / dblclick (Electron). */
  private lastCellClick: { r: number; c: number; t: number } | null = null;
  private static readonly DOUBLE_CLICK_MS = 450;

  private readonly colMenu: HTMLDivElement;
  private menuForCol: number | null = null;
  private readonly boundDocPointerDown: (e: Event) => void;
  private readonly boundMenuKeydown: (e: Event) => void;

  constructor(
    private readonly headerHost: HTMLElement,
    private readonly bodyScroll: HTMLElement,
    private readonly virtualInner: HTMLElement,
    private readonly virtTableWrap: HTMLElement,
    private readonly model: TableViewModel,
    private readonly handlers: VirtualTableHandlers,
  ) {
    this.boundResizeMove = this.onResizePointerMove.bind(this);
    this.boundResizeUp = this.onResizePointerUp.bind(this);
    this.boundDocPointerDown = this.onDocumentPointerDown.bind(this);
    this.boundMenuKeydown = this.onDocumentKeydownMenu.bind(this);

    this.colMenu = document.createElement("div");
    this.colMenu.className = "cvt-col-menu";
    this.colMenu.setAttribute("role", "menu");
    this.colMenu.hidden = true;
    this.colMenu.innerHTML =
      "<button type='button' class='cvt-col-menu-item' role='menuitem' data-sort-act='asc'>Sort ascending</button>" +
      "<button type='button' class='cvt-col-menu-item' role='menuitem' data-sort-act='desc'>Sort descending</button>" +
      "<button type='button' class='cvt-col-menu-item' role='menuitem' data-sort-act='clear'>Clear sort</button>";
    document.body.appendChild(this.colMenu);
    this.colMenu.addEventListener("click", (ev: Event) => {
      const t = (ev.target as HTMLElement).closest(
        "[data-sort-act]",
      ) as HTMLElement | null;
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
      { passive: true },
    );
    this.headerHost.addEventListener(
      "scroll",
      () => this.syncHorizontalScrollFromHeader(),
      { passive: true },
    );
    this.virtTableWrap.addEventListener("click", (e) =>
      this.onBodyClick(e as MouseEvent),
    );

    this.headerHost.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    });
    this.headerHost.addEventListener("drop", (e) => this.onHeaderDrop(e));

    // Add row button handler
    const addRowBtn = document.getElementById("addRowBtn");
    if (addRowBtn) {
      addRowBtn.addEventListener("click", () => {
        this.handlers.onAddRow();
      });
    }

    // Delete rows button handler
    const deleteRowsBtn = document.getElementById("deleteRowsBtn");
    if (deleteRowsBtn) {
      deleteRowsBtn.addEventListener("click", () => {
        this.handlers.onDeleteRows();
      });
    }
  }

  private closeColMenu(): void {
    this.colMenu.hidden = true;
    this.menuForCol = null;
  }

  private openColMenu(displayCol: number, anchor: HTMLElement): void {
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
      "button",
    ) as HTMLButtonElement | null;
    first?.focus();
  }

  private onDocumentPointerDown(e: Event): void {
    if (this.colMenu.hidden) return;
    const t = e.target as HTMLElement;
    if (this.colMenu.contains(t)) return;
    if (t.closest?.(".col-menu-trigger")) return;
    this.closeColMenu();
  }

  private onDocumentKeydownMenu(e: Event): void {
    const ke = e as KeyboardEvent;
    if (this.colMenu.hidden || ke.key !== "Escape") return;
    ke.preventDefault();
    ke.stopPropagation();
    this.closeColMenu();
  }

  fullRender(): void {
    this.renderHeader();
    this.renderBody();
  }

  scheduleBodyRender(): void {
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.renderBody();
    });
  }

  private syncHorizontalScrollFromBody(): void {
    if (this.scrollSyncLock) return;
    this.scrollSyncLock = true;
    if (this.headerHost.scrollLeft !== this.bodyScroll.scrollLeft) {
      this.headerHost.scrollLeft = this.bodyScroll.scrollLeft;
    }
    this.scrollSyncLock = false;
  }

  private syncHorizontalScrollFromHeader(): void {
    if (this.scrollSyncLock) return;
    this.scrollSyncLock = true;
    if (this.bodyScroll.scrollLeft !== this.headerHost.scrollLeft) {
      this.bodyScroll.scrollLeft = this.headerHost.scrollLeft;
    }
    this.scrollSyncLock = false;
  }

  private colgroupHtml(): string {
    const { columnWidths, displayOrder } = this.model;
    let html = "<colgroup>";
    // Checkbox column
    html += `<col style='width:36px;min-width:36px'>`;
    for (let d = 0; d < displayOrder.length; d++) {
      const w = columnWidths[d] ?? 120;
      html += `<col style='width:${w}px;min-width:${w}px'>`;
    }
    html += "</colgroup>";
    return html;
  }

  private tableWidthStyle(): string {
    const sum = this.model.columnWidths.reduce((a, b) => a + b, 0);
    const totalWithCheckbox = sum + 36; // Add checkbox column width
    return totalWithCheckbox > 0 ? `width:${totalWithCheckbox}px;min-width:${totalWithCheckbox}px` : "";
  }

  private frozenCellStyle(
    displayCol: number,
    layer: "header" | "body",
    headerRow: "label" | "filter" = "label",
  ): string {
    const { freezeCount, columnWidths } = this.model;
    const parts: string[] = [];
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
          "background:var(--vscode-sideBarSectionHeader-background,var(--vscode-editorWidget-background))",
        );
      }
    }
    return parts.length ? ` style='${parts.join(";")}'` : "";
  }

  private renderHeader(): void {
    this.closeColMenu();
    const { header, sortState, filterByDisplay, jsonColumns, displayOrder } =
      this.model;
    const n = displayOrder.length;
    const { freezeCount } = this.model;
    let html = `<table class='cvt-header-table' style='${this.tableWidthStyle()}'>`;
    html += this.colgroupHtml();
    html += "<thead><tr>";
    // Checkbox header
    html += `<th class='cvt-checkbox-header' style='width:36px;min-width:36px'></th>`;
    for (let d = 0; d < n; d++) {
      const phys = displayOrder[d];
      const h = header[phys] ?? "";
      let indicator = "";
      if (sortState.column === d) {
        indicator = sortState.direction === "asc" ? " ▲" : " ▼";
      }
      const fz = this.frozenCellStyle(d, "header", "label");
      const thClass =
        d < freezeCount ? "cvt-th cvt-frozen" : "cvt-th cvt-scroll-col";
      const rainbowCol = phys % 8;
      html += `<th${fz} data-col='${d}' data-rainbow-col='${rainbowCol}' class='${thClass}'>`;
      html += `<div class='cvt-th-inner'>`;
      html += `<span class='col-drag-handle' draggable='true' data-col='${d}' title='Drag to reorder'>⠿</span>`;
      html += `<span class='cvt-th-label-cell'><span class='cvt-th-label'>${escapeHtml(h)}${escapeHtml(indicator)}</span></span>`;
      html += `<button type='button' class='col-menu-trigger' data-col='${d}' aria-haspopup='menu' aria-label='Sort column' title='Sort options'>&#8942;</button>`;
      html += `</div>`;
      html += `<div class='resize-handle' data-col='${d}'></div></th>`;
    }
    html += "</tr><tr class='filter-row'>";
    // Checkbox column in filter row
    html += `<td class='cvt-checkbox-header' style='width:36px;min-width:36px'></td>`;
    for (let d = 0; d < n; d++) {
      const phys = displayOrder[d];
      const fz = this.frozenCellStyle(d, "header", "filter");
      const fClass = d < freezeCount ? "cvt-filter-td cvt-frozen" : "cvt-filter-td cvt-scroll-col";
      const rainbowCol = phys % 8;
      if (jsonColumns.has(phys)) {
        html += `<td${fz} data-col='${d}' data-rainbow-col='${rainbowCol}' class='${fClass}'></td>`;
      } else {
        const val = filterByDisplay[d] ?? "";
        html += `<td${fz} data-col='${d}' data-rainbow-col='${rainbowCol}' class='${fClass}'><input class='filter-input' data-col='${d}' value='${escapeHtml(val)}'></td>`;
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
        const th = (el as HTMLElement).closest(".cvt-th") as HTMLElement;
        const ev = e as MouseEvent;
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
        const col = parseInt((btn as HTMLElement).dataset.col ?? "0", 10);
        const open = this.menuForCol === col && !this.colMenu.hidden;
        if (open) this.closeColMenu();
        else this.openColMenu(col, btn as HTMLElement);
      });
    });

    this.headerHost.querySelectorAll(".col-drag-handle").forEach((el) => {
      el.addEventListener("dragstart", (ev: Event) => {
        const e = ev as DragEvent;
        const d = parseInt((el as HTMLElement).dataset.col ?? "0", 10);
        e.dataTransfer?.setData("application/x-cvt-col", String(d));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
    });

    this.headerHost.querySelectorAll(".resize-handle").forEach((h) => {
      h.addEventListener("pointerdown", (ev: Event) => {
        const e = ev as PointerEvent;
        e.preventDefault();
        e.stopPropagation();
        if (this.handlers.interactionLocked()) return;
        const displayCol = parseInt((h as HTMLElement).dataset.col ?? "0", 10);
        const w = this.model.columnWidths[displayCol] ?? 120;
        this.resizeState = { displayCol, startX: e.clientX, startW: w };
        window.addEventListener("pointermove", this.boundResizeMove);
        window.addEventListener("pointerup", this.boundResizeUp);
        (h as HTMLElement).setPointerCapture(e.pointerId);
      });
    });

    this.headerHost.querySelectorAll(".filter-input").forEach((input) => {
      const el = input as HTMLInputElement;
      const col = parseInt(el.dataset.col ?? "0", 10);
      el.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          this.handlers.onFilterCommit(col, el.value);
        }
      });
    });
  }

  private onResizePointerMove(e: PointerEvent): void {
    if (!this.resizeState) return;
    const dx = e.clientX - this.resizeState.startX;
    this.model.setColumnWidth(
      this.resizeState.displayCol,
      this.resizeState.startW + dx,
      true,
    );
    this.scheduleColumnGeometry();
  }

  private scheduleColumnGeometry(): void {
    if (this.geomRaf) return;
    this.geomRaf = requestAnimationFrame(() => {
      this.geomRaf = 0;
      this.applyColumnGeometries();
    });
  }

  /** Update widths + sticky offsets without rebuilding header (keeps filter focus while resizing). */
  private applyColumnGeometries(): void {
    const w = this.model.columnWidths;
    const freeze = this.model.freezeCount;
    const sum = w.reduce((a, b) => a + b, 0);
    const syncTable = (table: HTMLTableElement | null) => {
      if (!table) return;
      table.style.width = `${sum}px`;
      table.style.minWidth = `${sum}px`;
      table.querySelectorAll("colgroup col").forEach((col, i) => {
        const px = w[i];
        if (px !== undefined) {
          const el = col as HTMLElement;
          el.style.width = `${px}px`;
          el.style.minWidth = `${px}px`;
        }
      });
    };
    syncTable(this.headerHost.querySelector("table"));
    syncTable(this.virtTableWrap.querySelector("table"));

    const applySticky = (el: HTMLElement, displayCol: number) => {
      if (displayCol < freeze) {
        let left = 0;
        for (let i = 0; i < displayCol; i++) left += w[i] ?? 0;
        const inHeader = !!el.closest(".cvt-header-table");
        const inBody = !!el.closest(".cvt-body-table");
        const isFilterTd =
          el.tagName === "TD" && !!el.closest(".filter-row");
        el.style.position = "sticky";
        el.style.left = `${left}px`;
        el.style.zIndex = String(inHeader ? 52 + displayCol : 42 + displayCol);
        if (inBody) {
          el.style.background = "var(--vscode-editor-background)";
        } else if (isFilterTd) {
          el.style.background = "var(--vscode-editor-background)";
        } else if (el.tagName === "TH") {
          el.style.background =
            "var(--vscode-sideBarSectionHeader-background,var(--vscode-editorWidget-background))";
        }
      } else {
        el.style.position = "";
        el.style.left = "";
        el.style.zIndex = "";
        el.style.background = "";
      }
    };

    this.headerHost.querySelectorAll("[data-col]").forEach((node) => {
      const el = node as HTMLElement;
      if (el.classList.contains("resize-handle")) return;
      if (el.classList.contains("col-drag-handle")) return;
      if (el.classList.contains("col-menu-trigger")) return;
      if (el.classList.contains("filter-input")) return;
      const d = parseInt(el.dataset.col ?? "0", 10);
      applySticky(el, d);
    });
    this.virtTableWrap.querySelectorAll("td[data-col]").forEach((node) => {
      const td = node as HTMLElement;
      applySticky(td, parseInt(td.dataset.col ?? "0", 10));
    });
  }

  private onResizePointerUp(): void {
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

  private onHeaderDrop(e: DragEvent): void {
    e.preventDefault();
    const raw = e.dataTransfer?.getData("application/x-cvt-col");
    if (raw === undefined || raw === "") return;
    const from = parseInt(raw, 10);
    const target = (e.target as HTMLElement).closest(
      "[data-col]",
    ) as HTMLElement | null;
    if (!target) return;
    const to = parseInt(target.dataset.col ?? "0", 10);
    if (from === to || Number.isNaN(from) || Number.isNaN(to)) return;
    this.model.moveDisplayColumn(from, to);
  }

  private renderBody(): void {
    const n = this.model.filteredRows.length;
    const totalHeight = Math.max(n * ROW_HEIGHT, 0);
    this.virtualInner.style.height = `${totalHeight}px`;

    const st = this.bodyScroll.scrollTop;
    const ch = this.bodyScroll.clientHeight || 1;
    const start = Math.max(0, Math.floor(st / ROW_HEIGHT) - BUFFER);
    const end = Math.min(n, Math.ceil((st + ch) / ROW_HEIGHT) + BUFFER);

    const offsetY = start * ROW_HEIGHT;
    this.virtTableWrap.style.top = `${offsetY}px`;

    const { displayOrder, jsonColumns, selectedRow, selectedCol, freezeCount } =
      this.model;

    let bodyInner = `<table class='cvt-body-table' style='${this.tableWidthStyle()}'>`;
    bodyInner += this.colgroupHtml();
    bodyInner += "<tbody>";

    for (let r = start; r < end; r++) {
      const row = this.model.filteredRows[r];
      if (!row) continue;
      const isChecked = this.model.isRowChecked(r);
      bodyInner += "<tr>";
      // Checkbox column
      bodyInner += `<td class='cvt-checkbox-cell' data-row='${r}'><input type='checkbox' class='row-checkbox' data-row='${r}' ${isChecked ? "checked" : ""}></td>`;
      for (let d = 0; d < displayOrder.length; d++) {
        const phys = displayOrder[d];
        const cell = row[phys] ?? "";
        const display = jsonColumns.has(phys)
          ? this.model.jsonPreview(cell)
          : cell;
        const isSel = r === selectedRow && d === selectedCol;
        const sel = isSel ? "selected" : "";
        const fr = d < freezeCount ? "cvt-frozen" : "cvt-scroll-col";
        const tab = isSel ? "0" : "-1";
        const fz = this.frozenCellStyle(d, "body");
        const rainbowCol = phys % 8;
        const cls = [sel, fr].filter(Boolean).join(" ");
        bodyInner += `<td class='${cls}'${fz} data-row='${r}' data-col='${d}' data-rainbow-col='${rainbowCol}' tabindex='${tab}'>${escapeHtml(display)}</td>`;
      }
      bodyInner += "</tr>";
    }
    bodyInner += "</tbody></table>";
    this.virtTableWrap.innerHTML = bodyInner;

    // Attach checkbox handlers
    this.virtTableWrap.querySelectorAll(".row-checkbox").forEach((checkbox) => {
      (checkbox as HTMLInputElement).addEventListener("change", (e) => {
        const r = parseInt((e.target as HTMLElement).dataset.row ?? "0", 10);
        console.log('[VirtualTable] Checkbox toggled for row:', r, 'Checked:', (e.target as HTMLInputElement).checked);
        this.handlers.onToggleRowCheck(r);
      });
    });
  }

  private onBodyClick(e: MouseEvent): void {
    if (this.handlers.interactionLocked()) return;
    const td = (e.target as HTMLElement).closest(
      "td[data-row][data-col]",
    ) as HTMLElement | null;
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

    const isTimedDouble =
      this.lastCellClick !== null &&
      this.lastCellClick.r === r &&
      this.lastCellClick.c === c &&
      now - this.lastCellClick.t < VirtualTable.DOUBLE_CLICK_MS;

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
  refreshSelection(): void {
    const sr = this.model.selectedRow;
    const sc = this.model.selectedCol;
    this.virtTableWrap.querySelectorAll("td[data-row][data-col]").forEach((node) => {
      const td = node as HTMLElement;
      if (td.querySelector("input.cellEdit")) return;
      const r = parseInt(td.dataset.row ?? "0", 10);
      const c = parseInt(td.dataset.col ?? "0", 10);
      const isSel = r === sr && c === sc;
      td.classList.toggle("selected", isSel);
      td.tabIndex = isSel ? 0 : -1;
    });
  }
}
