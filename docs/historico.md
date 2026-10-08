# Histórico — por que o sistema está assim (P0 → P1 → P2)

## P0 — comandos confiáveis ✅ testado

**Problema:** botões "mortos" por dois motivos somados — firmware v3 inundava a
`eventQueue` (16 slots) com PIR/LDR a cada 50 ms (comando soterrado) e comandos QoS 0
se perdiam quando o ESP reconectava.

**Solução:** edge-trigger + `drainEventQueue()` no firmware; fila `pending_commands
(attempts, last_try_at, acked_at)` com ACK por `.../state` **e** por evento `.../log`;
retry-until-ACK na bridge; dashboard com *Enviando → Confirmado/Falhou* (`GET /api/commands/:id`).

**Detalhe que pega:** `test`/`recalibrate` dão ACK **só** via `.../log`, nunca via estado.

## P1 — hardening + telemetria real ✅ testado

**Problema:** broker público, API aberta, gráfico com dados inventados, ONLINE preso após queda.

**Solução:** `OPERATOR_TOKEN` (vazio = modo local aberto, sem quebrar a bancada), rate limit,
security headers, OFFLINE por staleness (`STALE_AFTER_MS`), gráfico real via
`GET /api/telemetry`, auth no firmware/bridge (`secrets.h`, `MQTT_USERNAME`…), pasta
`mosquitto/` com ACL de menor privilégio.

## P2 — TLS + rotação + retenção ✅ testado (cutover TLS em andamento)

**Problema:** transporte em claro, sem visibilidade de rotação de credenciais, telemetria
sem limite nem export, LDR sem gráfico, auditoria/rotacão sem tela.

**Solução:** BearSSL no ESP (`MQTT_TLS`/`MQTT_CA_PEM`), coluna `devices.mqtt_user` +
`PATCH /api/mqtt-users/:id` (só metadado, auditado), prune `TELEMETRY_RETENTION_DAYS` +
export CSV/JSON (`TELEMETRY_EXPORT_MAX`), 2º gráfico (LDR 0–4095), tabelas de auditoria e
botão de rotação no painel, pontos dos gráficos reduzidos (raio 1.5).

**Cutover TLS:** certs gerados, listener 8883 ativo; pendentes restart do broker + env da
bridge + rebuild do ESP com `MQTT_TLS=1`.
