import "server-only";
import { EventEmitter } from "node:events";
import type { LogLine } from "./procman";
import { LOG_MAX_LINES, type EventLogName } from "./shared";

// Logs the panel writes itself (clients, OBS, automation), streamed to the Log Monitor like a
// process's output: "line" and "clear" events, the last LOG_MAX_LINES kept.

export class EventLog extends EventEmitter {
  lines: LogLine[] = [];
  private seq = 0;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  log(level: NonNullable<LogLine["level"]>, text: string) {
    const line: LogLine = { id: ++this.seq, ts: Date.now(), stream: "stdout", level, text };
    this.lines.push(line);
    if (this.lines.length > LOG_MAX_LINES) this.lines.splice(0, this.lines.length - LOG_MAX_LINES);
    this.emit("line", line);
  }

  info(text: string) {
    this.log("info", text);
  }

  warn(text: string) {
    this.log("warning", text);
  }

  error(text: string) {
    this.log("error", text);
  }

  clearLogs() {
    this.lines = [];
    this.emit("clear");
  }
}

const g = globalThis as unknown as { __avEventLogs?: Record<EventLogName, EventLog> };
export const eventLogs = (g.__avEventLogs ??= { clients: new EventLog(), obs: new EventLog(), automation: new EventLog() });
