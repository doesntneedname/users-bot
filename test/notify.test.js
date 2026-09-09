import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainMessage, buildMentions, buildThreadMessage, createAnnouncer } from '../src/notify.js';
import { employee, fakeClient, testConfig } from './helpers.js';

test('тексты объявлений не изменились относительно старой версии', () => {
  assert.equal(buildMainMessage('invite', employee()), 'Встречаем нового сотрудника Лев Барышев 🙌');
  assert.equal(buildMainMessage('suspend', employee()), 'Прощаемся с Лев Барышев 😥');
  assert.equal(buildMainMessage('activate', employee()), null);
});

test('упоминания: базовые всегда, по тегам — дополнительно', () => {
  assert.deepEqual(buildMentions(employee({ list_tags: [] }), testConfig), ['@lgmspb', '@lpaspb']);
  assert.deepEqual(buildMentions(employee({ list_tags: ['iOS'] }), testConfig), ['@lgmspb', '@lpaspb', '@pinchukvd']);
  assert.deepEqual(
    buildMentions(employee({ list_tags: 'backend, iOS' }), testConfig),
    ['@lgmspb', '@lpaspb', '@indmaksim', '@pinchukvd'],
  );
});

test('в тред уходят упоминания и карточка сотрудника', () => {
  const text = buildThreadMessage(employee(), testConfig);
  assert.match(text, /@lgmspb/);
  assert.match(text, /Должность: iOS Developer/);
  assert.match(text, /Почта: baryshev@pachca.com/);
  assert.match(text, /Теги: iOS/);
});

test('announce постит сообщение и тред', async () => {
  const client = fakeClient();
  const announce = createAnnouncer({ client, config: testConfig });
  await announce(employee(), 'invite');
  assert.equal(client.calls.messages.length, 1);
  assert.equal(client.calls.messages[0].chatId, 144223);
  assert.equal(client.calls.threads.length, 1);
  assert.equal(client.calls.threadMessages.length, 1);
});

test('падение треда не отменяет основное сообщение', async () => {
  const client = fakeClient();
  client.createThread = async () => { throw new Error('1С шутит'); };
  const announce = createAnnouncer({ client, config: testConfig });
  await announce(employee(), 'suspend');
  assert.equal(client.calls.messages.length, 1);
});

test('DRY_RUN ничего не отправляет', async () => {
  const client = fakeClient();
  const announce = createAnnouncer({ client, config: { ...testConfig, dryRun: true } });
  const result = await announce(employee(), 'invite');
  assert.deepEqual(result, { dryRun: true });
  assert.equal(client.calls.messages.length, 0);
});
