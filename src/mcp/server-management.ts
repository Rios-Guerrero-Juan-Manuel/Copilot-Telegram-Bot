import { MCPServerConfig } from '@github/copilot-sdk';
import { UserState } from '../state/user-state';
import { logger } from '../utils/logger';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as config from '../config';
import { escapeHtml } from '../utils/formatter';
import { i18n } from '../i18n/index.js';

export interface ServerInfo {
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  config: MCPServerConfig;
}

export interface AddServerParams {
  name: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  confirmDangerousArgs?: boolean;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  warnings?: string[];
  server?: ServerInfo;
  requiresConfirmation?: boolean;
  dangerousFlags?: string[];
  fullCommand?: string;
  securityWarning?: string;
}

export interface DangerousArgsDetectionResult {
  isDangerous: boolean;
  dangerousFlags: string[];
  reason?: string;
  fullCommand?: string;
}

/**
 * Service for managing MCP (Model Context Protocol) server configurations
 * 
 * Provides methods for adding, removing, enabling/disabling, and validating
 * MCP servers. Includes security validation for stdio servers to prevent
 * execution of dangerous commands or unauthorized executables.
 * 
 * Features:
 * - Validates executable allowlists for stdio servers
 * - Detects dangerous command-line arguments
 * - Validates HTTP URLs and prevents private IP access
 * - Persists configurations to user database
 * 
 * @example
 * const service = new ServerManagementService(userState, userId);
 * const result = service.addServer({
 *   name: 'my-server',
 *   type: 'stdio',
 *   command: 'node',
 *   args: ['server.js']
 * });
 */
export class ServerManagementService {
  constructor(
    private userState: UserState,
    private userId: number
  ) {}

  /**
   * Lists all MCP servers for the user
   * @returns Array of server information
   */
  listServers(): ServerInfo[] {
    const servers = this.userState.listMcpServers(this.userId);
    return servers.map((server) => ({
      name: server.name,
      type: server.type as 'stdio' | 'http',
      enabled: server.enabled,
      config: server.config as MCPServerConfig,
    }));
  }

  /**
   * Quotes an argument if it contains spaces or special characters that require quoting
   * 
   * @param arg - The argument to potentially quote
   * @returns The argument, quoted if necessary
   */
  private quoteArgumentIfNeeded(arg: string): string {
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      return arg;
    }
    
