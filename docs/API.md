# HTTP API

Локальный base URL: `http://127.0.0.1:8000`. Полная интерактивная схема FastAPI доступна на `/docs`; readiness endpoint — `GET /health`.

## Построение плана

`POST /api/optimize` принимает объект с `requests`, `teams`, `solver` (`baseline` или `cpp`) и необязательным `solver_config`. Обычно UI отправляет загруженный dataset без преобразования бизнес-семантики.

Основные входные поля заявки: `id`, `lat`, `lon`, `work_type`, `window_start`, `window_end`, `required_skills`, `required_equipment`, `required_transport`, `service_duration`, `release_time`, `section_id` (legacy: `region_id`) и `district`. Поля бригады включают `id`, стартовую/текущую позицию, `shift_start`, `shift_end`, skills, equipment, transport, `available`, `available_from`, `section_id` и `district`.

`section_id` задаёт hard boundary, район не ограничивает назначение. Пустой участок совпадает только с пустым. API принимает `service_duration` ради совместимости, но сервер нормализует его по справочнику: CONNECTION 70, EMERGENCY 80, ADD_ON 20, REPAIR 30 минут; время в пути рассчитывается отдельно.

Пример минимальной формы запроса (значения времени передаются в формате, допускаемом текущей OpenAPI-схемой):

```json
{
  "solver": "cpp",
  "requests": [],
  "teams": [],
  "solver_config": {
    "seed": 42,
    "time_limit_ms": 3000
  }
}
```

Ответ содержит `plan_id`, routes/stops, unassigned requests, metrics, `verified`, solver config/version и routing source. Принимать результат как допустимый можно только если `verified=true`.

## Объяснение

`GET /api/plans/{plan_id}/requests/{request_id}/explanation` возвращает фактическое назначение, расписание, проверенные ограничения и причины отклонения альтернатив. Причины строятся из доступных данных constraint engine, а не генерируются LLM.

## События и перепланирование

Поддерживаемые типы для `POST /api/plans/{plan_id}/events`:

- `STATUS_CHANGED`: `event_time`, `request_id`, `status` (`NEW`, `ASSIGNED`, `ON_THE_WAY`, `IN_PROGRESS`, `COMPLETED` или `CANCELLED`). Только `COMPLETED`, `IN_PROGRESS` и `ON_THE_WAY` являются фиксированными при replan.
- `NEW_EMERGENCY`: `event_time` и объект `request`. Backend нормализует тип/приоритет/длительность, назначает `release_time=event_time`; раньше события обслуживание начать нельзя.
- `TEAM_UNAVAILABLE`: `event_time`, `team_id`, необязательная `reason`.

Каждый event сохраняется. `POST /api/plans/{plan_id}/replan` принимает `event_id` и `current_time`, применяет историю событий и создаёт отдельный child plan. Parent не перезаписывается. `COMPLETED`, `IN_PROGRESS` и `ON_THE_WAY` сохраняют назначение/положение в порядке fixed work; CANCELLED исключается; будущая незафиксированная работа оптимизируется повторно. Недоступная бригада не получает новые назначения.

Важно: плановые времена не являются фактом выполнения. Если диспетчер не отправил `COMPLETED`, ранее запланированная заявка остаётся в исходном статусе и может стать неназначаемой при перепланировании на более позднее время. Перед аварийным replanning нужно внести реальные статусы завершённых и выполняемых работ. `IN_PROGRESS` не прерывается ради аварии.

Успешный replan возвращает child plan, метрики до/после, изменения и статус независимой проверки.

## Сохранённые планы и ошибки

- `GET /api/plans/{plan_id}` — загрузить сохранённый план; сохранённый флаг `verified` дополнительно перепроверяется при restore.
- `GET /api/plans/{plan_id}/diff` — diff дочернего плана.

Ошибки: валидация входа — HTTP 422; отсутствующий plan/request/team/event — 404; replan без события — 400; решение, отклонённое verifier, — 503. Ошибка одного запроса не должна завершать backend.
