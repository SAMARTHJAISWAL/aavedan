// The one place that talks to Claude. Every call returns JSON validated against a zod schema,
// so the rest of the code never parses free text. Tests swap in a fake `Llm`.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { models, paths, prices } from './config.ts';
import { appendLine } from './util/store.ts';

export type Content = Anthropic.Beta.BetaContentBlockParam[];

export interface JsonRequest<S extends z.ZodType> {
  /** What this call is for, recorded in the cost log ("rank", "map-form", "tailor"...). */
  label: string;
  model: 'fast' | 'write';
  system: string;
  content: string | Content;
  schema: S;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface Llm {
  json<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>>;
}

export class ClaudeDeclined extends Error {}

let client: Anthropic | undefined;

export const claude: Llm = {
  async json(req) {
    client ??= new Anthropic();
    const model = models[req.model];
    const response = await client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.content }],
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? (req.model === 'fast' ? 'low' : 'medium') },
      // If the requested model declines, the API retries on its default fallback in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    logUsage(req.label, response.model, response.usage);
    if (response.stop_reason === 'refusal') {
      throw new ClaudeDeclined(`Claude declined the ${req.label} request${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}.`);
    }
    if (response.stop_reason === 'max_tokens') throw new Error(`The ${req.label} answer was cut off at max_tokens.`);
    if (response.parsed_output == null) throw new Error(`The ${req.label} answer did not match its schema.`);
    return response.parsed_output;
  },
};

function logUsage(label: string, model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) {
  const p = prices[model] ?? { input: 0, output: 0 };
  const dollars = (usage.input_tokens * p.input + (usage.cache_read_input_tokens ?? 0) * p.input * 0.1 + usage.output_tokens * p.output) / 1e6;
  appendLine(paths.usage, JSON.stringify({ at: new Date().toISOString(), label, model, in: usage.input_tokens, out: usage.output_tokens, usd: Number(dollars.toFixed(5)) }));
}
