# socks5-server.ts — SOCKS5 протокол

## Назначение

Реализует SOCKS5 прокси-сервер, который принимает запросы от браузера и
передаёт их через WebSocket в NestJS.

## Структура

```typescript
// Функции-утилиты для работы с байтами SOCKS5

function buildSocks5Reply(rep, bndAddr?, bndPort?) → Buffer
function parseSocks5UdpHeader(data) → { frag, atyp, dstAddr, dstPort, payload }
function buildSocks5UdpResponse(payload, srcAddr, srcPort) → Buffer

// Класс — одно SOCKS5-соединение

class Socks5Connection {
  private buf: Buffer;       // Буфер для парсинга
  private state: ParseState; // Текущая фаза
  private pendingReq;        // cmd + atyp
  private connectionId;      // UUID сессии
}

class Socks5Server {
  start(port) → net.Server
  stop()
}
```

## Конечный автомат парсинга

```
GREETING ──► REQUEST_HEADER ──► REQUEST_ADDR ──► RELAY
    1              2                 3               4
```

### Фаза 1: GREETING

```typescript
parseGreeting() {
  // Ожидаем минимум 3 байта: VER + NMETHODS + METHODS
  if (buf.length < 3) return false;
  if (buf[0] !== 0x05) { socket.end(); return false; }
  
  // nmethods = buf[1]
  // Ждём все methods
  if (buf.length < 2 + nmethods) return false;
  
  // Отвечаем: 0x05 + 0x00 (no auth)
  socket.write(Buffer.from([0x05, 0x00]));
  
  // Переходим к следующей фазе
  state = 'request_header';
}
```

### Фаза 2: REQUEST_HEADER

```typescript
parseRequestHeader() {
  // Читаем: VER + CMD + RSV + ATYP
  cmd = buf[1];   // 0x01=CONNECT, 0x03=UDP
  atyp = buf[3];  // 0x01=IPv4, 0x03=Domain, 0x04=IPv6
  
  state = 'request_addr';
}
```

### Фаза 3: REQUEST_ADDR

```typescript
parseRequestAddr() {
  switch (atyp) {
    case 0x01: // IPv4 — 4 байта
      dstAddr = `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
      offset = 4;
      break;
    case 0x03: // Domain — len(1) + строка
      len = buf[0];
      dstAddr = buf.subarray(1, 1+len).toString();
      offset = 1 + len;
      break;
    case 0x04: // IPv6 — 16 байт
      // ... преобразование в hex:hex:...:hex
      offset = 16;
      break;
  }
  dstPort = buf.readUInt16BE(offset);
  
  if (cmd === 0x01) handleConnect(dstAddr, dstPort, atyp);
  if (cmd === 0x03) handleUdpAssociate();
}
```

### Фаза 4: RELAY

Прозрачная передача данных без парсинга.

## TCP CONNECT

```typescript
handleConnect(dstAddr, dstPort, atyp) {
  // 1. Генерируем ID сессии
  connectionId = crypto.randomUUID();
  
  // 2. Отправляем запрос через WebSocket
  wsClient.sendConnect(connectionId, dstAddr, dstPort, atyp);
  
  // 3. Ждём ответ
  wsClient.onConnectResp(connectionId, (success) => {
    if (success) {
      // 4. Отвечаем браузеру: 0x05 + 0x00 (успех)
      socket.write(buildSocks5Reply(0x00));
      
      // 5. Начинаем relay
      startTcpRelay(connectionId);
    } else {
      // Ошибка: 0x05 + 0x04 (host unreachable)
      socket.write(buildSocks5Reply(0x04));
      socket.end();
    }
  });
}
```

### Relay

```typescript
startTcpRelay(connectionId) {
  // Browser → Local Proxy → WS → NestJS → Target
  socket.on('data', (data) => {
    wsClient.sendData(connectionId, data.toString('base64'));
  });
  
  // Target → NestJS → WS → Local Proxy → Browser
  wsClient.onData(connectionId, (dataBase64) => {
    if (!socket.destroyed)
      socket.write(Buffer.from(dataBase64, 'base64'));
  });
  
  // Browser закрыл
  socket.on('end', () => wsClient.sendClose(connectionId));
  
  // Target закрыл
  wsClient.onClose(connectionId, () => socket.end());
}
```

## UDP ASSOCIATE

```typescript
handleUdpAssociate() {
  // 1. Создаём локальный UDP relay на случайном порту
  const udpRelay = dgram.createSocket('udp4');
  udpRelay.bind(0, '127.0.0.1', () => {
    const localPort = udpRelay.address().port;
    
    // 2. Отвечаем браузеру с BND.ADDR=127.0.0.1 и портом релея
    socket.write(buildSocks5Reply(0x00, '127.0.0.1', localPort));
    
    // 3. Когда браузер шлёт датаграмму:
    udpRelay.on('message', (msg, rinfo) => {
      // Парсим SOCKS5 UDP header
      const parsed = parseSocks5UdpHeader(msg);
      if (parsed.frag !== 0) return; // Фрагментацию не поддерживаем
      
      // Запоминаем адрес браузера для ответов
      _browserAddr = rinfo;
      
      // Отправляем через WebSocket
      wsClient.sendUdpData(connectionId, parsed.payload, parsed.atyp,
        parsed.dstAddr, parsed.dstPort);
    });
    
    // 4. Когда ответ приходит с сервера:
    wsClient.onUdpData(connectionId, (data, srcAddr, srcPort) => {
      // Оборачиваем в SOCKS5 UDP response header
      const resp = buildSocks5UdpResponse(Buffer.from(data, 'base64'), srcAddr, srcPort);
      
      // Отправляем обратно браузеру
      udpRelay.send(resp, _browserAddr.port, _browserAddr.address);
    });
  });
}
```

### SOCKS5 UDP header

```
Запрос (Browser → Local Proxy):
┌────┬────┬────┬────┬──────────┬──────────┬──────────┐
│ RSV│ RSV│FRAG│ATYP│ DST.ADDR │ DST.PORT │   DATA   │
│  0 │  0 │  0 │ 01 │ 4 байта  │ 2 байта  │  ...     │
└────┴────┴────┴────┴──────────┴──────────┴──────────┘

Ответ (Local Proxy → Browser):
┌────┬────┬────┬────┬──────────┬──────────┬──────────┐
│ RSV│ RSV│FRAG│ATYP│ SRC.ADDR │ SRC.PORT │   DATA   │
│  0 │  0 │  0 │ 01 │ 4 байта  │ 2 байта  │  ...     │
└────┴────┴────┴────┴──────────┴──────────┴──────────┘
```
