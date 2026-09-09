// Состояние на диске: без него отложенные приглашения жили в setTimeout и
// умирали вместе с контейнером, а повторная доставка вебхука (Пачка даёт
// at-least-once) приводила к дублю сообщения в чате.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from './log.js';

const EMPTY = { seen: {}, pending: {} };

export async function createStore({ path, dedupeTtlMs }) {
  let state = await read(path);
  let writing = Promise.resolve();

  function persist() {
    // Пишем через временный файл: контейнер может умереть в любой момент.
    writing = writing.then(async () => {
      await mkdir(dirname(path), { recursive: true }).catch(() => {});
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      await rename(tmp, path);
    }).catch((error) => log.error('Не удалось сохранить состояние', { error: String(error.message || error) }));
    return writing;
  }

  return {
    path,

    /** Ключ доставки: тип + событие + сотрудник + время события. */
    isDuplicate(key) {
      return Boolean(state.seen[key]);
    },

    /**
     * Занять ключ доставки. Возвращает false, если событие уже обработано
     * или обрабатывается прямо сейчас.
     *
     * Помечаем ДО работы, а не после: две копии одного вебхука приходят
     * почти одновременно, и проверка «уже видели?» на входе успевала
     * отработать раньше, чем первая копия дописывала отметку — в чат
     * уходило два одинаковых сообщения.
     */
    async claim(key, now = Date.now()) {
      if (state.seen[key]) return false;
      state.seen[key] = now;
      gc(state, now, dedupeTtlMs);
      await persist();
      return true;
    },

    /** Вернуть ключ в работу — событие не обработалось, пусть Пачка повторит. */
    async release(key) {
      delete state.seen[key];
      await persist();
    },

    async remember(key, now = Date.now()) {
      state.seen[key] = now;
      gc(state, now, dedupeTtlMs);
      await persist();
    },
    getPending(userId) {
      return state.pending[String(userId)] || null;
    },
    listPending() {
      return Object.values(state.pending);
    },
    async schedule(entry) {
      state.pending[String(entry.userId)] = entry;
      await persist();
    },
    async unschedule(userId) {
      delete state.pending[String(userId)];
      await persist();
    },
    due(now = Date.now()) {
      return Object.values(state.pending).filter((entry) => entry.dueAt <= now);
    },
    stats() {
      return { pending: Object.keys(state.pending).length, seen: Object.keys(state.seen).length };
    },
    async flush() {
      await writing;
    },
  };
}

function gc(state, now, ttl) {
  for (const [key, ts] of Object.entries(state.seen)) {
    if (now - ts > ttl) delete state.seen[key];
  }
}

async function read(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return { seen: parsed.seen || {}, pending: parsed.pending || {} };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.warn('Состояние не прочиталось, начинаю с чистого', { path, error: String(error.message || error) });
    }
    return structuredClone(EMPTY);
  }
}

export function deliveryKey(payload, userId) {
  return `${payload.type}:${payload.event}:${userId}:${payload.created_at || ''}`;
}
