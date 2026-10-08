# Diagnóstico rápido — sintoma → onde olhar → causa

| Sintoma | Onde olhar | Causa provável |
|---------|-----------|----------------|
| Botão não reage | Serial `[MQTT] RX` → bridge `estado Armazém B` → badge | **par errado** (dashboard/firmware/prefixo misturados) ou QoS 0 perdido (P0 faz retry sozinho) |
| `Enviando…` para sempre | `GET /api/commands/:id` (`attempts`, `max_attempts`) | ESP offline · tópico `cmd` errado · `test`/`recalibrate` sem evento `.../log` |
| Gráfico parado | `GET /api/telemetry` (último `timestamp`) | sem `.../sensors` há > 10 s (bridge/API fora do ar?) |
| ONLINE preso após desligar | `last_seen` vs `STALE_AFTER_MS` | LWT não chegou; aguarde o staleness marcar OFFLINE |
| LDR "mexeu" no gráfico de distância | export CSV (`dist_cm` vs `ldr` no mesmo `timestamp`) | pacote único a cada 2 s + mão afetou o ultrassom — hoje há **um gráfico por sensor** |
| Buracos no gráfico de distância | linhas com `dist = 999` | sem eco do HC-SR04 (filtrado `< 900` por desenho) |
| 401 no painel | campo Token operador | `OPERATOR_TOKEN` setado no servidor e token ausente/errado |
| 429 em comandos | aguarde ~1 min | `RATE_LIMIT_MAX` estourou (IP/min) |
| TLS não conecta | `rc=` no Serial · log da bridge | CN ≠ IP do broker · CA errada · senha/`mqtt_user` divergente |
| API offline no painel | `node server.js` rodando? URL `http://localhost:3000`? | aberto como `file://` (fetch não funciona) ou porta ocupada |
