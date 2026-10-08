# ELO5-PROJETO — Sistema de Segurança Patrimonial IoT (ESP32 + MQTT + Dashboard)

Plataforma de monitoramento patrimonial com **ESP32 sensorial** (PIR + ultrassônico HC-SR04 + LDR),
**broker MQTT**, **API Node.js + SQLite** e **dashboard web em tempo real** com telemetria,
comandos com confirmação (ACK), auditoria e exportação de dados.

> **Status:** P0 (confiabilidade) ✅ · P1 (hardening + telemetria real) ✅ · P2 (TLS + rotação + retenção/export) ✅ —
> todos testados em bancada. Cutover TLS do broker próprio em andamento.

---

## 1. Visão geral

```
┌─────────────┐   elo5/armazem-b/...    ┌──────────────┐   HTTP (x-bridge-key)   ┌────────────┐   fetch   ┌───────────┐
│  ESP32      │ ──────────────────────▶ │ mqtt-bridge  │ ─────────────────────▶ │ server.js  │ ◀──────── │ index.html│
│ sketch.ino  │ ◀────────────────────── │  .js          │ ◀───────────────────── │ + elo5.db  │ ────────▶ │ dashboard │
└─────────────┘   .../cmd (QoS 0 + ACK) └──────────────┘   fila pending_commands └────────────┘   JSON    └───────────┘
      │                                        │                        ▲
      │ sensores a cada 2 s                    │ .../alarm → logs       │ staleness → OFFLINE
      ▼                                        ▼                        ▼ (> STALE_AFTER_MS sem toque)
   OLED local                            alarme patrimonial        SQLite (zero deps externas)
```

**Fluxo de um comando (ex.: Armar):** dashboard `POST /api/devices/:id/command` → fila
`pending_commands` → bridge publica em `elo5/armazem-b/cmd` (a cada 2 s, com retry) →
ESP executa, publica `.../state` ou `.../log` → bridge/API marcam `acked_at` →
dashboard mostra **Enviando → Confirmado** (ou **Falhou** após `BRIDGE_MAX_RETRIES`).

---

## 2. ⚠️ Regra de pareamento (leia antes de mexer)

Este repositório contém **dois pares dashboard ↔ firmware que NÃO são intercambiáveis**.
Misturar pares faz os botões parecerem "mortos" (comando publica onde nenhum ESP escuta).

| Par | Dashboard | Firmware | Prefixo MQTT | Transporte |
|-----|-----------|----------|--------------|------------|
| **Elo5 (este projeto)** | `elo5/index.html` | `elo5/sketch.ino` | `elo5/armazem-b` | API + `mqtt-bridge.js` (fila com ACK) |
| Referência | `projeto-final-test3/index.html` | `projeto-final-test3/sketch.ino` | `seguranca/patrimonio/meu-esp32` | Browser direto via WSS (sem fila) |

> Ao mexer em botões, tópicos ou firmware, confirme primeiro **qual par** está em uso e
> mantenha prefixo + sketch + dashboard consistentes.

---

## 3. Estrutura

```
ELO5-PROJETO/
├── README.md                    ← este arquivo
└── elo5/                        ← par Elo5 (foco do projeto)
    ├── index.html               ← dashboard (gráficos, comandos, auditoria, rotação, export)
    ├── server.js                ← API + SQLite (zero deps; só `mqtt` p/ a bridge)
    ├── mqtt-bridge.js           ← ponte HiveMQ/Mosquitto → API (ingest + entrega de comandos)
    ├── sketch.ino               ← firmware ESP32 do nó "Armazém B"
    ├── diagram.toml             ← circuito de referência Wokwi (espelha o pinout real)
    ├── package.json             ← deps (`mqtt`), engines Node >= 22.5
    ├── elo5.db                  ← SQLite (criado no 1º run; NÃO commitar)
    └── mosquitto/
        ├── mosquitto.conf       ← broker próprio (1883 localhost + 8883 TLS)
        └── acl.conf             ← ACL por usuário (menor privilégio)
```

---

## 4. Hardware (nó "Armazém B")

