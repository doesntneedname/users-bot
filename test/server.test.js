// Сквозные тесты вебхука: поднимаем приложение на случайном порту и
// стучимся в него обычным fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp, verifySignature } from '../src/server.js';
import { createAnnouncer } from '../src/notify.js';
import { createInviteWorker } from '../src/worker.js';
import { employee, fakeClient, sleep, tempStore, testAccount, testConfig, waitFor } from './helpers.js';

async function boot({ users = {}, config = testConfig } = {}) {
  const store = await tempStore();
  const client = fakeClient(users);
  const announce = createAnnouncer({ client, config });
  const worker = createInviteWorker({ store, client, announce, config });
  const app = createApp({ config, store, client, announce, worker });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, store, client, worker,
    async post(payload, headers = {}) {
      const res = await fetch(`${url}/employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      return res;
    },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

const suspendPayload = (userId, createdAt = '2026-09-09T15:02:55Z') => ({
  event: 'suspend', type: 'company_member', user_ids: [userId], created_at: createdAt,
});

test('увольнение сотрудника объявляется', async () => {
  const ctx = await boot({ users: { 770359: employee() } });
  const res = await ctx.post(suspendPayload(770359));
  assert.equal(res.status, 200);
  await waitFor(() => ctx.client.calls.messages.length === 1);
  assert.match(ctx.client.calls.messages[0].content, /Прощаемся с Лев Барышев/);
  await ctx.close();
});

test('тестовый аккаунт не объявляется (инцидент 09.09.2026)', async () => {
  const ctx = await boot({ users: { 819616: testAccount() } });
  await ctx.post(suspendPayload(819616));
  await waitFor(() => ctx.client.calls.users.length === 1);
  await sleep(50);
  assert.equal(ctx.client.calls.messages.length, 0);
  await ctx.close();
});

test('повторная доставка того же события не даёт второго сообщения', async () => {
  const ctx = await boot({ users: { 770359: employee() } });
  await ctx.post(suspendPayload(770359));
  await ctx.post(suspendPayload(770359));
  await sleep(100);
  assert.equal(ctx.client.calls.messages.length, 1);
  await ctx.close();
});

test('две копии вебхука, пришедшие одновременно, дают одно сообщение', async () => {
  // Живой прогон 09.09.2026: обе копии успевали пройти проверку «уже видели?»
  // до того, как первая дописывала отметку — в чат уходил дубль.
  const ctx = await boot({ users: { 770359: employee() } });
  const payload = suspendPayload(770359);
  await Promise.all([ctx.post(payload), ctx.post(payload), ctx.post(payload)]);
  await sleep(150);
  assert.equal(ctx.client.calls.messages.length, 1);
  await ctx.close();
});

test('повторное увольнение с другим временем события объявляется отдельно', async () => {
  // Сценарий 09.09.2026: suspend → activate → suspend. Это разные события,
  // и дедупликация их не склеивает.
  const ctx = await boot({ users: { 770359: employee() } });
  await ctx.post(suspendPayload(770359, '2026-09-09T15:02:55Z'));
  await ctx.post({ event: 'activate', type: 'company_member', user_ids: [770359], created_at: '2026-09-09T15:19:17Z' });
  await ctx.post(suspendPayload(770359, '2026-09-09T15:19:22Z'));
  await waitFor(() => ctx.client.calls.messages.length === 2);
  await ctx.close();
});

test('приглашение ставится в очередь, а не постится сразу', async () => {
  const ctx = await boot({ users: { 770359: employee() } });
  await ctx.post({
    event: 'invite', type: 'company_member', user_ids: [770359],
    created_at: new Date().toISOString(),
  });
  await waitFor(() => ctx.store.stats().pending === 1);
  assert.equal(ctx.client.calls.messages.length, 0);
  await ctx.close();
});

test('просроченное приглашение объявляется сразу при получении', async () => {
  const ctx = await boot({ users: { 770359: employee() } });
  await ctx.post({
    event: 'invite', type: 'company_member', user_ids: [770359],
    created_at: '2026-01-01T00:00:00Z',
  });
  await waitFor(() => ctx.client.calls.messages.length === 1);
  assert.match(ctx.client.calls.messages[0].content, /Встречаем нового сотрудника/);
  await ctx.close();
});

test('увольнение снимает висящее приглашение', async () => {
  const ctx = await boot({ users: { 770359: employee() } });
  await ctx.post({
    event: 'invite', type: 'company_member', user_ids: [770359],
    created_at: new Date().toISOString(),
  });
  await waitFor(() => ctx.store.stats().pending === 1);
  await ctx.post(suspendPayload(770359, '2026-09-09T16:00:00Z'));
  await waitFor(() => ctx.store.stats().pending === 0);
  await ctx.close();
});

test('чужие типы и события игнорируются с кодом 200', async () => {
  const ctx = await boot({ users: { 770359: employee() } });
  const other = await ctx.post({ event: 'suspend', type: 'chat_member', user_ids: [770359] });
  assert.equal(other.status, 200);
  await ctx.post({ event: 'confirm', type: 'company_member', user_ids: [770359], created_at: '2026-09-09T10:00:00Z' });
  await sleep(50);
  assert.equal(ctx.client.calls.messages.length, 0);
  await ctx.close();
});

test('healthz отвечает состоянием', async () => {
  const ctx = await boot();
  const res = await fetch(`${ctx.url}/healthz`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  await ctx.close();
});

test('подпись вебхука: неверная отклоняется, верная проходит', async () => {
  const config = { ...testConfig, webhookSecret: 'shhh' };
  const ctx = await boot({ users: { 770359: employee() }, config });
  const payload = suspendPayload(770359);
  const body = JSON.stringify(payload);

  const bad = await fetch(`${ctx.url}/employee`, {
    method: 'POST', headers: { 'Pachca-Signature': 'deadbeef' }, body,
  });
  assert.equal(bad.status, 401);
  await sleep(50);
  assert.equal(ctx.client.calls.messages.length, 0);

  const signature = crypto.createHmac('sha256', 'shhh').update(body).digest('hex');
  const good = await fetch(`${ctx.url}/employee`, {
    method: 'POST', headers: { 'Pachca-Signature': signature }, body,
  });
  assert.equal(good.status, 200);
  await waitFor(() => ctx.client.calls.messages.length === 1);
  await ctx.close();
});

test('режим log: неверная подпись не блокирует обработку', async () => {
  // Нужен на выкате: пока живой вебхук не подтвердил формат подписи,
  // блокировать доставки нельзя — объявления пропали бы молча.
  const config = { ...testConfig, webhookSecret: 'shhh', signatureMode: 'log' };
  const ctx = await boot({ users: { 770359: employee() }, config });
  const res = await fetch(`${ctx.url}/employee`, {
    method: 'POST',
    headers: { 'Pachca-Signature': 'deadbeef' },
    body: JSON.stringify(suspendPayload(770359)),
  });
  assert.equal(res.status, 200);
  await waitFor(() => ctx.client.calls.messages.length === 1);
  await ctx.close();
});

test('verifySignature не падает на пустом заголовке', () => {
  assert.equal(verifySignature(Buffer.from('{}'), undefined, 'secret'), false);
  assert.equal(verifySignature(Buffer.from('{}'), 'короткая', 'secret'), false);
});
