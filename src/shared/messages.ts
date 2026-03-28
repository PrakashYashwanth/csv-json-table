/**
 * Messages webview -> extension host.
 * Keep in sync with webview postMessage payloads.
 */
export type WebviewToHostMessage =
  | { command: "save"; data: string }
  | { command: "dirty"; isDirty: boolean }
  | { command: "requestReload" }
  | { command: "ready" };

/**
 * Messages host -> webview.
 */
export type HostToWebviewMessage = {
  command: "reload";
  data: string;
  reason?: "save" | "external" | "initial";
  /**
   * When true, apply `data` without a webview confirm().
   * Use for every host-initiated reload — the host already owns conflict UX
   * (or there is no conflict). Prevents double prompts and host/webview dirty desync.
   */
  skipDirtyConfirm?: boolean;
};

export function isWebviewMessage(raw: unknown): raw is WebviewToHostMessage {
  if (!raw || typeof raw !== "object") return false;
  const cmd = (raw as { command?: unknown }).command;
  return (
    cmd === "save" ||
    cmd === "dirty" ||
    cmd === "requestReload" ||
    cmd === "ready"
  );
}
