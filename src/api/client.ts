import { GraphQLClient, gql } from "graphql-request";
import { Logger } from "../utils/logger";
import { ActivityLog, GitCommit } from "../storage/database";

export class ApiClient {
  private client: GraphQLClient;
  private logger = Logger.getInstance();
  // TODO: Make this configurable
  private endpoint = "https://codechrono.mukulrai.me/api/graphql";

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
      this.logger.info(`Synced ${commits.length} commits to ${this.endpoint}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to sync commits", error as Error);
      return false;
    }
  }
}
