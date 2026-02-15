import { ServerWizard, WizardResult } from '../mcp/server-wizard';
import { ServerManagementService } from '../mcp/server-management';
import { UserState } from '../state/user-state';

/**
 * Manages wizard instances for all users
 */
export class WizardManager {
  private wizards = new Map<number, ServerWizard>();
  
  /**
   * Creates a new wizard manager instance
   * @param {UserState} userState - User state management instance
   */
  constructor(
    private userState: UserState
  ) {}

  /**
   * Gets or creates a wizard instance for a user
   * @param {number} userId - Telegram user ID
   * @returns {ServerWizard} Wizard instance for the user
   */
  getWizard(userId: number): ServerWizard {
    let wizard = this.wizards.get(userId);
    if (!wizard) {
      const service = new ServerManagementService(this.userState, userId);
      wizard = new ServerWizard(service);
      this.wizards.set(userId, wizard);
    }
    return wizard;
  }

  /**
   * Checks if user has an active wizard session
   * @param {number} userId - Telegram user ID
   * @returns {boolean} True if user has active wizard session
   */
  hasActiveWizard(userId: number): boolean {
    const wizard = this.wizards.get(userId);
    if (!wizard) return false;
    return wizard.getStatus(userId) !== undefined;
  }

  /**
   * Starts a new wizard session for a user
   * @param {number} userId - Telegram user ID
   * @returns {WizardResult} Result of wizard initialization
   */
  startWizard(userId: number): WizardResult {
    const wizard = this.getWizard(userId);
    return wizard.startWizard(userId);
  }

  /**
   * Handles user input for active wizard
   * @param {number} userId - Telegram user ID
   * @param {string} input - User input text
   * @returns {WizardResult | undefined} Result of input handling, or undefined if no active wizard
   */
  handleInput(userId: number, input: string): WizardResult | undefined {
    const wizard = this.wizards.get(userId);
    if (!wizard) return undefined;
    
    return wizard.handleInput(userId, input);
  }

  /**
   * Cancels active wizard session
   * @param {number} userId - Telegram user ID
   * @returns {WizardResult | undefined} Result of cancellation, or undefined if no active wizard
   */
  cancelWizard(userId: number): WizardResult | undefined {
    const wizard = this.wizards.get(userId);
    if (!wizard) return undefined;
    
    return wizard.cancelWizard(userId);
  }

  /**
   * Clears all wizard instances, typically called on bot restart
   * @returns {void}
   */
  clearAll(): void {
    this.wizards.clear();
  }
}
