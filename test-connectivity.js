// test-connectivity.js - API connectivity testing utility

import 'dotenv/config';
import * as RingCentralSDK from '@ringcentral/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from './logger.js';

async function testConnectivity() {
    console.log('🔍 Testing API Connectivity...\n');
    
    const results = {
        ringcentral: { status: 'unknown', details: null },
        gemini: { status: 'unknown', details: null }
    };

    // Test RingCentral connectivity
    console.log('📞 Testing RingCentral API...');
    try {
        const RingCentral = RingCentralSDK.SDK;
        const rcsdk = new RingCentral({
            server: process.env.RC_SERVER,
            clientId: process.env.RC_CLIENT_ID,
            clientSecret: process.env.RC_CLIENT_SECRET
        });
        
        const platform = rcsdk.platform();
        const startTime = Date.now();
        
        await platform.login({ jwt: process.env.RC_JWT });
        const loginTime = Date.now() - startTime;
        
        // Test a simple API call
        const testStart = Date.now();
        const response = await platform.get('/restapi/v1.0/account/~/extension/~');
        const apiTime = Date.now() - testStart;
        
        const data = await response.json();
        
        results.ringcentral = {
            status: 'success',
            details: {
                loginTime: `${loginTime}ms`,
                apiResponseTime: `${apiTime}ms`,
                userInfo: `${data.contact?.firstName} ${data.contact?.lastName}`,
                extensionId: data.id
            }
        };
        
        console.log('✅ RingCentral: Connected successfully');
        console.log(`   Login time: ${loginTime}ms`);
        console.log(`   API response time: ${apiTime}ms`);
        console.log(`   User: ${data.contact?.firstName} ${data.contact?.lastName}\n`);
        
    } catch (error) {
        results.ringcentral = {
            status: 'failed',
            details: {
                error: error.message,
                statusCode: error.response?.status,
                suggestion: getRingCentralErrorSuggestion(error)
            }
        };
        
        console.log('❌ RingCentral: Connection failed');
        console.log(`   Error: ${error.message}`);
        console.log(`   Suggestion: ${getRingCentralErrorSuggestion(error)}\n`);
    }

    // Test Gemini API connectivity
    console.log('🤖 Testing Gemini AI API...');
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const startTime = Date.now();
        const result = await model.generateContent("Say 'API test successful' in exactly those words.");
        const responseTime = Date.now() - startTime;
        
        const response = result.response.text();
        
        results.gemini = {
            status: 'success',
            details: {
                responseTime: `${responseTime}ms`,
                testResponse: response.substring(0, 50) + (response.length > 50 ? '...' : ''),
                model: 'gemini-1.5-flash'
            }
        };
        
        console.log('✅ Gemini AI: Connected successfully');
        console.log(`   Response time: ${responseTime}ms`);
        console.log(`   Test response: ${response.substring(0, 50)}${response.length > 50 ? '...' : ''}\n`);
        
    } catch (error) {
        results.gemini = {
            status: 'failed',
            details: {
                error: error.message,
                suggestion: getGeminiErrorSuggestion(error)
            }
        };
        
        console.log('❌ Gemini AI: Connection failed');
        console.log(`   Error: ${error.message}`);
        console.log(`   Suggestion: ${getGeminiErrorSuggestion(error)}\n`);
    }

    // Summary
    const allSuccessful = Object.values(results).every(r => r.status === 'success');
    console.log('📋 Connectivity Test Summary:');
    console.log(`   Overall Status: ${allSuccessful ? '✅ All APIs Connected' : '❌ Some APIs Failed'}`);
    console.log(`   RingCentral: ${results.ringcentral.status === 'success' ? '✅' : '❌'}`);
    console.log(`   Gemini AI: ${results.gemini.status === 'success' ? '✅' : '❌'}`);
    
    if (!allSuccessful) {
        console.log('\n🔧 Next Steps:');
        if (results.ringcentral.status === 'failed') {
            console.log(`   - Fix RingCentral: ${results.ringcentral.details.suggestion}`);
        }
        if (results.gemini.status === 'failed') {
            console.log(`   - Fix Gemini AI: ${results.gemini.details.suggestion}`);
        }
    }
    
    return results;
}

function getRingCentralErrorSuggestion(error) {
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        return 'Check JWT token - it may be expired or invalid';
    }
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
        return 'Check app permissions in RingCentral Developer Console';
    }
    if (error.message.includes('404')) {
        return 'Verify RC_SERVER URL is correct for your environment';
    }
    if (error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
        return 'Check network connectivity and firewall settings';
    }
    return 'Verify all RingCentral environment variables are set correctly';
}

function getGeminiErrorSuggestion(error) {
    if (error.message.includes('API key')) {
        return 'Check GEMINI_API_KEY is valid and has quota remaining';
    }
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
        return 'Verify API key permissions and billing status';
    }
    if (error.message.includes('429') || error.message.includes('quota')) {
        return 'API quota exceeded - wait or upgrade your plan';
    }
    if (error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
        return 'Check network connectivity to Google AI services';
    }
    return 'Verify GEMINI_API_KEY environment variable is set correctly';
}

export default testConnectivity;

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testConnectivity().catch(console.error);
}
