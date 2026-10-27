# Развёртывание PMO-портала на сервере

Стек: **три контейнера** (Caddy со статикой SPA → pmo-backend → Postgres), ~1 ГБ RAM.
Всё проверено локально: сборка фронта, прод-режим бэкенда, восстановление дампа, работа портала.

Сервер: любой VPS с 2 vCPU / 4 ГБ RAM / 40 ГБ диска, публичным IPv4 и ежедневными снапшотами у хостера.

---

## 1. Что нужно приготовить заранее

| Что | Где взять |
|---|---|
| Аккаунт у хостера VPS | панель управления хостера |
| DNS: `A`-запись `pm.example.com` → IP сервера | у того, кто управляет доменом example.com |
| SSH-ключ | `ssh-keygen -t ed25519` (публичный ключ добавить при создании сервера) |
| Дамп данных (если переносите существующий портал) | шаг 4 |

При создании сервера: образ **Ubuntu 24.04**, включить снапшоты/бэкапы у хостера, приложить SSH-ключ.
В разделе Firewall разрешить входящие **22, 80, 443**, остальное закрыть.

---

## 2. Подготовка сервера (одна команда за раз)

```bash
ssh root@<IP>

# базовая гигиена
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades      # включить авто-обновления безопасности

# firewall (облачный firewall хостера — снаружи, ufw — на самом сервере)
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

---

## 3. Код и секреты

```bash
mkdir -p /opt/pmo && cd /opt/pmo
# перенести каталоги pmo-backend/, deploy/ и RDProject/frontend/ (git clone или rsync/scp)

cd /opt/pmo/deploy
cp .env.prod.example .env
nano .env
```

Обязательно заполнить:
- `DOMAIN=pm.example.com`, `ACME_EMAIL=…` — Caddy сам получит сертификат Let's Encrypt.
- `POSTGRES_PASSWORD` — `openssl rand -base64 24`
- `ADAPTER_SECRET` — `openssl rand -base64 32` (при дефолтном значении прод **не стартует**)
- Bitrix24 и SMTP — по желанию; если задан `BITRIX24_WEBHOOK_URL`, то `BITRIX24_INBOUND_TOKEN` **обязателен**.

> Прод-режим намеренно падает на старте, если секреты дефолтные или в базе нет
> ни одного пользователя (иначе работали бы сид-пароли `admin123`/`pm123`).

---

## 4. Перенос данных

На **исходном экземпляре** портала (стек поднят):

```bash
docker exec pmo-db pg_dump -U pmo -d pmo --clean --if-exists | gzip > pmo-data.sql.gz
scp pmo-data.sql.gz root@<IP>:/opt/pmo/
```

На **сервере** — сначала поднять только базу, залить дамп, потом остальное:

```bash
cd /opt/pmo/deploy
docker compose -f docker-compose.prod.yml up -d pmo-db
sleep 10
gunzip -c /opt/pmo/pmo-data.sql.gz | docker exec -i pmo-db psql -U pmo -d pmo
docker exec pmo-db psql -U pmo -d pmo -tAc "SELECT count(*) FROM projects"   # столько проектов, сколько было в дампе
```

---

## 5. Запуск

```bash
cd /opt/pmo/deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # все три Up, pmo-db healthy
docker logs pmo-backend | tail -5                    # «prod-режим: секреты заданы»
```

Открыть `https://pm.example.com` — сертификат выпускается автоматически за 10–30 секунд.

**Ограничение частоты запросов по IP.** В поставляемом `Caddyfile` его нет: бэкенд ограничивает
только попытки входа на один email. Для портала, открытого в интернет, добавьте лимит на краю —
Caddy, собранный с модулем rate-limit (`xcaddy`), или fail2ban по журналу доступа Caddy —
как минимум для `/api/auth/*`, `/oauth/*` и `/webhooks/*`.

## 6. Бэкапы

```bash
chmod +x /opt/pmo/deploy/backup.sh
crontab -e
# раз в сутки в тихий час; <мин> <час> подставить свои:
# <мин> <час> * * * POSTGRES_USER=pmo POSTGRES_DB=pmo /opt/pmo/deploy/backup.sh >> /var/log/pmo-backup.log 2>&1
```

