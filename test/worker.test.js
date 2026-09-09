import test from 'node:test';
import assert from 'node:assert/strict';
import { createInviteWorker } from '../src/worker.js';
import { createAnnouncer } from '../src/notify.js';
import { employee, fakeClient, tempStore, testAccount, testConfig } from './helpers.js';

async function setup(users, config = testConfig) {
  const store = await tempStore();
  const client = fakeClient(users);
  const announce = createAnnouncer({ client, config });
  let now = Date.now();
  const worker = createInviteWorker({ store, client, announce, config, now: () => now });
  return { store, client, worker, advance(ms) { now += ms; }, at: () => now };
}

const pending = (userId, ctx, over = {}) => ({
  key: `company_member:invite:${userId}:2026-09-09T10:00:00Z`,
  userId, event: 'invite', createdAt: ctx.at(),
  dueAt: ctx.at(), deadlineAt: ctx.at() + testConfig.inviteDeadlineMs, attempts: 0, ...over,
});

test('созревшее приглашение объявляется и снимается с очереди', async () => {
  const ctx = await setup({ 770359: employee() });
  await ctx.store.schedule(pending(770359, ctx));
  await ctx.worker.processDue();
  assert.equal(ctx.client.calls.messages.length, 1);
  assert.equal(ctx.store.stats().pending, 0);
});

test('тестовый аккаунт снимается с очереди без объявления', async () => {
  const ctx = await setup({ 819616: testAccount() });
  await ctx.store.schedule(pending(819616, ctx));
  await ctx.worker.processDue();
  assert.equal(ctx.client.calls.messages.length, 0);
  assert.equal(ctx.store.stats().pending, 0);
});

test('незаполненная карточка откладывает объявление до дедлайна', async () => {
  const bare = employee({ list_tags: [], department: '', title: '' });
  const ctx = await setup({ 770359: bare });
  await ctx.store.schedule(pending(770359, ctx));

  await ctx.worker.processDue();
  assert.equal(ctx.client.calls.messages.length, 0, 'пока ждём заполнения');
  assert.equal(ctx.store.stats().pending, 1);

  // Карточку заполнили — объявляем на следующем тике.
  ctx.client.calls.users.length = 0;
  ctx.advance(testConfig.workerIntervalMs);
  Object.assign(bare, { list_tags: ['Backend'] });
  await ctx.worker.processDue();
  assert.equal(ctx.client.calls.messages.length, 1);
});

test('после дедлайна объявляем даже с пустой карточкой', async () => {
  const ctx = await setup({ 770359: employee({ list_tags: [], department: '', title: '' }) });
  await ctx.store.schedule(pending(770359, ctx));
  ctx.advance(testConfig.inviteDeadlineMs + 1000);
  await ctx.worker.processDue();
  assert.equal(ctx.client.calls.messages.length, 1);
});

test('ошибка Пачки не теряет приглашение, но не крутится вечно', async () => {
  const ctx = await setup({ 770359: employee() });
  ctx.client.getUser = async () => { throw new Error('502'); };
  await ctx.store.schedule(pending(770359, ctx));

  await ctx.worker.processDue();
  assert.equal(ctx.store.stats().pending, 1, 'осталось на повтор');

  for (let i = 0; i < 12; i += 1) {
    ctx.advance(testConfig.workerIntervalMs);
    await ctx.worker.processDue();
  }
  assert.equal(ctx.store.stats().pending, 0, 'после 10 неудач снято с очереди');
});

test('очередь переживает перезапуск: состояние читается с диска', async () => {
  const ctx = await setup({ 770359: employee() });
  await ctx.store.schedule(pending(770359, ctx));
  await ctx.store.flush();

  const { createStore } = await import('../src/store.js');
  const reopened = await createStore({ path: ctx.store.path, dedupeTtlMs: testConfig.dedupeTtlMs });
  assert.equal(reopened.stats().pending, 1);
  assert.equal(reopened.listPending()[0].userId, 770359);
});

test('дедупликация тоже переживает перезапуск', async () => {
  const ctx = await setup({ 770359: employee() });
  await ctx.store.remember('company_member:suspend:770359:2026-09-09T15:02:55Z');
  await ctx.store.flush();

  const { createStore } = await import('../src/store.js');
  const reopened = await createStore({ path: ctx.store.path, dedupeTtlMs: testConfig.dedupeTtlMs });
  assert.equal(reopened.isDuplicate('company_member:suspend:770359:2026-09-09T15:02:55Z'), true);
});
