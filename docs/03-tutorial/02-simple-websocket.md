# 02 — WebSocket сервер и клиент

## WebSocket сервер (на базе ws)

```typescript
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws: WebSocket) => {
  console.log('WS клиент подключился');

  ws.on('message', (data: Buffer) => {
    console.log(`Получено: ${data}`);
    ws.send(`Эхо: ${data}`);
  });

  ws.on('close', () => {
    console.log('WS клиент отключился');
  });
});

console.log('WebSocket сервер на порту 8080');
```

## WebSocket клиент

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Подключились к серверу');
  ws.send('Привет!');
});

ws.on('message', (data: Buffer) => {
  console.log(`Ответ: ${data.toString()}`);
  ws.close();
});

ws.on('close', () => {
  console.log('Соединение закрыто');
});
```

## Запуск

```bash
# Терминал 1:
npx tsx ws-server.ts

# Терминал 2:
npx tsx ws-client.ts
```

## Наш ws-client.ts

В проекте `local-proxy/src/ws-client.ts` — это тот же клиент, но с:

- **Автопереподключением** при разрыве
- **Мультиплексированием** — хранит Map колбэков по `connectionId`
- **Диспетчеризацией** — парсит JSON и вызывает нужный обработчик

```typescript
// Упрощённый ws-client.ts:
class WsClient {
  private handlers: { data: Map<string, Handler> };

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      this.dispatch(msg);
    });
  }

  onData(connectionId, handler) {
    this.handlers.data.set(connectionId, handler);
  }

  private dispatch(msg) {
    if (msg.event === 'data') {
      const handler = this.handlers.data.get(msg.data.id);
      handler?.(msg.data.data);
    }
  }
}
```

## Важный момент — JSON over WebSocket

Мы не отправляем бинарные данные напрямую. Вместо этого:

```typescript
// Отправка:
ws.send(JSON.stringify({
  event: 'connect',
  data: { id: 'abc', dstAddr: 'example.com', dstPort: 80, atyp: 3 }
}));

// Получение:
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  // msg.event, msg.data
});
```

Бинарные данные (TCP payload) передаются закодированными в base64 внутри JSON.
