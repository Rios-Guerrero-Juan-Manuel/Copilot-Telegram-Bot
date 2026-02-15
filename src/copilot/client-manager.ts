import { CopilotClient } from '@github/copilot-sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { i18n } from '../i18n/index.js';

/**
 * Manages GitHub Copilot CLI client lifecycle with automatic restart capabilities
 */
export class ResilientCopilotClient {
  private client: CopilotClient | null = null;

  /**
   * Ensures a running Copilot client instance, starting one if needed
   * @returns Active Copilot client instance
   * @throws Error if Copilot CLI is not available or authentication fails
   */
  async ensureClient(): Promise<CopilotClient> {
    if (!this.client) {
      this.client = new CopilotClient({
        cliPath: config.COPILOT_CLI_PATH || undefined,
      });
      try {
        await this.client.start();
        logger.info('CopilotClient started successfully');
      } catch (error) {
        this.client = null;
        // System-level error - use English as no user context is available
        throw new Error(i18n.t(0, 'copilot.cliNotAvailable'));
      }
    }
    return this.client;
  }

  /**
   * Forces a restart of the Copilot client
   */
  async restart(): Promise<void> {
    if (this.client) {
      try {
        await this.client.forceStop();
      } catch (error) {
        logger.warn('Could not stop CopilotClient', { error });
      }
      this.client = null;
    }
    await this.ensureClient();
  }

  /**
   * Stops the Copilot client gracefully
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}
