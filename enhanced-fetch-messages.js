// enhanced-fetch-messages.js - Message fetching with pagination for date ranges
// This module handles the complexity of RingCentral's API limitations for junior admins

import { APIError } from './error-handler.js';
import logger from './logger.js';
import diagnostics from './diagnostics.js';

/**
 * Enhanced message fetching with pagination to handle date ranges properly
 * 
 * WHY THIS EXISTS: RingCentral's Glip API doesn't support server-side date filtering.
 * The API only returns the most recent messages, so for older date ranges,
 * we need to paginate backwards through message history until we find our target dates.
 * 
 * This prevents the common issue where reports show "no messages found" 
 * when messages actually exist but are older than the most recent 250.
 */
export const fetchChatMessagesEnhanced = async (platform, chatId, dateFrom, dateTo, logDebug) => {
    const maxPages = 20; // Safety limit to prevent infinite loops
    const recordsPerPage = 250; // Maximum allowed by API
    let allMessages = [];
    let pageToken = null;
    let pagesProcessed = 0;
    let foundOlderThanRange = false;
    
    // Determine the correct endpoint - RingCentral has two different endpoints for chat types
    let endpoint;
    const endpointTimer = diagnostics.startTimer(`api-endpoint-discovery-${chatId}`);
    
    try {
        // Try 'teams' endpoint first (most common)
        endpoint = `/restapi/v1.0/glip/teams/${chatId}/posts`;
        logDebug(`Testing 'teams' endpoint for chat ID: ${chatId}`);
        await platform.get(endpoint, { qs: { recordCount: 1 } });
        logDebug(`Using 'teams' endpoint: ${endpoint}`);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            endpoint = `/restapi/v1.0/glip/chats/${chatId}/posts`;
            logDebug(`'teams' endpoint failed. Using 'chats' endpoint: ${endpoint}`);
        } else {
            logDebug(`Endpoint discovery failed: ${error.message}`);
            throw new APIError(`Failed to determine endpoint for chat ${chatId}`, error.status, 'RingCentral');
        }
    } finally {
        endpointTimer.end();
    }

    logDebug(`Starting paginated fetch for date range: ${dateFrom.toISOString()} to ${dateTo.toISOString()}`);
    
    while (pagesProcessed < maxPages && !foundOlderThanRange) {
        const pageTimer = diagnostics.startTimer(`fetch-page-${pagesProcessed}`);
        
        try {
            const params = { recordCount: recordsPerPage };
            if (pageToken) {
                params.pageToken = pageToken;
            }
            
            logDebug(`Fetching page ${pagesProcessed + 1}, pageToken: ${pageToken || 'none'}`);
            
            const resp = await platform.get(endpoint, { qs: params });
            const json = await resp.json();
            const pageRecords = json.records || [];
            
            if (pageRecords.length === 0) {
                logDebug(`No more messages found on page ${pagesProcessed + 1}`);
                break;
            }
            
            logDebug(`Page ${pagesProcessed + 1}: Retrieved ${pageRecords.length} messages`);
            
            // Process messages on this page
            let messagesInRange = 0;
            let messagesOlderThanRange = 0;
            
            for (const record of pageRecords) {
                const messageTime = new Date(record.creationTime);
                
                if (messageTime >= dateFrom && messageTime <= dateTo) {
                    allMessages.push(record);
                    messagesInRange++;
                } else if (messageTime < dateFrom) {
                    messagesOlderThanRange++;
                    // If we find messages older than our range, we can stop
                    foundOlderThanRange = true;
                }
            }
            
            logDebug(`Page ${pagesProcessed + 1}: ${messagesInRange} in range, ${messagesOlderThanRange} older than range`);
            
            // Get pagination info for next page
            pageToken = json.navigation?.nextPageToken || null;
            pagesProcessed++;
            
            // If we have messages older than our range, we can stop
            if (foundOlderThanRange) {
                logDebug(`Found messages older than date range. Stopping pagination.`);
                break;
            }
            
            // If no next page token, we've reached the end
            if (!pageToken) {
                logDebug(`No more pages available. Reached end of messages.`);
                break;
            }
            
            const { duration } = pageTimer.end();
            diagnostics.recordApiCall('ringcentral', duration);
            
        } catch (error) {
            const { duration } = pageTimer.end();
            diagnostics.recordApiCall('ringcentral', duration, error);
            throw new APIError(`Failed to fetch page ${pagesProcessed + 1} from ${endpoint}`, error.status, 'RingCentral');
        }
    }
    
    if (pagesProcessed >= maxPages) {
        logger.warn('Reached maximum page limit during message fetch', {
            chatId,
            pagesProcessed,
            maxPages,
            messagesFound: allMessages.length
        });
    }
    
    // Sort messages chronologically (oldest first)
    allMessages.sort((a, b) => new Date(a.creationTime) - new Date(b.creationTime));
    
    logDebug(`Pagination complete: ${pagesProcessed} pages processed, ${allMessages.length} messages in date range`);
    
    return allMessages;
};

