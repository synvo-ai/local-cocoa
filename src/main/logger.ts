import log from 'electron-log/main';
import path from 'path';
import fs from 'fs';
import { createSanitizingHook } from './logSanitizer';
import { config } from './config';

log.initialize();

// Add sanitizing hook for privacy protection
// This redacts sensitive data like API keys, passwords, emails, etc. from logs
log.hooks.push(createSanitizingHook());

// Configure log levels
log.transports.file.level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as any;
log.transports.console.level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as any;

// Configure log format for main process
log.transports.console.format = '[main] {m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.file.format = '[main] {m}-{d} {h}:{i}:{s} [{level}] {text}';

// Configure log file location
// Uses centralized config for data paths
const getLogPath = (): string => {
    const logsDir = path.dirname(config.paths.electronLogPath);
    
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    return config.paths.electronLogPath;
};

// Set the log file path
if (config.paths.electronLogPath) {
    log.transports.file.resolvePathFn = getLogPath;

    // Configure log rotation
    log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB max file size

    // Print the log file path so we know where it is
    console.log('[Logger] Log file location:', log.transports.file.getFile().path);
}

// Overwrite console.log to use electron-log
Object.assign(console, log.functions);

// Export the logs directory path for use by other modules
export function getLogsDirectory(): string {
    return path.dirname(log.transports.file.getFile().path);
}

export default log;
