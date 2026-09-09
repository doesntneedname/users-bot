// Отложенные приглашения. Приглашённого объявляем не сразу: карточка
// (теги, департамент) заполняется не в момент инвайта, а позже — по тегам
// мы зовём в тред нужных людей. Ждём заполнения до дедлайна, после чего
// объявляем как есть.
import { profileReady, screenEmployee } from './filter.js';
import { log } from './log.js';

export function createInviteWorker({ store, client, announce, config, now = () => Date.now() }) {
  async function processDue() {
    const due = store.due(now());
    for (const entry of due) {
      try {
        await processEntry(entry);
      } catch (error) {
        log.error('Ошибка обработки отложенного приглашения', {
          user_id: entry.userId, error: String(error.message || error),
        });
        // Пробуем ещё раз на следующем тике, но не бесконечно.
        entry.attempts = (entry.attempts || 0) + 1;
        if (entry.attempts >= 10) {
          log.error('Слишком много неудачных попыток, снимаю с очереди', { user_id: entry.userId });
          await store.unschedule(entry.userId);
        } else {
          entry.dueAt = now() + config.workerIntervalMs;
          await store.schedule(entry);
        }
      }
    }
  }

  async function processEntry(entry) {
    const user = await client.getUser(entry.userId);
    const verdict = screenEmployee(user, config);
    if (!verdict.ok) {
      log.info('Приглашение не объявляем', { user_id: entry.userId, reason: verdict.reason });
      await store.unschedule(entry.userId);
      return;
    }

    if (!profileReady(user) && now() < entry.deadlineAt) {
      log.info('Карточка ещё не заполнена, жду', {
        user_id: entry.userId,
        next_check_in_s: Math.round(config.workerIntervalMs / 1000),
      });
      entry.dueAt = now() + config.workerIntervalMs;
      await store.schedule(entry);
      return;
    }

    await announce(user, 'invite');
    await store.remember(entry.key, now());
    await store.unschedule(entry.userId);
  }

  let timer = null;
  return {
    processDue,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        processDue().catch((error) => log.error('Воркер упал', { error: String(error.message || error) }));
      }, config.workerIntervalMs);
      timer.unref?.();
      log.info('Воркер отложенных приглашений запущен', {
        interval_s: Math.round(config.workerIntervalMs / 1000),
        pending: store.stats().pending,
      });
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
