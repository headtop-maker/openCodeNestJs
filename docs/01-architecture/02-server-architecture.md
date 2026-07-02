# Архитектура сервера (NestJS)

## Структура модулей

```
src/
├── main.ts
│   ├── Создаёт NestFactory
│   ├── Подключает WsAdapter (платформа ws)
│   └── Слушает порт 8080
│
├── app.module.ts
│   └── Импортирует TunnelModule
│
└── tunnel/
    ├── tunnel.module.ts    ← DI: связывает Gateway + Service
    ├── tunnel.gateway.ts   ← WebSocket слой
    ├── tunnel.service.ts   ← Бизнес-логика TCP/UDP
    └── messages.interface.ts ← Типы
```

## Схема потока данных

```
  WebSocket              tunnel.gateway.ts              tunnel.service.ts
  клиент
 ┌─────────┐  message   ┌──────────────┐  createTcp  ┌─────────────────┐
 │         │───────────►│ dispatch()   │────────────►│ Map<clientId,   │
 │  WS     │            │              │             │   Map<connId,   │
 │  Client │◄───────────│  ┌─────────┐ │             │     Socket>>    │
 │         │   send()   │  │connect  │ │             │                 │
 └─────────┘            │  │data     │ │  writeToTcp │  Map<connId,    │
                        │  │close    │ │◄───────────│   Stats>        │
                        │  │udp_*    │ │             │                 │
                        │  └─────────┘ │             │  Map<udpRoutes> │
                        └──────────────┘             └─────────────────┘
```

## Роль каждого компонента

### TunnelGateway
- Принимает WebSocket-соединения
- Ведёт логирование подключений `Client connected: ${clientId}`
- Парсит JSON-сообщения и диспетчеризирует по `event`
- Передаёт управление в `TunnelService`

```typescript
handleConnection(client) → регистрирует clientId
handleDisconnect(client) → чистит все ресурсы клиента

dispatch(client, msg) → switch(msg.event):
  'connect'      → tunnelService.createTcpConnection()
  'data'         → tunnelService.writeToTcp()
  'close'        → tunnelService.closeTcp() + closeUdp()
  'udp_associate' → tunnelService.createUdpRelay()
  'udp_data'     → tunnelService.sendUdpData()
```

### TunnelService
- Хранит маппинги `clientId → { connectionId → Socket }`
- Создаёт TCP-соединения к целевым хостам
- Передаёт данные между WebSocket и TCP
- Управляет UDP релеями
- Чистит ресурсы (timeout, disconnect)

## Жизненный цикл TCP-соединения на сервере

```typescript
createTcpConnection(clientId, connId, host, port) {
  1. new net.Socket()
  2. socket.connect(port, host)
  3. При успехе:
     - сохраняем сокет в tcpConnections
     - отправляем connect_resp { success: true }
  4. socket.on('data'):
     - отправляем клиенту { event: 'data', data: base64 }
  5. socket.on('close'):
     - отправляем клиенту { event: 'close' }
     - чистим маппинги
}
```

## Обработка ошибок

| Ситуация | Действие |
|----------|----------|
| TCP connect failed | `connect_resp { success: false, error }` |
| WS disconnect | Закрыть все TCP/UDP сокеты клиента |
| TCP socket error | Отправить `close`, очистить |
| Idle timeout (30s) | Автоматически закрыть соединение |
| Invalid message | Логировать, игнорировать |
