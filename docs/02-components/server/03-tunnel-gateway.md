# tunnel.gateway.ts — WebSocket gateway

## Назначение

Принимает WebSocket-соединения от Local Proxy, парсит сообщения и диспетчеризирует
их в `TunnelService`.

## Ключевые функции

### `handleConnection(client: WebSocket)`

```typescript
// Вызывается при каждом новом WebSocket-подключении
handleConnection(client) {
  // 1. Генерируем уникальный ID клиента
  const clientId = crypto.randomUUID();
  
  // 2. Храним ID прямо на объекте сокета (чтобы был доступен в колбэках)
  (client as any).clientId = clientId;
  
  // 3. Регистрируем клиента в TunnelService
  this.tunnelService.registerClient(clientId, client);
  
  // 4. Вешаем обработчик входящих сообщений
  client.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    this.dispatch(client, msg);
  });
}
```

### `handleDisconnect(client: WebSocket)`

```typescript
// Очищает все ресурсы клиента при отключении
handleDisconnect(client) {
  this.tunnelService.unregisterClient(clientId);
  // → закрываются все TCP/UDP сокеты этого клиента
  // → удаляются все таймауты
  // → удаляются все UDP-маршруты
}
```

### `dispatch(client, msg)`

Маршрутизирует сообщения по полю `event`:

| event | Метод | Что делает |
|-------|-------|-----------|
| `connect` | `handleConnect` | Создаёт TCP-соединение к целевому хосту |
| `data` | `handleData` | Пишет данные в TCP-сокет |
| `close` | `handleClose` | Закрывает TCP/UDP сокет |
| `udp_associate` | `handleUdpAssociate` | Создаёт UDP-relay |
| `udp_data` | `handleUdpData` | Отправляет UDP датаграмму |

### `handleConnect(clientId, data, client)`

```typescript
async handleConnect(clientId, { id, dstAddr, dstPort, atyp }, client) {
  try {
    // Асинхронно создаёт TCP-соединение
    await tunnelService.createTcpConnection(clientId, id, dstAddr, dstPort);
    // При успехе service сам отправляет connect_resp
  } catch (err) {
    // При ошибке отправляем connect_resp { success: false }
    client.send(JSON.stringify({
      event: 'connect_resp',
      data: { id, success: false, error: err.message },
    }));
  }
}
```

### `handleData(clientId, data)`

Проксирует данные из WebSocket в TCP-сокет:

```typescript
handleData(clientId, { id, data }) {
  tunnelService.writeToTcp(clientId, id, data);
  // data — base64-строка
  // writeToTcp декодирует и пишет в net.Socket
}
```

## Важные детали

- **Одно WS-соединение — много TCP-сессий**: мультиплексирование через `connectionId`
- **Ручной dispatch**: не используем `@SubscribeMessage`, чтобы не зависеть от версии NestJS и иметь полный контроль
- **clientId**: хранится на объекте `WebSocket` через `(client as any).clientId`
