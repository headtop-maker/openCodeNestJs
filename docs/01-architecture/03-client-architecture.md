# Архитектура клиента (Local Proxy)

## Структура

```
local-proxy/
├── src/
│   ├── index.ts          ← Точка входа: env, запуск компонентов
│   ├── ws-client.ts      ← WebSocket клиент к NestJS
│   ├── socks5-server.ts  ← SOCKS5 сервер + UDP relay
│   └── messages.ts       ← Типы
└── .env                  ← WS_HOST=45.9.116.71 (не в git)
```

## Схема потоков

```
  Browser (SOCKS5)          localhost:1080               WS → NestJS
 ┌────────────────┐  TCP   ┌──────────────────┐  WS     ┌────────────┐
 │                │───────►│ Socks5Server     │ msg     │            │
 │  Firefox/curl  │        │                  │────────►│  NestJS    │
 │                │◄───────│ ┌──────────────┐ │◄────────│  Server    │
 └────────────────┘  TCP   │ │Socks5Connect │ │         │  :8080     │
                           │ │  ion         │ │         └────────────┘
   UDP datagram            │ └──────────────┘ │
 ┌────────────────┐  UDP   │ ┌──────────────┐ │
 │  Browser       │───────►│ │UdpRelay      │ │
 │  (DNS)         │◄───────│ │(local)       │ │
 └────────────────┘        │ └──────────────┘ │
                           └──────────────────┘
                                │
                                │ WsClient
                                │ (одно соединение)
                                ▼
                           ┌──────────────┐
                           │  handlers:    │
                           │  data Map     │
                           │  close Map    │
                           │  udpData Map  │
                           │  connectResp  │
                           └──────────────┘
```

## WsClient — диспетчер сообщений

```
Входящие  → connect_resp → находит callback по id → вызывает
сообщения → data         → находит handler по id → socket.write
          → close        → находит handler по id → socket.end()
          → udp_data     → находит handler по id → отправляет обратно
                          через UDP relay
```

WsClient поддерживает автоматический reconnect с задержкой 3с.

## Socks5Server — конечный автомат

Каждое SOCKS5-соединение парсится через state machine:

```
GREETING ──► REQUEST_HEADER ──► REQUEST_ADDR ──► RELAY
     ↓              ↓                ↓
  05 + 00       cmd + atyp      парсим адрес    передаём данные
```

### Фазы парсинга:

1. **Greeting**: `VER(1) + NMETHODS(1) + METHODS(N)`
   - Проверяем VER=0x05
   - Отвечаем `0x05 0x00` (no auth)

2. **Request header**: `VER(1) + CMD(1) + RSV(1) + ATYP(1)`
   - CMD: 0x01=CONNECT, 0x03=UDP ASSOCIATE
   - Запоминаем команду и тип адреса

3. **Request address**: зависит от ATYP
   - 0x01: 4 байта IPv4
   - 0x03: len(1) + строка домена
   - 0x04: 16 байт IPv6
   - + 2 байта порта

4. **Relay**: прозрачная передача данных

### TCP Relay

```typescript
socket.on('data')     → wsClient.sendData(connId, base64)
wsClient.onData(id)   → socket.write(Buffer.from(base64))
socket.on('end/error') → wsClient.sendClose(connId)
wsClient.onClose(id)  → socket.end()
```

### UDP Relay

При UDP ASSOCIATE создаётся локальный `dgram.Socket` — SOCKS5 UDP relay:

```typescript
Browser → LocalUDP: SOCKS5 UDP header + data
  → парсим REAL dstAddr, dstPort
  → wsClient.sendUdpData(connId, data, dstAddr, dstPort)

NestJS → ws: udp_data { data, srcAddr, srcPort }
  → формируем SOCKS5 UDP response header
  → отправляем обратно браузеру через LocalUDP
```
