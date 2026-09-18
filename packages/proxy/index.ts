import type { Entity } from '@monorise/base';

interface GenerateTicketOptions {
  entityType: Entity;
  entityId: string;
  feedTypes?: Entity[];
}

interface TicketResponse {
  ticket: string;
  wsUrl: string;
  expiresIn: number;
}

const getApiBaseUrl = (): string => {
  const url = process.env.API_BASE_URL;
  if (!url) {
    throw new Error(
      'API_BASE_URL environment variable is required for generateWebSocketTicket',
    );
  }
  return url;
};

const getApiKey = (): string => {
  return process.env.MONORISE_API_KEY || process.env.API_KEY || '';
};

/**
 * Generate a WebSocket ticket for entity feed subscriptions.
 * Call this from your proxy route (e.g., Next.js API route) after validating auth.
 *
 * @example
 * ```ts
 * import { generateWebSocketTicket } from 'monorise/proxy';
 * import { Entity } from './monorise/entities';
 *
 * export async function POST(req) {
 *   const session = await getSession(req);
 *   const ticket = await generateWebSocketTicket({
 *     entityType: Entity.USER,
 *     entityId: session.userId,
 *     feedTypes: [Entity.CHANNEL, Entity.MESSAGE],
 *   });
 *   return Response.json(ticket);
 * }
 * ```
 */
export const generateWebSocketTicket = async (
  options: GenerateTicketOptions,
): Promise<TicketResponse> => {
  const apiBaseUrl = getApiBaseUrl();
  const apiKey = getApiKey();

  const { entityType, entityId, feedTypes } = options;

  const response = await fetch(
    `${apiBaseUrl}/ws/ticket/${entityType}/${entityId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'x-api-key': apiKey }),
      },
      body: JSON.stringify({
        ...(feedTypes && { feedTypes }),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to generate WebSocket ticket: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<TicketResponse>;
};
