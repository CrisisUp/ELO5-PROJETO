# API — referência (`elo5/server.js`)

`node:http` + `node:sqlite`, **zero dependências externas**. `.env` suportado (não commitado).
Security headers em toda resposta JSON (`nosniff`, `DENY`, `no-referrer`); `no-cache` no shell.

## Auth

- `OPERATOR_TOKEN` vazio = **modo local aberto** (P0, bancada sem token)
- Setado = rotas mutantes + `/api/audit`, `/api/telemetry/export`, `/api/mqtt-users` exigem
  `x-operator-token: <token>` ou `Authorization: Bearer <token>` (401 senão)
- Canal interno da bridge: `x-bridge-key` (= `BRIDGE_KEY`, 403 senão); nunca expõe segredos
  (`/api/health` mostra só `auth.operatorRequired` + `limits`)

## Endpoints

| Método + rota | Auth | Uso |
|---------------|------|-----|
| `GET /api/health` | — | `ok, db, time, mqtt, auth, limits` (stale/retention/export) |
| `GET /api/devices` | — | lista com OFFLINE por staleness aplicado |
| `GET /api/logs?search=&location=&camera=&limit=` | — | página de logs (filtros server-side, máx. 200) |
| `GET /api/stats` | — | `totalHoje, capturasHoje, alertasHoje, devicesOnline, devicesTotal` |
| `GET /api/telemetry?device_id=&since=&limit=` | — | histórico p/ gráficos (mais novos por último, máx. 1000) |
| `GET /api/telemetry/export?format=csv\|json&device_id=&since=&until=&limit=` | operador | CSV (`attachment elo5-telemetry.csv`) ou JSON `{retention_days,count,rows}`; cap `TELEMETRY_EXPORT_MAX` |
| `GET /api/audit?limit=` | operador | trilha do operador (máx. 500) |
| `GET /api/mqtt-users` | operador | `id, local, mqtt_node, mqtt_user, last_seen` — **sem senhas** |
| `PATCH /api/mqtt-users/:id` `{"mqtt_user":"x"}` | operador + rate limit | **só metadado** (`/^[A-Za-z0-9._-]{1,64}$/`), auditado `mqtt-rotation` |
| `POST /api/devices/:id/command` `{"action":"arm\|disarm\|reset_alarm\|test\|recalibrate"}` | operador + rate limit | enfileira; idempotente (já-no-estado → ACK imediato); auditado |
| `GET /api/commands/:id` | — | `pending → sending → acked / failed` + `attempts/max_attempts` |
| `POST /api/logs` | bridge ou operador | ingest manual/simulação (valida `location`, `employeeId`, `confianca`) |
| `PATCH /api/_bridge/devices/:id` · `GET /api/_bridge/commands` · `POST /api/_bridge/heartbeat` · `GET /api/mqtt-status` | `x-bridge-key` | canal interno (estado vivo, fila de comandos, heartbeat) |

## Variáveis de ambiente

| Var | Padrão | Efeito |
|-----|--------|--------|
| `PORT` | `3000` | porta |
| `OPERATOR_TOKEN` | `""` | fecha rotas mutantes/auditoria/export/mqtt-users |
| `BRIDGE_KEY` | `elo5-local-bridge` | chave interna API ↔ bridge |
| `STALE_AFTER_MS` | `90000` (mín. 15000) | sem toque → OFFLINE |
| `RATE_LIMIT_MAX` | `120` (mín. 10) | mutantes por IP/min (in-memory) |
| `BRIDGE_MAX_RETRIES` / `BRIDGE_RETRY_MS` | `5` / `5000` | retry-until-ACK |
| `TELEMETRY_RETENTION_DAYS` | `30` (`0` = tudo) | prune por idade no insert (+ cap 5000/dispositivo) |
| `TELEMETRY_EXPORT_MAX` | `5000` (100–20000) | cap do export |

## Tabelas SQLite (`elo5.db`)

`employees` · `devices (+mqtt_node, armed, alarming, last_telemetry, mqtt_user)` ·
`logs (+origin, event)` · `pending_commands (+attempts, last_try_at, sent_at, acked_at)` ·
`telemetry (device_id, timestamp, dist, pir, ldr, ldr_anomaly)` · `audit_log (timestamp, actor, action, device_id, detail)`
