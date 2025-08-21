# Chat Group Summarizer - Troubleshooting Guide

## Quick Reference for Junior Administrators

### 🚀 Getting Started

**First Steps When Issues Occur:**
1. Check application health: `GET http://localhost:3000/health`
2. View diagnostics: `GET http://localhost:3000/diagnostics`
3. Check configuration: `GET http://localhost:3000/config-report`
4. Review logs in `./logs/` directory

### 🔍 Common Issues & Solutions

#### **Application Won't Start**

**Symptoms:** Server fails to start, exits immediately
**Diagnosis:**
```bash
# Check if required environment variables are set
node -e "console.log('RC_SERVER:', process.env.RC_SERVER ? '✓' : '✗')"
node -e "console.log('RC_CLIENT_ID:', process.env.RC_CLIENT_ID ? '✓' : '✗')"
node -e "console.log('RC_CLIENT_SECRET:', process.env.RC_CLIENT_SECRET ? '✓' : '✗')"
node -e "console.log('RC_JWT:', process.env.RC_JWT ? '✓' : '✗')"
node -e "console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✓' : '✗')"
```

**Solutions:**
1. **Missing .env file:** Copy `.env.example` to `.env` and fill in values
2. **Invalid JWT:** JWT tokens expire - generate a new one from RingCentral Developer Console
3. **Wrong server URL:** Ensure `RC_SERVER` matches your RingCentral environment
4. **Port conflict:** Change `PORT` in .env if 3000 is in use

#### **RingCentral API Errors**

**Symptoms:** "Failed to login" or "API Error" messages
**Diagnosis:** Check `/diagnostics` endpoint for API call statistics

**Common Causes & Fixes:**
- **401 Unauthorized:** JWT expired → Generate new JWT
- **403 Forbidden:** Insufficient permissions → Check app scopes in RC Developer Console
- **404 Not Found:** Invalid chat ID → Verify chat IDs exist and are accessible
- **429 Rate Limited:** Too many requests → Implement delays between requests

**Debug Commands:**
```bash
# Test RingCentral connectivity
curl -H "Authorization: Bearer YOUR_JWT" https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~
```

#### **Gemini AI Errors**

**Symptoms:** "Analysis failed" or "503 Service Unavailable"
**Common Issues:**
- **Invalid API Key:** Check `GEMINI_API_KEY` in .env
- **Service Overloaded:** App automatically retries with exponential backoff
- **Content Too Large:** Reduce date range or number of chat groups

#### **File System Issues**

**Symptoms:** "Failed to save report" or permission errors
**Diagnosis:**
```bash
# Check directory permissions
ls -la ./reports ./logs
# Test write permissions
touch ./reports/test.txt && rm ./reports/test.txt
touch ./logs/test.txt && rm ./logs/test.txt
```

**Solutions:**
- **Permission denied:** `chmod 755 ./reports ./logs`
- **Disk full:** Check available space with `df -h`
- **Directory missing:** App creates directories automatically, but check parent permissions

### 📊 Monitoring & Health Checks

#### **Health Check Endpoint**
```bash
curl http://localhost:3000/health
```

**Response Indicators:**
- `status: "healthy"` - All systems operational
- `status: "warning"` - Minor issues detected
- `status: "unhealthy"` - Critical issues require attention

#### **Diagnostics Dashboard**
```bash
curl http://localhost:3000/diagnostics?format=text
```

**Key Metrics to Monitor:**
- **Memory Usage:** Should stay below 75%
- **Error Rate:** Should be below 5%
- **API Response Times:** RingCentral <2s, Gemini <10s
- **File System:** All critical directories writable

### 🔧 Debug Mode

**Enable Debug Logging:**
Add `?debug=true` to report generation URL:
```
http://localhost:3000/generate-report?debug=true&...
```

**Debug Output Locations:**
- Console: Real-time colored output
- File: `./debug.log` (appends each session)
- Structured Logs: `./logs/app-YYYY-MM-DD.log`

### 📝 Log Analysis

#### **Log Levels & Meanings**
- **ERROR:** Critical issues requiring immediate attention
- **WARN:** Potential problems or degraded performance
- **INFO:** Normal operational events
- **DEBUG:** Detailed troubleshooting information
- **TRACE:** Very detailed execution flow

#### **Key Log Patterns to Look For**
```bash
# Find all errors in today's logs
grep "ERROR" ./logs/app-$(date +%Y-%m-%d).log

# Check API call performance
grep "API Response" ./logs/app-$(date +%Y-%m-%d).log

# Find correlation ID for specific request
grep "req_1234567890" ./logs/app-$(date +%Y-%m-%d).log
```

### 🚨 Emergency Procedures

#### **Application Hanging**
1. Check `/health` endpoint responsiveness
2. Review memory usage in `/diagnostics`
3. Look for long-running operations in logs
4. Restart application if necessary

#### **High Error Rate**
1. Check `/diagnostics` for error breakdown
2. Verify external service status (RingCentral, Gemini)
3. Review recent configuration changes
4. Check network connectivity

#### **Memory Issues**
1. Monitor heap usage in diagnostics
2. Check for memory leaks in long-running processes
3. Restart application to clear memory
4. Consider reducing concurrent operations

### 🔄 Maintenance Tasks

#### **Daily**
- Check application health status
- Review error logs for patterns
- Verify disk space availability

#### **Weekly**
- Rotate old log files (automatic, but verify)
- Clean up old report files if needed
- Update JWT token if approaching expiration

#### **Monthly**
- Review API usage patterns
- Update dependencies if security patches available
- Backup configuration and important reports

### 📞 Escalation Criteria

**Contact Senior Administrator When:**
- Application won't start after following troubleshooting steps
- Error rate exceeds 10% for more than 1 hour
- Memory usage consistently above 90%
- External API services report extended outages
- Security-related errors or unauthorized access attempts

### 🛠️ Useful Commands

```bash
# Start application with enhanced logging
LOG_LEVEL=debug npm start

# Check application status
curl -s http://localhost:3000/health | jq '.status'

# Monitor real-time logs
tail -f ./logs/app-$(date +%Y-%m-%d).log

# Check process resource usage
ps aux | grep node

# Test configuration without starting server
node -e "import('./config-validator.js').then(m => m.default.validateAndThrow())"
```

### 📋 Configuration Checklist

Before deploying or after issues:

- [ ] All required environment variables set
- [ ] JWT token valid and not expired
- [ ] RingCentral app has required permissions
- [ ] Gemini API key active and has quota
- [ ] File system permissions correct
- [ ] Network connectivity to external APIs
- [ ] Port 3000 available (or custom port set)
- [ ] Node.js version compatible (check package.json)

---

*For additional support, check the application logs with correlation IDs and provide specific error messages when escalating issues.*
