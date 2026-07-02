# local-proxy/src/index.ts — точка входа

```typescript
import 'dotenv/config';
import { Socks5Server } from './socks5-server';
import { WsClient } from './ws-client';

const WS_SSL = process.env.WS_SSL === 'true';
const WS_HOST = process.env.WS_HOST || 'localhost';
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const WS_URL = process.env.WS_URL || `${WS_SSL ? 'wss' : 'ws'}://${WS_HOST}:${WS_PORT}`;
const SOCKS5_PORT = parseInt(process.env.SOCKS5_PORT || '1080', 10);

const wsClient = new WsClient(WS_URL);
const socks5Server = new Socks5Server(wsClient);

wsClient.connect();
socks5Server.start(SOCKS5_PORT);
```

## Что делает

1. **dotenv/config** — автоматически загружает `.env` файл в `process.env`
2. **Определяет параметры подключения**:
   - `WS_URL` — полный URL WebSocket сервера (приоритет)
   - `WS_HOST` + `WS_PORT` + `WS_SSL` — собрать URL вручную
   - `SOCKS5_PORT` — на каком порту слушать SOCKS5
3. **Создаёт компоненты**:
   - `WsClient` — клиент к NestJS
   - `Socks5Server` — SOCKS5 сервер
4. **Запускает**:
   - `wsClient.connect()` — подключается к NestJS
   - `socks5Server.start()` — начинает слушать SOCKS5 запросы

## Конфигурация через .env

```bash
# Минимальная
WS_HOST=45.9.116.71

# С HTTPS
WS_SSL=true
WS_HOST=tunnel.example.com

# Полный URL (переопределяет всё)
WS_URL=wss://tunnel.example.com
```
