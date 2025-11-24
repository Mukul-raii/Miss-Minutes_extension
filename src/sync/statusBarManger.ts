import * as vscode from "vscode";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "miss-minutes.helloWorld"; // Placeholder, can be changed to open dashboard later
    this.statusBarItem.text = "$(clock) Miss-Minutes: Initializing...";
    this.statusBarItem.show();
  }

  public updateStatus(message: string, tooltip?: string) {
    this.statusBarItem.text = `$(clock) ${message}`;
    if (tooltip) {
      this.statusBarItem.tooltip = tooltip;
    }
  }

  public dispose() {
    this.statusBarItem.dispose();
  }
}
