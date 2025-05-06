import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/config';
import { bookingTools } from '@/ai/tools';
import { logger } from '@/config/logger';

export interface IntentContext {
  userId: string;
  tenantId: string;
  currentTime: string;
  userTimezone: string;
}

export interface ResolvedIntent {
  action: 'create_booking' | 'cancel_booking' | 'reschedule_booking' | 'query_availability' | 'query_bookings' | 'clarification_needed';
  parameters: Record<string, unknown>;
  rawMessage: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return _client;
}

function buildSystemPrompt(ctx: IntentContext): string {
  return `You are a scheduling assistant for the Nexus Scheduler system.
Current UTC time: ${ctx.currentTime}
User timezone: ${ctx.userTimezone}

Your job is to interpret the user's scheduling request and call the appropriate tool.
Always resolve relative time expressions (e.g., "next Tuesday", "tomorrow at 3pm") to absolute UTC datetimes.
When the user's intent is ambiguous, ask a clarifying question before calling a tool.
Call exactly ONE tool per user request unless multiple independent actions are explicitly requested.`;
}

export async function resolveIntent(
  message: string,
  context: IntentContext,
  onStreamDelta?: (delta: string) => void,
): Promise<ResolvedIntent> {
  const client = getClient();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];

  for (let turn = 0; turn < 5; turn++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: buildSystemPrompt(context),
      tools: bookingTools,
      messages,
    });

    if (onStreamDelta && response.content) {
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          onStreamDelta(block.text);
        }
      }
    }

    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(b => b.type === 'tool_use');
      if (toolUse && toolUse.type === 'tool_use') {
        logger.debug({ tool: toolUse.name, input: toolUse.input }, 'Tool called by Claude');
        return {
          action: toolUse.name as ResolvedIntent['action'],
          parameters: toolUse.input as Record<string, unknown>,
          rawMessage: message,
        };
      }
    }

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return {
        action: 'clarification_needed',
        parameters: { message: textBlock?.type === 'text' ? textBlock.text : 'I need more information to process your request.' },
        rawMessage: message,
      };
    }

    messages.push({ role: 'assistant', content: response.content });
  }

  return {
    action: 'clarification_needed',
    parameters: { message: 'I was unable to resolve your request. Please try rephrasing.' },
    rawMessage: message,
  };
}
