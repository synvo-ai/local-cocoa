/**
 * Log Sanitizer - Redacts sensitive information from log messages for privacy protection.
 *
 * Supports redaction of:
 * - API keys and tokens
 * - Passwords and secrets
 * - Email addresses
 * - File paths with usernames
 * - IP addresses (optional)
 * - JWT tokens
 * - Bearer tokens
 */

import os from 'os';

// Redaction placeholders
const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[EMAIL_REDACTED]';
const REDACTED_IP = '[IP_REDACTED]';
const REDACTED_JWT = '[JWT_REDACTED]';

interface SanitizePattern {
    pattern: RegExp;
    replacement: string | ((match: string, ...groups: string[]) => string);
}

/**
 * Log sanitizer class that redacts sensitive information from strings.
 */
export class LogSanitizer {
    private enabled: boolean;
    private sanitizePathsEnabled: boolean;
    private patterns: SanitizePattern[];
    private username: string | null;
    private pathCache: Map<string, string>;
    private readonly MAX_CACHE_SIZE = 256;

    constructor(enabled: boolean = true) {
        // Check environment variable for override
        const envEnabled = process.env.LOG_SANITIZE_ENABLED?.toLowerCase();
        this.enabled = enabled && (!envEnabled || ['true', '1', 'yes'].includes(envEnabled));
        const envPathSanitize = process.env.LOG_SANITIZE_PATHS?.toLowerCase();
        // Path username masking is opt-in; keep real paths visible in local dev logs by default.
        this.sanitizePathsEnabled = !!envPathSanitize && ['true', '1', 'yes'].includes(envPathSanitize);
        this.patterns = this.compilePatterns();
        this.username = this.getCurrentUsername();
        this.pathCache = new Map();
    }

    private getCurrentUsername(): string | null {
        try {
            return os.userInfo().username;
        } catch {
            return null;
        }
    }

