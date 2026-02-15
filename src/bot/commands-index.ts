import { Bot } from 'grammy';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { WizardManager } from './wizard-manager';
import { AllowlistSetupWizard } from './allowlist-setup';
import { ToolBundle } from '../types';
import { registerNavigationCommands } from './commands-navigation';
import { registerProjectCommands } from './commands-projects';
import { registerMcpCommands } from './commands-mcp';
import { registerSessionCommands } from './commands-session';
import { registerInfoCommands } from './commands-info';
import { registerLanguageCommands } from './commands-language';
import { CdWizard } from './wizard-cd';
import { AddProjectWizard } from './wizard-addproject';

/**
 * Registers all bot commands with the Telegram bot instance
 * @param bot - Grammy bot instance to register commands on
 * @param sessionManager - Manages Copilot sessions for all users
 * @param userState - User state management for persisting preferences
 * @param mcpRegistry - Registry for managing MCP server configurations
 * @param wizardManagerOrTools - WizardManager instance or ToolBundle depending on call signature
 * @param allowlistWizard - Optional wizard for allowlist setup
 * @param tools - Optional ToolBundle with available Copilot tools
 * @param cdWizard - Optional wizard for interactive directory navigation
 * @param addProjectWizard - Optional wizard for interactive project creation
 */
export function registerCommands(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  wizardManagerOrTools: WizardManager | ToolBundle,
  allowlistWizard?: AllowlistSetupWizard,
  tools?: ToolBundle,
  cdWizard?: CdWizard,
  addProjectWizard?: AddProjectWizard
) {
  /**
   * Type guard to check if a value is a ToolBundle
   * @param value - Value to check
   * @returns True if value is a ToolBundle
   */
  const isToolBundle = (value: unknown): value is ToolBundle =>
    !!value &&
    typeof value === 'object' &&
    'all' in (value as Record<string, unknown>);

  const wizardManager = isToolBundle(wizardManagerOrTools)
    ? ({ startWizard: () => ({ message: '', complete: false }) } as unknown as WizardManager)
    : wizardManagerOrTools;

  const resolvedAllowlistWizard = (allowlistWizard ?? {
    needsSetup: () => false,
    startSetup: async () => {},
  }) as AllowlistSetupWizard;

  const resolvedTools = (isToolBundle(wizardManagerOrTools)
    ? wizardManagerOrTools
    : tools) ?? ({ 
      all: [], 
      askUser: { hasPending: () => false, resolveResponse: () => false, cancel: () => {} },
      userInputHandler: async () => ({ answer: '', wasFreeform: true })
    } as ToolBundle);

  // Register info commands (start, help, status)
  registerInfoCommands(bot, sessionManager, userState, mcpRegistry, resolvedAllowlistWizard);

  // Register navigation commands (pwd, ls, cd) with shared CdWizard instance
  registerNavigationCommands(
    bot, 
    sessionManager, 
    userState, 
    mcpRegistry, 
    resolvedAllowlistWizard, 
    resolvedTools,
    cdWizard
  );

  // Register project management commands (projects, addproject, rmproject, switch)
  registerProjectCommands(
    bot, 
    sessionManager, 
    userState, 
    mcpRegistry, 
    resolvedAllowlistWizard, 
    resolvedTools,
    addProjectWizard
  );

  // Register MCP server commands (mcp, mcp_add, mcp_list, mcp_delete)
  registerMcpCommands(bot, sessionManager, userState, mcpRegistry, wizardManager, resolvedTools);

  // Register session management commands (model, plan, exitplan, new_chat)
  registerSessionCommands(bot, sessionManager, userState, mcpRegistry, resolvedTools, userState.getDatabaseManager());

  // Register language selection command (language)
  registerLanguageCommands(bot, userState);
}

// Re-export utility functions that might be used elsewhere
export { resolvePath } from './commands-navigation';
