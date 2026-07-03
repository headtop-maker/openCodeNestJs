# HTTP CONNECT Tunnel

HTTP CONNECT — это механизм, который позволяет клиенту через HTTP-прокси установить
прямой TCP-туннель к целевому серверу. Именно так работают HTTPS-прокси.

## Принцип работы

```
Клиент ──CONNECT google.com:443──▶ HTTP-прокси ──TCP──▶ google.com:443
         ◀────── 200 OK ──────────◀───────────────────────
         ◀────── туннель ────────▶◀────── туннель ───────▶
```

После CONNECT прокси перестаёт читать HTTP и просто копирует байты в обе стороны.

## Реализация

Сервер (сохрани в `http-connect-server.js`):

```javascript
const http = require('http');
const net = require('net');

const server = http.createServer((req, res) => {
  // Обычные HTTP-запросы не обрабатываем
  res.writeHead(405);
  res.end('Only CONNECT method is supported');
});

server.on('connect', (req, clientSocket, head) => {
  const [host, port] = req.url.split(':');
  const targetPort = parseInt(port, 10) || 443;

  console.log(`CONNECT ${host}:${targetPort}`);

  const targetSocket = net.connect(targetPort, host, () => {
    // 200 OK — туннель установлен
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // head содержит данные, которые пришли вместе с CONNECT
    if (head.length > 0) targetSocket.write(head);

    // Двусторонняя перекачка байтов
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on('error', (err) => {
    console.error(`Target error: ${err.message}`);
    clientSocket.end();
  });

  clientSocket.on('error', (err) => {
    console.error(`Client error: ${err.message}`);
    targetSocket.end();
  });
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`HTTP CONNECT proxy on http://localhost:${PORT}`);
});
```

Клиент — любой браузер или curl:

```bash
# curl использует HTTP CONNECT для HTTPS-сайтов
curl -x http://localhost:8080 https://google.com -v
# -v покажет CONNECT-рукопожатие
```

## Разбор кода

| Элемент | Назначение |
|---|---|
| `server.on('connect')` | Событие CONNECT — ключевое отличие от обычного HTTP |
| `req.url` | Содержит `host:port` цели |
| `head` | Данные, буферизованные после заголовков CONNECT |
| `pipe()` | Передаёт данные напрямую, без копирования в память |

## Сравнение с SOCKS5

| Характеристика | HTTP CONNECT | SOCKS5 |
|---|---|---|
| Протокол | Только TCP | TCP + UDP |
| Аутентификация | Basic Auth (встроена) | Несколько методов |
| Определение цели | В URL CONNECT | В байтах после рукопожатия |
| UDP | Нет | Поддерживается |
| Простота | Очень простой | Сложнее |

## Как это связано с проектом

В проекте SOCKS5-запросы от браузера упаковываются в WebSocket (local-proxy),
а наш NestJS-сервер распаковывает их и создаёт TCP-соединения. HTTP CONNECT
делает то же самое, но без дополнительного протокола — весь туннель описывается
одним HTTP-запросом.

Можно было бы реализовать HTTP CONNECT вместо SOCKS5 на клиенте:
браузер поддерживает HTTP-прокси «из коробки», без дополнительных настроек.
Но SOCKS5 даёт больше гибкости (UDP, домены через DNS-резолв прокси).
