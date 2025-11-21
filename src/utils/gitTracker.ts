import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { Logger } from "./logger";
import { Database, GitCommit } from "../storage/database";

const execAsync = promisify(exec);

export class GitTracker {
  private logger = Logger.getInstance();
  private currentCommit: Map<string, string> = new Map(); // projectPath -> commitHash
  private commitStartTime: Map<string, number> = new Map(); // commitHash -> startTime

  constructor(private database: Database) {}

  /**
   * Get the current git commit hash for a project
   */
  public async getCurrentCommit(projectPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git rev-parse HEAD", {
        cwd: projectPath,
      });
      return stdout.trim();
    } catch (error) {
      this.logger.debug(
        `Not a git repository or error getting commit: ${projectPath}`
      );
      return null;
    }
  }

  /**
   * Get current branch name
   */
  public async getCurrentBranch(projectPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git branch --show-current", {
        cwd: projectPath,
      });
      return stdout.trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * Get commit details
   */
  public async getCommitDetails(
    projectPath: string,
    commitHash: string
  ): Promise<Partial<GitCommit> | null> {
    try {
      const [messageResult, authorResult, emailResult, timestampResult] =
        await Promise.all([
          execAsync(`git log -1 --format=%s ${commitHash}`, {
            cwd: projectPath,
          }),
          execAsync(`git log -1 --format=%an ${commitHash}`, {
            cwd: projectPath,
          }),
          execAsync(`git log -1 --format=%ae ${commitHash}`, {
            cwd: projectPath,
          }),
          execAsync(`git log -1 --format=%at ${commitHash}`, {
            cwd: projectPath,
          }),
        ]);

      const message = messageResult.stdout.trim();
      const author = authorResult.stdout.trim();
      const authorEmail = emailResult.stdout.trim();
      const timestamp = parseInt(timestampResult.stdout.trim(), 10) * 1000; // Convert to ms

      // Get diff stats
      const { stdout: diffStats } = await execAsync(
        `git show --stat --format="" ${commitHash}`,
        { cwd: projectPath }
      );

      const filesChanged = (diffStats.match(/\n/g) || []).length;
      let linesAdded = 0;
      let linesDeleted = 0;

      const statsMatch = diffStats.match(/(\d+) insertion.*?(\d+) deletion/);
      if (statsMatch) {
        linesAdded = parseInt(statsMatch[1], 10) || 0;
        linesDeleted = parseInt(statsMatch[2], 10) || 0;
      }

      return {
        message,
        author,
        authorEmail,
        timestamp,
        filesChanged,
        linesAdded,
        linesDeleted,
      };
    } catch (error) {
      this.logger.error("Error getting commit details", error);
      return null;
    }
  }

  /**
   * Track commit change and store in database
   */
  public async trackCommitChange(projectPath: string): Promise<void> {
    const newCommit = await this.getCurrentCommit(projectPath);
    if (!newCommit) {
      return;
    }

    const oldCommit = this.currentCommit.get(projectPath);

    // If commit changed, save the new commit to database
    if (oldCommit !== newCommit) {
      this.logger.info(
        `Commit changed for ${projectPath}: ${oldCommit} -> ${newCommit}`
      );

      const commitDetails = await this.getCommitDetails(projectPath, newCommit);
      const branch = await this.getCurrentBranch(projectPath);

      if (commitDetails) {
        const commit: GitCommit = {
          projectPath,
          commitHash: newCommit,
          message: commitDetails.message!,
          author: commitDetails.author!,
          authorEmail: commitDetails.authorEmail!,
          timestamp: commitDetails.timestamp!,
          filesChanged: commitDetails.filesChanged!,
          linesAdded: commitDetails.linesAdded!,
          linesDeleted: commitDetails.linesDeleted!,
          branch: branch || undefined,
        };

        await this.database.insertCommit(commit);
        this.logger.info(`Stored git commit: ${newCommit.substring(0, 8)}`);
      }

      this.currentCommit.set(projectPath, newCommit);
      this.commitStartTime.set(newCommit, Date.now());
    }
  }

  /**
   * Get current commit hash for activity logging
   */
  public getActiveCommit(projectPath: string): string | undefined {
    return this.currentCommit.get(projectPath);
  }

  /**
   * Initialize tracking for a project
   */
  public async initializeProject(projectPath: string): Promise<void> {
    const commit = await this.getCurrentCommit(projectPath);
    if (commit) {
      this.currentCommit.set(projectPath, commit);
      this.commitStartTime.set(commit, Date.now());

      // Store initial commit if not already stored
      const commitDetails = await this.getCommitDetails(projectPath, commit);
      const branch = await this.getCurrentBranch(projectPath);

      if (commitDetails) {
        const gitCommit: GitCommit = {
          projectPath,
          commitHash: commit,
          message: commitDetails.message!,
          author: commitDetails.author!,
          authorEmail: commitDetails.authorEmail!,
          timestamp: commitDetails.timestamp!,
          filesChanged: commitDetails.filesChanged!,
          linesAdded: commitDetails.linesAdded!,
          linesDeleted: commitDetails.linesDeleted!,
          branch: branch || undefined,
        };

        await this.database.insertCommit(gitCommit);
      }
    }
  }

  /**
   * Watch for git changes in workspace
   */
  public watchGitChanges(context: vscode.ExtensionContext): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    // Watch for .git/HEAD changes to detect commit changes
    workspaceFolders.forEach((folder) => {
      const gitHeadPattern = new vscode.RelativePattern(
        folder,
        ".git/{HEAD,refs/heads/**}"
      );
      const watcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern);

      watcher.onDidChange(() => this.trackCommitChange(folder.uri.fsPath));
      watcher.onDidCreate(() => this.trackCommitChange(folder.uri.fsPath));

      context.subscriptions.push(watcher);

      // Initialize tracking
      this.initializeProject(folder.uri.fsPath);
    });
  }
}
