# 03 — Простой SOCKS5 прокси

SOCKS5 — байтовый протокол поверх TCP. Разберём его на минимальном примере.

## Код

```typescript
import * as net from 'net';

const server = net.createServer((client) => {
  // === Фаза 1: Handshake ===
  client.once('data', (greeting) => {
    // greeting: 05 + NMETHODS + METHODS
    if (greeting[0] !== 0x05) { client.end(); return; }
    // Отвечаем: 05 + 00 (no auth)
    client.write(Buffer.from([0x05, 0x00]));

    // === Фаза 2: Request ===
    client.once('data', (request) => {
      // request: 05 + CMD + RSV + ATYP + DST.ADDR + DST.PORT
      const cmd = request[1];   // 1=CONNECT
      const atyp = request[3];  // 1=IPv4, 3=Domain

      let offset = 4;
      let dstAddr: string;

      if (atyp === 1) { // IPv4
        dstAddr = `${request[offset]}.${request[offset+1]}.${request[offset+2]}.${request[offset+3]}`;
        offset += 4;
      } else if (atyp === 3) { // Domain
        const len = request[offset++];
        dstAddr = request.subarray(offset, offset + len).toString();
        offset += len;
      } else {
        client.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0])); // not supported
        client.end();
        return;
      }

      const dstPort = request.readUInt16BE(offset);

      if (cmd === 1) {
        // === Фаза 3: CONNECT ===
        const target = net.createConnection(dstPort, dstAddr, () => {
          // Успех: 05 + 00 + RSV + ATYP + BND.ADDR + BND.PORT
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]));

          // Relay: client ↔ target
          client.pipe(target);
          target.pipe(client);
        });

        target.on('error', () => {
          client.write(Buffer.from([0x05, 0x04, 0x00, 0x01, 0,0,0,0, 0,0]));
          client.end();
        });
      } else {
        // Другие команды (UDP ASSOCIATE) не поддерживаем
        client.end();
      }
    });
  });
});

server.listen(1080, () => console.log('SOCKS5 на :1080'));

// Тест: curl --socks5-hostname 127.0.0.1:1080 http://example.com
```

## Что изменилось по сравнению с эхо-сервером

1. **Две фазы парсинга**: greeting → request
2. **Байтовый протокол**: читаем байты по смещениям
3. **Создание второго соединения**: `net.createConnection` к целевому хосту
4. **Relay через pipe**: `client.pipe(target); target.pipe(client)` — двусторонняя передача

## Почему в проекте не используется pipe

В реальном проекте между клиентом и сервером стоит WebSocket:

```
client (SOCKS5) → local-proxy → WebSocket → NestJS → target
```

Pipe не работает через WebSocket, поэтому мы:
1. Кодируем данные в base64
2. Отправляем как JSON сообщение
3. На другой стороне декодируем и пишем в TCP-сокет

## SOCKS5 REP коды

| Код | Значение |
|-----|----------|
| 0x00 | Успех |
| 0x01 | General SOCKS server failure |
| 0x02 | Connection not allowed by ruleset |
| 0x03 | Network unreachable |
| 0x04 | Host unreachable |
| 0x05 | Connection refused |
| 0x06 | TTL expired |
| 0x07 | Command not supported |
| 0x08 | Address type not supported |