    const needsQuoting = /[\s;|&<>()$`\\!*?[\]{}'"~]/.test(arg);
    
    if (needsQuoting) {
      const escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    
    return arg;
  }

  /**
   * Builds a display-friendly full command string with proper quoting
   * 
   * @param cmdArray - Command parts array
   * @param argsArray - Arguments array
   * @returns Properly quoted command string for display
   */
  private buildFullCommandDisplay(cmdArray: string[], argsArray: string[]): string {
    const allParts = [...cmdArray, ...argsArray];
    return allParts.map((part, index) => {
      if (index === 0) {
        return part;
      }
      return this.quoteArgumentIfNeeded(part);
    }).join(' ');
  }

  /**
   * Detects dangerous command-line arguments that could execute arbitrary code
   * 
   * Dangerous flags include:
   * - -e, --eval: Execute code directly (node, perl, ruby)
   * - -c: Execute command string (python, sh, bash, zsh)
   * - -p, --print: Print evaluation result (node, perl)
   * - --code: Execute code (various tools)
   * - --interactive: Interactive shell mode
   * 
   * @param command - The command/executable being run
   * @param args - The arguments passed to the command
   * @returns Detection result with dangerous flags found
   */
  detectDangerousArguments(
    command: string | string[],
    args?: string[]
  ): DangerousArgsDetectionResult {
    const DANGEROUS_FLAGS = [
      '-e',           // Node.js, Perl, Ruby eval
      '--eval',       // Node.js eval (long form)
      '-c',           // Python, Shell command execution
      '--code',       // VS Code / other tools
      '-p',           // Node.js, Perl print eval
      '--print',      // Node.js print eval (long form)
      '--interactive', // Interactive shell mode
      '-i',           // Interactive mode (some interpreters)
    ];

    const flagExplanations: Record<string, string> = {
      '-e': i18n.t(this.userId, 'serverManagement.flagExplanations.-e'),
      '--eval': i18n.t(this.userId, 'serverManagement.flagExplanations.--eval'),
      '-c': i18n.t(this.userId, 'serverManagement.flagExplanations.-c'),
      '--code': i18n.t(this.userId, 'serverManagement.flagExplanations.--code'),
      '-p': i18n.t(this.userId, 'serverManagement.flagExplanations.-p'),
      '--print': i18n.t(this.userId, 'serverManagement.flagExplanations.--print'),
      '--interactive': i18n.t(this.userId, 'serverManagement.flagExplanations.--interactive'),
      '-i': i18n.t(this.userId, 'serverManagement.flagExplanations.-i'),
    };

    // Normalize command to array
    const cmdArray = Array.isArray(command) ? command : [command];
    const argsArray = args || [];
    const primaryCommand = String(cmdArray[0] || '');
    const commandName = path
      .basename(primaryCommand)
      .toLowerCase()
      .replace(/\.(exe|cmd|bat|ps1)$/, '');
    const dangerousShortFormCommands = [
      /^(node|nodejs|bun|deno)$/,
      /^python(\d+(\.\d+)*)?$/,
      /^(bash|sh|zsh|ksh|dash)$/,
      /^(pwsh|powershell|perl|ruby|php|lua)$/,
    ];
    const supportsDangerousShortForms = dangerousShortFormCommands
      .some((pattern) => pattern.test(commandName));
    
    // Find dangerous flags
    const foundDangerousFlags: string[] = [];
    
    for (const arg of argsArray) {
      // Exact match (normal separated form: -e code, --eval code)
      if (DANGEROUS_FLAGS.includes(arg)) {
        foundDangerousFlags.push(arg);
        continue;
      }
      
      // Match with equals: --eval=code, --code=script, --print=value
      const equalsMatch = /^(--eval|--code|--print)=/.test(arg);
      if (equalsMatch) {
        const flag = arg.split('=')[0];
        foundDangerousFlags.push(flag);
        continue;
      }
      
      // Match combined short flags where dangerous chars are packed together: -pe, -iec
      const combinedShortFlagsMatch =
        supportsDangerousShortForms &&
        /^-[ecpi]{2,}$/.test(arg);
      if (combinedShortFlagsMatch) {
        for (const shortFlagChar of arg.substring(1)) {
          foundDangerousFlags.push(`-${shortFlagChar}`);
        }
        continue;
      }

      // Match attached short form for interpreter-like commands: -e"code", -cscript, -pvalue, -imode
      // Restricting this to known interpreter/shell families avoids false positives on generic tools.
      const attachedMatch =
        supportsDangerousShortForms &&
        arg.length > 2 &&
        /^-[ecpi]/.test(arg);
      if (attachedMatch) {
        const flag = arg.substring(0, 2);
        foundDangerousFlags.push(flag);
      }
    }

    // Remove duplicates while preserving order
    const uniqueFlags = [...new Set(foundDangerousFlags)];

    const isDangerous = uniqueFlags.length > 0;
    
    // Build full command for display with proper quoting
    const fullCommand = this.buildFullCommandDisplay(cmdArray, argsArray);
    
    // Build reason message
    let reason: string | undefined;
    if (isDangerous) {
      const explanations = uniqueFlags
        .map(flag => `${flag} (${flagExplanations[flag] || i18n.t(this.userId, 'serverManagement.validation.codeExecution')})`)
        .join(', ');
      reason = i18n.t(this.userId, 'serverManagement.dangerousArguments', { flags: explanations });
    }

    return {
      isDangerous,
      dangerousFlags: uniqueFlags,
      reason,
      fullCommand,
    };
  }

  /**
   * Adds a new MCP server configuration
   * 
   * Validates server name, checks for duplicates, validates executables for stdio
   * servers, detects dangerous arguments, and validates URLs for HTTP servers.
   * 
   * @param params - Server configuration parameters
   * @returns Operation result with success status and optional warnings
   */
  addServer(params: AddServerParams): OperationResult {
    const warnings: string[] = [];

    // Validate server name
    const nameValidation = this.validateServerName(params.name);
    if (!nameValidation.valid) {
      return {
        success: false,
        error: nameValidation.error,
      };
    }

    // Check for duplicate
    const existing = this.getServer(params.name);
    if (existing) {
      return {
        success: false,
        error: `El servidor "${params.name}" ya existe`,
      };
    }

    // Build config based on type
    let config: MCPServerConfig;

    if (params.type === 'stdio') {
      if (!params.command || params.command.trim() === '') {
        return {
          success: false,
          error: i18n.t(this.userId, 'serverManagement.validation.commandEmpty'),
        };
      }

      const executableValidation = this.validateExecutable(params.command);
      if (!executableValidation.valid) {
        return {
          success: false,
          error: executableValidation.error,
        };
      }

      const dangerousArgsCheck = this.detectDangerousArguments(
        params.command,
        params.args
      );

      if (dangerousArgsCheck.isDangerous) {
        if (!params.confirmDangerousArgs) {
          logger.warn('Dangerous arguments detected in MCP server command', {
            userId: this.userId,
            serverName: params.name,
            command: params.command,
            args: params.args,
            dangerousFlags: dangerousArgsCheck.dangerousFlags,
            fullCommand: dangerousArgsCheck.fullCommand,
          });

          return {
            success: false,
            error: `⚠️ ADVERTENCIA DE SEGURIDAD: Se detectaron argumentos peligrosos.\n\n${dangerousArgsCheck.reason}\n\nComando completo: ${dangerousArgsCheck.fullCommand}\n\nEsto podría permitir ejecución de código arbitrario. Si estás seguro de que este comando es seguro, confirma explícitamente.`,
            requiresConfirmation: true,
            dangerousFlags: dangerousArgsCheck.dangerousFlags,
            fullCommand: dangerousArgsCheck.fullCommand,
          };
        }

        logger.warn('Dangerous arguments confirmed by user', {
          userId: this.userId,
          serverName: params.name,
          command: params.command,
          args: params.args,
          dangerousFlags: dangerousArgsCheck.dangerousFlags,
          fullCommand: dangerousArgsCheck.fullCommand,
          decision: 'confirmed',
          timestamp: new Date().toISOString(),
        });

        warnings.push(
          `⚠️ Servidor agregado con argumentos peligrosos confirmado por el usuario: ${dangerousArgsCheck.dangerousFlags.map(escapeHtml).join(', ')}`
        );
      }

      const commandWarning = this.checkCommandExists(params.command);
      if (commandWarning) {
        warnings.push(commandWarning);
      }

      config = {
        command: params.command,
        args: params.args || [],
        tools: ['*'],
      } as any;

      if (params.env && Object.keys(params.env).length > 0) {
        (config as any).env = params.env;
      }
    } else if (params.type === 'http') {
      if (!params.url || params.url.trim() === '') {
        return {
          success: false,
          error: i18n.t(this.userId, 'serverManagement.validation.urlEmpty'),
        };
      }

      // Validate URL
      const urlValidation = this.validateUrl(params.url);
      if (!urlValidation.valid) {
        return {
          success: false,
          error: urlValidation.error,
        };
      }

      config = {
        type: 'http',
        url: params.url,
        tools: ['*'],
      };
    } else {
      return {
        success: false,
        error: `Tipo de servidor no válido: ${params.type}`,
      };
    }

    this.userState.upsertMcpServer(
      this.userId,
      params.name,
      params.type,
      config,
      true // enabled by default
    );

    logger.info('MCP server added', {
      userId: this.userId,
      serverName: params.name,
      serverType: params.type,
    });

    const server = this.getServer(params.name);

    const result: OperationResult = {
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      server,
    };

    if (params.type === 'stdio' && params.confirmDangerousArgs) {
      const dangerousArgsCheck = this.detectDangerousArguments(
        params.command!,
        params.args
      );
      if (dangerousArgsCheck.isDangerous) {
        result.securityWarning = `Servidor agregado con argumentos peligrosos confirmado por el usuario`;
      }
    }

    return result;
  }

  /**
   * Removes an MCP server configuration
   * 
   * @param name - Server name to remove
   * @returns Operation result with success status
   */
  removeServer(name: string): OperationResult {
    const server = this.getServer(name);
    if (!server) {
      return {
        success: false,
        error: `El servidor "${name}" no existe`,
      };
    }

    this.userState.removeMcpServer(this.userId, name);

    logger.info('MCP server removed', {
      userId: this.userId,
      serverName: name,
    });

    return {
      success: true,
    };
  }

  /**
   * Gets server details by name
   * 
   * @param name - Server name
   * @returns Server information or undefined if not found
   */
  getServer(name: string): ServerInfo | undefined {
    const servers = this.listServers();
    return servers.find((s) => s.name === name);
  }

  /**
   * Enables an MCP server
   * 
   * @param name - Server name to enable
   * @returns Operation result with success status and updated server info
   */
  enableServer(name: string): OperationResult {
    const server = this.getServer(name);
    if (!server) {
      return {
        success: false,
        error: `El servidor "${name}" no existe`,
      };
    }

    this.setEnabled(name, true);

    logger.info('MCP server enabled', {
      userId: this.userId,
      serverName: name,
    });

    return {
      success: true,
      server: this.getServer(name),
    };
  }

  /**
   * Disables an MCP server
   * 
   * @param name - Server name to disable
   * @returns Operation result with success status and updated server info
   */
  disableServer(name: string): OperationResult {
    const server = this.getServer(name);
    if (!server) {
      return {
        success: false,
        error: `El servidor "${name}" no existe`,
      };
    }

    this.setEnabled(name, false);

    logger.info('MCP server disabled', {
      userId: this.userId,
      serverName: name,
    });

    return {
      success: true,
      server: this.getServer(name),
    };
  }

  /**
   * Sets the enabled state for a server
   * 
   * @param name - Server name
   * @param enabled - Whether the server should be enabled
   */
  setEnabled(name: string, enabled: boolean): void {
    this.userState.setMcpServerEnabled(this.userId, name, enabled);
  }

  /**
   * Validates server name format
   * 
   * @param name - Server name to validate
   * @returns Validation result with error message if invalid
   */
  private validateServerName(name: string): { valid: boolean; error?: string } {
    if (!name || name.trim() === '') {
      return {
        valid: false,
        error: i18n.t(this.userId, 'serverManagement.validation.nameEmpty'),
      };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return {
        valid: false,
        error: i18n.t(this.userId, 'serverManagement.validation.nameInvalid'),
      };
    }

    return { valid: true };
  }

  /**
   * Validates URL format and prevents SSRF attacks
   * 
   * @param url - URL to validate
   * @returns Validation result with error message if invalid
   */
  private validateUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          error: 'La URL debe usar protocolo http:// o https://',
        };
      }

      if (this.isLocalOrPrivateHost(parsed.hostname)) {
        return {
          valid: false,
          error: 'URL bloqueada por seguridad (SSRF): no se permiten localhost, loopback o redes privadas',
        };
      }

      return { valid: true };
    } catch {
      return {
        valid: false,
        error: i18n.t(this.userId, 'serverManagement.validation.urlInvalid'),
      };
    }
  }

  /**
   * Checks if hostname is localhost, loopback, or private IP address
   * 
   * @param hostname - Hostname to check
   * @returns true if hostname is local or private, false otherwise
   */
  private isLocalOrPrivateHost(hostname: string): boolean {
    const host = hostname.trim().toLowerCase();
    if (!host) return true;

    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return true;
    }

    if (host === '0.0.0.0' || host === '127.0.0.1' || host === '::1') {
      return true;
    }

    const ipv4Parts = host.split('.');
    if (ipv4Parts.length === 4 && ipv4Parts.every((part) => /^\d+$/.test(part))) {
      const octets = ipv4Parts.map((part) => Number(part));
      if (octets.some((octet) => octet < 0 || octet > 255)) {
        return true;
      }

      const [a, b] = octets;
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return true;
      }
      return false;
    }

    if (host.includes(':')) {
      return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
    }

    return false;
  }

  /**
   * Checks if a command exists in system PATH
   * 
   * @param command - Command name to check
   * @returns Warning message if command not found, undefined otherwise
   */
  private checkCommandExists(command: string): string | undefined {
    try {
      const isWindows = process.platform === 'win32';
      const checkCmd = isWindows ? 'where' : 'which';
      
      const result = spawnSync(checkCmd, [command], { stdio: 'ignore' });
      return result.status === 0 ? undefined : `⚠️ El comando "${escapeHtml(command)}" no se encuentra en PATH. Asegúrate de que esté disponible o usa una ruta completa.`;
    } catch {
      return `⚠️ El comando "${escapeHtml(command)}" no se encuentra en PATH. Asegúrate de que esté disponible o usa una ruta completa.`;
    }
  }

  /**
   * Resolves path to its real path, following symlinks
   * 
   * @param filePath - Path to resolve
   * @returns Resolved real path, or normalized path if resolution fails
   */
  private resolveRealPath(filePath: string): string {
    try {
      return fs.realpathSync(filePath);
    } catch (error) {
      return path.resolve(filePath);
    }
  }

  /**
   * Checks if an absolute path executable exists in system PATH
   * 
   * SECURITY: Prevents bypass attacks using absolute paths not in system PATH.
   * Compares provided path against actual system PATH results to prevent
   * scenarios where malicious C:\Malicious\node.exe would pass because
   * legitimate node.exe exists in PATH.
   * 
   * @param absolutePath - The absolute path to validate
   * @returns true if the path exists in system PATH, false otherwise
   */
  private isExecutableInSystemPath(absolutePath: string): boolean {
    const basename = path.basename(absolutePath);
    const isWindows = process.platform === 'win32';
    const whichCommand = isWindows ? 'where' : 'which';
    
    try {
      const result = spawnSync(whichCommand, [basename], { encoding: 'utf-8' });
      
      if (result.status !== 0) {
        logger.warn('Executable not found in system PATH', {
          userId: this.userId,
          absolutePath,
          basename,
        });
        return false;
      }
      
      const systemPaths = String(result.stdout ?? '')
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
      
      if (systemPaths.length === 0) {
        logger.warn('where/which returned success but no paths found', {
          userId: this.userId,
          absolutePath,
          basename,
        });
        return false;
      }
      
      const resolvedInput = this.resolveRealPath(absolutePath);
      
      for (const systemPath of systemPaths) {
        const resolvedSystem = this.resolveRealPath(systemPath);
        
        const pathsMatch = isWindows
          ? resolvedInput.toLowerCase() === resolvedSystem.toLowerCase()
          : resolvedInput === resolvedSystem;
        
        if (pathsMatch) {
          logger.debug('Absolute path validated against system PATH', {
            userId: this.userId,
            providedPath: absolutePath,
            resolvedInput,
            matchedPath: systemPath,
            resolvedSystem,
          });
          return true;
        }
      }
      
      logger.warn('SECURITY: Absolute path bypass attempt detected', {
        userId: this.userId,
        providedPath: absolutePath,
        resolvedInput,
        systemPaths: systemPaths.map(p => this.resolveRealPath(p)),
        reason: 'Provided path does not match any system PATH entry',
      });
      
      return false;
    } catch (error) {
      logger.warn('Failed to check if executable is in system PATH', {
        userId: this.userId,
        absolutePath,
        error,
      });
      return false;
    }
  }

  /**
   * Validates executable against allowlist
   * 
   * SECURITY: Enhanced validation to prevent bypass techniques:
   * 1. Absolute paths not in system PATH
   * 2. Malicious prefixes/suffixes (e.g., node.evil.exe)
   * 3. Multiple/invalid extensions (e.g., node.exe.malicious)
   * 4. Shell metacharacters for command injection
   * 
   * @param command - The command/executable to validate
   * @returns Validation result with error message if not allowed
   */
  private validateExecutable(command: string): { valid: boolean; error?: string } {
    const allowedExecutables = config.getAllowedExecutables();
    
    const dangerousChars = /[;&|`$()<>]/;
    if (dangerousChars.test(command)) {
      logger.warn('MCP executable rejected due to dangerous characters', {
        userId: this.userId,
        command,
      });
      
      return {
        valid: false,
        error: '❌ Comando contiene caracteres no permitidos (;, &, |, `, $, etc.)',
      };
    }
    
