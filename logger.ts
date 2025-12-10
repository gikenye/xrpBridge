interface LogContext {
  [key: string]: any;
}

export class Logger {
  private static instance: Logger;
  private context: LogContext = {};

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  private log(level: string, message: string, meta?: LogContext): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...meta
    };
    
    console.log(JSON.stringify(logEntry));
  }

  info(message: string, meta?: LogContext): void {
    this.log('INFO', message, meta);
  }

  error(message: string, error?: Error, meta?: LogContext): void {
    this.log('ERROR', message, {
      error: error?.message,
      stack: error?.stack,
      ...meta
    });
  }

  warn(message: string, meta?: LogContext): void {
    this.log('WARN', message, meta);
  }

  debug(message: string, meta?: LogContext): void {
    this.log('DEBUG', message, meta);
  }
}

export const logger = Logger.getInstance();