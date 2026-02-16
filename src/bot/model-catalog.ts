import { SessionManager } from '../copilot/session-manager';
import { MODEL_ID_VALUES } from '../types';

const KNOWN_MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4.5': '🟣 Claude Sonnet 4.5',
  'claude-haiku-4.5': '🟣 Claude Haiku 4.5 (fast)',
  'claude-opus-4.6': '🟣 Claude Opus 4.6 (premium)',
  'claude-opus-4.5': '🟣 Claude Opus 4.5 (premium)',
  'claude-sonnet-4': '🟣 Claude Sonnet 4',
  'gpt-5': '🟢 GPT-5',
  'gpt-5-mini': '🟢 GPT-5 mini (fast)',
  'gpt-5.1': '🟢 GPT-5.1',
  'gpt-5.1-codex': '🟢 GPT-5.1-Codex',
  'gpt-5.1-codex-mini': '🟢 GPT-5.1-Codex-Mini (fast)',
  'gpt-5.1-codex-max': '🟢 GPT-5.1-Codex-Max',
  'gpt-5.2': '🟢 GPT-5.2',
  'gpt-5.2-codex': '🟢 GPT-5.2-Codex',
  'gpt-4.1': '🟢 GPT-4.1 (fast)',
  'gemini-3-pro-preview': '🔵 Gemini 3 Pro (Preview)',
};

const KNOWN_MODEL_SET = new Set(MODEL_ID_VALUES);

function getModelEmoji(modelId: string): string {
  if (modelId.startsWith('claude-')) return '🟣';
  if (modelId.startsWith('gpt-')) return '🟢';
  if (modelId.startsWith('gemini-')) return '🔵';
  return '⚪';
}

export function getModelButtonLabel(modelId: string): string {
  return KNOWN_MODEL_LABELS[modelId] ?? `${getModelEmoji(modelId)} ${modelId}`;
}

export async function getAvailableModelIds(sessionManager: SessionManager): Promise<string[]> {
  const dynamicModels =
    typeof (sessionManager as Partial<SessionManager>).listAvailableModels === 'function'
      ? await sessionManager.listAvailableModels()
      : [];
  const source = dynamicModels.length > 0 ? dynamicModels : [...MODEL_ID_VALUES];
  const normalized = [...new Set(source.map((modelId) => modelId.trim()).filter(Boolean))];
  const knownModels = MODEL_ID_VALUES.filter((modelId) => normalized.includes(modelId));
  const extraModels = normalized
    .filter((modelId) => !KNOWN_MODEL_SET.has(modelId as (typeof MODEL_ID_VALUES)[number]))
    .sort((left, right) => left.localeCompare(right));

  return [...knownModels, ...extraModels];
}