Два уровня: снапшоты сервера у хостера (галочка Backups) + ночной `pg_dump` в `/opt/pmo/backups`.
Оба лежат у одного провайдера, поэтому свежий дамп стоит регулярно копировать за пределы сервера,
а сбой скрипта (запись в лог и ненулевой код выхода) — отслеживать.
**Раз в квартал проверить восстановление**: залить свежий дамп в пустую БД и убедиться, что портал поднимается.

## 7. Обновление портала

```bash
cd /opt/pmo && git pull
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
```

## 8. Интеграции после запуска

- **Bitrix24 (входящий вебхук)**: в Bitrix указать адрес `https://pm.example.com/webhooks/bitrix24`
  и тот же токен, что в `BITRIX24_INBOUND_TOKEN`.
- **Почта**: заполнить `SMTP_*` (или через UI: Настройки → SMTP). Без неё письма
  копятся в OUTBOX и видны в `/admin/outbox`.
- **Помощник (MCP)**: адрес подключения — `https://pm.example.com/mcp`. Коннекторы claude.ai поля
  для токена не имеют и подключаются по OAuth: клиент регистрируется сам, портал показывает
  человеку страницу согласия, и токен появляется в его Профиле. Ручной токен там же остаётся —
  он нужен клиентам вроде Claude Desktop, где заголовок задают руками.

  Переменные `PORTAL_PUBLIC_URL` / `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS` уже заданы
  в `docker-compose.prod.yml` через `${DOMAIN}` — отдельно в `.env` их писать не нужно.
  `PORTAL_PUBLIC_URL` при этом критичен: из него строятся ВСЕ адреса, которые портал объявляет
  клиенту (издатель, точки OAuth, идентификатор ресурса). Разойдётся с реальным доменом —
  подключение перестанет собираться, а по симптомам это выглядит как «просто не работает».

  **Проверять обязательно СНАРУЖИ**, а не с сервера:

  ```bash
  curl -s -o /dev/null -w '%{http_code}
' -X POST https://pm.example.com/mcp     -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream'     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  ```

  Ожидаем `401` (нет токена) — значит, точка живёт и Caddy её проксирует. `404` означает,
  что запрос ушёл в SPA (нет блока `handle /mcp*` или контейнер Caddy не перезапущен),
  а `421` — что домена нет в `MCP_ALLOWED_HOSTS`.

  Вторая проверка — цепочка обнаружения OAuth. Она из трёх звеньев, и рвётся молча:

  ```bash
  curl -s https://pm.example.com/.well-known/oauth-protected-resource/mcp
  ```

  Должен прийти JSON с `"authorization_servers":["https://pm.example.com"]` — БЕЗ хвостового слэша
  (сравнение издателя побайтовое) и не HTML. HTML означает, что запрос ушёл в SPA: нет блока
  `handle /.well-known/oauth-*` в Caddyfile или контейнер не перезапущен.

## 9. Если что-то пошло не так

```bash
docker compose -f docker-compose.prod.yml logs -f pmo-backend   # почему не стартует
docker compose -f docker-compose.prod.yml logs caddy            # проблемы с сертификатом
curl -s localhost:8002/ready                                    # бэкенд видит базу?
```

**Правка `Caddyfile` требует ПЕРЕЗАПУСКА контейнера, а не только `caddy reload`.** Файл
подключён как bind-mount одиночного файла, поэтому любая правка, которая заменяет файл целиком
(`git checkout`, `mv`, редактор с атомарным сохранением), создаёт новый inode — а контейнер
остаётся привязан к старому и продолжает жить со старым конфигом. Коварство в том, что
`caddy validate` и `caddy reload` при этом отвечают «всё хорошо»: они читают файл ВНУТРИ
контейнера, то есть прежний. Правильно так:

```bash
docker restart pmo-caddy
docker exec pmo-caddy caddy adapt --config /etc/caddy/Caddyfile | grep -o '"host":[^]]*]'
```

Вторая команда печатает хосты, которые реально знает конфиг, — это и есть проверка, что правка
доехала. Проверять снаружи (`curl`) обязательно: конфиг может быть валидным и при этом не тем.

Откат к предыдущему состоянию данных:

```bash
docker compose -f docker-compose.prod.yml stop pmo-backend caddy
gunzip -c /opt/pmo/backups/pmo-<дата>.sql.gz | docker exec -i pmo-db psql -U pmo -d pmo
docker compose -f docker-compose.prod.yml start pmo-backend caddy
```
