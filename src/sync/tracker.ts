// src/core/tracker.ts
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
  private isTracking = false;
  private queue: ActivityLog[] = [];
  private syncTimer: NodeJS.Timeout | undefined;
  private lastActivityTime = 0;
  private debounceInterval = 2000; // 2 seconds
  private maxIdleTime = 5 * 60 * 1000; // 5 minutes
  private syncInterval = 60_000; // 60 seconds

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
    if (this.isTracking) return;

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
    if (!this.isTracking) return;

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

  private onDocumentChange(_event: vscode.TextDocumentChangeEvent) {
    this.handleActivity();
  }

  private onSelectionChange(_event: vscode.TextEditorSelectionChangeEvent) {
    this.handleActivity();
  }

  private onDocumentSave(_document: vscode.TextDocument) {
    this.handleActivity();
  }

  private handleActivity() {
    const now = Date.now();
    const timeDiff = now - this.lastActivityTime;

    // Debounce very rapid events
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
    if (!editor) return;

    const doc = editor.document;
    const filePath = doc.fileName;
    let projectPath = "";

    const language = doc.languageId;
    const gitRoot = this.gitTracker?.getGitRootForPath(filePath);
    if (gitRoot) {
      projectPath = gitRoot; // ✅ TRUE PROJECT PATH
    } else {
      // fallback: workspace root
      projectPath =
        vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || "";
    }
    // Ask GitTracker for commit based on real file path
    const commitHash =
      this.gitTracker?.getActiveCommitForPath(filePath) ?? undefined;
    this.logger.debug(
      `Tracking activity: ${filePath} | ${language} | ${duration}ms | commitHash: ${commitHash}`
    );
    if (!commitHash && projectPath) {
      this.logger.debug(
        `No active commit found for file: ${filePath} (project: ${projectPath})`
      );
    }

    const log: ActivityLog = {
      projectPath,
      filePath,
      language,
      timestamp: now,
      duration,
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
        this.logger.debug(`Syncing ${logs.length} activity logs`);
        const success = await this.apiClient.syncActivities(logs);
        if (success) {
          const ids = logs
            .map((l) => l.id!)
            .filter((id): id is number => id !== undefined);
          if (ids.length > 0) {
            await this.db.deleteLogs(ids);
          }
          this.statusBarManager.updateStatus("CodeChrono: Synced");
        } else {
          this.statusBarManager.updateStatus("CodeChrono: Offline");
        }
      }

      // Sync git commits
      const commits = await this.db.getUnsyncedCommits(20);
      if (commits.length > 0) {
        this.logger.debug(`Syncing ${commits.length} commits`);
        const success = await this.apiClient.syncCommits(commits);
        if (success) {
          const ids = commits
            .map((c) => c.id!)
            .filter((id): id is number => id !== undefined);
          if (ids.length > 0) {
            await this.db.deleteCommits(ids);
          }
          this.logger.info(`Synced ${commits.length} commits`);
        }
      }
    } catch (err) {
      this.logger.error("Sync loop error", err as Error);
    }

    this.syncTimer = setTimeout(() => this.syncLoop(), this.syncInterval);
  }
}
