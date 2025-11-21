import * as vscode from "vscode";
import { Logger } from "./utils/logger";
import { Database } from "./storage/database";
import { StatusBarManager } from "./sync/statusBarManger";
import { Tracker } from "./sync/tracker";
import { ApiClient } from "./api/client";
import { GitTracker } from "./utils/gitTracker";

let db: Database;
let tracker: Tracker;
let statusBarManager: StatusBarManager;
let apiClient: ApiClient;
let gitTracker: GitTracker;

export async function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance();
  logger.info("CodeChrono extension is activating...");

  // Initialize Database
  // Use globalStorageUri for persistent storage across sessions
  const storagePath = context.globalStorageUri.fsPath;
  db = new Database(storagePath);
  await db.init();

  // Initialize API Client
  apiClient = new ApiClient(); // Initialize Status Bar
  statusBarManager = new StatusBarManager();

  // Register statusBarManager as a disposable
  context.subscriptions.push(
    new vscode.Disposable(() => statusBarManager.dispose())
  );

  // Initialize Git Tracker
  gitTracker = new GitTracker(db);
  gitTracker.watchGitChanges(context);

  // Initialize Tracker
  tracker = new Tracker(statusBarManager, db, apiClient, gitTracker);
  tracker.startTracking();

  // Auth Command
  context.subscriptions.push(
    vscode.commands.registerCommand("codechrono.setApiKey", async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Enter your CodeChrono API Token",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "Paste your API token here",
      });

      if (token) {
        await context.secrets.store("codechrono_api_token", token);
        apiClient.updateToken(token);
        vscode.window.showInformationMessage(
          "CodeChrono: API Token saved successfully!"
        );
        logger.info("API Token saved");
        statusBarManager.updateStatus("CodeChrono: Active");
      }
    })
  );

  // Check for existing token
  try {
    const token = await context.secrets.get("codechrono_api_token");
    if (!token) {
      statusBarManager.updateStatus(
        "CodeChrono: No Token",
        "Click to set API Token"
      );
      const selection = await vscode.window.showWarningMessage(
        "CodeChrono: API Token is missing. Please provide it to enable syncing.",
        "Enter API Token"
      );
      if (selection === "Enter API Token") {
        vscode.commands.executeCommand("codechrono.setApiKey");
      }
    } else {
      logger.info("API Token found.");
      apiClient.updateToken(token);
      statusBarManager.updateStatus("CodeChrono: Active");
    }
  } catch (err) {
    logger.error("Error retrieving API token", err as Error);
  }

  logger.info("CodeChrono initialized successfully");

  let disposable = vscode.commands.registerCommand(
    "codechrono.helloWorld",
    () => {
      vscode.window.showInformationMessage("Hello World from CodeChrono!");
      logger.info("Hello World command executed");
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  if (db) {
    db.close();
  }
  if (tracker) {
    tracker.stopTracking();
  }
  if (statusBarManager) {
    statusBarManager.dispose();
  }
}
