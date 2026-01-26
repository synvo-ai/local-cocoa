import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { sanitizeLog } from './logSanitizer';

// Debug mode state - can be updated at runtime
let debugModeEnabled = false;

const DEBUG_LOG_FILE = path.join(app.getPath('home'), 'local-cocoa-debug.log');

/**
 * Enable or disable debug mode
 */
export function setDebugMode(enabled: boolean): void {
    debugModeEnabled = enabled;
    if (enabled) {
        // Clear the debug log when enabling
        try {
            fs.writeFileSync(DEBUG_LOG_FILE, `[${new Date().toISOString()}] Debug mode enabled\n`);
        } catch (e) {
            // ignore
        }
    }
    console.log(`[Debug] Debug mode ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
    return debugModeEnabled;
}

/**
 * Get the debug log file path
 */
export function getDebugLogPath(): string {
    return DEBUG_LOG_FILE;
}

/**
 * Create a debug logger for a specific component
 * Only writes to file when debug mode is enabled
 * Applies log sanitization for privacy protection
 */
export function createDebugLogger(component: string) {
    return (msg: string) => {
        // Sanitize the message to redact sensitive information
        const sanitizedMsg = sanitizeLog(msg);
        const line = `[${new Date().toISOString()}] [${component}] ${sanitizedMsg}`;
        
        // Always log to console
        console.log(line);
        
        // Only write to file if debug mode is enabled
        if (debugModeEnabled) {
            try {
                fs.appendFileSync(DEBUG_LOG_FILE, line + '\n');
            } catch (e) {
                // ignore file write errors
            }
        }
    };
}

/**
 * Delete the debug log file
 */
export function clearDebugLog(): void {
    try {
        if (fs.existsSync(DEBUG_LOG_FILE)) {
            fs.unlinkSync(DEBUG_LOG_FILE);
        }
    } catch (e) {
        // ignore
    }
}