| Componente | Pino ESP32 | Observação |
|------------|-----------|------------|
| PIR (presença) | GPIO 16 | edge-trigger (borda subida); confirmação 2 s no LDR |
| HC-SR04 TRIG / ECHO | GPIO 5 / 18 | média de 5 amostras; `999` = sem eco (filtrado do gráfico) |
| LDR (divisor 10 k) | GPIO 34 (ADC) | calibração 50 amostras + histerese + confirmação 2 s |
| Botão arma/desarma | GPIO 4 (`INPUT_PULLUP` → GND) | borda física, funciona sem MQTT |
| LED status | GPIO 2 (+ 220 Ω) | — |
| Buzzer 1 / 2 (sirene LEDC) | GPIO 19 / 23 | flag `g_sirenActive` lida por task separada |
| OLED SSD1306 (I2C, 0x3C) | SDA 21 / SCL 22 | estado + distância + LDR locais |
| FreeRTOS | 5 tasks | `eventQueue` (16 slots) + `txQueue` + `statusMutex` + NVS |

O arquivo `elo5/diagram.toml` reproduz esse circuito no Wokwi (rede `Wokwi-GUEST`,
broker `broker.hivemq.com:1883`, tópicos `elo5/armazem-b/...`).

---

## 5. Firmware (`elo5/sketch.ino`)

- **P0 — sem flood, sem comando perdido:** PIR/LDR enfileiram só na borda quieto→ativo
  (`edge-trigger`) e `drainEventQueue()` esvazia a fila nas transições de estado; comandos
  `test`/`recalibrate` dão ACK **só** via eventos `.../log` (`test`, `recalibrating`/`recalibrated`),
  nunca via `.../state`.
- **Config sem editar o fonte:** tudo sobrescrevível via `secrets.h` (opcional, **não commitado**)
  ou flags `-D`. Padrões = comportamento P0 (HiveMQ público, anônimo):

| Define | Padrão | Via |
|--------|--------|-----|
| `WIFI_SSID` / `WIFI_PASSWORD` | `Wokwi-GUEST` / `""` | `-D` ou `secrets.h` |
| `MQTT_SERVER` / `MQTT_PORT` | `broker.hivemq.com` / `1883` | idem |
| `MQTT_USER` / `MQTT_PASSWORD` | `""` / `""` (anônimo) | idem (**senha nunca no repo**) |
| `TOPIC_BASE` | `elo5/armazem-b` | idem |
| `MQTT_TLS` / `MQTT_TLS_PORT` | `0` / `8883` | `-DMQTT_TLS=1` + `MQTT_CA_PEM` p/ TLS (BearSSL) |

Exemplo PlatformIO (TLS + broker próprio):

```ini
build_flags =
  -DWIFI_SSID='"MinhaRede"' -DWIFI_PASSWORD='"senha"'
  -DMQTT_SERVER='"192.168.1.10"' -DMQTT_TLS=1 -DMQTT_TLS_PORT=8883
  -DMQTT_USER='"elo5-esp"' -DMQTT_PASSWORD='"troque-isso"'
```

> Sem `MQTT_CA_PEM` o firmware usa `setInsecure()` — TLS sem validação (ok em lab,
> **não** em produção; em produção embuta o `ca.crt` via `secrets.h`).

---

## 6. Backend (`elo5/server.js` + `elo5/mqtt-bridge.js`)

**Requisitos:** Node.js ≥ 22.5 (usa `node:sqlite` embutido). Única dependência externa: `mqtt` (bridge).

```powershell
cd elo5
npm install          # instala `mqtt`
node server.js       # terminal 1 → http://localhost:3000
node mqtt-bridge.js  # terminal 2 → ponte MQTT
```

> Abra o dashboard por **http://localhost:3000**, nunca como `file://` (o `fetch()` não funciona em `file://`).

### 6.1 Variáveis de ambiente (`.env` suportado, **nunca commitado**)

