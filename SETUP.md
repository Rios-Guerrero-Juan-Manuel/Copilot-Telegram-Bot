# Quick Setup Guide

This guide will help you get the bot running in a few simple steps.

## 1. Verify Prerequisites

### Node.js >= 18
```bash
node --version
# Must be >= 18.0.0
```

If you don't have Node.js 18+, download it from https://nodejs.org/

### Copilot CLI
```bash
npm install -g @github/copilot
copilot --version
```

Authenticate Copilot CLI:
```bash
copilot
# Then run /login in the interactive session
```

## 2. Configure the Bot

### Get Telegram Credentials

1. **Bot Token**: Talk to @BotFather on Telegram
   - Send `/newbot`
   - Follow the instructions
   - Copy the token provided (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

2. **Your Chat ID**: Talk to @userinfobot on Telegram
   - Send any message
   - Copy the number in the response (your user ID)

### Configure .env

The `.env` file should already be created. Verify it contains:

```env
TELEGRAM_BOT_TOKEN=your_token_from_botfather
TELEGRAM_CHAT_ID=your_numeric_user_id
DEFAULT_PROJECT_PATH=C:\Users\YourName\Projects
ALLOWED_PATHS=C:\Users\YourName\Projects
```

## 3. Install Dependencies

```bash
cd "C:\path\to\copilot-telegram-bot"
npm install
```

## 4. Create Directories

```bash
# If they don't exist:
mkdir data
mkdir logs
```

Or in PowerShell:
```powershell
New-Item -ItemType Directory -Name data -Force
New-Item -ItemType Directory -Name logs -Force
```

## 5. Verify Build

```bash
npm run build
```

## 6. Run Tests (optional)

```bash
npm test
```

## 7. Start the Bot

### Development mode (recommended for testing)
```bash
npm run dev
```

### Production mode
```bash
npm start
```

## 8. Test on Telegram

1. Open Telegram and find your bot
2. Send `/start`
3. You should see a welcome message
4. Try `/help` to see available commands

## 9. Basic Commands to Test

- `/status` - View current status
- `/pwd` - View current directory
- `/model` - Change LLM model
- `hello copilot` - Send a simple prompt

## Troubleshooting

### "Error: TELEGRAM_BOT_TOKEN is required"
- Verify that the `.env` file exists
- Verify that the token is correctly configured
- Verify there are no extra spaces

### "Copilot CLI not available"
- Run `copilot` in terminal
- Verify it's authenticated with `/login`
- Verify that `@github/copilot` is installed globally

### "Error connecting to Telegram"
- Verify your internet connection
- Verify that the bot token is correct
- Verify that no firewall is blocking the connection
- The bot will automatically retry (10 attempts with exponential backoff)
- Check `logs/error-YYYY-MM-DD.log` for error details

### Bot doesn't respond to commands
- Verify you're using the correct chat/user ID
- Review logs in `logs/combined-YYYY-MM-DD.log`
- Verify that `TELEGRAM_CHAT_ID` matches your user ID

### Bot is slow or unresponsive
- Review `logs/combined-YYYY-MM-DD.log` for long operations
- Look for entries with high `durationSeconds`
- Consider increasing timeouts in `.env`

### Logging

Logs are stored in `./logs/` with automatic daily rotation:
- `combined-YYYY-MM-DD.log` - All logs
- `error-YYYY-MM-DD.log` - Errors only

Sensitive data is automatically redacted. Files are kept for 14 days.

**View logs in real-time**:
```bash
# Windows PowerShell
Get-Content -Path "logs\combined-2026-02-10.log" -Wait -Tail 50

# Linux/Mac
tail -f logs/combined-2026-02-10.log
```

Configure in `.env`:
```env
LOG_LEVEL=info          # debug | info | warn | error
LOG_MAX_SIZE=20m        # Max file size before rotation
LOG_MAX_FILES=14d       # Retention period
```
- **Troubleshooting**: `LOG_LEVEL=debug` temporarily, then return to `info`

### Troubleshooting with Logs

**Problem: Bot doesn't start**
```bash
# View recent errors (Linux/macOS)
cat logs/error-*.log | tail -n 50
```
```powershell
# View recent errors (Windows PowerShell)
Get-Content -Path logs\error-*.log -Tail 50
```

**Problem: Slow commands**
```bash
# Search for operations that took >30 seconds (Linux/macOS)
grep -E "durationSeconds\":[3-9][0-9]+" logs/combined-*.log
```
```powershell
# Search for operations that took >30 seconds (Windows PowerShell)
Select-String -Path logs\combined-*.log -Pattern 'durationSeconds":[3-9][0-9]+'
```

**Problem: Intermittent network errors**
```bash
# Search for network retries (Linux/macOS)
grep "Network error detected - will retry" logs/combined-*.log
```
```powershell
# Search for network retries (Windows PowerShell)
Select-String -Path logs\combined-*.log -Pattern 'Network error detected - will retry'
```

**Problem: Operation timeouts**
```bash
# Search for timeouts (Linux/macOS)
grep -i timeout logs/error-*.log
```
```powershell
# Search for timeouts (Windows PowerShell)
Select-String -Path logs\error-*.log -Pattern 'timeout' -CaseSensitive:$false
```

## Next Steps

See `README.md` for complete command documentation and features.
