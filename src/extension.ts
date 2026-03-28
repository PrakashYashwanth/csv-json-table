import * as vscode from "vscode";
import { openCsvTablePanel } from "./host/PanelManager";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "csvJsonTable.open",
    (uri?: vscode.Uri) => {
      const target =
        uri ?? vscode.window.activeTextEditor?.document.uri ?? undefined;
      if (!target) {
        void vscode.window.showWarningMessage("No CSV file selected.");
        return;
      }
      openCsvTablePanel(context, target);
    },
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
