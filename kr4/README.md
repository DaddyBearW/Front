# Контрольная работа №4

Проект собран в одной папке `kr4` без разделения на `task19`, `task20` и т.д. Работа объединяет требования практических заданий 19-24.

## Что реализовано

- Практика 19: REST API для пользователей с PostgreSQL.
- Практика 20: REST API для пользователей с MongoDB.
- Практика 21: Redis-кэширование маршрутов чтения.
- Практика 22: балансировка нагрузки через Nginx и альтернативная конфигурация HAProxy.
- Практика 23: контейнеризация через Dockerfile и Docker Compose.
- Практика 24: README и Postman-коллекция для проверки.

## Состав проекта

- `server.js` — Express API.
- `package.json` — зависимости Node.js.
- `Dockerfile` — образ backend-сервиса.
- `docker-compose.yml` — весь стек: Nginx, HAProxy, 3 backend-сервиса, PostgreSQL, MongoDB, Redis.
- `nginx.conf` — Nginx load balancer с `max_fails` и `fail_timeout`.
- `haproxy.cfg` — альтернативный балансировщик HAProxy.
- `KR4.postman_collection.json` — коллекция Postman с тестами.

## Запуск через Docker Compose

1. Установить Docker Desktop и включить WSL integration, если запуск идёт на Windows.
2. Перейти в папку проекта: `cd C:\Users\Mosen\Desktop\Front\kr4`.
3. Запустить стек: `docker compose up -d --build`.
4. Посмотреть контейнеры: `docker compose ps`.
5. Посмотреть логи: `docker compose logs -f`.
6. Остановить проект: `docker compose down`.
7. Полностью очистить данные БД и кэша при необходимости: `docker compose down -v`.

Если порт `80` занят, поменяйте в `docker-compose.yml` строку `80:80` на, например, `8081:80`, а в Postman переменную `baseUrl` на `http://localhost:8081`.

## Основные адреса

- Nginx: `http://localhost`.
- HAProxy: `http://localhost:8080`.
- PostgreSQL снаружи: `localhost:5432`.
- MongoDB снаружи: `localhost:27017`.
- Redis снаружи: `localhost:6379`.

## Проверка балансировки

Откройте `http://localhost/` несколько раз или отправьте несколько GET-запросов в Postman. В ответе поле `server` должно меняться между `backend-1` и `backend-2`. `backend-3-backup` указан как резервный сервер и начнёт использоваться, если основные backend-сервисы недоступны.

Проверка отказоустойчивости:

1. Остановить один backend: `docker compose stop backend1`.
2. Несколько раз открыть `http://localhost/`.
3. Убедиться, что ответы продолжают приходить от доступных backend-сервисов.
4. Вернуть backend: `docker compose start backend1`.

HAProxy проверяется аналогично через `http://localhost:8080/`.

## PostgreSQL API

Маршруты используют таблицу `users` в PostgreSQL. Таблица создаётся автоматически через Sequelize.

Поля пользователя:

- `id` — целочисленный идентификатор.
- `first_name` — имя.
- `last_name` — фамилия.
- `age` — возраст.
- `created_at` — время создания в unix milliseconds.
- `updated_at` — время обновления в unix milliseconds.

Маршруты:

- `POST /api/users` — создать пользователя.
- `GET /api/users` — получить список пользователей, кэш Redis на 1 минуту.
- `GET /api/users/:id` — получить пользователя, кэш Redis на 1 минуту.
- `PATCH /api/users/:id` — обновить пользователя и очистить кэш.
- `DELETE /api/users/:id` — удалить пользователя и очистить кэш.

Пример тела для создания пользователя: `{ "first_name": "Иван", "last_name": "Петров", "age": 22 }`.

## MongoDB API

Маршруты используют коллекцию MongoDB через Mongoose.

- `POST /api/mongo-users` — создать пользователя.
- `GET /api/mongo-users` — получить список пользователей.
- `GET /api/mongo-users/:id` — получить пользователя.
- `PATCH /api/mongo-users/:id` — обновить пользователя.
- `DELETE /api/mongo-users/:id` — удалить пользователя.

Пример тела для создания пользователя: `{ "first_name": "Мария", "last_name": "Иванова", "age": 20 }`.

## Redis-кэширование

Кэшируются маршруты:

- `GET /api/users` — 1 минута.
- `GET /api/users/:id` — 1 минута.
- `GET /api/products` — 10 минут.
- `GET /api/products/:id` — 10 минут.

При первом GET-запросе ответ приходит с `source: "server"`, при повторном — с `source: "cache"`. При изменении или удалении данных соответствующий кэш очищается.

## Products API для проверки Redis

- `GET /api/products` — список товаров.
- `GET /api/products/:id` — товар по id.
- `POST /api/products` — создать товар.
- `PATCH /api/products/:id` — обновить товар.
- `DELETE /api/products/:id` — удалить товар.

Пример тела товара: `{ "name": "Планшет", "price": 30000, "description": "Учебный товар" }`.

## Как сделать тесты в Postman для сдачи

В проект уже добавлена коллекция `KR4.postman_collection.json`.

1. Запустите проект командой `docker compose up -d --build`.
2. Откройте Postman.
3. Нажмите `Import`.
4. Выберите файл `KR4.postman_collection.json` из папки `kr4`.
5. Убедитесь, что переменная `baseUrl` равна `http://localhost`, а `haproxyUrl` равна `http://localhost:8080`.
6. Откройте коллекцию `KR4 API tests`.
7. Нажмите `Run collection`.
8. Запускайте запросы по порядку сверху вниз.
9. В результате должны пройти тесты на статусы, CRUD PostgreSQL, CRUD MongoDB, Redis cache и ответы балансировщиков.
10. Для отчёта можно сделать скриншот окна Collection Runner, где видно, что тесты прошли.

## Что показать преподавателю

- Репозиторий с папкой `kr4`.
- `docker-compose.yml`, `Dockerfile`, `nginx.conf`, `haproxy.cfg`, `server.js`.
- Запущенные контейнеры через `docker compose ps`.
- Проверку `http://localhost/` с разными `server` в ответах.
- Postman Collection Runner со статусом успешного прохождения тестов.