    const isAbsolutePath = path.isAbsolute(command);
    if (isAbsolutePath) {
      const inSystemPath = this.isExecutableInSystemPath(command);
      if (!inSystemPath) {
        logger.warn('MCP executable rejected: absolute path not in system PATH', {
          userId: this.userId,
          command,
        });
        
        return {
          valid: false,
          error: `❌ La ruta absoluta '${command}' no está en el PATH del sistema. ` +
                 'Solo se permiten rutas absolutas que apunten a ejecutables del sistema.',
        };
      }
    }
    
    const basename = path.basename(command);
    const basenameLower = basename.toLowerCase();
    
    const isWindows = process.platform === 'win32';
    const isAllowed = allowedExecutables.some((allowed) => {
      const allowedLower = allowed.toLowerCase();
      
      if (isWindows) {
        return basenameLower === allowedLower;
      } else {
        return basename === allowed || basenameLower === allowedLower;
      }
    });
    
    if (!isAllowed) {
      logger.warn('MCP executable rejected by allowlist', {
        userId: this.userId,
        command,
        basename,
        allowedExecutables,
      });
      
      const displayList = Array.from(
        new Set(
          allowedExecutables.map((exe) =>
            exe.replace(/\.(exe|cmd)$/i, '')
          )
        )
      ).join(', ');
      
      return {
        valid: false,
        error: `❌ Ejecutable '${basename}' no permitido. Permitidos: ${displayList}`,
      };
    }
    
    return { valid: true };
  }
}
