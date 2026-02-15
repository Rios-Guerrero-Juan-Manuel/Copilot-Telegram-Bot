# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-15

### Added
- **Core Features**
  - GitHub Copilot CLI integration via `@github/copilot-sdk`
  - Telegram bot interface using grammY framework
  - MCP (Model Context Protocol) server support (STDIO & HTTP)
  - Interactive plan mode with approval workflow
  - Cross-platform support (Windows, Linux, macOS)

- **Security Features**
  - Path allowlist enforcement
  - MCP executable validation
  - Telegram user ID authentication
  - Automatic sensitive data redaction in logs

- **Essential Commands**
  - `/start`, `/help`, `/status` - Bot basics
  - `/pwd`, `/ls`, `/cd` - Directory navigation
  - `/ask`, `/plan`, `/exitplan` - Copilot interaction
  - `/model` - Model selection
  - `/mcp`, `/mcp_add`, `/mcp_list` - MCP management

### Security
- Path traversal prevention
- Command injection protection
- Token sanitization in logs
