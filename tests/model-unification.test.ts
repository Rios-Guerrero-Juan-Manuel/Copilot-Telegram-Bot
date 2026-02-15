/**
 * Test: Task 2.7 - Model List Unification
 * 
 * Verifica que la lista de modelos está unificada en un solo lugar
 * y que no hay duplicación entre archivos.
 * 
 * Issue #C4 - Bug alto de arquitectura
 */

import { describe, it, expect } from 'vitest';
import { MODEL_ID_VALUES, ModelId } from '../src/types';

describe('Task 2.7 - Model List Unification', () => {
  it('should export MODEL_ID_VALUES from types/index.ts', () => {
    expect(MODEL_ID_VALUES).toBeDefined();
    expect(Array.isArray(MODEL_ID_VALUES)).toBe(true);
    expect(MODEL_ID_VALUES.length).toBeGreaterThan(0);
  });

  it('should include all critical models', () => {
    const criticalModels = [
      'claude-sonnet-4.5',
      'claude-haiku-4.5', // Bug: este podría no pasar validación
      'claude-opus-4.6',
      'claude-opus-4.5',
      'claude-sonnet-4',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.1',
      'gpt-5.2-codex',
    ] as const;

    criticalModels.forEach((model) => {
      expect(MODEL_ID_VALUES).toContain(model);
    });
  });

  it('should have claude-haiku-4.5 in the list', () => {
    // Regression test: Este modelo faltaba en MODEL_ID_VALUES_CONST
    expect(MODEL_ID_VALUES).toContain('claude-haiku-4.5');
  });

  it('should validate model IDs using the unified list', () => {
    // Simular validación de modelo
    const isValidModel = (model: string): model is ModelId => {
      return MODEL_ID_VALUES.includes(model as ModelId);
    };

    expect(isValidModel('claude-haiku-4.5')).toBe(true);
    expect(isValidModel('claude-sonnet-4.5')).toBe(true);
    expect(isValidModel('invalid-model')).toBe(false);
  });

  it('should have all models from original MODEL_ID_VALUES_CONST', () => {
    // Modelos que estaban en config.ts MODEL_ID_VALUES_CONST
    const originalConfigModels = [
      'claude-sonnet-4.5',
      'claude-opus-4.6',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.1',
      'gpt-5.2-codex',
    ] as const;

    originalConfigModels.forEach((model) => {
      expect(MODEL_ID_VALUES).toContain(model);
    });
  });

  it('should not have duplicate model entries', () => {
    const uniqueModels = new Set(MODEL_ID_VALUES);
    expect(uniqueModels.size).toBe(MODEL_ID_VALUES.length);
  });
});
