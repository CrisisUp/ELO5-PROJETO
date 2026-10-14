# 🛡️ Sistema de Segurança Patrimonial e Monitoramento de Perímetro (ELO5)

Solução de telemetria e monitoramento patrimonial para armazéns industriais baseada em IoT (ESP32), arquitetura de mensageria MQTT, persistência em séries temporais (InfluxDB v2) e visualização analítica em tempo real (Grafana).

---

## 🏗️ Arquitetura da Solução

```text
+-------------------+      MQTT       +---------------------+
| ESP32 / Sensores  | ------------->  |   Node.js Bridge    |
| (PIR, LDR, HC-S04)|                 | (mqtt-bridge/server)|
+-------------------+                 +----------+----------+
                                                 |
                                          Linha de Escrita (Flux)
                                                 v
                                      +---------------------+
                                      |  InfluxDB v2.7      |
                                      | (Bucket Telemetria) |
                                      +----------+----------+
                                                 |
                                         Consultas Flux
                                                 v
                                      +---------------------+
                                      |   Grafana v10.4     |
                                      | (Dashboard Central) |
                                      +---------------------+

Camada de Borda (Sensoriamento): ESP32 capturando dados de proximidade (HC-SR04), presença (PIR) e luminosidade (LDR).
```

Camada de Integração: Backend Node.js processando telemetrias e estados do alarme.

Camada de Banco de Dados: InfluxDB 2.7 (armazenamento otimizado de séries temporais).

Camada de Visualização: Grafana com painel analítico de detecção de intrusão e auditoria temporal.

🚀 Como Executar o Ambiente

Pré-requisitos

Docker Desktop com suporte a WSL2 configurado.

Node.js (versão LTS recomendada).

1. Inicializar os Contêineres (Stack TIG / IoT)

No terminal, dentro da pasta do projeto, suba a infraestrutura em segundo plano:

```PowerShell
docker compose up -d
```

Para verificar o status dos contêineres:

PowerShell
docker compose ps

2. Portas e Acessos PadrãoServiçoURL de AcessoPortaFunçãoGrafanahttp://localhost:30003000Visualização dos Dashboards de SegurançaInfluxDBhttp://localhost:80868086Banco de Dados de Séries TemporaisTelegraf—8092 / 8094Coletor de métricas de infraestrutura

🔑 Credenciais e Variáveis de Ambiente PadrãoAs credenciais pré-configuradas no docker-compose.yml para desenvolvimento local são:InfluxDB 2.7Usuário: adminSenha: adminpassword123Organização: seguranca_patrimonialBucket Principal: armazem_telemetriaToken de Operador / Admin:PlaintextSuperSecretTokenSecurity2026==
GrafanaUsuário: adminSenha: admin

⚙️ Configuração do Data Source no GrafanaAcesse o Grafana em http://localhost:3000 e navegue até Connections > Data Sources > Add data source > InfluxDB.Ajuste os seguintes parâmetros:Query Language: FluxURL: http://security_influxdb:8086 (comunicação interna pela rede Docker)Basic auth: DesativadoOrganization: seguranca_patrimonialToken: SuperSecretTokenSecurity2026==Default Bucket: armazem_telemetriaClique em Save & test para validar a conexão.

📊 Estrutura de Telemetria e Measurements

O banco InfluxDB recebe e consome os dados nas seguintes estruturas:

1. security_sensorsdist (float/int): Distância em centímetros medida pelo sensor ultrassônico HC-SR04 (alerta para leituras abaixo de 40 cm).pir (boolean): Detecção de presença/movimento (0 = Livre, 1 = Intrusão).ldr (int): Nível analógico de luminosidade lido pelo ADC (0 a 4095).ldr_anomaly (boolean): Flag indicadora de oscilação anômala de luz no galpão.

2. security_statearmed (boolean): Indica se o sistema de alarme está ativo.alarm (boolean): Estado de disparo do alarme de intrusão.

📈 Importação do DashboardNo Grafana, acesse Dashboards > New > Import.Cole o conteúdo JSON do dashboard no campo Import via panel json.Associe o DataSource configurado (influxdb) e clique em Import.

🛑 Comandos ÚteisAcompanhar logs dos contêineres:

PowerShell

docker compose logs -f

Parar a infraestrutura:

PowerShell
docker compose down

Parar e limpar volumes persistidos (reset completo do banco):

PowerShell
docker compose down -v

---

Deseja que eu faça algum ajuste na descrição das rotas da API/Node.js ou inclua instruções p