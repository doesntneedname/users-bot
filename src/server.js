// HTTP-слой: приём вебхука Пачки, проверка подписи, дедупликация и
// маршрутизация событий. Обработчик отвечает 200 сразу — дальше работа
// идёт в фоне, чтобы Пачка не ретраила из-за нашей медлительности.
import crypto from 'node:crypto';
import express from 'express';
import { profileReady, screenEmployee } from './filter.js';
import { deliveryKey } from './store.js';
import { log } from './log.js';

export function createApp({ config, store, client, announce, worker }) {
  const app = express();
  // Сырое тело нужно для HMAC: после JSON.parse подпись уже не сойдётся.
  app.use(express.raw({ type: '*/*', limit: '1mb' }));

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      version: 2,
      dry_run: config.dryRun,
      signature_check: config.webhookSecret ? config.signatureMode : 'off',
      ...store.stats(),
    });
  });

  app.post('/employee', async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    if (config.webhookSecret) {
      const header = req.get('Pachca-Signature');
      const valid = verifySignature(raw, header, config.webhookSecret);
      if (!valid && config.signatureMode === 'enforce') {
        log.warn('Неверная подпись вебхука', { has_header: Boolean(header) });
        return res.status(401).send('Invalid signature');
      }
      if (valid) log.info('Подпись вебхука сошлась');
      else log.warn('Подпись вебхука НЕ сошлась, но режим log — обрабатываю', { has_header: Boolean(header) });
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      log.warn('Тело вебхука не разобралось как JSON');
      return res.status(400).send('Bad JSON');
    }

    log.info('Вебхук получен', { type: payload.type, event: payload.event, user_ids: payload.user_ids });

    if (payload.type !== 'company_member') {
      // 200, чтобы Пачка не ретраила то, что мы всё равно не обрабатываем.
      return res.status(200).send('Ignored: unsupported type');
    }
    const userIds = Array.isArray(payload.user_ids) ? payload.user_ids : [];
    if (userIds.length === 0) return res.status(200).send('Ignored: no user ids');

    res.status(200).send('OK');

    for (const userId of userIds) {
      handleUser(payload, userId).catch((error) => {
        log.error('Ошибка обработки события', {
          user_id: userId, event: payload.event, error: String(error.message || error),
        });
      });
    }
  });

  async function handleUser(payload, userId) {
    if (payload.event !== 'invite' && payload.event !== 'suspend') {
      // activate / confirm и всё остальное: только в лог.
      log.info('Событие не обрабатывается', { user_id: userId, event: payload.event });
      return;
    }

    const key = deliveryKey(payload, userId);
    // Занимаем ключ ДО работы — иначе две копии одного вебхука, пришедшие
    // одновременно, обе пройдут проверку и напишут в чат дважды.
    if (!(await store.claim(key))) {
      log.info('Повторная доставка, пропускаю', { user_id: userId, event: payload.event, key });
      return;
    }

    try {
      if (payload.event === 'invite') await scheduleInvite(payload, userId, key);
      else await announceSuspend(payload, userId, key);
    } catch (error) {
      // Не смогли обработать — отдаём ключ обратно, чтобы повтор доставки
      // (или ручной ретрай) не был отброшен как дубль.
      await store.release(key);
      throw error;
    }
  }

  async function scheduleInvite(payload, userId, key) {
    const createdAt = Date.parse(payload.created_at || '') || Date.now();
    const entry = {
      key,
      userId,
      event: 'invite',
      createdAt,
      dueAt: createdAt + config.inviteDelayMs,
      deadlineAt: createdAt + config.inviteDeadlineMs,
      attempts: 0,
    };
    await store.schedule(entry);
    log.info('Приглашение поставлено в очередь', {
      user_id: userId,
      due_at: new Date(entry.dueAt).toISOString(),
      deadline_at: new Date(entry.deadlineAt).toISOString(),
    });
    // Если задержка уже прошла (например, вебхук доставили с опозданием),
    // не ждём тика воркера.
    if (entry.dueAt <= Date.now()) await worker.processDue();
  }

  async function announceSuspend(payload, userId, key) {
    const user = await client.getUser(userId);
    const verdict = screenEmployee(user, config);
    if (!verdict.ok) {
      log.info('Увольнение не объявляем', { user_id: userId, reason: verdict.reason });
      return;
    }
    // Приглашение могло ещё висеть в очереди — человек ушёл, объявлять приход поздно.
    if (store.getPending(userId)) {
      log.info('Снимаю отложенное приглашение: сотрудник уже отключён', { user_id: userId });
      await store.unschedule(userId);
    }
    await announce(user, 'suspend');
    log.debug('Профиль уволенного', { user_id: userId, profile_ready: profileReady(user) });
  }

  return app;
}

export function verifySignature(rawBody, headerValue, secret) {
  if (!headerValue) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(headerValue), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
