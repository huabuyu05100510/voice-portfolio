/**
 * StructuredLogger — JSON 结构化日志, 单行输出便于 ELK 采集
 * 对应 Python 端的 server/logger.py StructuredLogger
 */
import { Injectable, LoggerService } from '@nestjs/common';

export interface LogMeta {
  session_id?: string;
  event_type?: string;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

@Injectable()
export class StructuredLogger implements LoggerService {
  private write(level: string, msg: string, extra?: LogMeta): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      logger: 'volc-server',
      message: msg,
      ...extra,
    };
    // 单行 JSON
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  log(msg: string, extra?: LogMeta) {
    this.write('INFO', msg, extra);
  }
  info(msg: string, extra?: LogMeta) {
    this.write('INFO', msg, extra);
  }
  warn(msg: string, extra?: LogMeta) {
    this.write('WARN', msg, extra);
  }
  error(msg: string, extra?: LogMeta) {
    this.write('ERROR', msg, extra);
  }
  debug(msg: string, extra?: LogMeta) {
    if ((process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug') {
      this.write('DEBUG', msg, extra);
    }
  }
  fatal(msg: string, extra?: LogMeta) {
    this.write('FATAL', msg, extra);
  }
  verbose(msg: string, extra?: LogMeta) {
    this.debug(msg, extra);
  }
}
