// Общая обвязка тестов: конфиг, поддельный клиент Пачки, временный стор.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';

export const testConfig = {
  chatId: 144223,
  corporateDomains: ['pachca.com'],
  inviteDelayMs: 2 * 3_600_000,
  inviteDeadlineMs: 24 * 3_600_000,
  workerIntervalMs: 60_000,
  dedupeTtlMs: 24 * 3_600_000,
  dryRun: false,
  webhookSecret: '',
  signatureMode: 'enforce',
  baseMentions: ['@lgmspb', '@lpaspb'],
  tagMentions: { ios: ['@pinchukvd'], backend: ['@indmaksim'] },
};

export function fakeClient(users = {}) {
  const calls = { messages: [], threads: [], threadMessages: [], users: [] };
  let nextId = 1000;
  return {
    calls,
    async getUser(id) {
      calls.users.push(id);
      return users[id] ?? null;
    },
    async postMessage(chatId, content) {
      calls.messages.push({ chatId, content });
      return { id: nextId++ };
    },
    async createThread(messageId) {
      calls.threads.push(messageId);
      return { id: nextId++ };
    },
    async postThreadMessage(threadId, content) {
      calls.threadMessages.push({ threadId, content });
      return { id: nextId++ };
    },
  };
}

export async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'users-bot-'));
  return createStore({ path: join(dir, 'state.json'), dedupeTtlMs: testConfig.dedupeTtlMs });
}

export const employee = (over = {}) => ({
  id: 770359, first_name: 'Лев', last_name: 'Барышев', email: 'baryshev@pachca.com',
  list_tags: ['iOS'], department: 'iOS', title: 'iOS Developer', bot: false, ...over,
});

export const testAccount = (over = {}) => ({
  id: 819616, first_name: 'L;ekbz ДмитриевнаВнааа', last_name: 'Алесандровга',
  email: 'dekina+1@pachca.com', list_tags: [], bot: false, ...over,
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ждать выполнения условия — обработка вебхука идёт в фоне после ответа 200. */
export async function waitFor(predicate, { timeout = 2000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('условие не выполнилось за отведённое время');
    await sleep(interval);
  }
}
