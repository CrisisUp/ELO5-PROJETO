# MQTT — tópicos, payloads e fluxo ACK

Prefixo: `elo5/<nó>/…` · nó do projeto: **`armazem-b`** (bridge assina `elo5/#`).

## Tópicos

| Tópico | Direção | Payload | Efeito na API |
|--------|---------|---------|---------------|
| `elo5/armazem-b/cmd` | bridge → ESP | `{"action":"arm\|disarm\|reset_alarm\|test\|recalibrate"}` | lido pelo ESP; bridge republica a cada 2 s até ACK |
| `elo5/armazem-b/state` | ESP → bridge | `{"armed":bool,"alarm":bool}` | atualiza estado + **ACK por estado** (`arm/disarm/reset_alarm`) |
| `elo5/armazem-b/alarm` | ESP → bridge | `{"type":"pir\|proximity\|ldr","value":n}` | cria `logs` (`origin='esp32'`, `acesso='Negado'`) |
| `elo5/armazem-b/log` | ESP → bridge | `{"event":"boot\|armed\|disarmed\|…\|test\|recalibrating\|recalibrated\|alarm_reset\|alarm_timeout"}` | cria `logs` + **ACK preciso por evento** |
| `elo5/armazem-b/sensors` | ESP → bridge (2 s) | `{"pir":bool,"dist":cm,"ldr":0-4095,"ldr_anomaly":bool}` | `last_telemetry` + linha em `telemetry` |
| `elo5/armazem-b/status` | ESP → bridge (LWT retained) | `online` / `offline` | ONLINE/OFFLINE + carimbo `mqtt_user` |

## Por que retry-until-ACK (P0)

O transporte usa **QoS 0**: se o ESP estiver reconectando na hora da publicação, a mensagem
se perde sem aviso. A bridge então reenvia comandos não confirmadados até `BRIDGE_MAX_RETRIES`,
e a API só marca `acked_at` quando o ESP **confirma de volta**:

- `arm` → `.../state {armed:true}` ou `.../log {event:armed}`
- `disarm` → `{armed:false}` ou `{event:disarmed/disarming…}`
- `reset_alarm` → `{alarming:false}` ou `{event:alarm_reset/alarm_timeout}`
- `test` / `recalibrate` → **só** via `.../log` (`test`, `recalibrating`/`recalibrated`) — nunca via estado

O dashboard faz poll de `GET /api/commands/:id` e mostra *Enviando → Confirmado/Falhou*.

## Bridge (`mqtt-bridge.js`)

- `MQTT_URL` padrão `mqtt://broker.hivemq.com:1883` (anônimo); broker próprio via
  `MQTT_USERNAME`/`MQTT_PASSWORD`/`MQTT_CA_FILE` (`mqtts://…:8883`)
- Pump de comandos a cada 2 s (claim atômico — duas bridges nunca duplicam)
- Heartbeat 15 s (`POST /api/_bridge/heartbeat`), refresh de devices 60 s
- Carimba `mqtt_user` (= `MQTT_USERNAME`) no `.../state` e no LWT — visibilidade de rotação