| Var | Padrão | Efeito |
|-----|--------|--------|
| `PORT` | `3000` | porta da API |
| `OPERATOR_TOKEN` | `""` (vazio = **modo local aberto**, P0) | quando setado, rotas mutantes + `/api/audit`, `/api/telemetry/export`, `/api/mqtt-users` exigem `x-operator-token` ou `Authorization: Bearer` |
| `BRIDGE_KEY` | `elo5-local-bridge` | chave interna API ↔ bridge (`x-bridge-key`) |
| `STALE_AFTER_MS` | `90000` (mín. 15 s) | sem toque da bridge por esse tempo → status reportado **OFFLINE** (sobrevive a restart) |
| `RATE_LIMIT_MAX` | `120` | máx. de requisições mutantes por IP/min (in-memory) |
| `BRIDGE_MAX_RETRIES` / `BRIDGE_RETRY_MS` | `5` / `5000` | retry-until-ACK de comandos QoS 0 |
| `TELEMETRY_RETENTION_DAYS` | `30` (`0` = guarda tudo) | prune por idade a cada insert |
| `TELEMETRY_EXPORT_MAX` | `5000` (teto 20000) | cap de linhas do export |
| `API_BASE` / `MQTT_URL` / `MQTT_ROOT` (bridge) | `http://localhost:3000` / `mqtt://broker.hivemq.com:1883` / `elo5` | HiveMQ público por padrão |
| `MQTT_USERNAME` / `MQTT_PASSWORD` / `MQTT_CA_FILE` (bridge) | `""` (anônimo) | auth + CA para broker próprio/TLS |

### 6.2 Tópicos MQTT (`TOPIC_ROOT/elo5` + nó `armazem-b`)

| Tópico | Direção | Payload | Efeito |
|--------|---------|---------|--------|
| `elo5/armazem-b/cmd` | bridge → ESP | `{"action":"arm\|disarm\|reset_alarm\|test\|recalibrate"}` | enfileirado, retry até ACK |
| `elo5/armazem-b/state` | ESP → bridge | `{"armed":bool,"alarm":bool}` | atualiza estado + ACK por estado |
| `elo5/armazem-b/alarm` | ESP → bridge | `{"type":"pir\|proximity\|ldr","value":n}` | gera `logs` (`origin='esp32'`) |
| `elo5/armazem-b/log` | ESP → bridge | `{"event":"..."}` | ACK preciso (`test`, `armed`, `disarmed`, …) |
| `elo5/armazem-b/sensors` | ESP → bridge | `{"pir":bool,"dist":cm,"ldr":0-4095,"ldr_anomaly":bool}` | `last_telemetry` + tabela `telemetry` |
| `elo5/armazem-b/status` | ESP → bridge (LWT, retained) | `online` / `offline` | ONLINE/OFFLINE + carimbo `mqtt_user` |

### 6.3 Endpoints principais

| Método + rota | Auth | Uso |
|---------------|------|-----|
| `GET /api/health` | — | `auth.operatorRequired`, `limits` (stale/retention/export), `mqtt` — sem vazar segredos |
| `GET /api/devices` | — | lista com OFFLINE por staleness aplicado |
| `GET /api/telemetry?device_id=&since=&limit=` | — | histórico real p/ os gráficos |
| `GET /api/telemetry/export?format=csv\|json&device_id=&since=&until=&limit=` | operador* | CSV (`attachment`) ou JSON `{retention_days,count,rows}` |
| `GET /api/audit?limit=` | operador* | quem armou/desarmou/rodou o quê |
| `GET /api/mqtt-users` | operador* | `id, local, mqtt_node, mqtt_user, last_seen` (sem senhas) |
| `PATCH /api/mqtt-users/:id` `{"mqtt_user":"elo5-esp"}` | operador* + rate limit | **só metadado** (validado, auditado `mqtt-rotation`) |
| `POST /api/devices/:id/command` `{"action":"arm"}` | operador* + rate limit | enfileira (idempotente: já-no-estado → ACK imediato) |
| `GET /api/commands/:id` | — | `pending` → `sending` → `acked` / `failed` (poll do dashboard) |
| `POST /api/logs` | bridge ou operador* | ingest manual/simulação |
| `PATCH /api/_bridge/devices/:id` · `GET /api/_bridge/commands` · `POST /api/_bridge/heartbeat` | `x-bridge-key` | canal interno da bridge |

\*operador = exigido **só** se `OPERATOR_TOKEN` estiver setado; vazio = modo local aberto (P0).

---

## 7. Dashboard (`elo5/index.html`)

- **Dois gráficos ao vivo** (mesma fonte `GET /api/telemetry`, refresh 10 s, nunca inventam dados):
  **Distância (cm)** — HC-SR04, filtro `< 900`; **Luminosidade (LDR)** — escala própria 0–4095.
  Cada sensor tem sua linha/escala — mexer no LDR move só o gráfico âmbar.
