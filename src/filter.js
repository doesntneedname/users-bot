// Кто попадает в объявления, а кто нет.
//
// Старый фильтр смотрел только на имя («тест» или спецсимвол) и дважды
// пропускал тестовые аккаунты в боевой чат: «not me» (06.08.2026) и
// «L;ekbz ДмитриевнаВнааа Алесандровга» (09.09.2026) — в первом нет ни
// «теста», ни спецсимволов, во втором символ «;» в старый список не входил.
//
// Надёжный признак — почта. У всех настоящих сотрудников она вида
// `фамилия@pachca.com`, у тестовых аккаунтов — плюс-алиас
// (`dekina+1@pachca.com`, `baryshev+1@pachca.com`) или внешний домен.
// Проверено по всей базе: 37 активных сотрудников с корп-почтой проходят,
// оба «утёкших» теста — нет.

const TEST_WORDS = /(тест|test|демо|demo|проверк|check|guest|гость|dummy|fake)/i;

// В имени допустимы буквы, пробел, дефис (Гончар-Прушковский), апостроф
// (О'Коннор) и точка (инициалы). Цифры и прочие символы — признак мусора.
const SUSPICIOUS_NAME_CHARS = /[^\p{L}\s'’.\-]/u;

export function splitEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  return { local: value.slice(0, at), domain: value.slice(at + 1) };
}

/**
 * Пропускать ли сотрудника в объявление.
 * @returns {{ok: boolean, reason: string}} reason всегда заполнен — он идёт в лог.
 */
export function screenEmployee(user, { corporateDomains = ['pachca.com'] } = {}) {
  if (!user) return { ok: false, reason: 'нет данных пользователя' };
  if (user.bot) return { ok: false, reason: 'бот' };

  const firstName = String(user.first_name || '').trim();
  const lastName = String(user.last_name || '').trim();
  if (!firstName || !lastName) return { ok: false, reason: 'нет имени или фамилии' };

  const parts = splitEmail(user.email);
  if (!parts) return { ok: false, reason: 'нет корректной почты' };
  if (parts.local.includes('+')) {
    return { ok: false, reason: `плюс-алиас в почте (${user.email})` };
  }
  if (!corporateDomains.includes(parts.domain)) {
    return { ok: false, reason: `внешняя почта (${parts.domain})` };
  }

  const fullName = `${firstName} ${lastName}`;
  if (TEST_WORDS.test(fullName)) return { ok: false, reason: `тестовое имя (${fullName})` };
  if (SUSPICIOUS_NAME_CHARS.test(fullName)) {
    return { ok: false, reason: `подозрительные символы в имени (${fullName})` };
  }

  return { ok: true, reason: 'сотрудник' };
}

/** Заполнена ли карточка — по ней воркер решает, ждать ли ещё до объявления. */
export function profileReady(user) {
  const tags = normalizeTags(user?.list_tags);
  return tags.length > 0 || Boolean(user?.department) || Boolean(user?.title);
}

export function normalizeTags(listTags) {
  if (!listTags) return [];
  if (Array.isArray(listTags)) return listTags.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof listTags === 'string') return listTags.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
