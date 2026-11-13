// What tokens would cost at Anthropic's API list prices, in US dollars per million tokens.
// On a Claude subscription nothing is billed per token: this is what the same work would cost
// on the API, which is still the fairest way to compare projects. Prices as of 2026-10.

import type { TokenUsage } from './contract';

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/** Longest prefix wins, so dated or suffixed ids ("claude-opus-5-5[1m]") find their model. */
const PRICES: [prefix: string, price: Price][] = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
];

/** Cache writes cost more than plain input: 1.25 times for 5 minutes, twice for an hour. */
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

export function priceOf(model: string): Price | null {
  let best: [string, Price] | null = null;
  for (const entry of PRICES) {
    if (model.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1] ?? null;
}

/** Dollars, or null for a model with no known price. */
export function costOf(u: TokenUsage): number | null {
  const p = priceOf(u.model);
  if (!p) return null;
  const write5m = Math.max(0, u.cacheWrite - u.cacheWrite1h);
  const dollars =
    u.input * p.input +
    u.output * p.output +
    u.cacheRead * p.cacheRead +
    write5m * p.input * CACHE_WRITE_5M +
    u.cacheWrite1h * p.input * CACHE_WRITE_1H;
  return dollars / 1_000_000;
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}
