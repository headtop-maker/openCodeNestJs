# tunnel.service.ts — менеджер соединений

## Структуры данных

```typescript
// clientId → Map<connectionId → net.Socket>
// По клиенту группируем все его TCP-соединения
private readonly tcpConnections = new Map<string, Map<string, net.Socket>>();

// clientId → Map<connectionId → dgram.Socket>
// UDP-релеи для каждого клиента
private readonly udpConnections = new Map<string, Map<string, dgram.Socket>>();

// targetAddr:Port → { clientId, connectionId }
// Маршрутизация ответных UDP-датаграмм обратно к нужному клиенту
private readonly udpRoutes = new Map<string, UdpRoute>();

// clientId → WebSocket
// Чтобы отправлять сообщения конкретному клиенту
private readonly clientSockets = new Map<string, WebSocket>();

// connectionId → ConnStats
// Счётчики байт для логирования
private readonly connStats = new Map<string, ConnStats>();
```

## Ключевые функции

### `registerClient / unregisterClient`

Управляют жизненным циклом WebSocket-клиента. При регистрации создаются пустые Map'ы
для будущих соединений. При удалении — все сокеты закрываются, все таймауты чистится.

### `createTcpConnection(clientId, connectionId, host, port)`

Сердце всего туннеля — создаёт TCP-соединение к целевому хосту.

```
1. new net.Socket()
2. socket.connect(port, host)
3. Ждём connect (или error, или timeout 10s)
4. При успехе:
   - Сохраняем в tcpConnections[clientId][connectionId]
   - Отправляем connect_resp { success: true }
5. Вешаем обработчики:
   on('data')   → отправляем клиенту { event: 'data', data: base64 }
   on('error')  → если connect ещё не завершился — reject, иначе → close
   on('close')  → если established → отправляем close, чистим
```

```typescript
// Ключевой фрагмент — Promise с ручным управлением:
return new Promise((resolve, reject) => {
  let established = false;
  let settled = false;

  socket.connect(port, host, () => {
    established = true;
    settled = true;
    // сохраняем, отвечаем, resolve
  });

  socket.on('close', () => {
    if (established) {
      // Нормальное закрытие после успешного соединения
      if (this.tcpConnections.get(clientId)?.has(connectionId)) {
        this.send(clientId, { event: 'close', data: { id: connectionId } });
        this.cleanupConnection(clientId, connectionId);
      }
    } else if (!settled) {
      // Закрытие ДО установки соединения — ошибка
      settled = true;
      reject(new Error('Connection closed before established'));
    }
  });
});
```

Флаг `established` нужен, чтобы различать:
- `close` после успешного `connect` → нормальное завершение
- `close` без `connect` → ошибка соединения

Флаг `settled` предотвращает двойной resolve/reject.

### `writeToTcp(clientId, connectionId, dataBase64)`

Пишет данные из WebSocket в TCP-сокет:

```typescript
const buffer = Buffer.from(dataBase64, 'base64');
const stats = this.connStats.get(connectionId);
if (stats) stats.downBytes += buffer.length;
socket.write(buffer);
```

### `closeTcp(clientId, connectionId)`

Закрывает TCP-соединение по запросу клиента:

```typescript
const socket = tcpMap.get(connectionId);
if (socket) socket.end(); // Отправляет FIN
this.cleanupConnection(clientId, connectionId);
```

### `createUdpRelay(clientId, connectionId)`

Создаёт UDP-сокет для релея:

```typescript
const socket = dgram.createSocket('udp4');
socket.bind(0, '0.0.0.0', () => {
  const port = socket.address().port;
  // Сохраняем, отвечаем
});
// Когда приходит датаграмма из сети:
socket.on('message', (msg, rinfo) => {
  const routeKey = `${rinfo.address}:${rinfo.port}`;
  const route = this.udpRoutes.get(routeKey);
  if (route?.connectionId === connectionId) {
    this.send(clientId, { event: 'udp_data', data: { id, data: msg.toString('base64') } });
  }
});
```

### `sendUdpData(clientId, connectionId, dataBase64, dstAddr, dstPort)`

Отправляет UDP-датаграмму и регистрирует маршрут для ответа:

```typescript
const routeKey = `${dstAddr}:${dstPort}`;
this.udpRoutes.set(routeKey, { clientId, connectionId });
socket.send(buffer, dstPort, dstAddr);
```

### `cleanupConnection(clientId, connectionId)`

Удаляет все следы соединения из всех Map'ов и таймаутов.

### Таймауты

Каждое соединение имеет idle timeout (30s). При любой активности таймер сбрасывается.
Если таймаут истекает — соединение закрывается автоматически.

```typescript
private refreshIdleTimeout(connectionId: string) {
  this.clearIdleTimeout(connectionId);
  const timeout = setTimeout(() => {
    // Находим clientId по connectionId
    // Отправляем close
    // Чистим
  }, 30000);
  this.idleTimeouts.set(connectionId, timeout);
}
```

## Логирование

```typescript
// На каждое соединение ведётся статистика:
TCP example.com:80 — connected [a1b2c3d4]
TCP example.com:80 — closed ↑4096B ↓128B [a1b2c3d4]
```
