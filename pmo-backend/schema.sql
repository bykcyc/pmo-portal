-- PMO backend v2 — схема PostgreSQL (замена OpenProject как хранилища).
-- Применяется идемпотентно при старте приложения (db.apply_schema).
--
-- ПРАВИЛА ТИПОВ (обусловлены требованием побайтной совместимости /api/*):
--  * json, НЕ jsonb — для всех «сквозных» документов, которые отдаются фронту как есть.
--    jsonb пересортировывает ключи объектов и схлопывает дубликаты → тела ответов
--    коллекций (/team, /meetings, /budget-items, _version_log…) перестали бы совпадать.
--  * created_at/updated_at — TEXT в формате OpenProject ('2026-07-09T13:00:44.029Z'),
--    а не timestamptz: python isoformat() дал бы '+00:00' и микросекунды.
--  * id — INTEGER; сериализацию в строку по-прежнему делают мапперы (str(...)).

BEGIN;

-- ── последовательности ────────────────────────────────────────────────────────
-- Задачи и риски были work packages в ОДНОМ id-пространстве OpenProject: общий
-- wp_id_seq. Иначе новая задача и новый риск получили бы одинаковый id, а
-- activities/attachments ссылаются на wp_id без FK → неоднозначность.
CREATE SEQUENCE IF NOT EXISTS project_id_seq;
CREATE SEQUENCE IF NOT EXISTS wp_id_seq;
CREATE SEQUENCE IF NOT EXISTS journal_id_seq;
CREATE SEQUENCE IF NOT EXISTS attachment_id_seq;

-- ── проекты ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY DEFAULT nextval('project_id_seq'),
    name       TEXT    NOT NULL,
    identifier TEXT    NOT NULL,           -- фолбэк для code в to_project(); NULL уронил бы /projects
    meta       JSON    NOT NULL,           -- весь паспорт-JSON минус _task_extra/_risk_extra/_deps/_baselines
    version    INTEGER NOT NULL DEFAULT 0, -- оптимистичная блокировка (замена lockVersion)
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);

-- Зонтик → подпроект. Настоящая колонка, а не ключ в meta: по ней идёт RBAC-предфильтр в SQL,
-- а meta — байтовый контракт с капом 60 КиБ. Уровень ровно один (подпроект не может быть
-- зонтиком) — это стережёт db.set_project_parent в транзакции, а не CHECK: проверять надо
-- ДВЕ строки сразу. ON DELETE SET NULL: удалили зонтик — подпроекты стали самостоятельными.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects (parent_id) WHERE parent_id IS NOT NULL;

-- ── задачи (WP типов Task/Milestone/Summary task + влитый сайдкар _task_extra) ─
CREATE TABLE IF NOT EXISTS tasks (
    id               INTEGER PRIMARY KEY DEFAULT nextval('wp_id_seq'),
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title            TEXT    NOT NULL DEFAULT '',
    description      TEXT,
    task_type        TEXT    NOT NULL DEFAULT 'task'
                     CHECK (task_type IN ('phase','task','milestone')),
    status           TEXT    NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started','in_progress','completed','cancelled','on_hold')),
    planned_start    DATE,
    planned_end      DATE,
    progress         INTEGER,              -- у фаз OpenProject отдавал NULL; маппер делает `or 0`
    parent_id        INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    version          INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    -- бывший _task_extra
    priority         TEXT,                 -- NULL → маппер отдаёт 'medium'
    assignee_name    TEXT,                 -- денормализация: сервер заполняет из persons (см. resolve_person)
    assignee_email   TEXT,                 -- денормализация: то же
    assignee_person_id TEXT,               -- ← стабильная идентичность исполнителя (persons.id)
    bar_color        TEXT,
    bitrix24_task_id BIGINT,
    actual_start     TEXT,                 -- TEXT: контракт «что прислали, то и отдали»
    actual_end       TEXT,
    wbs_code         TEXT,
    sort_order       INTEGER,
    estimated_hours  DOUBLE PRECISION,     -- на выдаче int-if-integral (JS шлёт 40, не 40.0)
    actual_hours     DOUBLE PRECISION,
    -- Соисполнители: [{person_id, name, email}, …]. ОТВЕТСТВЕННЫЙ по-прежнему один
    -- (assignee_person_id) — «несколько исполнителей» означает, что не отвечает никто.
    -- JSON, как `risks.updates`: читается через ::text, пишется json.dumps.
    co_assignees     JSON
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS co_assignees JSON;
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id, id);
CREATE INDEX IF NOT EXISTS tasks_parent_idx  ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS tasks_bitrix_idx  ON tasks(bitrix24_task_id) WHERE bitrix24_task_id IS NOT NULL;
-- Догоняем уже существующие БД (прод): CREATE TABLE выше их не тронет.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_person_id TEXT;
CREATE INDEX IF NOT EXISTS tasks_assignee_person_idx
    ON tasks(assignee_person_id) WHERE assignee_person_id IS NOT NULL;

-- ── риски (WP типа Risk + влитый _risk_extra) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS risks (
    id               INTEGER PRIMARY KEY DEFAULT nextval('wp_id_seq'),
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title            TEXT    NOT NULL DEFAULT '',
    description      TEXT,
    version          INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    -- бывший _risk_extra
    code             TEXT,
    category         TEXT,
    probability      TEXT,                 -- NULL → маппер отдаёт 'medium'
    impact           TEXT,
    status           TEXT,                 -- NULL → маппер отдаёт 'open'
    owner            TEXT,
    mitigation_plan  TEXT,
    contingency_plan TEXT,
    related_task_id  TEXT,                 -- TEXT: фронт шлёт и ждёт строку
    updates          JSON NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS risks_project_idx ON risks(project_id, id);

-- ── зависимости задач (бывший _deps в мете) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS deps (
    id              TEXT PRIMARY KEY,      -- uuid4-строки, как в мете
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         INTEGER NOT NULL,      -- без FK: в мете встречаются осиротевшие записи,
    depends_on_id   INTEGER NOT NULL,      -- gantt-data отдаёт их как есть (байт-совместимость)
    dependency_type TEXT    NOT NULL DEFAULT 'finish_to_start',
    lag_days        INTEGER NOT NULL DEFAULT 0,
    seq             INTEGER NOT NULL       -- порядок в исходном массиве _deps
);
CREATE INDEX IF NOT EXISTS deps_project_idx ON deps(project_id, seq);
CREATE INDEX IF NOT EXISTS deps_task_idx    ON deps(task_id);
CREATE INDEX IF NOT EXISTS deps_dep_idx     ON deps(depends_on_id);

-- ── история и комментарии (journals OpenProject) ──────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
    id          INTEGER PRIMARY KEY DEFAULT nextval('journal_id_seq'),
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wp_id       INTEGER NOT NULL,          -- task ИЛИ risk (общее id-пространство)
    version     INTEGER NOT NULL,          -- пер-WP счётчик 1,2,3…
    user_title  TEXT,                      -- вербатим _links.user.title (в текущих данных NULL)
    author_name TEXT,                      -- распарсен из префикса '**Имя:** '; наружу НЕ идёт
    comment     TEXT,                      -- raw, ВКЛЮЧАЯ префикс '**Имя:** '
    details     JSON NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    UNIQUE (wp_id, version)
);
CREATE INDEX IF NOT EXISTS activities_wp_idx ON activities(wp_id, id);

-- ── вложения ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
    id           INTEGER PRIMARY KEY DEFAULT nextval('attachment_id_seq'),
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wp_id        INTEGER NOT NULL,
    file_name    TEXT    NOT NULL,
    content_type TEXT    NOT NULL DEFAULT '',
    file_size    BIGINT  NOT NULL,
    author_title TEXT,
    data         BYTEA   NOT NULL,         -- лимит 25 МБ проверяет код
    created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_wp_idx ON attachments(wp_id, id);

-- ── бывшие файловые сторы ─────────────────────────────────────────────────────
-- users.json: doc целиком (password_hash, роли, op_token…); seq хранит порядок файла,
-- т.к. GET /users отдаёт значения в порядке вставки.
CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    seq   INTEGER NOT NULL,
    doc   JSON    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_seq_idx ON users(seq);

CREATE TABLE IF NOT EXISTS persons (
    id  TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    doc JSON    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    id  INTEGER PRIMARY KEY CHECK (id = 1),
    doc JSON NOT NULL DEFAULT '{}'
);
INSERT INTO settings (id, doc) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS snapshots (        -- {date: {pid: metrics}}
    snap_date TEXT PRIMARY KEY,
    data      JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS baselines (        -- {pid: [снимок, …]}; bls[-1] = последний
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    doc        JSON    NOT NULL,
    PRIMARY KEY (project_id, seq)
);

-- Нормализованные модульные коллекции (_action_log/_meetings/_backlog/_notes),
-- раньше жившие JSON-ключами в projects.meta. Каждый элемент — verbatim json-doc,
-- порядок хранит seq. JSON (не JSONB) — порядок ключей часть golden-контракта.
CREATE TABLE IF NOT EXISTS project_docs (
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    coll       TEXT   NOT NULL,   -- имя коллекции: _action_log/_meetings/_backlog/_notes
    seq        INTEGER NOT NULL,
    doc        JSON   NOT NULL,
    PRIMARY KEY (project_id, coll, seq)
);
CREATE INDEX IF NOT EXISTS project_docs_pc ON project_docs (project_id, coll);

-- Отозванные (logout) токены: сигнатура → срок жизни. Переживает рестарт; _REVOKED
-- прогревается отсюда на старте. Никогда не сериализуется в /api — golden не затрагивает.
CREATE TABLE IF NOT EXISTS revoked_tokens (
    signature  TEXT PRIMARY KEY,
    expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_tokens_exp_idx ON revoked_tokens (expires_at);

-- Журнал синхронизации с Bitrix24. Форма записи продиктована фронтом (SyncLogEntry:
-- id/task_id/bitrix24_task_id/sync_action/status/error_message/synced_at) — он опрашивал
-- эту ручку каждые 30с и получал 404. Пишем на уровне ОПЕРАЦИИ (создали задачу, синк людей),
-- а не каждого HTTP-вызова: один синк людей — это несколько страниц user.search, они вымыли бы
-- окно «последние 50». БЕЗ внешнего ключа на tasks: запись про УДАЛЁННУЮ задачу — самая
-- ценная в журнале, каскад бы её стёр (тот же приём, что в deps.depends_on_id).
CREATE SEQUENCE IF NOT EXISTS bitrix_sync_log_id_seq;
CREATE TABLE IF NOT EXISTS bitrix_sync_log (
    id               BIGINT PRIMARY KEY DEFAULT nextval('bitrix_sync_log_id_seq'),
    task_id          BIGINT,          -- наша задача (может быть NULL: синк людей, тест связи)
    bitrix24_task_id BIGINT,
    sync_action      TEXT NOT NULL,   -- task.create | task.update | task.delete | people.sync | …
    status           TEXT NOT NULL,   -- ok | error
    error_message    TEXT,            -- уже без токена вебхука (см. main._bx_safe_error)
    synced_at        TEXT NOT NULL    -- TEXT в формате портала, как created_at везде
);
CREATE INDEX IF NOT EXISTS bitrix_sync_log_id_desc ON bitrix_sync_log (id DESC);

-- Последний код статуса, который, как мы знаем, стоит у задачи в Bitrix. Это ЗАЩИТА ОТ
-- ЭХО-ПЕТЛИ: наш push вызывает ONTASKUPDATE, и входящий вебхук обязан отличить собственное
-- эхо от правки живого человека. Колонка намеренно НЕ входит в _TASK_EXTRA_COLS —
-- значит наружу в /api не сериализуется и байт-контракт задач не двигает.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS bx_status TEXT;

-- «Сообщить о проблеме» (F6): баг-репорты от пользователей. Непроектная сущность (к проекту не
-- привязана) → отдельная таблица, а не project_docs. Скрин храним прямо в BYTEA-колонке (он один
-- и жёстко привязан к репорту — отдельная таблица вложений не нужна). Наружу id — строкой.
CREATE SEQUENCE IF NOT EXISTS problem_report_id_seq;
CREATE TABLE IF NOT EXISTS problem_reports (
    id              BIGINT PRIMARY KEY DEFAULT nextval('problem_report_id_seq'),
    reporter_email  TEXT NOT NULL,
    reporter_name   TEXT,
    description     TEXT NOT NULL,
    page_url        TEXT,
    user_agent      TEXT,
    screenshot      BYTEA,             -- PNG из html2canvas, опционален
    screenshot_type TEXT,
    screenshot_size BIGINT,
    created_at      TEXT NOT NULL      -- TEXT в формате портала, как created_at везде
);
CREATE INDEX IF NOT EXISTS problem_reports_id_desc ON problem_reports (id DESC);
-- Ответ автору. Поток «Сообщить о проблеме» был односторонним: человек писал и больше никогда
-- ничего не слышал — даже когда чинили в тот же день. Теперь у репорта есть состояние, и
-- колокольчик показывает автору, что его проблема решена (и чем именно).
ALTER TABLE problem_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE problem_reports ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE problem_reports ADD COLUMN IF NOT EXISTS resolved_at TEXT;
ALTER TABLE problem_reports ADD COLUMN IF NOT EXISTS resolved_by TEXT;
CREATE INDEX IF NOT EXISTS problem_reports_by_reporter
    ON problem_reports (reporter_email, id DESC);

-- Запрос доступа наблюдателем (F-D). Человек видит СВОИ элементы в чужом проекте («Мои задачи»
-- сканируют все проекты намеренно), но сам проект открыть не может — и просит доступ у его РП.
--
-- Отдельная таблица, а не project_docs: автор запроса — посторонний для проекта, а всё в
-- project_docs лежит за `rbac`, который его же и не пустит. Та же причина, что у problem_reports
-- и project_drafts, и решается так же.
--
-- Частичный уникальный индекс держит главный инвариант: ОДИН открытый запрос на пару
-- человек-проект. Без него повторный клик плодил бы дубликаты, и РП видел бы одно и то же
-- пять раз. Решённые записи остаются — по ним считается пауза после отказа.
CREATE SEQUENCE IF NOT EXISTS access_request_id_seq;
CREATE TABLE IF NOT EXISTS access_requests (
    id              BIGINT PRIMARY KEY DEFAULT nextval('access_request_id_seq'),
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requester_id    TEXT NOT NULL,     -- users.id того, кто просит
    requester_name  TEXT,              -- снимок имени: человек может уволиться, а запрос остаётся читаемым
    requester_email TEXT,
    note            TEXT,              -- «зачем» — необязательно, но с ним решать легче
    status          TEXT NOT NULL,     -- open | approved | rejected
    created_at      TEXT NOT NULL,
    decided_at      TEXT,
    decided_by      TEXT               -- имя решившего, для журнала и для показа просителю
);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_open
    ON access_requests (project_id, requester_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS access_requests_open ON access_requests (project_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS access_requests_by_requester ON access_requests (requester_id, project_id);

-- Токены для внешнего помощника (MCP). Личный токен пользователя, который он вставляет в свой
-- ChatGPT/Claude. Храним SHA-256 от значения, а не значение: bcrypt здесь не нужен (токен —
-- 32 случайных байта, перебирать нечего), а на каждом запросе он стоил бы задержки.
-- ВАЖНО: эти токены принимаются ТОЛЬКО на MCP-точке. Обычный /api их не знает — поэтому ими
-- нельзя ни сменить пароль, ни снять 2FA, ни попасть в админку.
CREATE SEQUENCE IF NOT EXISTS api_token_id_seq;
CREATE TABLE IF NOT EXISTS api_tokens (
    id           BIGINT PRIMARY KEY DEFAULT nextval('api_token_id_seq'),
    user_email   TEXT NOT NULL,     -- владелец; права берутся из его учётной записи на каждом запросе
    name         TEXT NOT NULL,     -- человеческое имя: «ChatGPT на ноутбуке»
    token_hash   TEXT NOT NULL,     -- SHA-256 hex от значения токена
    token_hint   TEXT NOT NULL,     -- первые символы, чтобы узнать токен в списке
    scopes       TEXT NOT NULL,     -- 'read' | 'read+draft'
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,     -- 90 дней от выпуска
    last_used_at TEXT,              -- когда токеном пользовались в последний раз (видно аномалию)
    revoked_at   TEXT
);
-- Токен, выпущенный через OAuth, принадлежит конкретному клиенту (claude.ai и т.п.).
-- Без этой связи точка отзыва RFC 7009 не смогла бы убедиться, что клиент гасит СВОЙ токен,
-- и отзыв молча не срабатывал бы. У токена, выписанного руками в Профиле, поле пустое.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS oauth_client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash ON api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens (user_email);

-- Журнал обращений помощника. ОТДЕЛЬНАЯ таблица, а не журнал действий проекта: у того кап
-- 50 записей, и поток запросов от агента вытеснил бы историю проекта за сутки.
CREATE SEQUENCE IF NOT EXISTS mcp_access_id_seq;
CREATE TABLE IF NOT EXISTS mcp_access_log (
    id         BIGINT PRIMARY KEY DEFAULT nextval('mcp_access_id_seq'),
    at         TEXT NOT NULL,
    user_email TEXT NOT NULL,
    token_id   BIGINT,             -- какой именно токен (значение НЕ пишем никогда)
    tool       TEXT NOT NULL,      -- имя инструмента
    project_id INTEGER,            -- если обращение к конкретному проекту
    ok         BOOLEAN NOT NULL,
    detail     TEXT                -- краткая причина отказа или размер выдачи
);
CREATE INDEX IF NOT EXISTS mcp_access_log_id_desc ON mcp_access_log (id DESC);

-- Черновики от помощника. Отдельная таблица, а не поле проекта: черновик существует и для
-- проекта, которого ещё нет (project_id NULL), у него своя судьба и свой автор. Класть это
-- в projects.meta значило бы мешать сущности с разным жизненным циклом и трогать байт-контракт.
CREATE SEQUENCE IF NOT EXISTS project_draft_id_seq;
CREATE TABLE IF NOT EXISTS project_drafts (
    id          BIGINT PRIMARY KEY DEFAULT nextval('project_draft_id_seq'),
    project_id  INTEGER,            -- NULL = черновик НОВОГО проекта
    author      TEXT NOT NULL,      -- email того, чьим токеном пришёл помощник
    source      TEXT NOT NULL,      -- «расшифровка планёрки 14 августа»
    title       TEXT NOT NULL,      -- заголовок для списка
    items       JSON NOT NULL,      -- состав: [{id, section, op, selected, data, target_id, note}]
    status      TEXT NOT NULL,      -- open | accepted | rejected
    created_at  TEXT NOT NULL,
    decided_at  TEXT,
    decided_by  TEXT,
    result      JSON                -- что реально применилось при приёме
);
CREATE INDEX IF NOT EXISTS project_drafts_id_desc ON project_drafts (id DESC);
CREATE INDEX IF NOT EXISTS project_drafts_project ON project_drafts (project_id);

-- ── OAuth для подключения помощника ───────────────────────────────────────────────────────
-- Клиенты вроде claude.ai не умеют вставлять готовый токен: они регистрируются сами (RFC 7591)
-- и ведут человека на страницу согласия. Поэтому портал выступает и сервером авторизации.
-- Итогом флоу становится обычная строка в api_tokens — хранилище и отзыв у токенов ОДНИ,
-- иначе «Отозвать» в Профиле убивал бы не всё.
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id      TEXT PRIMARY KEY,   -- выдаёт SDK при регистрации
    client_secret  TEXT,               -- NULL у публичных клиентов (PKCE вместо секрета)
    client_name    TEXT NOT NULL DEFAULT '',
    info           JSON NOT NULL,      -- вся карточка клиента целиком, как её сохранил SDK
    created_at     TEXT NOT NULL,
    last_used_at   TEXT
);

-- Запрос на доступ, ждущий человека. Живёт минуты: между нажатием «Add» в клиенте и нажатием
-- «Разрешить» в портале. Сам по себе доступа не даёт — это только «что именно спрашивают».
CREATE TABLE IF NOT EXISTS oauth_requests (
    id             TEXT PRIMARY KEY,   -- случайный идентификатор, он же в адресе страницы согласия
    client_id      TEXT NOT NULL,
    redirect_uri   TEXT NOT NULL,      -- уже проверен SDK на точное совпадение с зарегистрированным
    redirect_explicit BOOLEAN NOT NULL DEFAULT TRUE,
    code_challenge TEXT NOT NULL,      -- PKCE S256
    scopes         TEXT NOT NULL,      -- через пробел
    state          TEXT,
    resource       TEXT,               -- RFC 8707: для какого ресурса просят токен
    created_at     TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    decided_at     TEXT,               -- заполняется при «Разрешить»/«Отклонить» — второй раз не сработает
    decided_by     TEXT
);
CREATE INDEX IF NOT EXISTS oauth_requests_expires ON oauth_requests (expires_at);

-- Одноразовый код авторизации. Храним ХЕШ: утёкшая копия базы не даёт обменять код на токен.
CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash      TEXT PRIMARY KEY,
    client_id      TEXT NOT NULL,
    user_email     TEXT NOT NULL,
    redirect_uri   TEXT NOT NULL,
    redirect_explicit BOOLEAN NOT NULL DEFAULT TRUE,
    code_challenge TEXT NOT NULL,
    scopes         TEXT NOT NULL,
    resource       TEXT,
    expires_at     TEXT NOT NULL,
    used_at        TEXT                -- повторный обмен обязан провалиться
);
CREATE INDEX IF NOT EXISTS oauth_codes_expires ON oauth_codes (expires_at);

-- Обновление доступа помощника (refresh). Отдельная таблица и отдельный префикс значения:
-- положить refresh в api_tokens «чтобы отзыв был один» нельзя — он немедленно стал бы рабочим
-- bearer-токеном на /mcp. Хранится только хеш, как у кодов авторизации.
-- chain_id связывает всю цепочку ротаций: отзыв гасит её целиком, включая выданные доступы.
-- chain_expires_at — АБСОЛЮТНЫЙ потолок: он не двигается при ротации, поэтому одно согласие
-- человека не превращается в вечный доступ.
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token_hash       TEXT PRIMARY KEY,
    chain_id         TEXT NOT NULL,
    client_id        TEXT NOT NULL,
    user_email       TEXT NOT NULL,
    scopes           TEXT NOT NULL,
    access_token_id  BIGINT,
    resource         TEXT,
    created_at       TEXT NOT NULL,
    chain_expires_at TEXT NOT NULL,
    expires_at       TEXT NOT NULL,
    used_at          TEXT,               -- одноразовость: повтор = кража либо гонка
    revoked_at       TEXT
);
CREATE INDEX IF NOT EXISTS oauth_refresh_chain ON oauth_refresh_tokens (chain_id);
CREATE INDEX IF NOT EXISTS oauth_refresh_expires ON oauth_refresh_tokens (chain_expires_at);

-- Реестр проектов переходного периода: список того, что ДОЛЖНО вестись в портале, пока РП
-- переносят свои проекты из Excel. Ведёт его руководитель портфеля и только он. Строка живёт
-- сама по себе («болванка»), пока к ней не привязан настоящий проект; после привязки портал
-- показывает живые данные этого проекта, а строка остаётся якорем перехода. Когда всё
-- перенесено, таблица пустеет — и пункт меню исчезает сам, отдельного выключателя не нужно.
CREATE SEQUENCE IF NOT EXISTS portfolio_registry_id_seq;
CREATE TABLE IF NOT EXISTS portfolio_registry (
    id          BIGINT PRIMARY KEY DEFAULT nextval('portfolio_registry_id_seq'),
    pm_name     TEXT,              -- кто должен вести (свободный текст: учётки может ещё не быть)
    name        TEXT NOT NULL,
    kind        TEXT,              -- стратегический / операционный / пилотный
    rag         TEXT,              -- red|yellow|green, пока проекта нет — оценка владельца
    customer    TEXT,
    phase       TEXT,              -- инициализация / реализация / внедрение …
    note        TEXT,
    project_id  BIGINT REFERENCES projects(id) ON DELETE SET NULL,  -- ссылка на заведённый проект
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS portfolio_registry_order ON portfolio_registry (sort_order, id);

-- Связка Fireflies → протокол в совещание PMO + комментарий к событию Битрикса. Одна строка на
-- встречу Fireflies: она же очередь воркера, журнал шагов и ключ идемпотентности (вебхук
-- Fireflies повторяется до 5 раз и шлёт resend при правке заметок). ТЕКСТОВ ПРОТОКОЛОВ ЗДЕСЬ
-- НЕТ — только id, статусы и кандидаты сопоставления. Порядок записи: намерение (статус шага
-- + целевой id) → внешний вызов → id результата; повтор делает только недоделанный шаг.
CREATE TABLE IF NOT EXISTS fireflies_sync (
    meeting_id        TEXT PRIMARY KEY,   -- id транскрипта Fireflies
    event             TEXT NOT NULL,      -- meeting.summarized
    reprocessed_at    TEXT,               -- дедуп resend: принимаем только строго новее
    status            TEXT NOT NULL,      -- received|processing|done|unmatched|conflict|failed|skipped
    pmo_status        TEXT,               -- pending|writing|done|none|unmatched|conflict
    bitrix_status     TEXT,               -- waiting_method|posting|done|unmatched|skipped
    decision          TEXT,               -- publish|queue|none (fireflies_match.decide)
    basis             TEXT,               -- link|strong — на чём основано publish
    reason            TEXT,               -- человеческое объяснение решения (без текстов встречи)
    pmo_project_id    TEXT,
    pmo_meeting_id    TEXT,
    bitrix_event_id   TEXT,
    bitrix_comment_id TEXT,
    candidates        JSON,               -- {"bitrix": [топ-3], "pmo": [...]} для очереди «не сопоставлено»
    attempts          INTEGER NOT NULL DEFAULT 0,
    next_attempt_at   TEXT,
    last_error        TEXT,               -- без секретов и без текстов протокола
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fireflies_sync_due ON fireflies_sync (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS fireflies_sync_updated ON fireflies_sync (updated_at DESC);

COMMIT;
