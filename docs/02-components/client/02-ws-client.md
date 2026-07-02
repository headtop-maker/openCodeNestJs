# ws-client.ts — WebSocket клиент

## Назначение

Поддерживает одно WebSocket-соединение к NestJS-серверу и диспетчеризирует сообщения.

## Ключевая структура

```typescript
class WsClient {
  private ws: WebSocket | null;
  private url: string;
  private connecting: boolean;

  // Хранилища колбэков — по connectionId
  private handlers = {
    data:        Map<string, DataHandler>,
    close:       Map<string, CloseHandler>,
    udpData:     Map<string, UdpDataHandler>,
    connectResp: Map<string, ConnectRespCallback>,
    udpResp:     Map<string, UdpRespCallback>,
  };
}
```

Каждая SOCKS5-сессия получает свой `connectionId`. Колбэки регистрируются
с этим ID и вызываются, когда приходит сообщение с соответствующим ID.

## Методы отправки

| Метод | WS event | Что делает |
|-------|----------|------------|
| `sendConnect(id, host, port, atyp)` | `connect` | Запрос TCP-соединения |
| `sendData(id, base64)` | `data` | Данные от браузера |
| `sendClose(id)` | `close` | Закрыть сессию |
| `sendUdpAssociate(id)` | `udp_associate` | Запрос UDP релея |
| `sendUdpData(id, data, atyp, dst, port)` | `udp_data` | UDP датаграмма |

## Методы регистрации обработчиков

| Метод | Возвращает | Вызывается при |
|-------|-----------|----------------|
| `onConnectResp(id, cb)` | `() => void` (unsubscribe) | `connect_resp` |
| `onData(id, cb)` | unsubscribe | `data` (данные с сервера) |
| `onClose(id, cb)` | unsubscribe | `close` (сервер закрыл) |
| `onUdpResp(id, cb)` | unsubscribe | `udp_associate_resp` |
| `onUdpData(id, cb)` | unsubscribe | `udp_data` (ответный UDP) |

```typescript
// Пример использования:
const remove = wsClient.onConnectResp('abc-123', (success) => {
  remove(); // Отписываемся после первого вызова
  if (success) startRelay();
});
```

## Reconnect

При разрыве WebSocket автоматически переподключается через 3 секунды:

```typescript
this.ws.on('close', () => {
  console.log('[WS] Disconnected, reconnecting in 3s...');
  setTimeout(() => this.connect(), 3000);
});
```

Все активные SOCKS5-сессии при этом оборвутся (NestJS почистит их
при disconnect'e клиента).

## Внутренняя работа

```typescript
// Входящее сообщение:
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  
  switch (msg.event) {
    case 'connect_resp':
      // Ищем callback по data.id, вызываем, удаляем
      callback = handlers.connectResp.get(data.id);
      callback(data.success, data.error);
      handlers.connectResp.delete(data.id);
      break;
      
    case 'data':
      // Ищем handler по data.id, вызываем
      handler = handlers.data.get(data.id);
      handler(data.data); // socket.write(Buffer.from(data, 'base64'))
      break;
      
    case 'close':
      handler = handlers.close.get(data.id);
      handler(); // socket.end()
      break;
  }
});
```
