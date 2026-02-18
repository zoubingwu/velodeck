import { mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "../../shared/contracts";

const LOG_FILE_NAME = "velodeck.log";

function timestamp(): string {
  return new Date().toISOString();
}

function formatLine(level: string, message: string): string {
  return `[${timestamp()}] [${level}] ${message}\n`;
}

export class LoggerService {
  private fd: number | null = null;

  constructor() {
    const logPath = join(homedir(), CONFIG_DIR_NAME, LOG_FILE_NAME);
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o750 });
    this.fd = openSync(logPath, "a", 0o666);
  }

  private write(level: string, message: string): void {
    const line = formatLine(level, message);
    if (this.fd !== null) {
      writeSync(this.fd, line);
    }
    process.stderr.write(line);
  }

  debug(message: string): void {
    this.write("DEBUG", message);
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }
}

export const logger = new LoggerService();