/**
 * Fallback function for smaller date ranges or when enhanced pagination isn't needed
 * This is your current implementation, kept for compatibility
 */
export const fetchChatMessagesSimple = async (platform, chatId, dateFrom, dateTo, logDebug) => {
    const params = { recordCount: 250 };
    
    let endpoint;
    const timer = diagnostics.startTimer(`api-endpoint-discovery-${chatId}`);
    
    try {
        endpoint = `/restapi/v1.0/glip/teams/${chatId}/posts`;
        logDebug(`Attempting to use 'teams' endpoint for chat ID: ${chatId}`);
        await platform.get(endpoint, { qs: { recordCount: 1 } });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            endpoint = `/restapi/v1.0/glip/chats/${chatId}/posts`;
            logDebug(`'teams' endpoint failed. Falling back to 'chats' endpoint.`);
        } else { 
            logDebug(`'teams' endpoint failed with error: ${error.message}`);
            throw new APIError(`Failed to determine endpoint for chat ${chatId}`, error.status, 'RingCentral');
        }
    } finally {
        timer.end();
    }

    logDebug(`Using endpoint: ${endpoint}`);
    
    const apiTimer = diagnostics.startTimer(`fetch-messages-${chatId}`);
    try {
        const resp = await platform.get(endpoint, { qs: params });
        const json = await resp.json();
        const allRecords = json.records || [];
        
        logDebug(`API returned ${allRecords.length} raw messages.`);
        
        const filteredRecords = allRecords.filter(record => {
            const messageTime = new Date(record.creationTime);
            return messageTime >= dateFrom && messageTime <= dateTo;
        }).reverse();
        
        logDebug(`Found ${filteredRecords.length} messages after client-side filtering.`);
        
        return filteredRecords;
    } catch (error) {
        throw new APIError(`Failed to fetch messages from ${endpoint}`, error.status, 'RingCentral');
    } finally {
        apiTimer.end();
    }
};

/**
 * Smart message fetching that chooses the best strategy based on date range
 */
export const fetchChatMessagesSmart = async (platform, chatId, dateFrom, dateTo, logDebug) => {
    const now = new Date();
    const daysDifference = Math.ceil((now - dateFrom) / (1000 * 60 * 60 * 24));
    
    // If looking for messages from the last 3 days, use simple fetch
    // Otherwise use enhanced pagination
    if (daysDifference <= 3) {
        logDebug(`Recent date range (${daysDifference} days ago). Using simple fetch.`);
        return await fetchChatMessagesSimple(platform, chatId, dateFrom, dateTo, logDebug);
    } else {
        logDebug(`Older date range (${daysDifference} days ago). Using enhanced pagination.`);
        return await fetchChatMessagesEnhanced(platform, chatId, dateFrom, dateTo, logDebug);
    }
};
