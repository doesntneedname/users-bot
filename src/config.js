// Конфигурация из окружения. Всё, что раньше было зашито в код (chat id,
// задержка, упоминания по тегам), теперь настраивается через .env.
import process from 'node:process';

const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} должен быть числом, а не «${raw}»`);
  return value;
};

const bool = (name, fallback = false) => {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on', 'да'].includes(raw);
};

const list = (name, fallback) => {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

export const config = {
  port: int('PORT', 3002),
  token: process.env.PACHCA_API_TOKEN || '',
  apiUrl: process.env.PACHCA_API_URL || 'https://api.pachca.com/api/shared/v1',

  // Чат «Доступы», куда уходят объявления.
  chatId: int('ANNOUNCE_CHAT_ID', 144223),

  // Корпоративные домены: сотрудник — это почта вида user@pachca.com.
  corporateDomains: list('CORPORATE_DOMAINS', ['pachca.com']),

  // Приглашённого объявляем не сразу: даём HR время заполнить карточку
  // (теги, департамент). Если к дедлайну карточка так и пуста — объявляем
  // как есть, лишь бы человек прошёл проверку почты.
  inviteDelayMs: int('INVITE_DELAY_MINUTES', 120) * 60_000,
  inviteDeadlineMs: int('INVITE_DEADLINE_HOURS', 24) * 3_600_000,
  workerIntervalMs: int('WORKER_INTERVAL_SECONDS', 60) * 1000,

  // Окно, в котором повторная доставка того же события считается дублем.
  dedupeTtlMs: int('DEDUPE_TTL_HOURS', 24) * 3_600_000,

  statePath: process.env.STATE_PATH || '/data/state.json',

  // DRY_RUN=1 — всё считаем и логируем, но в Пачку не постим.
  dryRun: bool('DRY_RUN'),

  // Подпись исходящего вебхука («Signing secret» в настройках бота).
  // Пустая строка — проверка выключена (с предупреждением в логе).
  webhookSecret: process.env.PACHCA_WEBHOOK_SECRET || '',

  // enforce — не совпала подпись, значит 401 и запрос не обрабатываем.
  // log — только пишем в лог, сходится подпись или нет, и обрабатываем как
  // обычно. Нужен на выкате: пока живой вебхук не подтвердил, что формат
  // подписи наш, блокировать доставки нельзя — молча пропадут объявления.
  signatureMode: (process.env.WEBHOOK_SIGNATURE_MODE || 'enforce').toLowerCase(),

  // Кого звать в тред всегда и кого добавлять по тегам сотрудника.
  baseMentions: list('BASE_MENTIONS', ['@lgmspb', '@lpaspb']),
  tagMentions: {
    frontend: ['@golubevpn'],
    ios: ['@pinchukvd', '@DmitryPlatonov'],
    backend: ['@indmaksim'],
    android: ['@vbakurov', '@pinchukvd'],
  },
};

export function assertConfig() {
  if (!config.token) throw new Error('PACHCA_API_TOKEN не задан');
  if (!config.chatId) throw new Error('ANNOUNCE_CHAT_ID не задан');
}
