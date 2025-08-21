// diagnostics.js - System diagnostics and health monitoring utilities

import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';

class DiagnosticsManager {
    constructor() {
        this.startTime = Date.now();
        this.requestCount = 0;
        this.errorCount = 0;
        this.apiCallStats = {
            ringcentral: { calls: 0, errors: 0, totalTime: 0 },
            gemini: { calls: 0, errors: 0, totalTime: 0 }
        };
    }

    // System information gathering
    getSystemInfo() {
        return {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            nodeVersion: process.version,
            platform: os.platform(),
            arch: os.arch(),
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            loadAverage: os.loadavg(),
            networkInterfaces: this.getNetworkInfo()
        };
    }

    getNetworkInfo() {
        const interfaces = os.networkInterfaces();
        const result = {};
        
        Object.keys(interfaces).forEach(name => {
            result[name] = interfaces[name]
                .filter(iface => !iface.internal)
                .map(iface => ({
                    address: iface.address,
                    family: iface.family,
                    mac: iface.mac
                }));
        });
        
        return result;
    }

    // Application statistics
    getAppStats() {
        return {
            uptime: Date.now() - this.startTime,
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount * 100).toFixed(2) + '%' : '0%',
            apiStats: this.getApiStats()
        };
    }

    getApiStats() {
        const stats = {};
        Object.keys(this.apiCallStats).forEach(service => {
            const serviceStats = this.apiCallStats[service];
            stats[service] = {
                totalCalls: serviceStats.calls,
                errors: serviceStats.errors,
                errorRate: serviceStats.calls > 0 ? 
                    (serviceStats.errors / serviceStats.calls * 100).toFixed(2) + '%' : '0%',
                averageResponseTime: serviceStats.calls > 0 ? 
                    (serviceStats.totalTime / serviceStats.calls).toFixed(2) + 'ms' : '0ms'
            };
        });
        return stats;
    }

    // Directory and file system checks
    async checkFileSystem() {
        const checks = [];
        const directories = ['./reports', './logs', './node_modules'];
        
        for (const dir of directories) {
            try {
                const stats = await fsPromises.stat(dir);
                const files = await fsPromises.readdir(dir);
                checks.push({
                    path: dir,
                    exists: true,
                    isDirectory: stats.isDirectory(),
                    size: stats.size,
                    fileCount: files.length,
                    lastModified: stats.mtime,
                    permissions: {
                        readable: true,
                        writable: await this.checkWritePermission(dir)
                    }
                });
            } catch (error) {
                checks.push({
                    path: dir,
                    exists: false,
                    error: error.message
                });
            }
        }
        
        return checks;
    }

    async checkWritePermission(dir) {
        try {
            const testFile = path.join(dir, '.write-test');
            await fsPromises.writeFile(testFile, 'test');
            await fsPromises.unlink(testFile);
            return true;
        } catch {
            return false;
        }
    }

    // Environment and configuration checks
    checkEnvironment() {
        const requiredVars = ['RC_SERVER', 'RC_CLIENT_ID', 'RC_CLIENT_SECRET', 'RC_JWT', 'GEMINI_API_KEY'];
        const optionalVars = ['LOG_LEVEL', 'PORT', 'REPORTS_DIR'];
        
        const env = {
            required: {},
            optional: {},
            missing: [],
            present: []
        };

        requiredVars.forEach(varName => {
            if (process.env[varName]) {
                env.required[varName] = this.maskSensitive(varName, process.env[varName]);
                env.present.push(varName);
            } else {
                env.missing.push(varName);
            }
        });

        optionalVars.forEach(varName => {
            if (process.env[varName]) {
                env.optional[varName] = process.env[varName];
                env.present.push(varName);
            }
        });

        return env;
    }

    maskSensitive(key, value) {
        const sensitiveKeys = ['SECRET', 'JWT', 'KEY'];
        if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
            return value.substring(0, 8) + '***';
        }
        return value;
    }

    // Performance monitoring
    startTimer(operation) {
        return {
            operation,
            startTime: performance.now(),
            end: () => {
                const duration = performance.now() - this.startTime;
                return { operation, duration };
            }
        };
    }

    recordApiCall(service, duration, error = null) {
        if (!this.apiCallStats[service]) {
            this.apiCallStats[service] = { calls: 0, errors: 0, totalTime: 0 };
        }
        
        this.apiCallStats[service].calls++;
        this.apiCallStats[service].totalTime += duration;
        
        if (error) {
            this.apiCallStats[service].errors++;
        }
    }

    recordRequest(error = null) {
        this.requestCount++;
        if (error) {
            this.errorCount++;
        }
    }

    // Generate comprehensive diagnostic report
    async generateDiagnosticReport() {
        const systemInfo = this.getSystemInfo();
        const appStats = this.getAppStats();
        const fileSystemChecks = await this.checkFileSystem();
        const envChecks = this.checkEnvironment();

        const report = {
            timestamp: new Date().toISOString(),
            system: systemInfo,
            application: appStats,
            filesystem: fileSystemChecks,
            environment: envChecks,
            health: this.getHealthStatus(systemInfo, appStats, fileSystemChecks, envChecks)
        };

        return report;
    }

    getHealthStatus(system, app, filesystem, environment) {
        const issues = [];
        const warnings = [];

        // Memory usage check
        const memoryUsagePercent = (system.memoryUsage.heapUsed / system.memoryUsage.heapTotal) * 100;
        if (memoryUsagePercent > 90) {
            issues.push('High memory usage detected');
        } else if (memoryUsagePercent > 75) {
            warnings.push('Elevated memory usage');
        }

        // Error rate check
        const errorRate = parseFloat(app.errorRate);
        if (errorRate > 10) {
            issues.push(`High error rate: ${app.errorRate}`);
        } else if (errorRate > 5) {
            warnings.push(`Elevated error rate: ${app.errorRate}`);
        }

        // Environment variables check
        if (environment.missing.length > 0) {
            issues.push(`Missing required environment variables: ${environment.missing.join(', ')}`);
        }

        // File system check
        const criticalDirs = filesystem.filter(dir => 
            ['./reports', './logs'].includes(dir.path) && (!dir.exists || !dir.permissions?.writable)
        );
        if (criticalDirs.length > 0) {
            issues.push('Critical directories not accessible or writable');
        }

        return {
            status: issues.length > 0 ? 'unhealthy' : warnings.length > 0 ? 'warning' : 'healthy',
            issues,
            warnings
        };
    }

    // Export diagnostic data for external monitoring
    async exportDiagnostics(format = 'json') {
        const report = await this.generateDiagnosticReport();
        
        if (format === 'json') {
            return JSON.stringify(report, null, 2);
        } else if (format === 'text') {
            return this.formatReportAsText(report);
        }
        
        return report;
    }

    formatReportAsText(report) {
        let text = `DIAGNOSTIC REPORT - ${report.timestamp}\n`;
        text += '='.repeat(50) + '\n\n';
        
        text += `HEALTH STATUS: ${report.health.status.toUpperCase()}\n`;
        if (report.health.issues.length > 0) {
            text += `Issues: ${report.health.issues.join(', ')}\n`;
        }
        if (report.health.warnings.length > 0) {
            text += `Warnings: ${report.health.warnings.join(', ')}\n`;
        }
        text += '\n';

        text += 'SYSTEM INFO:\n';
        text += `- Uptime: ${Math.floor(report.system.uptime / 1000 / 60)} minutes\n`;
        text += `- Memory Usage: ${(report.system.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
        text += `- Platform: ${report.system.platform} ${report.system.arch}\n\n`;

        text += 'APPLICATION STATS:\n';
        text += `- Total Requests: ${report.application.requestCount}\n`;
        text += `- Error Rate: ${report.application.errorRate}\n`;
        text += `- API Calls: ${JSON.stringify(report.application.apiStats, null, 2)}\n\n`;

        return text;
    }
}

// Create singleton instance
const diagnostics = new DiagnosticsManager();

export default diagnostics;
