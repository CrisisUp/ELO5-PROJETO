# ELO5-PROJETO — Segurança Patrimonial IoT (ESP32 + MQTT + Dashboard)

Monitoramento patrimonial com **ESP32 sensorial** (PIR + HC-SR04 + LDR), **MQTT**,
**API Node.js + SQLite** e **dashboard em tempo real** — comandos com confirmação,
telemetria, auditoria e exportação.

> ✅ P0 (confiabilidade) · P1 (hardening + telemetria) · P2 (TLS + rotação + export) — testados em bancada.

```
ESP32 ──elo5/armazem-b/..──▶ mqtt-bridge.js ──HTTP──▶ server.js + SQLite ──fetch──▶ dashboard
  ◀────── .../cmd (fila + ACK) ──────◀────────────────── pending_commands ──◀──── comandos
```

## Comece em 5 minutos

```powershell
cd elo5
npm install
node server.js        # terminal 1 → http://localhost:3000
node mqtt-bridge.js   # terminal 2 → ponte MQTT
```

Abra **http://localhost:3000** (nunca `file://`). Sem `OPERATOR_TOKEN`, a API roda em
**modo local aberto** — ideal para bancada.

## O que o sistema faz

- **Gráficos ao vivo** — distância (HC-SR04) e luminosidade (LDR), um por sensor, via `GET /api/telemetry`
- **Comandos com confirmação** — Armar/Desarmar mostram *Enviando → Confirmado/Falhou* (retry-until-ACK)
- **Auditoria** — quem armou/desarmou/rodou o quê, quando
- **Export CSV/JSON** — telemetria com retenção configurável
- **Rotação MQTT visível** — troca de usuário com auditoria (senha troca-se no broker + ESP)
- **TLS end-to-end** — ESP (BearSSL) ↔ Mosquitto 8883 ↔ bridge

## Estrutura

```
elo5/
├── index.html          dashboard (gráficos, comandos, auditoria, rotação, export)
├── server.js           API + SQLite (zero deps; só `mqtt` p/ a bridge)
├── mqtt-bridge.js      ponte MQTT → API (ingest + entrega de comandos)
├── sketch.ino          firmware ESP32 "Armazém B"
├── diagram.toml        circuito Wokwi de referência
└── mosquitto/          broker próprio (conf + ACL)
```

## ⚠️ Uma regra antes de mexer

Há **dois pares dashboard ↔ firmware não intercambiáveis**. Misturar faz botão parecer "morto".

| Par | Dashboard | Firmware | Prefixo MQTT |
|-----|-----------|----------|--------------|
| **Elo5** | `elo5/index.html` | `elo5/sketch.ino` | `elo5/armazem-b` |
| Referência | `projeto-final-test3/index.html` | `projeto-final-test3/sketch.ino` | `seguranca/patrimonio/meu-esp32` |

## Guias

| Guia | Para quem |
|------|-----------|
| [docs/instalacao.md](docs/instalacao.md) | subir API + bridge + ESP do zero |
| [docs/dashboard.md](docs/dashboard.md) | usar o painel (gráficos, comandos, auditoria, export) |
| [docs/api.md](docs/api.md) | referência de endpoints + envs |
| [docs/mqtt.md](docs/mqtt.md) | tópicos, payloads e fluxo ACK |
| [docs/hardware.md](docs/hardware.md) | pinout, sensores e firmware |
| [docs/tls.md](docs/tls.md) | broker próprio + cutover TLS |
| [docs/diagnostico.md](docs/diagnostico.md) | sintoma → onde olhar → causa |
| [docs/historico.md](docs/historico.md) | por que está assim (P0 → P1 → P2) |

## Segurança

**Nunca commitar:** `secrets.h`, `mosquitto/passwd`, `*.crt`, `*.key`, `.env`, `elo5.db`.
Senhas de WiFi/MQTT vivem em `secrets.h` ou flags `-D` — nunca no repo.
