import { describe, expect, it } from 'vitest';
import { MODEL_ID_VALUES } from '../src/types';
import { getAvailableModelIds, getModelButtonLabel } from '../src/bot/model-catalog';

describe('model catalog helpers', () => {
  it('falls back to static models when dynamic list is empty', async () => {
    const sessionManager = {
      listAvailableModels: async () => [],
    } as any;

    const models = await getAvailableModelIds(sessionManager);
    expect(models).toEqual(MODEL_ID_VALUES);
  });

  it('includes dynamic models not present in static list', async () => {
    const sessionManager = {
      listAvailableModels: async () => ['gpt-5.3-codex', 'gpt-5.2-codex'],
    } as any;

    const models = await getAvailableModelIds(sessionManager);
    expect(models).toContain('gpt-5.3-codex');
    expect(models).toContain('gpt-5.2-codex');
  });

  it('uses friendly labels for known models and id fallback for unknown models', () => {
    expect(getModelButtonLabel('gpt-5')).toContain('GPT-5');
    expect(getModelButtonLabel('gpt-5.3-codex')).toContain('gpt-5.3-codex');
  });
});
