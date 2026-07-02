# 04 — Объединение SOCKS5 + WebSocket

Теперь соединим SOCKS5 сервер с WebSocket. Вместо того чтобы создавать TCP-соединение
напрямую, отправляем запрос через WebSocket на удалённый сервер.

## Схема

```
Browser → SOCKS5 :1080 → наш код → WS → удалённый сервер → TCP → target
```

## Клиентская часть (local proxy)

```typescript
import * as net from 'net';
import WebSocket from 'ws';

const ws = new WebSocket('ws://server-ip:8080');

const server = net.createServer((client) => {
  // SOCKS5 handshake + парсинг запроса (как в шаге 3)
  // ...

  // Вместо net.createConnection:
  const connId = crypto.randomUUID();

  ws.send(JSON.stringify({
    event: 'connect',
    data: { id: connId, dstAddr, dstPort, atyp },
  }));

  // Ждём ответ
  ws.on('message', function onMessage(raw) {
    const msg = JSON.parse(raw.toString());
    if (msg.event === 'connect_resp' && msg.data.id === connId) {
      ws.removeListener('message', onMessage);

      if (msg.data.success) {
        client.write(buildSocks5Reply(0x00));

        // Relay: browser ↔ WS
        client.on('data', (data) => {
          ws.send(JSON.stringify({
            event: 'data',
            data: { id: connId, data: data.toString('base64') },
          }));
        });

        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.event === 'data' && msg.data.id === connId) {
            if (!client.destroyed)
              client.write(Buffer.from(msg.data.data, 'base64'));
          }
        });
      }
    }
  });
});
```

## Серверная часть (NestJS)

```typescript
import * as WebSocket from 'ws';
import * as net from 'net';

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.event === 'connect') {
      const { id, dstAddr, dstPort } = msg.data;

      const target = net.createConnection(dstPort, dstAddr, () => {
        ws.send(JSON.stringify({
          event: 'connect_resp',
          data: { id, success: true },
        }));

        target.on('data', (data) => {
          ws.send(JSON.stringify({
            event: 'data',
            data: { id, data: data.toString('base64') },
          }));
        });
      });

      ws.on('message', (raw) => {
        const inner = JSON.parse(raw.toString());
        if (inner.event === 'data' && inner.data.id === id) {
          target.write(Buffer.from(inner.data.data, 'base64'));
        }
      });
    }
  });
});
```

## Ключевые отличия от простого SOCKS5

1. **Два слоя соединений**: SOCKS5-клиент + WebSocket-клиент
2. **Асинхронный CONNECT**: ждём `connect_resp` из WebSocket
3. **Base64**: данные кодируются в строку, так как WS JSON работает с текстом
4. **Мультиплексирование**: одно WS-соединение обрабатывает много SOCKS5-сессий

## Проблема: несколько сессий

Когда через одно WS-соединение идёт несколько SOCKS5-сессий, сообщения
перемешиваются. Решение — `connectionId`:

```
Browser A → connId = aaa → WS: { id: 'aaa', data: '...' }
Browser B → connId = bbb → WS: { id: 'bbb', data: '...' }

Сервер получает:
  { id: 'aaa', data: '...' } → пишет в TCP сокет A
  { id: 'bbb', data: '...' } → пишет в TCP сокет B
```

Именно для этого в проекте `Map<string, Map<string, net.Socket>>` —
двухуровневое хранение: сначала по клиенту, потом по connectionId.