- **Botões CSV/JSON** — `exportTelemetry()` baixa `elo5-telemetry.csv/json` com o token do operador.
- **Comandos com confirmação** — Armar/Desarmar mostram *Enviando… → ✓ Confirmado / ✗ Sem resposta*.
- **Auditoria do Operador** — tabela `GET /api/audit` (poll 15 s + refresh manual; dica de token no 401).
- **Rotação visível** — linha `MQTT <user>` nos cards + botão `⟳ MQTT` (`PATCH /api/mqtt-users/:id`).
- **Token do operador** — campo no topo (salvo em `localStorage`), mostrado só se `health.auth.operatorRequired`.

---

## 8. Broker próprio + cutover TLS (Mosquitto)

`elo5/mosquitto/mosquitto.conf` (1883 localhost + **8883 TLS** com CA própria) e
`elo5/mosquitto/acl.conf` (ESP só publica sensores e assina o próprio `cmd`; bridge lê `elo5/#` e escreve `elo5/+/cmd`).

```powershell
# 1) certs (uma vez)
cd elo5/mosquitto
openssl req -new -x509 -days 365 -nodes -out ca.crt -keyout ca.key -subj "/CN=Elo5-CA"
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=IP-DO-BROKER"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# 2) usuários (senhas nunca commitadas)
mosquitto_passwd -c passwd elo5-esp
mosquitto_passwd passwd elo5-bridge

# 3) subir (listener 8883 já ativo no conf)
mosquitto -c mosquitto/mosquitto.conf

# 4) bridge no TLS
$env:MQTT_URL="mqtts://IP-DO-BROKER:8883"; $env:MQTT_USERNAME="elo5-bridge"
$env:MQTT_PASSWORD="..."; $env:MQTT_CA_FILE="mosquitto/ca.crt"; node mqtt-bridge.js

# 5) ESP: rebuild com -DMQTT_TLS=1 -DMQTT_TLS_PORT=8883 -DMQTT_SERVER='"IP-DO-BROKER"'
#    + MQTT_USER/MQTT_PASSWORD e MQTT_CA_PEM via secrets.h
```

**Validar:** bridge loga `conectado ao broker mqtts://…` → ESP publica `online` → card volta a
ONLINE → Armar/Desarmar confirma (ACK igual, só o transporte mudou).

> **Nunca commitar:** `secrets.h`, `mosquitto/passwd`, `*.crt`, `*.key`, `*.csr`, `.env`, `elo5.db`.
> Ver `.gitignore`.

---

## 9. Diagnóstico rápido

| Sintoma | Onde olhar | Causa provável |
|---------|-----------|----------------|
| Botão não reage | Serial `[MQTT] RX` → bridge `estado Armazém B` → badge | par errado (seção 2) ou QoS 0 perdido (P0 faz retry sozinho) |
| `Enviando…` para sempre | `GET /api/commands/:id` (`attempts`) | ESP offline / tópico `cmd` errado / `test` sem evento `.../log` |
| Gráfico parado | `GET /api/telemetry` | sem `.../sensors` há > 10 s (bridge/API fora?) |
| ONLINE preso | `last_seen` vs `STALE_AFTER_MS` | bridge sem tocar o device (LWT não chegou) |
| LDR mexeu o gráfico de distância | CSV export (`dist_cm` vs `ldr`) | dois sensores no mesmo pacote 2 s + mão afetou o ultrassom — hoje há um gráfico por sensor |
| TLS não conecta | `rc=` no Serial / log bridge | CN ≠ IP do broker, CA errada, senha/`mqtt_user` divergente |

---

## 10. Histórico (por que está assim)

- **P0 — comandos confiáveis:** fila `pending_commands(attempts,last_try_at,acked_at)` + ACK por
  `.../state` e por evento `.../log` + retry da bridge + `drainEventQueue()` e edge-trigger no firmware.
- **P1 — hardening + telemetria real:** `OPERATOR_TOKEN`, rate limit, security headers,
  OFFLINE por staleness, gráfico real via `GET /api/telemetry`, auth no firmware/bridge, `mosquitto/` + ACL.
- **P2 — TLS + rotação + retenção:** BearSSL no ESP, coluna `devices.mqtt_user` + `PATCH /api/mqtt-users/:id`
  (metadado auditado), prune `TELEMETRY_RETENTION_DAYS` + export CSV/JSON, gráfico LDR dedicado,
  auditoria e rotação no painel.

---

*Documentação gerada a partir do código em `elo5/` (P0–P2 testados em bancada, 2026-10-08).*
