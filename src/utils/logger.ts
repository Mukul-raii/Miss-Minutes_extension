import * as vscode from "vscode";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Miss-Minutes");
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  public debug(message: string, ...args: any[]) {
    if (this.logLevel <= LogLevel.DEBUG) {
      this.log(`[DEBUG] ${message}`, ...args);
    }
  }

  public info(message: string, ...args: any[]) {
    if (this.logLevel <= LogLevel.INFO) {
      this.log(`[INFO] ${message}`, ...args);
    }
  }

  public warn(message: string, ...args: any[]) {
    if (this.logLevel <= LogLevel.WARN) {
      this.log(`[WARN] ${message}`, ...args);
    }
  }

  public error(message: string, error?: any) {
    if (this.logLevel <= LogLevel.ERROR) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log(`[ERROR] ${message}`, errorMessage);
      if (error instanceof Error && error.stack) {
        this.log(error.stack);
      }
    }
  }

  private log(message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `${timestamp} ${message} ${
      args.length ? JSON.stringify(args) : ""
    }`;
    console.log(formattedMessage); // Also log to debug console
    this.outputChannel.appendLine(formattedMessage);
  }

  public show() {
    this.outputChannel.show();
  }
}
