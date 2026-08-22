import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';
import { buildTools, systemPrompt } from './tools.ts';

/* ===========================================================================
   Answering a plain-English question about the data.

   The SDK's tool runner drives the loop: Claude picks tools, the SDK executes
   them and feeds results back, and it stops when Claude has an answer. Every
   tool is read-only (see tools.ts) and every figure comes from the same engine
   the UI renders, so a chat answer and a dashboard number cannot disagree.
   =========================================================================== */

export type AskResult =
  | { ok: true; answer: string; toolsUsed: string[] }
  | { ok: false; error: string; needsKey?: boolean };

export type Turn = { role: 'user' | 'assistant'; content: string };

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function ask(
  question: string,
  snapshot: Snapshot,
  today: Day,
  history: Turn[] = [],
): Promise<AskResult> {
  if (!aiConfigured()) {
    return {
      ok: false,
      needsKey: true,
      error: 'Set ANTHROPIC_API_KEY in your environment to enable questions.',
    };
  }

  const client = new Anthropic();
  const tools = buildTools(snapshot, today);
  const used: string[] = [];

  try {
    const runner = client.beta.messages.toolRunner({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: systemPrompt(snapshot, today),
      tools,
      messages: [
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user' as const, content: question },
      ],
    });

    // Iterating the runner lets us record which tools were consulted, so the
    // answer can show its working rather than asking to be trusted.
    for await (const message of runner) {
      for (const block of message.content) {
        if (block.type === 'tool_use') used.push(block.name);
      }
    }

    const final = await runner.done();

    if (final.stop_reason === 'refusal') {
      return { ok: false, error: 'That question could not be answered.' };
    }

    const answer = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!answer) return { ok: false, error: 'No answer came back. Try rephrasing the question.' };
    return { ok: true, answer, toolsUsed: [...new Set(used)] };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, needsKey: true, error: 'The Anthropic API key was rejected.' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Rate limited by the API. Try again in a moment.' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `API error ${err.status}: ${err.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}
