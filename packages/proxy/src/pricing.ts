interface PricingTier {
  input: number;  // per 1M tokens
  output: number; // per 1M tokens
}

// Ordered most specific to least specific for matching
const PRICING_ENTRIES: [string, PricingTier][] = [
  ['claude-opus-4-6', { input: 15.0, output: 75.0 }],
  ['claude-opus-4', { input: 15.0, output: 75.0 }],
  ['claude-sonnet-4-6', { input: 3.0, output: 15.0 }],
  ['claude-sonnet-4', { input: 3.0, output: 15.0 }],
  ['claude-haiku-4-5-20251001', { input: 0.8, output: 4.0 }],
  ['claude-haiku-4-5', { input: 0.8, output: 4.0 }],
  ['claude-haiku-4', { input: 0.8, output: 4.0 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10.0 }],
];

const DEFAULT_PRICING: PricingTier = { input: 1.0, output: 3.0 };

export function getPricing(model: string): PricingTier {
  const lower = model.toLowerCase();
  for (const [key, tier] of PRICING_ENTRIES) {
    if (lower.includes(key)) return tier;
  }
  return DEFAULT_PRICING;
}

export interface CostInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  thinkingTokens?: number;
}

export function estimateCost(input: CostInput): number {
  const tier = getPricing(input.model);
  const freshInputCost = (input.inputTokens / 1_000_000) * tier.input;
  const cacheCreationCost = ((input.cacheCreationTokens ?? 0) / 1_000_000) * tier.input * 1.25;
  const cacheReadCost = ((input.cacheReadTokens ?? 0) / 1_000_000) * tier.input * 0.10;
  const outputCost = (input.outputTokens / 1_000_000) * tier.output;
  const thinkingCost = ((input.thinkingTokens ?? 0) / 1_000_000) * tier.output;
  return freshInputCost + cacheCreationCost + cacheReadCost + outputCost + thinkingCost;
}
