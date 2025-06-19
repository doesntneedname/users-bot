import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = 3002;
const API_URL = 'https://api.pachca.com/api/shared/v1/users';
const TOKEN = process.env.PACHCA_API_TOKEN;
const MESSAGE_URL = 'https://api.pachca.com/api/shared/v1/messages';

let logCollector = [];

app.use(express.json());
console.log('Регистрируем маршрут POST /employee');
app.post('/employee', doPost);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// ===============================================
// Обработка входящего запроса
// ===============================================
async function doPost(req, res) {
  try {
    const data = req.body;
    addLog(`Получены данные: ${JSON.stringify(data)}`);

    if (data.type !== 'company_member') {
      addLog('Неподдерживаемый тип объекта (type)');
      return res.status(400).send('Unsupported object type');
    }

    const { event, user_ids, created_at } = data;
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      addLog('user_ids отсутствует или не является массивом');
      return res.status(400).send('No user IDs');
    }

    for (let userId of user_ids) {
      addLog(`Обработка пользователя ${userId}`);

      // Обрабатываем событие
      if (event === 'invite') {
        const scheduledTime = new Date(created_at).getTime() + 15 * 60 * 1000;
        const now = Date.now();

        const checkAndSend = async () => {
          const current = Date.now();
          if (current >= scheduledTime) {
            const userData = await fetchUserData(userId);
            if (!userData) {
              addLog(`(Отложенно) Не удалось получить данные пользователя ${userId}`);
              return;
            }

            const { first_name, last_name } = userData;

            if (!first_name || !last_name) {
              addLog(`(Отложенно) Имя или фамилия отсутствуют. Пропускаем.`);
              return;
            }

            if (isTestAccount(first_name, last_name)) {
              addLog(`(Отложенно) Тестовый аккаунт. Пропускаем.`);
              return;
            }

            addLog(`(Отложенно) Отправляем уведомление`);
            await sendNotification(userData, 'invite', created_at);
          } else {
            setTimeout(checkAndSend, 60 * 1000);
          }
        };

        addLog(`Событие invite. Планируем отложенную отправку.`);
        checkAndSend();

      } else if (event === 'suspend') {
        const userData = await fetchUserData(userId);
        if (!userData) {
          addLog(`Не удалось получить данные пользователя ${userId}`);
          continue;
        }

        const { first_name, last_name } = userData;

        if (!first_name || !last_name) {
          addLog(`Имя или фамилия отсутствуют. Пропускаем.`);
          continue;
        }

        if (isTestAccount(first_name, last_name)) {
          addLog(`Тестовый аккаунт. Пропускаем.`);
          continue;
        }

        await sendNotification(userData, 'suspend', created_at);

      } else if (event === 'confirm') {
        addLog(`Событие confirm получено. Ничего не делаем.`);
        continue;

      } else {
        addLog(`Событие ${event} не обрабатывается.`);
        continue;
      }
    }

    res.status(200).send('Success');
  } catch (error) {
    addLog(`Ошибка в doPost: ${error.message}`);
    res.status(500).send('Error');
  }
}

// ===============================================
// Проверка тестового аккаунта
// ===============================================
function isTestAccount(firstName, lastName) {
  const combined = `${firstName} ${lastName}`;
  const testRegex = /(тест|test)/i;
  const specialCharsRegex = /[\d+!@#$%^&*(),.?":{}|<>]/;
  return testRegex.test(combined) || specialCharsRegex.test(combined);
}

// ===============================================
// Получение данных пользователя
// ===============================================
async function fetchUserData(userId) {
  try {
    const response = await fetch(`${API_URL}/${userId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    const json = await response.json();
    return json.data;
  } catch (error) {
    addLog(`Ошибка при fetchUserData(${userId}): ${error.message}`);
    return null;
  }
}

// ===============================================
// Отправка уведомления
// ===============================================
async function sendNotification(userData, event, createdAt) {
  const { first_name, last_name, list_tags } = userData;
  const mainMessage = getMainMessage(event, first_name, last_name);
  if (!mainMessage) {
    addLog(`Событие ${event} не поддерживается`);
    return;
  }

  const formattedDate = new Date(createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  addLog(`Дата события: ${formattedDate}`);

  const mainPayload = {
    "message": {
      "entity_type": "discussion",
      "entity_id": 144223,
      "content": mainMessage
    }
  };

  try {
    const mainResponse = await fetch(MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(mainPayload)
    });

    const mainResponseData = await mainResponse.json();
    if (mainResponseData.data && mainResponseData.data.id) {
      const messageId = mainResponseData.data.id;
      addLog(`Основное сообщение отправлено. ID: ${messageId}`);
      sendThreadMessage(messageId, list_tags, event);
    } else {
      addLog('Не удалось создать основное сообщение.');
    }
  } catch (error) {
    addLog(`Ошибка при отправке сообщения: ${error.message}`);
  }
}

// ===============================================
// Создание треда и доп. сообщение
// ===============================================
async function sendThreadMessage(messageId, list_tags, event) {
  const threadUrl = `${MESSAGE_URL}/${messageId}/thread`;
  let threadContent;

  if (event === 'suspend') {
    threadContent = list_tags?.length
      ? `@lgmspb\n@lpaspb\nТеги: ${list_tags.join(', ')}`
      : `@lgmspb\n@lpaspb`;
  } else if (event === 'invite') {
    threadContent = list_tags?.length
      ? `@lpaspb\nТеги: ${list_tags.join(', ')}`
      : `@lpaspb`;
  } else {
    addLog(`Неизвестное событие для треда: ${event}`);
    return;
  }

  try {
    const threadResponse = await fetch(threadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: '{}'
    });

    const threadData = await threadResponse.json();
    if (threadData.data && threadData.data.id) {
      const threadId = threadData.data.id;
      addLog(`Тред создан. ID: ${threadId}`);

      const threadMessagePayload = {
        "message": {
          "entity_type": "thread",
          "entity_id": threadId,
          "content": threadContent
        }
      };

      await fetch(MESSAGE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(threadMessagePayload)
      });

      addLog('Сообщение в тред отправлено');
    } else {
      addLog('Не удалось создать тред.');
    }
  } catch (error) {
    addLog(`Ошибка при отправке сообщения в тред: ${error.message}`);
  }
}

// ===============================================
// Формирование текста основного сообщения
// ===============================================
function getMainMessage(event, firstName, lastName) {
  switch (event) {
    case 'invite':
      return `Встречаем нового сотрудника ${firstName} ${lastName} 🙌`;
    case 'suspend':
      return `Прощаемся с ${firstName} ${lastName} 😥`;
    default:
      return null;
  }
}

// ===============================================
// Логирование
// ===============================================
function addLog(message) {
  console.log(message);
  logCollector.push(message);
}
