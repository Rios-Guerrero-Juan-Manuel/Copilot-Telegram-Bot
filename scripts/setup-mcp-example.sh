#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MCP Example Setup Script
# =============================================================================
# Quick setup script to create example MCP configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="${PROJECT_ROOT}/mcp-config.json"

echo "🔧 MCP Example Setup"
echo "===================="

# Create minimal example config
cat > "$CONFIG_FILE" << 'EOF'
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
EOF

echo "✅ Created: $CONFIG_FILE"
echo ""
echo "📖 To add more servers:"
echo "  - Use /mcp_add command in Telegram"
echo "  - Or edit mcp-config.json directly"
echo "  - Or run ./scripts/install-mcp.sh for full setup"
