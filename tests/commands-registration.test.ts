/**
 * Test suite for command registration
 * 
 * This test verifies that all commands are properly registered when using
 * the modular command system (commands-index.ts) instead of the old
 * backup file (commands.ts).
 * 
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bot } from 'grammy';
import { registerCommands } from '../src/bot/commands-index';
import { SessionManager } from '../src/copilot/session-manager';
import { UserState } from '../src/state/user-state';
import { McpRegistry } from '../src/mcp/mcp-registry';
import { WizardManager } from '../src/bot/wizard-manager';
import { AllowlistSetupWizard } from '../src/bot/allowlist-setup';
import { ToolBundle } from '../src/types';

describe('Command Registration', () => {
  let bot: Bot;
  let sessionManager: SessionManager;
  let userState: UserState;
  let mcpRegistry: McpRegistry;
  let wizardManager: WizardManager;
  let allowlistWizard: AllowlistSetupWizard;
  let tools: ToolBundle;

  beforeEach(() => {
    // Create bot instance with test token
    bot = new Bot('test-token');
    
    // Mock dependencies
    sessionManager = {} as SessionManager;
    userState = {
      getDatabase: () => ({} as any),
      getDatabaseManager: () => ({} as any),
    } as UserState;
    mcpRegistry = {} as McpRegistry;
    wizardManager = {} as WizardManager;
    allowlistWizard = {} as AllowlistSetupWizard;
    tools = { all: [] } as ToolBundle;
  });

  /**
   * List of all expected commands based on the old commands.ts file
   * 
   * Commands from commands.ts (line numbers from grep):
   * - start (line 37)
   * - help (line 72)
   * - status (line 101)
   * - pwd (line 145)
   * - ls (line 152)
   * - cd (line 175)
   * - projects (line 277)
   * - addproject (line 291)
   * - rmproject (line 334)
   * - switch (line 346)
   * - plan (line 430)
   * - exitplan (line 531)
   * - model (line 611)
   * - mcp (line 626)
   * - mcp_add (line 756)
   * - mcp_list (line 771)
   * - mcp_delete (line 818)
   * - new_chat (line 866)
   * 
   * Note: /stop and /extend are registered separately in src/index.ts
   * Note: /logs is a new command added in modular files
   */
  const expectedCommands = [
    // Info commands (commands-info.ts)
    'start',
    'help',
    'status',
    'logs',
    
    // Navigation commands (commands-navigation.ts)
    'pwd',
    'ls',
    'cd',
    'allowpath',
    
    // Project commands (commands-projects.ts)
    'projects',
    'addproject',
    'rmproject',
    'switch',
    
    // MCP commands (commands-mcp.ts)
    'mcp',
    'mcp_add',
    'mcp_list',
    'mcp_delete',
    
    // Session commands (commands-session.ts)
    'model',
    'plan',
    'exitplan',
    'new_chat',
    'reset',
    'plans',
    'showplan',
    'editplan',
    'exportplan',
    
    // Language commands (commands-language.ts)
    'language',
  ];

  it('should register all expected commands', () => {
    // Spy on bot.command to track registered commands
    const commandSpy = vi.spyOn(bot, 'command');
    
    // Register all commands using the modular system
    registerCommands(
      bot,
      sessionManager,
      userState,
      mcpRegistry,
      wizardManager,
      allowlistWizard,
      tools
    );
    
    // Get all registered command names
    const registeredCommands = commandSpy.mock.calls.map(call => call[0]);
    
    // Verify all expected commands are registered
    for (const expectedCommand of expectedCommands) {
      expect(
        registeredCommands,
        `Command /${expectedCommand} should be registered`
      ).toContain(expectedCommand);
    }
    
    // Verify we have the exact number of expected commands
    expect(registeredCommands.length).toBe(expectedCommands.length);
  });

  it('should register commands from all modular files', () => {
    const commandSpy = vi.spyOn(bot, 'command');
    
    registerCommands(
      bot,
      sessionManager,
      userState,
      mcpRegistry,
      wizardManager,
      allowlistWizard,
      tools
    );
    
    const registeredCommands = commandSpy.mock.calls.map(call => call[0]);
    
    // Verify info commands
    expect(registeredCommands).toContain('start');
    expect(registeredCommands).toContain('help');
    expect(registeredCommands).toContain('status');
    expect(registeredCommands).toContain('logs');
    
    // Verify navigation commands
    expect(registeredCommands).toContain('pwd');
    expect(registeredCommands).toContain('ls');
    expect(registeredCommands).toContain('cd');
    expect(registeredCommands).toContain('allowpath');
    
    // Verify project commands
    expect(registeredCommands).toContain('projects');
    expect(registeredCommands).toContain('addproject');
    expect(registeredCommands).toContain('rmproject');
    expect(registeredCommands).toContain('switch');
    
    // Verify MCP commands
    expect(registeredCommands).toContain('mcp');
    expect(registeredCommands).toContain('mcp_add');
    expect(registeredCommands).toContain('mcp_list');
    expect(registeredCommands).toContain('mcp_delete');
    
    // Verify session commands
    expect(registeredCommands).toContain('model');
    expect(registeredCommands).toContain('plan');
    expect(registeredCommands).toContain('exitplan');
    expect(registeredCommands).toContain('new_chat');
    expect(registeredCommands).toContain('reset');
    expect(registeredCommands).toContain('plans');
    expect(registeredCommands).toContain('showplan');
    expect(registeredCommands).toContain('editplan');
    expect(registeredCommands).toContain('exportplan');
    
    // Verify language commands
    expect(registeredCommands).toContain('language');
  });

  it('should not have duplicate command registrations', () => {
    const commandSpy = vi.spyOn(bot, 'command');
    
    registerCommands(
      bot,
      sessionManager,
      userState,
      mcpRegistry,
      wizardManager,
      allowlistWizard,
      tools
    );
    
    const registeredCommands = commandSpy.mock.calls.map(call => call[0]);
    const uniqueCommands = new Set(registeredCommands);
    
    // Verify no duplicates
    expect(
      registeredCommands.length,
      'Should not have duplicate command registrations'
    ).toBe(uniqueCommands.size);
  });
});
