#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MCP Server Setup Example Script
# =============================================================================
# This script helps you configure common MCP servers for use with Copilot.
# Run this script to create a sample mcp-config.json configuration.
# =============================================================================

CONFIG_FILE="${COPILOT_MCP_CONFIG_PATH:-./mcp-config.json}"

echo "🔧 MCP Server Setup Script"
echo "=========================="
echo ""
echo "Este script te ayuda a configurar servidores MCP comunes."
echo "El archivo de configuración será: $CONFIG_FILE"
echo ""

# Check if config already exists
if [ -f "$CONFIG_FILE" ]; then
    echo "⚠️  El archivo $CONFIG_FILE ya existe."
    read -p "¿Deseas sobrescribirlo? (s/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        echo "Operación cancelada."
        exit 0
    fi
fi

# Create config file
cat > "$CONFIG_FILE" << 'EOF'
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "description": "GitHub Copilot MCP server for GitHub operations"
    },
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
      "description": "Local filesystem access (change /path/to/allowed/dir)"
    },
    "fetch": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"],
      "description": "HTTP fetch capabilities for web requests"
    },
    "postgres": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/dbname"
      },
      "description": "PostgreSQL database access (configure DATABASE_URL)"
    },
    "sqlite": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db", "/path/to/database.db"],
      "description": "SQLite database access (change path)"
    },
    "memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "description": "Persistent memory for cross-session context"
    },
    "brave-search": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-brave-api-key"
      },
      "description": "Web search via Brave Search API (needs API key)"
    },
    "puppeteer": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
      "description": "Browser automation with Puppeteer"
    }
  }
}
EOF

echo ""
echo "✅ Archivo de configuración creado: $CONFIG_FILE"
echo ""
echo "📋 Servidores configurados:"
echo "  - github: GitHub Copilot MCP (HTTP)"
echo "  - filesystem: Acceso a sistema de archivos local"
echo "  - fetch: Peticiones HTTP/web"
echo "  - postgres: Base de datos PostgreSQL"
echo "  - sqlite: Base de datos SQLite"
echo "  - memory: Memoria persistente"
echo "  - brave-search: Búsqueda web (requiere API key)"
echo "  - puppeteer: Automatización de navegador"
echo ""
echo "⚠️  IMPORTANTE: Antes de usar, edita $CONFIG_FILE para:"
echo "  1. Actualizar rutas en 'filesystem' y 'sqlite'"
echo "  2. Configurar DATABASE_URL para 'postgres'"
echo "  3. Agregar BRAVE_API_KEY para 'brave-search'"
echo ""
echo "🚀 Para habilitar un servidor, usa: /mcp enable <nombre>"
