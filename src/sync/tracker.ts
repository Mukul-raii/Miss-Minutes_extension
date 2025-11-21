import * as vscode from "vscode";
import { Logger } from "../utils/logger";
import { StatusBarManager } from "./statusBarManger";
import { Database, ActivityLog } from "../storage/database";
import { ApiClient } from "../api/client";
import { GitTracker } from "../utils/gitTracker";

export class Tracker {
  private logger: Logger;
  private statusBarManager: StatusBarManager;
  private db: Database;
  private apiClient: ApiClient;
  private gitTracker: GitTracker | undefined;
  private disposable: vscode.Disposable | undefined;
  private isTracking: boolean = false;
  private queue: ActivityLog[] = [];
  private syncTimer: NodeJS.Timeout | undefined;
  private lastActivityTime: number = 0;
  private debounceInterval: number = 2000; // 2 seconds
  private maxIdleTime: number = 5 * 60 * 1000; // 5 minutes
  private syncInterval: number = 60000; // 60 seconds (1 minute)

  constructor(
    statusBarManager: StatusBarManager,
    db: Database,
    apiClient: ApiClient,
    gitTracker?: GitTracker
  ) {
    this.logger = Logger.getInstance();
    this.statusBarManager = statusBarManager;
    this.db = db;
    this.apiClient = apiClient;
    this.gitTracker = gitTracker;
  }

  public startTracking() {
    if (this.isTracking) {
      return;
    }
    this.isTracking = true;
    this.logger.info("Tracking started");
    this.statusBarManager.updateStatus("CodeChrono: Active");

    const subscriptions: vscode.Disposable[] = [];

    vscode.workspace.onDidChangeTextDocument(
      this.onDocumentChange,
      this,
      subscriptions
    );
    vscode.window.onDidChangeTextEditorSelection(
      this.onSelectionChange,
      this,
      subscriptions
    );
    vscode.workspace.onDidSaveTextDocument(
      this.onDocumentSave,
      this,
      subscriptions
    );

    this.disposable = vscode.Disposable.from(...subscriptions);

    // Start sync loop
    this.syncLoop();
  }

  public stopTracking() {
    if (!this.isTracking) {
      return;
    }
    this.isTracking = false;
    this.logger.info("Tracking stopped");
    this.statusBarManager.updateStatus("CodeChrono: Paused");

    if (this.disposable) {
      this.disposable.dispose();
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
    this.handleActivity();
  }

  private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    this.handleActivity();
  }

  private onDocumentSave(document: vscode.TextDocument) {
    this.handleActivity();
  }

  private handleActivity() {
    const now = Date.now();
    const timeDiff = now - this.lastActivityTime;

    if (timeDiff < this.debounceInterval) {
      return;
    }

    let duration = 0;
    // Only count duration if within max idle time and not the first event
    if (this.lastActivityTime !== 0 && timeDiff < this.maxIdleTime) {
      duration = timeDiff;
    }

    this.lastActivityTime = now;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const doc = editor.document;
    const filePath = doc.fileName;
    const projectPath =
      vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || "";
    const language = doc.languageId;

    // Get current commit hash if git tracker is available
    const commitHash = this.gitTracker?.getActiveCommit(projectPath);

    const log: ActivityLog = {
      projectPath,
      filePath,
      language,
      timestamp: now,
      duration: duration,
      editor: "vscode",
      commitHash,
    };

    this.queue.push(log);
    this.statusBarManager.updateStatus("CodeChrono: Tracking...");
  }

  private async syncLoop() {
    if (!this.isTracking) return;

    // Flush queue to DB
    if (this.queue.length > 0) {
      const logsToSave = [...this.queue];
      this.queue = [];
      for (const log of logsToSave) {
        try {
          await this.db.insertActivity(log);
        } catch (err) {
          this.logger.error("Failed to save activity to DB", err as Error);
        }
      }
    }

    // Sync DB to API
    try {
      // Sync activity logs
      const logs = await this.db.getUnsyncedLogs(50);
      if (logs.length > 0) {
        console.log("Syncing logs:", logs);
        const success = await this.apiClient.syncActivities(logs);
        if (success) {
          const ids = logs.map((l) => l.id!).filter((id) => id !== undefined);
          await this.db.deleteLogs(ids);
          this.statusBarManager.updateStatus("CodeChrono: Synced");
        } else {
          this.statusBarManager.updateStatus("CodeChrono: Offline");
        }
      }

      // Sync git commits
      const commits = await this.db.getUnsyncedCommits(20);
      if (commits.length > 0) {
        console.log("Syncing commits:", commits);
        const success = await this.apiClient.syncCommits(commits);
        if (success) {
          const ids = commits
            .map((c) => c.id!)
            .filter((id) => id !== undefined);
          await this.db.deleteCommits(ids);
          this.logger.info(`Synced ${commits.length} commits`);
        }
      }
    } catch (err) {
      this.logger.error("Sync loop error", err as Error);
    }

    this.syncTimer = setTimeout(() => this.syncLoop(), this.syncInterval);
  }
}
