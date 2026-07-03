# TCP ↔ WebSocket Port Forwarding

Простой тунель: TCP-порт на локальной машине пробрасывается через WebSocket
на удалённую. Всё, что приходит в TCP, уходит в WebSocket, и наоборот.

## Зачем это нужно

- Пробросить доступ к БД через фаервол
- Подключиться к домашнему компьютеру через публичный WS-сервер
- Обойти NAT без настройки роутера

## Схема

```
Локально:                     Серверно:
TCP:3000 ──▶ WS ──── WS ──▶ TCP:target:8080
           клиент     сервер
```

## Реализация

### Сервер (сохрани в `ws-port-forward-server.js`)

```javascript
const { WebSocketServer } = require('ws');
const net = require('net');

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws, req) => {
  // Параметры цели берём из URL: ws://localhost:8080/?host=google.com&port=80
  const url = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host') || 'localhost';
  const port = parseInt(url.searchParams.get('port'), 10) || 80;

  console.log(`Forwarding to ${host}:${port}`);

  const target = net.connect(port, host, () => {
    console.log(`Connected to ${host}:${port}`);
  });

  // TCP → WS
  target.on('data', (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data.toString('base64'));
    }
  });

  // WS → TCP
  ws.on('message', (raw) => {
    const data = Buffer.from(raw.toString(), 'base64');
    if (!target.destroyed) {
      target.write(data);
    }
  });

  // Обработка закрытия
  target.on('close', () => ws.close());
  ws.on('close', () => target.end());
  ws.on('error', () => target.destroy());
  target.on('error', (err) => console.error(`TCP error: ${err.message}`));
});

console.log('WS forward server on ws://localhost:8080');
```

### Клиент (сохрани в `ws-port-forward-client.js`)

```javascript
const { WebSocket } = require('ws');
const net = require('net');
const { program } = require('commander'); // необязательно, можно hardcode

program
  .argument('<local-port>')
  .argument('<remote-host>')
  .argument('<remote-port>')
  .parse();

const [localPort, remoteHost, remotePort] = program.args;
const wsUrl = `ws://localhost:8080/?host=${remoteHost}&port=${remotePort}`;

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log(`WS connected. Listening on localhost:${localPort}`);

  const tcpServer = net.createServer((localSocket) => {
    console.log('Local TCP client connected');

    // TCP → WS
    localSocket.on('data', (data) => {
      ws.send(data.toString('base64'));
    });

    // WS → TCP
    ws.on('message', (raw) => {
      const data = Buffer.from(raw.toString(), 'base64');
      localSocket.write(data);
    });

    localSocket.on('end', () => ws.close());
    ws.on('close', () => localSocket.end());
  });

  tcpServer.listen(localPort);
});
```

### Запуск

```bash
# Терминал 1: сервер (на удалённой машине)
node ws-port-forward-server.js

# Терминал 2: клиент (локально)
node ws-port-forward-client.js 3000 google.com 80

# Терминал 3: проверка
curl http://localhost:3000
# → ответ от google.com
```

## Объяснение

Этот пример — упрощённая версия проекта. Отличия:

| Проект | Этот пример |
|---|---|
| SOCKS5 на клиенте | Прямое TCP-соединение |
| Много соединений (multiplexing) | Одно WS → одно TCP |
| UUID + Map для идентификации | Каждое WS = одно TCP |
| UDP relay | Только TCP |
| JSON-формат сообщений | Обычный base64 |

## Что дальше

1. Добавь multiplexing — несколько TCP через одно WS (как в проекте)
2. Добавь TLS — оберни WS в WSS
3. Добавь автоматическое переподключение
4. Преврати в SOCKS5 — и получишь полноценный тунель
