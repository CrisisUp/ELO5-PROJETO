# Dashboard — guia de uso (`elo5/index.html`)

Servido pela própria API em **http://localhost:3000**. Poll automático; sem refresh manual.

## Gráficos de telemetria (lado esquerdo)

Dois cards, mesma fonte `GET /api/telemetry`, refresh a cada 10 s, nunca inventam dados
(sem amostra, mantêm o último estado):

| Card | Sensor | Linha | Escala | Filtro |
|------|--------|-------|--------|--------|
| Distância (cm) | HC-SR04 | verde | cm | `dist < 900` (`999` = sem eco, oculto) |
| Luminosidade (LDR) | fotorresistor | âmbar | 0–4095 | `ldr != null` |

Cada sensor tem **sua linha e sua escala** — tapar o LDR move só o gráfico âmbar.
Pontos pequenos (raio 1.5) com destaque no hover.

**Botões CSV / JSON** (card Distância) baixam `elo5-telemetry.csv/json` via
`GET /api/telemetry/export` com o token do operador.

## Dispositivos (Nós de Telemetria)

- Badge **ONLINE/OFFLINE** — OFFLINE também por *staleness* (sem toque da bridge por
  `STALE_AFTER_MS`, padrão 90 s; sobrevive a restart)
- Badge **ARMADO/DESARMADO**, **ALARME** pulsante
- Linha de telemetria (`Dist … · PIR ativo · LDR … · ⚠ luz`) + linha `MQTT <user>`
- **Armar / Desarmar** → *Enviando … → ✓ Confirmado pelo ESP32 / ✗ Sem resposta*
- **⟳ MQTT `<user>`** → troca o usuário MQTT (só metadado; lembra de trocar a **senha**
  no broker via `mosquitto_passwd` + `MQTT_PASSWORD` no ESP)

## Logs + Auditoria (lado direito)

- **Tabela de Logs** — eventos com filtros (busca, local, câmera), poll 5 s, modal Detalhes
- **Auditoria do Operador** — `GET /api/audit` (poll 15 s): hora, ator
  (`operator` ou `operator:token`), ação (`command:arm`, `mqtt-rotation`, …), dispositivo, detalhe.
  Com auth ligada e sem token, mostra dica em vez de quebrar.

## Topo

- **Token operador** — campo de senha, visível só se `GET /api/health` disser
  `auth.operatorRequired`; salvo em `localStorage`
- **Simulação** — toggle gera tráfego demo via `POST /api/logs` (`origin='simulacao'`);
  **+ Disparar Evento** abre o modal manual
