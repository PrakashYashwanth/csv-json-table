import * as vscode from "vscode";
import type { HostToWebviewMessage } from "../shared/messages";
import { isWebviewMessage } from "../shared/messages";
import type { FileSyncService } from "./FileSyncService";
import type { StateManager } from "./StateManager";

export interface MessageHandlerContext {
  panel: vscode.WebviewPanel;
  state: StateManager;
  fileSync: FileSyncService;
  updateTitle: () => void;
}

export class MessageHandler {
  constructor(private readonly ctx: MessageHandlerContext) {}

  handle(raw: unknown): void {
    if (!isWebviewMessage(raw)) return;
    const message = raw;
    
    console.log('[MessageHandler] Received message:', message.command);

    switch (message.command) {
      case "ready": {
        console.log('[MessageHandler] Webview ready, sending initial data');
        try {
          const csv = this.ctx.fileSync.readFile();
          this.ctx.state.setBaseline(csv);
          this.post({
            command: "reload",
            data: csv,
            reason: "initial",
            skipDirtyConfirm: true,
          });
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Failed to read CSV: ${String(e)}`,
          );
        }
        break;
      }
      case "dirty": {
        console.log('[MessageHandler] Dirty state changed:', message.isDirty);
        this.ctx.state.setDirty(message.isDirty);
        this.ctx.updateTitle();
        break;
      }
      case "requestReload": {
        console.log('[MessageHandler] Reload requested');
        try {
          const csv = this.ctx.fileSync.readFile();
          this.post({
            command: "reload",
            data: csv,
            reason: "external",
            skipDirtyConfirm: true,
          });
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Failed to reload: ${String(e)}`,
          );
        }
        break;
      }
      case "save": {
        console.log('[MessageHandler] Save requested');
        try {
          this.ctx.fileSync.writeFile(message.data);
          const written = this.ctx.fileSync.readFile();
          this.ctx.state.setBaseline(written);
          this.ctx.state.setDirty(false);
          this.ctx.updateTitle();
          void vscode.window.showInformationMessage("CSV saved");
          this.post({
            command: "reload",
            data: written,
            reason: "save",
            skipDirtyConfirm: true,
          });
        } catch (e) {
          void vscode.window.showErrorMessage(`Failed to save: ${String(e)}`);
        }
        break;
      }
      default:
        break;
    }
  }

  private post(msg: HostToWebviewMessage): void {
    console.log('[MessageHandler] Posting to webview:', msg.command, msg.reason);
    void this.ctx.panel.webview.postMessage(msg);
  }
}
