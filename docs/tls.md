# Broker próprio + cutover TLS (Mosquitto)

`elo5/mosquitto/mosquitto.conf`: listener `1883 localhost` (migração) + **`8883 TLS`**
com CA própria. `acl.conf`: menor privilégio (ESP publica sensores/estado e só assina o
próprio `cmd`; bridge lê `elo5/#` e escreve `elo5/+/cmd`).

## Cutover passo a passo

```powershell
# 1) Certificados (uma vez) — CN = IP do broker na rede do ESP
cd elo5/mosquitto
openssl req -new -x509 -days 365 -nodes -out ca.crt -keyout ca.key -subj "/CN=Elo5-CA"
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=IP-DO-BROKER"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# 2) Usuários (senhas nunca commitadas)
mosquitto_passwd -c passwd elo5-esp
mosquitto_passwd passwd elo5-bridge

# 3) Subir (listener 8883 já ativo no conf)
mosquitto -c mosquitto/mosquitto.conf

# 4) Bridge no TLS
$env:MQTT_URL="mqtts://IP-DO-BROKER:8883"; $env:MQTT_USERNAME="elo5-bridge"
$env:MQTT_PASSWORD="..."; $env:MQTT_CA_FILE="mosquitto/ca.crt"; node mqtt-bridge.js

# 5) ESP: rebuild com -DMQTT_TLS=1 -DMQTT_TLS_PORT=8883 -DMQTT_SERVER='"IP-DO-BROKER"'
#    + MQTT_USER/MQTT_PASSWORD e MQTT_CA_PEM (conteúdo do ca.crt) via secrets.h
```

## Validar

Bridge loga `conectado ao broker mqtts://…` → ESP publica `online` → card volta a ONLINE →
Armar/Desarmar confirma (ACK idêntico, só o transporte mudou). Painel mostra `MQTT elo5-esp`.

## Rotação de credenciais

1. Crie o novo usuário no broker (`mosquitto_passwd`) e atualize o ESP (`MQTT_PASSWORD`)
2. Registre no painel: botão **⟳ MQTT** no card → `PATCH /api/mqtt-users/:id` (só metadado,
   validado `/^[A-Za-z0-9._-]{1,64}$/`, auditado como `mqtt-rotation`)
3. A bridge carimba o usuário ativo a cada `.../state`/LWT — divergência aparece no card

> `setInsecure()` (sem `MQTT_CA_PEM`) = TLS sem validação: ok para o teste do cutover,
> **não** para produção. **Nunca commitar:** `passwd`, `*.crt`, `*.key`, `*.csr`, `secrets.h`.
