// Тексты объявлений и постинг: основное сообщение в чат «Доступы» плюс
// тред с упоминаниями тех, кто выдаёт доступы.
import { normalizeTags } from './filter.js';
import { log } from './log.js';

export function buildMainMessage(event, user) {
  const name = `${String(user.first_name).trim()} ${String(user.last_name).trim()}`;
  if (event === 'invite') return `Встречаем нового сотрудника ${name} 🙌`;
  if (event === 'suspend') return `Прощаемся с ${name} 😥`;
  return null;
}

export function buildMentions(user, { baseMentions, tagMentions }) {
  const mentions = new Set(baseMentions);
  for (const tag of normalizeTags(user.list_tags)) {
    const extra = tagMentions[tag.toLowerCase()];
    if (extra) extra.forEach((m) => mentions.add(m));
  }
  return [...mentions];
}

export function buildThreadMessage(user, { baseMentions, tagMentions }) {
  const lines = buildMentions(user, { baseMentions, tagMentions });
  const tags = normalizeTags(user.list_tags);
  const details = [];
  if (user.title) details.push(`Должность: ${user.title}`);
  if (user.department) details.push(`Департамент: ${user.department}`);
  if (user.email) details.push(`Почта: ${user.email}`);
  if (tags.length) details.push(`Теги: ${tags.join(', ')}`);
  return [...lines, ...(details.length ? ['', ...details] : [])].join('\n');
}

export function createAnnouncer({ client, config }) {
  return async function announce(user, event) {
    const content = buildMainMessage(event, user);
    if (!content) {
      log.warn('Нечего объявлять: неизвестное событие', { event });
      return null;
    }

    const threadContent = buildThreadMessage(user, config);
    if (config.dryRun) {
      log.info('DRY_RUN: сообщение не отправлено', { event, user_id: user.id, content, thread: threadContent });
      return { dryRun: true };
    }

    const message = await client.postMessage(config.chatId, content);
    if (!message?.id) throw new Error('Пачка не вернула id созданного сообщения');
    log.info('Объявление отправлено', { event, user_id: user.id, message_id: message.id });

    // Тред создаём отдельно: если он упадёт, основное сообщение уже в чате.
    try {
      const thread = await client.createThread(message.id);
      if (!thread?.id) throw new Error('Пачка не вернула id треда');
      await client.postThreadMessage(thread.id, threadContent);
      log.info('Упоминания отправлены в тред', { user_id: user.id, thread_id: thread.id });
    } catch (error) {
      log.error('Не удалось написать в тред', { user_id: user.id, message_id: message.id, error: String(error.message || error) });
    }
    return message;
  };
}
