declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

import { JsonEditor } from "./components/JsonEditor";
import { ROW_HEIGHT, VirtualTable } from "./components/VirtualTable";
import { EditorViewModel } from "./models/EditorViewModel";
import { TableViewModel } from "./models/TableViewModel";

const api = acquireVsCodeApi();

let baselineCsv = "";
let isDirty = false;

function setDirty(val: boolean): void {
  if (isDirty === val) return;
  console.log('[Webview] setDirty:', val);
  isDirty = val;
  api.postMessage({ command: "dirty", isDirty });
}

const model = new TableViewModel();
const editorVm = new EditorViewModel();

const headerHost = document.getElementById("headerHost")!;
const bodyScroll = document.getElementById("bodyScroll")! as HTMLElement;
bodyScroll.tabIndex = 0;
const tableRoot = document.getElementById("tableRoot")!;
const virtualInner = document.getElementById("virtualInner")!;
const virtTableWrap = document.getElementById("virtTable")!;
const overlay = document.getElementById("editorOverlay")!;
const monacoHost = document.getElementById("monacoEditor")!;
const deleteRowsBtn = document.getElementById("deleteRowsBtn")! as HTMLButtonElement;
const checkedCountEl = document.getElementById("checkedCount")!;
const revertBtn = document.getElementById("revertBtn")! as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn")! as HTMLButtonElement;

let inlineEditing = false;

/** Last pointer interaction was inside the grid (not filter/cell inputs) — drives keyboard nav. */
let gridKeysEnabled = false;

function updateDeleteButtonState(): void {
  const count = model.getCheckedRowCount();
  deleteRowsBtn.disabled = count === 0;
  if (count > 0) {
    checkedCountEl.textContent = `${count} row${count !== 1 ? "s" : ""} selected`;
  } else {
    checkedCountEl.textContent = "";
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t as HTMLElement).closest) return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return true;
  if (el.isContentEditable) return true;
  if (el.closest("#monacoEditor")) return true;
  return false;
}

function focusSelectedCellAfterPaint(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const td = virtTableWrap.querySelector(
        "td.selected",
      ) as HTMLElement | null;
      if (td) td.focus({ preventScroll: true });
      else bodyScroll.focus({ preventScroll: true });
    });
  });
}

