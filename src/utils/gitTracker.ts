// src/utils/gitTracker.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec, execSync } from "child_process";
import { promisify } from "util";

import { Logger } from "./logger";
import { Database, GitCommit } from "../storage/database";

const execAsync = promisify(exec);

export class GitTracker {
  private logger = Logger.getInstance();

  // gitRoot -> commitHash
  private currentCommit: Map<string, string> = new Map();

  // gitRoot -> branch name
  private currentBranch: Map<string, string> = new Map();

  // Set of known git roots
  private gitRoots: Set<string> = new Set();

  constructor(private database: Database) {}

  // -------------------------------------------------------
  // 🔍 FIND ALL GIT ROOTS INSIDE WORKSPACE (MONOREPO SAFE)
  // -------------------------------------------------------
  private findGitRootsInWorkspace(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return [];

    const roots = new Set<string>();

    for (const folder of folders) {
      const base = folder.uri.fsPath;

      const stack: string[] = [base];

      while (stack.length > 0) {
        const current = stack.pop()!;
        const gitDir = path.join(current, ".git");

        try {
          if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
            roots.add(current);
            continue; // do NOT scan deeper inside this repo
          }
        } catch {}

        // Scan children folders
        try {
          const children = fs.readdirSync(current);
          for (const child of children) {
            const full = path.join(current, child);
            if (fs.statSync(full).isDirectory()) {
              stack.push(full);
            }
          }
        } catch {}
      }
    }

