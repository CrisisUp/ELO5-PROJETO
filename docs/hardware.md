# Hardware + firmware — nó "Armazém B" (`elo5/sketch.ino`)

## Pinout

| Componente | Pino | Detalhe |
|------------|------|---------|
| PIR (presença) | GPIO 16 | **edge-trigger**: enfileira só na borda quieto→ativo |
| HC-SR04 TRIG / ECHO | GPIO 5 / 18 | média móvel de 5 amostras; `999` = sem eco |
| LDR (divisor com 10 k) | GPIO 34 (ADC) | média por leitura; calibração de 50 amostras no boot |
| Botão arma/desarma | GPIO 4 (`INPUT_PULLUP` → GND) | físico, funciona sem MQTT |
| LED status | GPIO 2 (+ 220 Ω → GND) | — |
| Buzzer 1 / 2 (sirene LEDC) | GPIO 19 / 23 | flag `g_sirenActive`, task separada toca |
| OLED SSD1306 (I2C, addr 0x3C) | SDA 21 / SCL 22 | estado + distância + LDR locais |

`elo5/diagram.toml` = circuito Wokwi idêntico (rede `Wokwi-GUEST`, HiveMQ, `elo5/armazem-b/…`).

## Firmware (FreeRTOS, 5 tasks)

- `eventQueue` (16 slots) + `txQueue` + `statusMutex`; estado persistido em NVS
- **P0 anti-flood:** PIR/LDR só enfileiram na borda; `drainEventQueue()` esvazia a fila nas
  transições arma/desarma (comando nunca fica soterrado por evento de sensor)
- **LDR:** base calibrada + histerese (`LDR_DELTA_ON/OFF`) + confirmação de 2 s antes de alarmar
- **Sensores publicados a cada 2 s** em `.../sensors` (`pir, dist, ldr, ldr_anomaly`)
- **LWT** `.../status` retained (`online`/`offline`), QoS 0 + ACK em `.../state`/`.../log`

## Config sem editar o fonte

Tudo via `secrets.h` (opcional, **não commitado**) ou flags `-D`:

| Define | Padrão | Notas |
|--------|--------|-------|
| `WIFI_SSID` / `WIFI_PASSWORD` | `Wokwi-GUEST` / `""` | — |
| `MQTT_SERVER` / `MQTT_PORT` | `broker.hivemq.com` / `1883` | broker próprio: IP + `MQTT_USER`/`MQTT_PASSWORD` |
| `MQTT_USER` / `MQTT_PASSWORD` | `""` (anônimo) | **senha nunca no repo** |
| `TOPIC_BASE` | `elo5/armazem-b` | manter igual ao par do dashboard |
| `MQTT_TLS` / `MQTT_TLS_PORT` | `0` / `8883` | `1` = BearSSL; CA via `MQTT_CA_PEM`, senão `setInsecure()` (só lab) |
