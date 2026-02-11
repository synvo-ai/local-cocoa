import log from 'electron-log/main';
import { FormatParams } from 'electron-log';
import path from 'path';
import fs from 'fs';
import { createSanitizingHook } from './logSanitizer';
import { config } from './config';

const COLORS: Record<string, string> = {
    info: '\x1b[92m',    // Light Green
    error: '\x1b[91m',   // Light Red
    warn: '\x1b[93m',    // Light Yellow
    debug: '\x1b[94m',   // Light Blue
};
const RESET = '\x1b[0m';

log.initialize();

// Add sanitizing hook for privacy protection
// This redacts sensitive data like API keys, passwords, emails, etc. from logs
log.hooks.push(createSanitizingHook());

// Configure log format for main process
/**
 * Helper to get caller file and line number from stack trace.
 * This ensures we capture the actual caller of console.log, even when wrapped.
 */
function getCallerInfo(): { file: string; line: string } | null {
    const originalStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 25; // Increase depth to ensure we cross IPC boundaries
    const stack = new Error().stack;
    Error.stackTraceLimit = originalStackTraceLimit;

    if (!stack) return null;

    const lines = stack.split('\n');
    for (const line of lines) {
        // Skip frames from known log wrappers or internal Node/Electron/Library code
        const lowerLine = line.toLowerCase();
        if (
            lowerLine.includes('logger.ts') ||
            lowerLine.includes('electron-log') ||
            lowerLine.includes('node_modules') ||
            lowerLine.includes('node:') ||
            lowerLine.includes('error') ||
            lowerLine.includes('<anonymous>') ||
            lowerLine.includes('ipcmainimpl') ||
            lowerLine.includes('eventemitter') ||
            lowerLine.includes('js2c') ||
            lowerLine.includes('electron/js2c') ||
            lowerLine.includes('internal/')
        ) {
            continue;
        }

        // Match common stack frame formats:
        // "at FunctionName (path:line:col)"
        // "at path:line:col"
        // Also handle cases where path might contain spaces or multiple colons (like node:events:123)
        const match = line.match(/(?:at\s+)?(?:\S+\s+)?\(?(.+?):(\d+)(?::(\d+))?\)?$/);
        if (match) {
            const filePath = match[1];
            const lineNumber = match[2];

            // If the "file" part looks like a node internal (e.g. "node"), skip it
            if (filePath === 'node' || filePath.startsWith('node:')) {
                continue;
            }

            return {
                file: path.basename(filePath),
                line: lineNumber
            };
        }
    }
    return null;
}

// Configure log format for main process
log.transports.console.format = (params: FormatParams) => {
    const date = new Date(Date.now());
    const { level = 'info', data = [] } = params;

    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const i = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');

    const formattedTime = `${m}-${d} ${h}:${i}:${s}`;
    const color = COLORS[level] || '';
    const coloredLevel = `${color}${level.toUpperCase()}${RESET}`;

    const text = data.map(arg => {
        if (arg === null) {
            return 'null';
        }

        if (typeof arg === 'string') {
            return arg;
        }
        if (typeof arg !== 'object') {
            return String(arg);
        }
        try {
            return JSON.stringify(arg, null, 2);
        } catch {
            return '[Complex Object]';
        }
    }).join(' ');

    // Check if it's a renderer log. electron-log v5 uses processType or process variable.
    const variables = (params as any).variables || {};
    const isRenderer = variables.processType === 'renderer' || variables.process === 'renderer';
    let fileInfo = '';

    if (isRenderer) {
        // For renderer logs, use variables sent from the renderer.
        // If they contain stack-like strings, they're likely captured in the wrong process.
        const fileName = String(variables.file || '');
        if (fileName && !fileName.includes(' at ') && !fileName.includes('node_modules')) {
            fileInfo = ` (${path.basename(fileName)}:${variables.line})`;
        }
    } else {
        // For main process logs, prioritize our filtered stack trace analysis.
        const caller = getCallerInfo();
        if (caller) {
            fileInfo = ` (${caller.file}:${caller.line})`;
        } else {
            // Fallback to variables if stack trace failed, but only if they look like real paths.
            const fileName = String(variables.file || '');
            if (fileName && !fileName.includes(' at ') && !fileName.includes('node_modules')) {
                fileInfo = ` (${path.basename(fileName)}:${variables.line})`;
            }
        }
    }

    return [`${formattedTime} [${coloredLevel}]${fileInfo} ${text}`];
};

log.transports.file.format = (params: FormatParams) => {
    const date = new Date();
    const { level = 'info', data = [] } = params;

    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const i = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');

    const formattedTime = `${m}-${d} ${h}:${i}:${s}`;

    const text = data.map(arg => {
        if (typeof arg === 'string') return arg;
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }).join(' ');

    const variables = (params as any).variables || {};
    const isRenderer = variables.processType === 'renderer' || variables.process === 'renderer';
    let fileInfo = '';

    if (isRenderer) {
        const fileName = String(variables.file || '');
        if (fileName && !fileName.includes(' at ')) {
            fileInfo = ` (${path.basename(fileName)}:${variables.line})`;
        }
    } else {
        const caller = getCallerInfo();
        if (caller) {
            fileInfo = ` (${caller.file}:${caller.line})`;
        }
    }

    return [`${formattedTime} [${level.toUpperCase()}]${fileInfo} ${text}`];
};

/**
 * Update log settings
 */
export function updateLogSettings(): void {
    // TODO: if necessary, should support more log levels and update python backend too

    log.transports.file.level = config.logLevel as any;
    log.transports.console.level = config.logLevel as any;

    if (config.paths.electronLogPath) {
        // Ensure logs directory exists
        if (!fs.existsSync(path.dirname(config.paths.electronLogPath))) {
            fs.mkdirSync(path.dirname(config.paths.electronLogPath), { recursive: true });
        }

        log.transports.file.resolvePathFn = () => config.paths.electronLogPath;

        // Configure log rotation
        log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB max file size

        // Print the log file path so we know where it is
        console.info('[Logger] Log file location:', log.transports.file.getFile().path);
    }

    // Overwrite console.log to use electron-log
    Object.assign(console, log.functions);

    console.info(`[Logger] Log level set to ${config.logLevel}.`);
}

/**
 * Get the current log file path
 */
export function getDebugLogPath(): string {
    return log.transports.file.getFile().path;
}

/**
 * Clear the log file by deleting it.
 */
export function clearDebugLog(): void {
    try {
        const logFile = log.transports.file.getFile().path;
        if (fs.existsSync(logFile)) {
            fs.unlinkSync(logFile);
        }
    } catch {
        // ignore
    }
}


// Export the logs directory path for use by other modules
export function getLogsDirectory(): string {
    return path.dirname(log.transports.file.getFile().path);
}

export default log;

