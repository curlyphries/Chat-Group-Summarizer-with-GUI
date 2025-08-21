// logger.js - Enhanced logging system for debugging and troubleshooting
// This provides structured logging with correlation IDs to help junior admins trace issues

import { promises as fsPromises } from 'fs';
import path from 'path';
import { format } from 'date-fns';

class Logger {
    constructor(options = {}) {
        this.logLevel = options.logLevel || process.env.LOG_LEVEL || 'info';
        this.logDir = options.logDir || './logs';
        this.maxLogFiles = options.maxLogFiles || 10;
        this.maxLogSize = options.maxLogSize || 10 * 1024 * 1024; // 10MB
        this.correlationId = null;
        
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            trace: 4
        };
        
        this.init();
    }

    async init() {
        try {
            await fsPromises.mkdir(this.logDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create log directory:', error);
        }
    }

    setCorrelationId(id) {
        this.correlationId = id;
    }

    generateCorrelationId() {
        this.correlationId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return this.correlationId;
    }

    shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

    formatMessage(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const correlationId = this.correlationId || 'no-correlation';
        
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            correlationId,
            message,
            ...meta
        };

        // Console output with colors
        const colors = {
            error: '\x1b[31m',   // Red
            warn: '\x1b[33m',    // Yellow
            info: '\x1b[36m',    // Cyan
            debug: '\x1b[35m',   // Magenta
            trace: '\x1b[37m',   // White
            reset: '\x1b[0m'
        };

        const coloredLevel = `${colors[level] || colors.reset}[${level.toUpperCase()}]${colors.reset}`;
        console.log(`${timestamp} ${coloredLevel} [${correlationId}] ${message}`, meta.stack ? `\n${meta.stack}` : '');

        return JSON.stringify(logEntry) + '\n';
    }

    async writeToFile(content, level) {
        try {
            const date = format(new Date(), 'yyyy-MM-dd');
            const filename = `app-${date}.log`;
            const filepath = path.join(this.logDir, filename);
            
            await fsPromises.appendFile(filepath, content);
            
            // Rotate logs if needed
            await this.rotateLogs(filepath);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    async rotateLogs(currentFile) {
        try {
            const stats = await fsPromises.stat(currentFile);
            if (stats.size > this.maxLogSize) {
                const timestamp = format(new Date(), 'yyyy-MM-dd-HH-mm-ss');
                const rotatedFile = currentFile.replace('.log', `-${timestamp}.log`);
                await fsPromises.rename(currentFile, rotatedFile);
                
                // Clean up old log files
                await this.cleanupOldLogs();
            }
        } catch (error) {
            console.error('Failed to rotate logs:', error);
        }
    }

    async cleanupOldLogs() {
        try {
            const files = await fsPromises.readdir(this.logDir);
            const logFiles = files
                .filter(file => file.startsWith('app-') && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.logDir, file),
                    time: fsPromises.stat(path.join(this.logDir, file)).then(s => s.mtime)
                }));

            const sortedFiles = await Promise.all(
                logFiles.map(async file => ({
                    ...file,
                    time: await file.time
                }))
            );

            sortedFiles.sort((a, b) => b.time - a.time);

            if (sortedFiles.length > this.maxLogFiles) {
                const filesToDelete = sortedFiles.slice(this.maxLogFiles);
                await Promise.all(
                    filesToDelete.map(file => fsPromises.unlink(file.path))
                );
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }

    async log(level, message, meta = {}) {
        if (!this.shouldLog(level)) return;

        const formattedMessage = this.formatMessage(level, message, meta);
        await this.writeToFile(formattedMessage, level);
    }

    error(message, meta = {}) {
        return this.log('error', message, meta);
    }

    warn(message, meta = {}) {
        return this.log('warn', message, meta);
    }

    info(message, meta = {}) {
        return this.log('info', message, meta);
    }

    debug(message, meta = {}) {
        return this.log('debug', message, meta);
    }

    trace(message, meta = {}) {
        return this.log('trace', message, meta);
    }

    // Specialized logging methods for common scenarios
    apiRequest(method, url, params = {}) {
        this.debug('API Request', {
            method,
            url,
            params: JSON.stringify(params),
            timestamp: new Date().toISOString()
        });
    }

    apiResponse(method, url, statusCode, responseTime, error = null) {
        const level = error ? 'error' : statusCode >= 400 ? 'warn' : 'debug';
        this.log(level, 'API Response', {
            method,
            url,
            statusCode,
            responseTime: `${responseTime}ms`,
            error: error?.message,
            stack: error?.stack
        });
    }

    userAction(action, userId, details = {}) {
        this.info('User Action', {
            action,
            userId,
            ...details
        });
    }

    systemEvent(event, details = {}) {
        this.info('System Event', {
            event,
            ...details
        });
    }

    performance(operation, duration, details = {}) {
        const level = duration > 5000 ? 'warn' : 'debug';
        this.log(level, 'Performance Metric', {
            operation,
            duration: `${duration}ms`,
            ...details
        });
    }
}

// Create singleton instance
const logger = new Logger();

export default logger;
