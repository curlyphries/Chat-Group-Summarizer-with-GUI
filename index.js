// index.js - Chat Group Summarizer with Enhanced Debugging and Monitoring

import 'dotenv/config';
import { promises as fsPromises, createWriteStream } from 'fs';
import path from 'path';
import express from 'express';
import showdown from 'showdown';
import { format } from 'date-fns';
import * as RingCentralSDK from '@ringcentral/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { handleError, ConfigError, APIError } from './error-handler.js';
import logger from './logger.js';
import ConfigValidator from './config-validator.js';
import diagnostics from './diagnostics.js';
import { fetchChatMessagesSmart } from './enhanced-fetch-messages.js';

// --- SETUP ---
// Cache for person names to avoid repeated API calls
const personCache = {};
const app = express();
const port = process.env.PORT || 3000;
const reportsDir = process.env.REPORTS_DIR || './reports';
const mdConverter = new showdown.Converter({ openLinksInNewWindow: true });
const configValidator = new ConfigValidator();

// Predefined chat groups for easy selection in the UI
const PRESET_CHAT_GROUPS = {
    '7595909126': 'Global CC TAM',
    '21861851142': 'Global RingEX TAM',
    '1310416902': 'Global Advanced Support (UC)',
    '17273856006': 'CC Support (NA, EMEA, and APAC)',
    '122943823878': 'TAM Message Board'
};

// --- MIDDLEWARE ---
// Request logging and correlation ID tracking for debugging
app.use((req, res, next) => {
    const correlationId = logger.generateCorrelationId();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    
    logger.info('Incoming Request', {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip
    });
    
    diagnostics.recordRequest();
    next();
});

// --- DIAGNOSTIC AND HEALTH ENDPOINTS ---
// These endpoints help junior admins troubleshoot issues

app.get('/health', async (req, res) => {
    try {
        const health = await configValidator.healthCheck();
        const systemHealth = await diagnostics.generateDiagnosticReport();
        
        res.status(health.status === 'healthy' ? 200 : 503).json({
            status: health.status,
            timestamp: new Date().toISOString(),
            correlationId: req.correlationId,
            config: health,
            system: systemHealth.health
        });
    } catch (error) {
        logger.error('Health check failed', { error: error.message, stack: error.stack });
        res.status(500).json({
            status: 'error',
            error: error.message,
            correlationId: req.correlationId
        });
    }
});

