# 01 — TCP эхо-сервер

Самый простой TCP-сервер на Node.js. Всё, что нам нужно — модуль `net`.

## Код

```typescript
import * as net from 'net';

const server = net.createServer((socket) => {
  console.log('Клиент подключился');

  // Эхо: отправляем обратно то, что получили
  socket.on('data', (data) => {
    console.log(`Получено ${data.length} байт: ${data.toString()}`);
    socket.write(data); // Эхо
  });

  socket.on('end', () => {
    console.log('Клиент отключился');
  });

  socket.on('error', (err) => {
    console.error('Ошибка:', err.message);
  });
});

server.listen(9000, () => {
  console.log('TCP эхо-сервер на порту 9000');
});
```

## Запуск

```bash
npx tsx server.ts

# В другом терминале:
nc localhost 9000
# Пишем что-то — получаем обратно
```

## Что мы узнали

1. **`net.createServer()`** — создаёт TCP-сервер
2. **`socket`** — дуплексный поток: можно читать (`on('data')`) и писать (`write()`)
3. **`socket.on('data', cb)`** — вызывается каждый раз, когда приходят данные
4. **`socket.on('end')`** — вызывается, когда клиент закрыл соединение (FIN)
5. **`socket.on('error')`** — ошибка соединения

Это основа, на которой построен весь проект:
- SOCKS5 сервер — тот же `net.createServer()`
- TunnelService — те же `socket.connect()`, `socket.write()`, `socket.on('data')`