    return Array.from(roots);
  }

  // -------------------------------------------------------
  // 🧠 GET CURRENT COMMIT
  // -------------------------------------------------------
  private async getCurrentCommit(gitRoot: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git rev-parse HEAD", {
        cwd: gitRoot,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------
  // 🧠 GET BRANCH
  // -------------------------------------------------------
  private async getBranch(gitRoot: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git branch --show-current", {
        cwd: gitRoot,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------
  // 📦 GET COMMIT DETAILS (message, author, diff stats)
  // -------------------------------------------------------
  private async getCommitDetails(
    gitRoot: string,
    hash: string
  ): Promise<Partial<GitCommit> | null> {
    try {
      const [msg, author, email, timestamp] = await Promise.all([
        execAsync(`git log -1 --format=%s ${hash}`, { cwd: gitRoot }),
        execAsync(`git log -1 --format=%an ${hash}`, { cwd: gitRoot }),
        execAsync(`git log -1 --format=%ae ${hash}`, { cwd: gitRoot }),
        execAsync(`git log -1 --format=%at ${hash}`, { cwd: gitRoot }),
      ]);

      const message = msg.stdout.trim();
      const authorName = author.stdout.trim();
      const authorEmail = email.stdout.trim();
      const timestampMs = parseInt(timestamp.stdout.trim(), 10) * 1000;

      // diff stats
      const { stdout: diffStats } = await execAsync(
        `git show --stat --format="" ${hash}`,
        { cwd: gitRoot }
      );

      const filesChanged = (diffStats.match(/\n/g) || []).length;

      let linesAdded = 0;
      let linesDeleted = 0;

      const stats = diffStats.match(/(\d+) insertion.*?(\d+) deletion/);
      if (stats) {
        linesAdded = parseInt(stats[1], 10) || 0;
        linesDeleted = parseInt(stats[2], 10) || 0;
      }

      return {
        message,
        author: authorName,
        authorEmail,
        timestamp: timestampMs,
        filesChanged,
        linesAdded,
        linesDeleted,
      };
    } catch (err) {
      this.logger.error("Failed reading commit details", err);
      return null;
    }
  }

  // -------------------------------------------------------
  // 🔄 TRACK COMMIT CHANGE
  // -------------------------------------------------------
  public async trackCommitChange(gitRoot: string) {
    const newCommit = await this.getCurrentCommit(gitRoot);
    if (!newCommit) return;

    const oldCommit = this.currentCommit.get(gitRoot);

    if (oldCommit === newCommit) return;

    this.logger.info(
      `Commit changed (${gitRoot}): ${oldCommit} → ${newCommit}`
    );

    const details = await this.getCommitDetails(gitRoot, newCommit);
    const branch = await this.getBranch(gitRoot);

    if (details) {
      const data: GitCommit = {
        projectPath: gitRoot,
        commitHash: newCommit,
        message: details.message!,
        author: details.author!,
        authorEmail: details.authorEmail!,
        timestamp: details.timestamp!,
        filesChanged: details.filesChanged!,
        linesAdded: details.linesAdded!,
        linesDeleted: details.linesDeleted!,
        branch: branch || undefined,
      };

      await this.database.insertCommit(data);
    }

    this.currentCommit.set(gitRoot, newCommit);
    if (branch) {
      this.currentBranch.set(gitRoot, branch);
    }
  }

  // -------------------------------------------------------
  // 🚀 INITIALIZE ALL FOUND GIT ROOTS
  // -------------------------------------------------------
  public async initializeAllRoots() {
    const roots = this.findGitRootsInWorkspace();
    this.gitRoots = new Set(roots);

    this.logger.info(
      `GitTracker detected git roots: ${
        roots.length > 0 ? roots.join(", ") : "None"
      }`
    );

    for (const root of roots) {
      const commit = await this.getCurrentCommit(root);
      if (commit) {
        this.currentCommit.set(root, commit);

        const details = await this.getCommitDetails(root, commit);
        const branch = await this.getBranch(root);

        if (branch) {
          this.currentBranch.set(root, branch);
        }

        if (details) {
          await this.database.insertCommit({
            projectPath: root,
            commitHash: commit,
            message: details.message!,
            author: details.author!,
            authorEmail: details.authorEmail!,
            timestamp: details.timestamp!,
            filesChanged: details.filesChanged!,
            linesAdded: details.linesAdded!,
            linesDeleted: details.linesDeleted!,
            branch: branch || undefined,
          });
        }
      }
    }
  }

  // -------------------------------------------------------
  // 👀 WATCH GIT HEAD CHANGES
  // -------------------------------------------------------
  public async watchGitChanges(context: vscode.ExtensionContext) {
    await this.initializeAllRoots();

    for (const root of this.gitRoots) {
      const rootUri = vscode.Uri.file(root);

      const pattern = new vscode.RelativePattern(
        rootUri,
        ".git/{HEAD,refs/heads/**}"
      );

      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidChange(() => this.trackCommitChange(root));
      watcher.onDidCreate(() => this.trackCommitChange(root));

      context.subscriptions.push(watcher);
    }
  }

  // -------------------------------------------------------
  // 🧩 RETURN COMMIT FOR A FILE PATH
  // -------------------------------------------------------
  public getActiveCommitForPath(fsPath: string): string | undefined {
    let bestMatch: string | undefined;

    for (const root of this.gitRoots) {
      if (
        fsPath === root ||
        fsPath.startsWith(root + path.sep) ||
        fsPath.startsWith(root + "/")
      ) {
        if (!bestMatch || root.length > bestMatch.length) {
          bestMatch = root;
        }
      }
    }

    return bestMatch ? this.currentCommit.get(bestMatch) : undefined;
  }

  // Backwards compatibility
  public getActiveCommit(projectPath: string): string | undefined {
    return this.getActiveCommitForPath(projectPath);
  }

  /**
   * Get active branch for a given file path
   */
  public getActiveBranchForPath(fsPath: string): string | undefined {
    let bestMatch: string | undefined;

    for (const root of this.gitRoots) {
      if (
        fsPath === root ||
        fsPath.startsWith(root + path.sep) ||
        fsPath.startsWith(root + "/")
      ) {
        if (!bestMatch || root.length > bestMatch.length) {
          bestMatch = root;
        }
      }
    }

    return bestMatch ? this.currentBranch.get(bestMatch) : undefined;
  }

  public getGitRootForPath(fsPath: string): string | undefined {
    let best: string | undefined;

    for (const root of this.gitRoots) {
      if (
        fsPath === root ||
        fsPath.startsWith(root + path.sep) ||
        fsPath.startsWith(root + "/")
      ) {
        if (!best || root.length > best.length) {
          best = root;
        }
      }
    }

    return best;
  }
}