app.get('/diagnostics', async (req, res) => {
    try {
        const format = req.query.format || 'json';
        const report = await diagnostics.exportDiagnostics(format);
        
        if (format === 'text') {
            res.setHeader('Content-Type', 'text/plain');
            res.send(report);
        } else {
            res.json(JSON.parse(report));
        }
    } catch (error) {
        logger.error('Diagnostics generation failed', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Failed to generate diagnostics' });
    }
});

app.get('/config-report', async (req, res) => {
    try {
        const report = await configValidator.generateConfigReport();
        res.setHeader('Content-Type', 'text/markdown');
        res.send(report);
    } catch (error) {
        logger.error('Config report generation failed', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Failed to generate config report' });
    }
});

// --- MAIN APPLICATION ENDPOINTS ---

app.get('/', (req, res) => {
    logger.debug('Serving main page');
    res.sendFile(path.resolve(process.cwd(), 'index.html'));
});

app.get('/reports', async (req, res) => {
    const timer = diagnostics.startTimer('list-reports');
    try {
        await fsPromises.mkdir(reportsDir, { recursive: true });
        const files = await fsPromises.readdir(reportsDir);
        const reports = files.filter(file => file.endsWith('.md')).sort().reverse();
        
        logger.debug('Reports listed', { count: reports.length });
        res.json(reports);
    } catch (error) {
        logger.error('Failed to read reports directory', { 
            error: error.message, 
            reportsDir,
            stack: error.stack 
        });
        diagnostics.recordRequest(error);
        res.status(500).json({ 
            error: 'Failed to read reports directory.',
            correlationId: req.correlationId
        });
    } finally {
        const { duration } = timer.end();
        diagnostics.recordApiCall('filesystem', duration);
    }
});

app.get('/report/:filename', async (req, res) => {
    const timer = diagnostics.startTimer('get-report');
    try {
        const filePath = path.join(reportsDir, req.params.filename);
        
        // Security check - ensure file is within reports directory
        const resolvedPath = path.resolve(filePath);
        const resolvedReportsDir = path.resolve(reportsDir);
        if (!resolvedPath.startsWith(resolvedReportsDir)) {
            throw new Error('Invalid file path');
        }
        
        const markdown = await fsPromises.readFile(filePath, 'utf-8');
        const html = mdConverter.makeHtml(markdown);
        
        logger.debug('Report served', { filename: req.params.filename });
        res.json({ markdown, html });
    } catch (error) {
        logger.error('Report not found or inaccessible', { 
            filename: req.params.filename,
            error: error.message 
        });
        diagnostics.recordRequest(error);
        res.status(404).json({ 
            error: 'Report not found.',
            correlationId: req.correlationId
        });
    } finally {
        const { duration } = timer.end();
        diagnostics.recordApiCall('filesystem', duration);
    }
});

app.get('/generate-report', async (req, res) => {
    const overallTimer = diagnostics.startTimer('generate-report');
    logger.setCorrelationId(req.correlationId);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Correlation-ID', req.correlationId);

    const { debug } = req.query;
    const isDebugMode = debug === 'true';
    let logStream;

    if (isDebugMode) {
        logStream = createWriteStream('debug.log', { flags: 'a' });
        logStream.write(`\n--- NEW DEBUG SESSION: ${new Date().toISOString()} [${req.correlationId}] ---\n`);
    }

    const logDebug = (message, meta = {}) => {
        if (isDebugMode) {
            console.log(message);
            logStream.write(`${message}\n`);
        }
        logger.debug(message, meta);
    };

    const sendEvent = (type, message, data = {}) => {
        const eventData = { 
            type, 
            message, 
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
            ...data 
        };
        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        logger.debug('SSE Event sent', { type, message });
    };

    try {
        logger.info('Starting report generation');
        sendEvent('status', 'Validating configuration...');
        await configValidator.validateAndThrow();

        const RingCentral = RingCentralSDK.SDK;
        sendEvent('status', 'Initializing SDKs...');
        
        const rcsdk = new RingCentral({ 
            server: process.env.RC_SERVER, 
            clientId: process.env.RC_CLIENT_ID, 
            clientSecret: process.env.RC_CLIENT_SECRET 
        });
        const platform = rcsdk.platform();
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        sendEvent('status', 'Logging into RingCentral...');
        const loginTimer = diagnostics.startTimer('rc-login');
        
        try {
            await platform.login({ jwt: process.env.RC_JWT });
            const { duration } = loginTimer.end();
            diagnostics.recordApiCall('ringcentral', duration);
            logger.info('RingCentral login successful', { duration: `${duration}ms` });
            sendEvent('status', 'Successfully logged in!');
        } catch (error) {
            const { duration } = loginTimer.end();
            diagnostics.recordApiCall('ringcentral', duration, error);
            throw new APIError('RingCentral login failed', error.status, 'RingCentral');
        }

        const { dateFrom, timeFrom, dateTo, timeTo } = req.query;
        let { chatId: chatIds } = req.query;
        if (!Array.isArray(chatIds)) chatIds = [chatIds];

        const startDateTime = new Date(`${dateFrom}T${timeFrom}:00Z`);
        const endDateTime = new Date(`${dateTo}T${timeTo}:00Z`);
        
        logger.info('Report parameters', {
            dateRange: `${startDateTime.toISOString()} to ${endDateTime.toISOString()}`,
            chatIds: chatIds.length,
            debugMode: isDebugMode
        });
        
        if (!chatIds || chatIds.length === 0) {
            throw new ConfigError('No Chat ID provided.');
        }

        let allConversations = [];
        for (const chatId of chatIds) {
            const groupName = PRESET_CHAT_GROUPS[chatId] || `Custom Group (${chatId})`;
            sendEvent('status', `Fetching messages from ${groupName}...`);
            
            const fetchTimer = diagnostics.startTimer(`fetch-${chatId}`);
            try {
                const messages = await fetchChatMessagesSmart(platform, chatId, startDateTime, endDateTime, logDebug);
                const { duration } = fetchTimer.end();
                diagnostics.recordApiCall('ringcentral', duration);
                
                logger.info('Messages fetched', { 
                    groupName, 
                    chatId, 
                    messageCount: messages.length,
                    duration: `${duration}ms`
                });
                
                sendEvent('status', `Found ${messages.length} messages in ${groupName}.`);
                if (messages.length > 0) {
                    allConversations.push({ groupName, messages, chatId });
                }
            } catch (error) {
                const { duration } = fetchTimer.end();
                diagnostics.recordApiCall('ringcentral', duration, error);
                throw error;
            }
        }

        if (allConversations.length === 0) {
            logger.info('No messages found in date range');
            sendEvent('status', 'No new messages found in any selected groups.');
            sendEvent('done');
            return;
        }
        
        sendEvent('status', 'Analyzing conversations with Gemini AI...');
        const analysisTimer = diagnostics.startTimer('gemini-analysis');
        
        try {
            const summary = await summarizeConversations(platform, genAI, allConversations, sendEvent, logDebug);
            const { duration } = analysisTimer.end();
            diagnostics.recordApiCall('gemini', duration);
            
            logger.info('Analysis completed', { duration: `${duration}ms` });
            sendEvent('status', 'Analysis complete.');
        } catch (error) {
            const { duration } = analysisTimer.end();
            diagnostics.recordApiCall('gemini', duration, error);
            throw error;
        }

        sendEvent('status', 'Saving report file...');
        const { filePath, html, markdown } = await generateMarkdownReport(summary, startDateTime, endDateTime);
        
        logger.info('Report generated successfully', { 
            filePath,
            reportSize: markdown.length 
        });
        
        sendEvent('status', `Report saved to ${filePath}`);
        sendEvent('report', 'Report content generated.', { html, markdown });
        sendEvent('done');

    } catch (error) {
        const { name, message } = handleError(error, false);
        logger.error('Report generation failed', { 
            error: message,
            stack: error.stack,
            name
        });
        
        logDebug(`[ERROR] ${name}: ${message}\n${error.stack}`);
        sendEvent('error', name, { details: message });
        diagnostics.recordRequest(error);
    } finally {
        if (logStream) logStream.end();
        const { duration } = overallTimer.end();
        logger.info('Report generation completed', { 
            totalDuration: `${duration}ms`,
            correlationId: req.correlationId
        });
        res.end();
    }
});

// --- ERROR HANDLING ---
// Global error handler for unhandled application errors
app.use((error, req, res, next) => {
    logger.error('Unhandled application error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
    });
    
    diagnostics.recordRequest(error);
    res.status(500).json({
        error: 'Internal server error',
        correlationId: req.correlationId
    });
});

// --- SERVER STARTUP ---
// Validates configuration and starts the Express server
async function startServer() {
    try {
        logger.info('Starting Chat Summarizer application');
        
        // Validate configuration on startup - prevents runtime errors
        const configValidation = await configValidator.validateEnvironment();
        if (!configValidation.valid) {
            logger.error('Configuration validation failed', { errors: configValidation.errors });
            process.exit(1);
        }
        
        if (configValidation.warnings.length > 0) {
            logger.warn('Configuration warnings detected', { warnings: configValidation.warnings });
        }
        
        app.listen(port, () => {
            logger.info(`Chat Summarizer is running`, { 
                port,
                environment: process.env.NODE_ENV || 'development',
                logLevel: logger.logLevel
            });
            console.log(`Chat Summarizer is running at http://localhost:${port}`);
            console.log(`Health check: http://localhost:${port}/health`);
            console.log(`Diagnostics: http://localhost:${port}/diagnostics`);
        });
        
    } catch (error) {
        logger.error('Failed to start server', { error: error.message, stack: error.stack });
        process.exit(1);
    }
}

startServer();

// --- HELPER FUNCTIONS ---
// These functions support the main report generation process

// Fetches and caches person names from RingCentral API
const getPersonName = async (platform, personId) => {
    if (personCache[personId]) return personCache[personId];
    
    const timer = diagnostics.startTimer(`get-person-${personId}`);
    try {
        const resp = await platform.get(`/restapi/v1.0/glip/persons/${personId}`);
        const json = await resp.json();
        const name = `${json.firstName} ${json.lastName}`;
        personCache[personId] = name;
        return name;
    } catch (e) {
        // Graceful fallback when person lookup fails - prevents report generation from breaking
        logger.warn('Failed to get person name', { personId, error: e.message });
        return `User (${personId})`;
    } finally {
        timer.end();
    }
};

// Processes chat messages and generates AI summary using Google Gemini
const summarizeConversations = async (platform, genAI, conversations, sendEvent, logDebug) => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    let fullConversationText = '';
    const processingTimer = diagnostics.startTimer('process-conversations');
    
    for (const convo of conversations) {
        fullConversationText += `\n\n--- START OF CONVERSATION FROM GROUP: ${convo.groupName} ---\n`;
        const formattedMessages = await Promise.all(convo.messages.map(async (message) => {
            if (!message.text) return null;
            const authorName = await getPersonName(platform, message.creatorId);
            const postDate = format(new Date(message.creationTime), 'MM/dd/yyyy @ hh:mm a zzz');
            const postLink = `https://app.ringcentral.com/l/messages/${convo.chatId}/${message.id}`;
            return `[${authorName} at ${postDate}]: ${message.text} (Link: ${postLink})`;
        }));
        fullConversationText += formattedMessages.filter(Boolean).join('\n');
        fullConversationText += `\n--- END OF CONVERSATION FROM GROUP: ${convo.groupName} ---\n`;
    }
    
    processingTimer.end();

    const prompt = `
        You are an expert analyst summarizing team chat conversations for a manager. Your goal is to create a clean, scannable Markdown report suitable for copying into Confluence.
        Analyze the following chat logs.

        Generate a detailed report in **pure Markdown format**.

        First, create a high-level summary section:
        ## Daily Case/Issue Summary
        * Identify all unique cases or incidents (e.g., INC-44958, SE Case 28743083) mentioned.
        * For each, provide a concise, one-sentence summary of the updates that occurred ONLY within the provided time period.

        ---

        Second, create a detailed breakdown section:
        ## Detailed Analysis
        *For each distinct topic or incident, create a sub-section.*
        ### [Topic or Incident Title]
        * **Summary:** A concise paragraph summarizing the key points, discussions, and outcomes for this topic.
        * **Timeline & Key Posts:**
            * **[Date @ Time Timezone] by [Author]:** [Summary of the post's content]. ([View Post](link))
            * **[Date @ Time Timezone] by [Author]:** [Summary of the post's content]. ([View Post](link))

        Ensure there is a clear line separator (---) between the high-level summary and the detailed breakdown.

        Here are the chat logs:
        ${fullConversationText}
    `;

    let retries = 3;
    let delay = 2000;
    const geminiTimer = diagnostics.startTimer('gemini-api-call');
    
    while (retries > 0) {
        try {
            const result = await model.generateContent(prompt);
            geminiTimer.end();
            return result.response.text();
        } catch (error) {
            if (error.message.includes('503')) {
                retries--;
                if (retries > 0) {
                    const waitTime = delay / 1000;
                    logger.warn('Gemini API busy, retrying', { 
                        retriesLeft: retries, 
                        waitTime: `${waitTime}s` 
                    });
                    sendEvent('status', `Gemini API is busy. Retrying in ${waitTime} seconds... (${retries} retries left)`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    geminiTimer.end();
                    throw new APIError("Gemini API is overloaded after multiple retries.", 503, 'Gemini');
                }
            } else {
                geminiTimer.end();
                throw new APIError(`Gemini API error: ${error.message}`, error.status, 'Gemini');
            }
        }
    }
};

const generateMarkdownReport = async (summary, dateFrom, dateTo) => {
    const fromStr = format(dateFrom, 'MM-dd-yyyy-HH-mm');
    const toStr = format(dateTo, 'MM-dd-yyyy-HH-mm');
    const isSingleDay = format(dateFrom, 'MM-dd-yyyy') === format(dateTo, 'MM-dd-yyyy');

    const filename = isSingleDay
        ? `Analysis-${fromStr}.md`
        : `Analysis-${fromStr}_to_${toStr}.md`;
    
    const title = isSingleDay
        ? `# Chat Analysis for ${format(dateFrom, 'MM-dd-yyyy')}`
        : `# Chat Analysis from ${format(dateFrom, 'MM-dd-yyyy')} to ${format(dateTo, 'MM-dd-yyyy')}`;
    
    const reportGeneratedTime = new Date().toLocaleString('en-US', { 
        timeZone: 'America/Chicago', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        timeZoneName: 'short' 
    });
    
    const content = `${title}\n\n*Report generated on ${reportGeneratedTime}*\n\n${summary}`;
    
    await fsPromises.mkdir(reportsDir, { recursive: true });
    const filePath = path.join(reportsDir, filename);
    await fsPromises.writeFile(filePath, content);
    
    const html = mdConverter.makeHtml(content);
    
    logger.info('Report file saved', { 
        filename, 
        size: content.length,
        path: filePath 
    });
    
    return { filePath, html, markdown: content };
};
