// Точка входа: собирает зависимости и поднимает сервер.
import process from 'node:process';
import { assertConfig, config } from './config.js';
import { createClient } from './pachca.js';
import { createStore } from './store.js';
import { createAnnouncer } from './notify.js';
import { createInviteWorker } from './worker.js';
import { createApp } from './server.js';
import { log } from './log.js';

assertConfig();

const store = await createStore({ path: config.statePath, dedupeTtlMs: config.dedupeTtlMs });
const client = createClient({ apiUrl: config.apiUrl, token: config.token });
const announce = createAnnouncer({ client, config });
const worker = createInviteWorker({ store, client, announce, config });
const app = createApp({ config, store, client, announce, worker });

worker.start();

const server = app.listen(config.port, () => {
  log.info('Сервис запущен', {
    port: config.port,
    chat_id: config.chatId,
    dry_run: config.dryRun,
    signature_mode: config.webhookSecret ? config.signatureMode : 'off',
    ...store.stats(),
  });
  if (!config.webhookSecret) {
    log.warn('Проверка подписи выключена: задайте PACHCA_WEBHOOK_SECRET (Signing secret бота)');
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log.info('Останавливаюсь', { signal });
    worker.stop();
    server.close(() => store.flush().then(() => process.exit(0)));
  });
}
