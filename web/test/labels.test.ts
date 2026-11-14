import { describe, expect, it } from 'vitest';
import { agentModel, modelLabel } from '../src/lib/labels';

describe('modelLabel', () => {
  it('names models the way people say them', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5');
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)');
    expect(modelLabel('claude-fable-5-2')).toBe('Fable 5.2');
    expect(modelLabel('opus')).toBe('Opus');
  });

  it('shows ids it cannot read as they are', () => {
    expect(modelLabel('gpt-5')).toBe('gpt-5');
    expect(modelLabel('claude-opus-5-5-preview')).toBe('claude-opus-5-5-preview');
  });
});

describe('agentModel', () => {
  it('reads the model from details', () => {
    expect(agentModel({ details: { model: 'claude-opus-5-5' } })).toBe('claude-opus-5-5');
    expect(agentModel({ details: { model: null } })).toBeNull();
    expect(agentModel({ details: {} })).toBeNull();
  });
});
