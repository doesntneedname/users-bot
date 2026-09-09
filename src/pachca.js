// Клиент Пачки: таймауты, ретраи и уважение к 429 (в старом коде голый
// fetch без таймаута — зависший запрос вешал обработку события).
import { log } from './log.js';

const RETRIABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class PachcaError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'PachcaError';
    this.status = status;
    this.body = body;
  }
}

export function createClient({ apiUrl, token, timeoutMs = 10_000, retries = 3, fetchImpl = fetch, sleep = defaultSleep }) {
  async function request(method, path, body) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchImpl(`${apiUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) return response.status === 204 ? null : await response.json();

        const text = await response.text().catch(() => '');
        if (!RETRIABLE.has(response.status) || attempt === retries) {
          throw new PachcaError(`${method} ${path} → HTTP ${response.status}`, {
            status: response.status,
            body: text.slice(0, 300),
          });
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 1000;
        log.warn('Пачка ответила ошибкой, повторяю', { path, status: response.status, attempt, delay_ms: delay });
        await sleep(delay);
      } catch (error) {
        if (error instanceof PachcaError) throw error;
        lastError = error;
        if (attempt === retries) break;
        log.warn('Сетевая ошибка при запросе в Пачку, повторяю', { path, attempt, error: String(error.message || error) });
        await sleep(attempt * 1000);
      }
    }
    throw new PachcaError(`${method} ${path} — не удалось за ${retries} попыток: ${lastError?.message || 'unknown'}`);
  }

  return {
    request,
    async getUser(userId) {
      const json = await request('GET', `/users/${userId}`);
      return json?.data ?? null;
    },
    async postMessage(chatId, content) {
      const json = await request('POST', '/messages', {
        message: { entity_type: 'discussion', entity_id: chatId, content },
      });
      return json?.data ?? null;
    },
    async createThread(messageId) {
      const json = await request('POST', `/messages/${messageId}/thread`);
      return json?.data ?? null;
    },
    async postThreadMessage(threadId, content) {
      const json = await request('POST', '/messages', {
        message: { entity_type: 'thread', entity_id: threadId, content },
      });
      return json?.data ?? null;
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
