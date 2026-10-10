import { LogItem } from '../types';

export class AppLogger {
  private logs: LogItem[] = [];
  private maxLogs = 5000;
  private listeners: ((logs: LogItem[]) => void)[] = [];

  public subscribe(listener: (logs: LogItem[]) => void): () => void {
    this.listeners.push(listener);
    listener([...this.logs]);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener([...this.logs]);
    }
  }

  public getLogs(): LogItem[] {
    return [...this.logs];
  }

  public setLogs(newLogs: LogItem[]) {
    this.logs = newLogs.slice(-this.maxLogs);
    this.notify();
  }

  public clear() {
    this.logs = [];
    this.notify();
  }

  private formatTime(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  public log(entry: Omit<LogItem, 'id' | 'timestamp'>) {
    const item: LogItem = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.formatTime(),
      ...entry
    };

    this.logs.unshift(item);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.notify();
  }

  public exportTxt(): string {
    return this.logs
      .slice()
      .reverse()
      .map(l => `[${l.timestamp}] ${l.type.padEnd(9)} | ${l.message}`)
      .join('\n');
  }

  public exportJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const logger = new AppLogger();
