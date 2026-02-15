import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

type JsonRecord = Record<string, unknown>;

function flattenKeys(obj: JsonRecord, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenKeys(value as JsonRecord, next);
    }
    return [next];
  });
}

function getNestedValue(obj: JsonRecord, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as JsonRecord)) {
      return (acc as JsonRecord)[key];
    }
    return undefined;
  }, obj);
}

describe('i18n migration guards', () => {
  it('keeps en/es locale key parity', () => {
    const en = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'i18n', 'locales', 'en.json'), 'utf-8')
    ) as JsonRecord;
    const es = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'i18n', 'locales', 'es.json'), 'utf-8')
    ) as JsonRecord;

    const enKeys = new Set(flattenKeys(en));
    const esKeys = new Set(flattenKeys(es));

    const missingInEs = [...enKeys].filter((k) => !esKeys.has(k));
    const missingInEn = [...esKeys].filter((k) => !enKeys.has(k));

    expect(missingInEs).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('does not reintroduce known hardcoded telegram strings in critical files', () => {
    const criticalFiles = [
      join(process.cwd(), 'src', 'bot', 'message-handler.ts'),
      join(process.cwd(), 'src', 'bot', 'commands-language.ts'),
      join(process.cwd(), 'src', 'bot', 'timeout-confirmation.ts'),
      join(process.cwd(), 'src', 'bot', 'callbacks.ts'),
      join(process.cwd(), 'src', 'bot', 'commands-mcp.ts'),
      join(process.cwd(), 'src', 'index.ts'),
    ];

    const forbiddenLiterals = [
      '✅ Listo.',
      '\\n\\n⏱️ <i>Completado en ',
      '| Extensiones:',
      '✅ Completado',
      '❌ Error:',
      '⏰ Solicitud expirada',
      'Solicitud expirada',
      '❌ An error occurred.',
    ];

    for (const file of criticalFiles) {
      const content = readFileSync(file, 'utf-8');
      for (const literal of forbiddenLiterals) {
        expect(content.includes(literal)).toBe(false);
      }
    }
  });

  it('avoids angle-bracket command placeholders in locale command text', () => {
    const localeFiles = [
      join(process.cwd(), 'src', 'i18n', 'locales', 'en.json'),
      join(process.cwd(), 'src', 'i18n', 'locales', 'es.json'),
    ];

    const commandLikeKeys = [
      'commands.help.commands.allowpath',
      'commands.help.commands.mcp_add_sub',
      'commands.help.commands.mcp_remove',
      'commands.help.commands.mcp_enable',
      'commands.help.commands.mcp_disable',
      'errors.specifyServerName',
      'mcp.commands.usage.add',
      'mcp.commands.usage.remove',
      'mcp.commands.usage.enable',
      'projects.add.usage',
      'projects.remove.usage',
      'projects.switch.usage',
      'messageHandler.planModeUsage',
      'allowlistAdmin.usage',
    ];
    const anglePlaceholder = /<[a-z_|]+>/i;

    for (const file of localeFiles) {
      const data = JSON.parse(readFileSync(file, 'utf-8')) as JsonRecord;
      const offending = commandLikeKeys.filter((keyPath) => {
        const value = getNestedValue(data, keyPath);
        return typeof value === 'string' && anglePlaceholder.test(value);
      });

      expect(offending, `Unsafe placeholders found in ${file}`).toEqual([]);
    }
  });
});
