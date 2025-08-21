// config-validator.js - Configuration validation and environment setup checker
// Helps junior admins identify missing environment variables and configuration issues

import { promises as fsPromises } from 'fs';
import path from 'path';
import { ConfigError } from './error-handler.js';

class ConfigValidator {
    constructor() {
        this.requiredEnvVars = [
            'RC_SERVER',
            'RC_CLIENT_ID', 
            'RC_CLIENT_SECRET',
            'RC_JWT',
            'GEMINI_API_KEY'
        ];
        
        this.optionalEnvVars = [
            'LOG_LEVEL',
            'PORT',
            'REPORTS_DIR'
        ];
    }

    async validateEnvironment() {
        const results = {
            valid: true,
            errors: [],
            warnings: [],
            config: {}
        };

        // Check if .env file exists
        try {
            await fsPromises.access('.env');
            results.config.envFileExists = true;
        } catch {
            results.warnings.push('No .env file found. Using system environment variables.');
            results.config.envFileExists = false;
        }

        // Validate required environment variables
        for (const envVar of this.requiredEnvVars) {
            const value = process.env[envVar];
            if (!value) {
                results.valid = false;
                results.errors.push(`Missing required environment variable: ${envVar}`);
            } else {
                results.config[envVar] = this.maskSensitiveValue(envVar, value);
            }
        }

        // Check optional environment variables
        for (const envVar of this.optionalEnvVars) {
            const value = process.env[envVar];
            if (value) {
                results.config[envVar] = value;
            }
        }

        // Validate specific configurations
        await this.validateSpecificConfigs(results);

        return results;
    }

    async validateSpecificConfigs(results) {
        // Validate RingCentral server URL
        if (process.env.RC_SERVER) {
            const validServers = [
                'https://platform.ringcentral.com',
                'https://platform.devtest.ringcentral.com'
            ];
            if (!validServers.includes(process.env.RC_SERVER)) {
                results.warnings.push(`RC_SERVER "${process.env.RC_SERVER}" is not a standard RingCentral server URL`);
            }
        }

        // Validate JWT format (basic check)
        if (process.env.RC_JWT) {
            const jwtParts = process.env.RC_JWT.split('.');
            if (jwtParts.length !== 3) {
                results.errors.push('RC_JWT does not appear to be a valid JWT format');
                results.valid = false;
            }
        }

        // Check reports directory permissions
        const reportsDir = process.env.REPORTS_DIR || './reports';
        try {
            await fsPromises.mkdir(reportsDir, { recursive: true });
            await fsPromises.access(reportsDir, fsPromises.constants.W_OK);
            results.config.reportsDir = reportsDir;
            results.config.reportsDirWritable = true;
        } catch (error) {
            results.errors.push(`Reports directory "${reportsDir}" is not writable: ${error.message}`);
            results.valid = false;
        }

        // Check logs directory permissions
        const logsDir = './logs';
        try {
            await fsPromises.mkdir(logsDir, { recursive: true });
            await fsPromises.access(logsDir, fsPromises.constants.W_OK);
            results.config.logsDir = logsDir;
            results.config.logsDirWritable = true;
        } catch (error) {
            results.warnings.push(`Logs directory "${logsDir}" is not writable: ${error.message}`);
        }
    }

    maskSensitiveValue(key, value) {
        const sensitiveKeys = ['CLIENT_SECRET', 'JWT', 'API_KEY'];
        if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
            return value.substring(0, 8) + '***';
        }
        return value;
    }

    async generateConfigReport() {
        const validation = await this.validateEnvironment();
        
        let report = '# Configuration Validation Report\n\n';
        report += `**Status:** ${validation.valid ? '✅ Valid' : '❌ Invalid'}\n`;
        report += `**Generated:** ${new Date().toISOString()}\n\n`;

        if (validation.errors.length > 0) {
            report += '## ❌ Errors\n';
            validation.errors.forEach(error => {
                report += `- ${error}\n`;
            });
            report += '\n';
        }

        if (validation.warnings.length > 0) {
            report += '## ⚠️ Warnings\n';
            validation.warnings.forEach(warning => {
                report += `- ${warning}\n`;
            });
            report += '\n';
        }

        report += '## 📋 Configuration Summary\n';
        Object.entries(validation.config).forEach(([key, value]) => {
            report += `- **${key}:** ${value}\n`;
        });

        return report;
    }

    async validateAndThrow() {
        const validation = await this.validateEnvironment();
        if (!validation.valid) {
            const errorMessage = `Configuration validation failed:\n${validation.errors.join('\n')}`;
            throw new ConfigError(errorMessage);
        }
        return validation;
    }

    // Quick health check for monitoring
    async healthCheck() {
        try {
            const validation = await this.validateEnvironment();
            return {
                status: validation.valid ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                errors: validation.errors,
                warnings: validation.warnings
            };
        } catch (error) {
            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }
}

export default ConfigValidator;