    private compilePatterns(): SanitizePattern[] {
        const patterns: SanitizePattern[] = [];

        // API Keys - common patterns
        // Format: api_key=xxx, apikey=xxx, api-key=xxx, x-api-key: xxx
        patterns.push({
            pattern: /(?:api[-_]?key|apikey|x-api-key)\s*[=:]\s*["']?([a-zA-Z0-9_-]{16,})["']?/gi,
            replacement: (match, key) => match.replace(key, REDACTED),
        });

        // Bearer tokens
        patterns.push({
            pattern: /(bearer\s+)([a-zA-Z0-9_\-.]+)/gi,
            replacement: `$1${REDACTED}`,
        });

        // Authorization headers
        patterns.push({
            pattern: /(authorization\s*[=:]\s*)["']?([^"'>\s]+)["']?/gi,
            replacement: `$1${REDACTED}`,
        });

        // Password patterns
        // Format: password=xxx, passwd=xxx, pwd=xxx, pass=xxx
        patterns.push({
            pattern: /(password|passwd|pwd|pass)\s*[=:]\s*["']?([^\s"'&]+)["']?/gi,
            replacement: `$1=${REDACTED}`,
        });

        // Secret/Token patterns
        // Format: secret=xxx, token=xxx, access_token=xxx, refresh_token=xxx
        patterns.push({
            pattern: /(secret|token|access_token|refresh_token|client_secret)\s*[=:]\s*["']?([a-zA-Z0-9_\-.]{8,})["']?/gi,
            replacement: `$1=${REDACTED}`,
        });

        // JWT tokens (eyXXX.eyXXX.XXX format)
        patterns.push({
            pattern: /\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
            replacement: REDACTED_JWT,
        });

        // Email addresses
        patterns.push({
            pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
            replacement: REDACTED_EMAIL,
        });

        // Credit card numbers (basic pattern - 13-19 digits with optional spaces/dashes)
        patterns.push({
            pattern: /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g,
            replacement: '[CARD_REDACTED]',
        });

        // IPv4 addresses (optional - only if LOG_SANITIZE_IP is enabled)
        if (['true', '1', 'yes'].includes(process.env.LOG_SANITIZE_IP?.toLowerCase() ?? '')) {
            patterns.push({
                pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
                replacement: REDACTED_IP,
            });
        }

        // Private keys (BEGIN...PRIVATE KEY)
        patterns.push({
            pattern: /-----BEGIN[A-Z\s]*PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]*PRIVATE KEY-----/gm,
            replacement: REDACTED,
        });

        // AWS Access Key ID
        patterns.push({
            pattern: /(aws_access_key_id|aws_secret_access_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{16,})["']?/gi,
            replacement: `$1=${REDACTED}`,
        });

        // Connection strings with passwords
        patterns.push({
            pattern: /(mongodb|mysql|postgres|redis|amqp):\/\/[^:]+:([^@]+)@/gi,
            replacement: `$1://***:${REDACTED}@`,
        });

        return patterns;
    }

    /**
     * Sanitize file paths to remove usernames.
     */
    private sanitizePath(path: string): string {
        if (!this.username || !path.includes(this.username)) {
            return path;
        }

        // Check cache
        const cached = this.pathCache.get(path);
        if (cached !== undefined) {
            return cached;
        }

        let sanitized = path;
        const escapedUsername = this.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // macOS pattern (/Users/username/)
        sanitized = sanitized.replace(
            new RegExp(`/Users/${escapedUsername}/`, 'g'),
            '/Users/[USER]/'
        );

        // Linux pattern (/home/username/)
        sanitized = sanitized.replace(
            new RegExp(`/home/${escapedUsername}/`, 'g'),
            '/home/[USER]/'
        );

        // Windows pattern (C:\Users\username\)
        sanitized = sanitized.replace(
            new RegExp(`[A-Za-z]:\\\\Users\\\\${escapedUsername}\\\\`, 'gi'),
            'C:\\Users\\[USER]\\'
        );

        // Manage cache size
        if (this.pathCache.size >= this.MAX_CACHE_SIZE) {
            // Remove oldest entry
            const firstKey = this.pathCache.keys().next().value;
            if (firstKey) {
                this.pathCache.delete(firstKey);
            }
        }

        this.pathCache.set(path, sanitized);
        return sanitized;
    }

    /**
     * Sanitize a message by redacting sensitive information.
     */
    sanitize(message: string): string {
        if (!this.enabled || !message || typeof message !== 'string') {
            return message;
        }

        let sanitized = message;

        // Apply all regex patterns
        for (const { pattern, replacement } of this.patterns) {
            if (typeof replacement === 'function') {
                sanitized = sanitized.replace(pattern, replacement as any);
            } else {
                sanitized = sanitized.replace(pattern, replacement);
            }
        }

        // Optionally sanitize file paths to remove usernames.
        if (this.sanitizePathsEnabled && this.username) {
            sanitized = this.sanitizePath(sanitized);
        }

        return sanitized;
    }

    /**
     * Enable log sanitization.
     */
    enable(): void {
        this.enabled = true;
    }

    /**
     * Disable log sanitization.
     */
    disable(): void {
        this.enabled = false;
    }

    /**
     * Check if sanitization is enabled.
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}

// Global sanitizer instance
let globalSanitizer: LogSanitizer | null = null;

/**
 * Get the global log sanitizer instance.
 */
export function getSanitizer(): LogSanitizer {
    if (!globalSanitizer) {
        globalSanitizer = new LogSanitizer();
    }
    return globalSanitizer;
}

/**
 * Convenience function to sanitize a log message.
 */
export function sanitizeLog(message: string): string {
    return getSanitizer().sanitize(message);
}

/**
 * Create a sanitizing hook for electron-log.
 * This can be used with electron-log's hooks feature.
 *
 * Usage:
 *   log.hooks.push(createSanitizingHook());
 */
export function createSanitizingHook() {
    const sanitizer = getSanitizer();

    return (message: any, _transport: any) => {
        if (message.data) {
            message.data = message.data.map((item: any) => {
                if (typeof item === 'string') {
                    return sanitizer.sanitize(item);
                }
                if (typeof item === 'object' && item !== null) {
                    // Deep sanitize objects (convert to string, sanitize, parse back)
                    try {
                        const str = JSON.stringify(item);
                        const sanitized = sanitizer.sanitize(str);
                        return JSON.parse(sanitized);
                    } catch {
                        return item;
                    }
                }
                return item;
            });
        }
        return message;
    };
}

export default LogSanitizer;
