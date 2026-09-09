import test from 'node:test';
import assert from 'node:assert/strict';
import { profileReady, screenEmployee, splitEmail } from '../src/filter.js';

const employee = (over = {}) => ({
  id: 1, first_name: 'Лев', last_name: 'Барышев', email: 'baryshev@pachca.com',
  list_tags: ['iOS'], bot: false, ...over,
});

test('настоящий сотрудник проходит', () => {
  assert.equal(screenEmployee(employee()).ok, true);
});

test('фамилия с дефисом и апострофом — это нормально', () => {
  assert.equal(screenEmployee(employee({ last_name: 'Гончар-Прушковский' })).ok, true);
  assert.equal(screenEmployee(employee({ last_name: "О'Коннор" })).ok, true);
});

test('плюс-алиас отсекается: случай «not me» 06.08.2026', () => {
  const verdict = screenEmployee(employee({ first_name: 'not', last_name: 'me', email: 'baryshev+1@pachca.com' }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /плюс-алиас/);
});

test('плюс-алиас отсекается: случай 09.09.2026, который прошёл старый фильтр', () => {
  const verdict = screenEmployee(employee({
    first_name: 'L;ekbz ДмитриевнаВнааа', last_name: 'Алесандровга', email: 'dekina+1@pachca.com', list_tags: [],
  }));
  assert.equal(verdict.ok, false);
});

test('внешняя почта отсекается', () => {
  assert.match(screenEmployee(employee({ email: 'petrov@gmail.com' })).reason, /внешняя почта/);
});

test('слово «тест» в имени отсекается', () => {
  assert.equal(screenEmployee(employee({ last_name: 'Тестов' })).ok, false);
  assert.equal(screenEmployee(employee({ first_name: 'Artemy', last_name: 'Test' })).ok, false);
});

test('мусорные символы в имени отсекаются даже при корп-почте', () => {
  const verdict = screenEmployee(employee({ first_name: 'L;ekbz', email: 'dekina@pachca.com' }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /подозрительные символы/);
});

test('боты, безымянные и без почты не проходят', () => {
  assert.equal(screenEmployee(employee({ bot: true })).ok, false);
  assert.equal(screenEmployee(employee({ last_name: '' })).ok, false);
  assert.equal(screenEmployee(employee({ email: '' })).ok, false);
  assert.equal(screenEmployee(null).ok, false);
});

test('домены настраиваются', () => {
  const verdict = screenEmployee(employee({ email: 'ivan@example.com' }), { corporateDomains: ['example.com'] });
  assert.equal(verdict.ok, true);
});

test('profileReady: карточка считается заполненной по тегам, департаменту или должности', () => {
  assert.equal(profileReady({ list_tags: ['Dev'] }), true);
  assert.equal(profileReady({ department: 'Backend' }), true);
  assert.equal(profileReady({ title: 'iOS Developer' }), true);
  assert.equal(profileReady({ list_tags: [] }), false);
});

test('splitEmail разбирает адрес и не падает на мусоре', () => {
  assert.deepEqual(splitEmail('A@Pachca.COM'), { local: 'a', domain: 'pachca.com' });
  assert.equal(splitEmail('broken'), null);
  assert.equal(splitEmail(''), null);
});
