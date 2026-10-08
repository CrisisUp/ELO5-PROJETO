# Instalação — do zero à bancada funcionando

## Requisitos

- **Node.js ≥ 22.5** (usa `node:sqlite` embutido — a API não tem dependências externas)
- **ESP32** (DevKit v1) com o circuito da seção Hardware, ou Wokwi com `elo5/diagram.toml`
- Broker: **HiveMQ público** (padrão, sem setup) ou **Mosquitto local** (ver `tls.md`)

## 1. API + bridge (5 min)

```powershell
cd elo5
npm install          # única dep externa: `mqtt` (só a bridge usa)
node server.js       # terminal 1 → http://localhost:3000 (cria elo5.db + seed)
node mqtt-bridge.js  # terminal 2 → assina elo5/# no HiveMQ
```

Abra **http://localhost:3000** — nunca como `file://` (`fetch()` não funciona em `file://`).

Sem `OPERATOR_TOKEN`, tudo roda em **modo local aberto** (P0): dashboard, comandos e
telemetria funcionam sem token. Para fechar a API, crie um `.env` (**não commitado**):

```
OPERATOR_TOKEN=troque-isso
BRIDGE_KEY=elo5-local-bridge
```

E preencha o campo **Token operador** no topo do dashboard (salvo em `localStorage`).

## 2. Firmware no ESP32

Tudo é sobrescrevível via `secrets.h` (opcional, **não commitado**) ou flags `-D` —
sem editar `sketch.ino`. Padrões = HiveMQ público, anônimo (bancada imediata).

**Bancada (padrão):** compile e grave `sketch.ino` como está (rede `Wokwi-GUEST` no Wokwi,
ou ajuste `WIFI_SSID`/`WIFI_PASSWORD` via `-D`).

**Broker próprio:** ver `tls.md` (usuário/senha + TLS via `-DMQTT_TLS=1`).

## 3. Validar a bancada

1. Serial do ESP mostra `[MQTT] OK` + `publish .../status online`
2. Card **Armazém B** fica ONLINE no dashboard
3. Mexa no PIR/LDR → linha nova em **Logs** + gráficos se movem
4. Clique **Armar** → botão mostra *Enviando… → ✓ Confirmado*
5. Tabela **Auditoria do Operador** ganha a linha `command:arm`

Se algo falhar, ver `diagnostico.md`.
