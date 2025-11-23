import { GraphQLClient, gql } from "graphql-request";
import { Logger } from "../utils/logger";
import {
  ActivityLog,
  GitCommit,
  FileActivitySummary,
  DailyActivitySummary,
} from "../storage/database";

export class ApiClient {
  private client: GraphQLClient;
  private logger = Logger.getInstance();
  // TODO: Make this configurable
  private endpoint = "https://miss-minutes.mukulrai.me/api/graphql";

  constructor(token?: string) {
    this.client = new GraphQLClient(this.endpoint, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  public updateToken(token: string) {
    this.client = new GraphQLClient(this.endpoint, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  public async syncActivities(logs: ActivityLog[]): Promise<boolean> {
    if (logs.length === 0) {
      return true;
    }

    const mutation = gql`
      mutation SyncActivity($input: [ActivityInput!]!) {
        syncActivity(input: $input) {
          success
          message
        }
      }
    `;

    const input = logs.map((log) => ({
      projectPath: log.projectPath,
      filePath: log.filePath,
      language: log.language,
      timestamp: log.timestamp,
      duration: log.duration,
      editor: log.editor || "vscode",
      commitHash: log.commitHash,
    }));

    try {
      await this.client.request(mutation, { input });
      this.logger.info(
        `Synced ${input[0].commitHash}||${input[0].filePath}||${input[0].projectPath} `
      );
      this.logger.info(`Synced ${logs.length} activities to ${this.endpoint}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to sync activities", error as Error);
      return false;
    }
  }

  public async syncCommits(commits: GitCommit[]): Promise<boolean> {
    if (commits.length === 0) {
      return true;
    }

    const mutation = gql`
      mutation SyncCommits($input: [CommitInput!]!) {
        syncCommits(input: $input) {
          success
          message
        }
      }
    `;

    const input = commits.map((commit) => ({
      projectPath: commit.projectPath,
      commitHash: commit.commitHash,
      message: commit.message,
      author: commit.author,
      authorEmail: commit.authorEmail,
      timestamp: commit.timestamp,
      filesChanged: commit.filesChanged,
      linesAdded: commit.linesAdded,
      linesDeleted: commit.linesDeleted,
      branch: commit.branch,
    }));

    try {
      await this.client.request(mutation, { input });
      this.logger.info(
        `Synced ${input[0].author}||${input[0].commitHash}||${input[0].projectPath}  `
      );
      this.logger.info(`Synced ${commits.length} commits to ${this.endpoint}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to sync commits", error as Error);
      return false;
    }
  }

  /**
   * Sync aggregated file activity summaries (grouped by commit, branch, and file)
   * This is the new preferred method instead of syncing individual activities
   */
  public async syncFileActivities(
    summaries: FileActivitySummary[]
  ): Promise<boolean> {
    if (summaries.length === 0) {
      return true;
    }

    const mutation = gql`
      mutation SyncFileActivities($input: [FileActivityInput!]!) {
        syncFileActivities(input: $input) {
          success
          message
        }
      }
    `;

    const input = summaries.map((summary) => ({
      projectPath: summary.projectPath,
      commitHash: summary.commitHash,
      branch: summary.branch,
      filePath: summary.filePath,
      language: summary.language,
      totalDuration: summary.totalDuration,
      activityCount: summary.activityCount,
      firstActivityAt: summary.firstActivityAt,
      lastActivityAt: summary.lastActivityAt,
      editor: summary.editor,
    }));

    try {
      await this.client.request(mutation, { input });
      this.logger.info(
        `Synced file activity: ${input[0].commitHash}||${input[0].branch}||${input[0].filePath}`
      );
      this.logger.info(
        `Synced ${summaries.length} file activity summaries to ${this.endpoint}`
      );
      return true;
    } catch (error) {
      this.logger.error("Failed to sync file activities", error as Error);
      return false;
    }
  }

  /**
   * Sync daily aggregated stats
   */
  public async syncDailyStats(
    dailyStats: DailyActivitySummary[]
  ): Promise<boolean> {
    if (dailyStats.length === 0) {
      return true;
    }

    const mutation = gql`
      mutation SyncDailyStats($input: [DailyStatsInput!]!) {
        syncDailyStats(input: $input) {
          success
          message
        }
      }
    `;

    const input = dailyStats.map((stat) => ({
      date: stat.date,
      projectPath: stat.projectPath,
      totalDuration: stat.totalDuration,
      languageBreakdown: JSON.stringify(stat.languageBreakdown),
      filesEdited: stat.filesEdited.length,
      commitCount: stat.commitCount,
    }));

    try {
      await this.client.request(mutation, { input });
      this.logger.info(`Synced ${dailyStats.length} daily stats summaries`);
      return true;
    } catch (error) {
      this.logger.error("Failed to sync daily stats", error as Error);
      return false;
    }
  }
}