tableRoot.addEventListener(
  "mousedown",
  (e) => {
    const el = e.target as HTMLElement;
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
  true,
);

const jsonEditor = new JsonEditor(monacoHost);

const vtable = new VirtualTable(
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
    onAddRow() {
      model.addRow();
      setDirty(true);
      setTimeout(() => {
        vtable.fullRender();
        ensureSelectionVisible();
        focusSelectedCellAfterPaint();
      }, 0);
    },
    onToggleRowCheck(r) {
      model.toggleRowCheck(r);
      updateDeleteButtonState();
      vtable.fullRender();
    },
    onDeleteRows() {
      const count = model.getCheckedRowCount();
      console.log('[Main] Delete rows clicked, checked count:', count);
      if (count === 0) return;
      // Note: confirm() is blocked by webview sandbox, so we just proceed
      // Users can undo with Ctrl+Z if needed
      console.log('[Main] Deleting rows...');
      model.deleteCheckedRows();
      setDirty(true);
      updateDeleteButtonState();
      setTimeout(() => {
        console.log('[Main] After delete, rendering...');
        vtable.fullRender();
        ensureSelectionVisible();
        focusSelectedCellAfterPaint();
      }, 0);
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
    interactionLocked: () => inlineEditing,
  },
);

function beginEditAt(r: number, c: number): void {
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

model.setOnChange(() => {
  vtable.fullRender();
  updateDeleteButtonState();
});

function ensureSelectionVisible(): void {
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
    const ae = document.activeElement as HTMLElement | null;
    if (ae && isTypingTarget(ae)) return;
    const onSelectedCell =
      ae?.matches?.("td.selected") === true &&
      virtTableWrap.contains(ae as Node);
    const onBodyScroller = ae === bodyScroll;
    if (!onSelectedCell && !onBodyScroller) return;

    const rowCount = model.filteredRows.length;
    const colCount = model.displayOrder.length;
    if (rowCount === 0 || colCount === 0) return;

    const k = e.key;
    if (
      k !== "Enter" &&
      k !== "ArrowUp" &&
      k !== "ArrowDown" &&
      k !== "ArrowLeft" &&
      k !== "ArrowRight"
    ) {
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
      Math.min(rowCount - 1, model.selectedRow + dr),
    );
    model.selectedCol = Math.max(
      0,
      Math.min(colCount - 1, model.selectedCol + dc),
    );
    vtable.refreshSelection();
    requestAnimationFrame(() => {
      ensureSelectionVisible();
      requestAnimationFrame(() => {
        const td = virtTableWrap.querySelector(
          "td.selected",
        ) as HTMLElement | null;
        if (td) td.focus({ preventScroll: true });
        else bodyScroll.focus({ preventScroll: true });
      });
    });
  },
  true,
);

function initialize(csv: string): void {
  console.log('[Webview] initialize called, csv length:', csv.length);
  baselineCsv = csv;
  model.initialize(csv);
  // Don't call setDirty here - let the caller manage dirty state
}

function openJsonEditor(): void {
  const r = editorVm.editingRow;
  const c = editorVm.editingCol;
  if (r === null || c === null) return;
  let value = model.cellAtFiltered(r, c);
  try {
    value = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    /* keep raw */
  }
  overlay.style.display = "block";
  jsonEditor.open(value, {
    onApply: () => applyJsonEdit(),
    onCancel: () => closeEditor(),
    onSaveFile: () => save(),
  });
  requestAnimationFrame(() => {
    jsonEditor.layout();
    requestAnimationFrame(() => jsonEditor.layout());
  });
}

function applyJsonEdit(): boolean {
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

function closeEditor(): void {
  overlay.style.display = "none";
  jsonEditor.hide();
  editorVm.clear();
}

function inlineEdit(r: number, c: number): void {
  if (inlineEditing) return;
  inlineEditing = true;
  const cell = virtTableWrap.querySelector(
    `td[data-row='${r}'][data-col='${c}']`,
  ) as HTMLElement | null;
  if (!cell) {
    inlineEditing = false;
    return;
  }
  const oldValue = model.cellAtFiltered(r, c);
  cell.innerHTML = "<input class='cellEdit'>";
  const input = cell.querySelector("input") as HTMLInputElement;
  input.value = oldValue;
  input.focus();
  input.select();

  const commit = (): void => {
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

function save(): void {
  if (overlay.style.display === "block") {
    if (!applyJsonEdit()) return;
  }
  const newCsv = model.toCsvString();
  api.postMessage({ command: "save", data: newCsv });
  baselineCsv = newCsv;
  setDirty(false);
}

revertBtn.addEventListener("click", () => {
  // Note: confirm() is blocked by webview sandbox, so we just proceed
  // Only revert if there are unsaved changes
  if (isDirty) {
    console.log('[Main] Revert clicked - discarding changes and reloading');
  }
  api.postMessage({ command: "requestReload" });
});

saveBtn.addEventListener("click", () => {
  save();
});

overlay.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).id === "editorOverlay") {
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

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    if (!inlineEditing && overlay.style.display !== "block") {
      model.addRow();
      setDirty(true);
      setTimeout(() => {
        vtable.fullRender();
        ensureSelectionVisible();
        focusSelectedCellAfterPaint();
      }, 0);
    }
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
  const msg = event.data as {
    command?: string;
    data?: string;
    reason?: string;
    skipDirtyConfirm?: boolean;
  };
  console.log(
    "[Webview] Received message:",
    msg.command,
    msg.reason,
    "isDirty:",
    isDirty,
    "skipDirtyConfirm:",
    msg.skipDirtyConfirm,
  );

  if (msg.command === "reload" && typeof msg.data === "string") {
    console.log(
      "[Webview] Reload - data length:",
      msg.data.length,
      "baseline length:",
      baselineCsv.length,
      "are equal:",
      msg.data === baselineCsv,
    );

    // Host already handled conflicts, or reload is save/initial — never double-prompt.
    // A second confirm here caused "Apply disk" to be ignored when user clicked Cancel,
    // leaving webview dirty while host was clean (setDirty(true) then no-oped forever).
    const skipConfirm = msg.skipDirtyConfirm === true;
    if (isDirty && msg.data !== baselineCsv && !skipConfirm) {
      console.log("[Webview] Dirty + external data differs — asking user (legacy path)");
      const shouldReload = confirm(
        "The file changed on disk. Reload and discard your table edits?",
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
