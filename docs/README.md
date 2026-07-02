# WebSocket Tunnel + SOCKS5 Proxy — документация

## Содержание

### 1. Архитектура
- [01 — Общая схема](01-architecture/01-overview.md)
- [02 — Сервер (NestJS)](01-architecture/02-server-architecture.md)
- [03 — Клиент (Local Proxy)](01-architecture/03-client-architecture.md)

### 2. Компоненты
**Сервер:**
- [main.ts](02-components/server/01-main.md) — точка входа, WsAdapter
- [tunnel.module.ts](02-components/server/02-tunnel-module.md) — DI модуль
- [tunnel.gateway.ts](02-components/server/03-tunnel-gateway.md) — WebSocket, dispatch
- [tunnel.service.ts](02-components/server/04-tunnel-service.md) — TCP/UDP менеджер

**Клиент (Local Proxy):**
- [index.ts](02-components/client/01-index.md) — точка входа
- [ws-client.ts](02-components/client/02-ws-client.md) — WebSocket клиент
- [socks5-server.ts](02-components/client/03-socks5-server.md) — SOCKS5 протокол

### 3. Туториалы (от простого к сложному)
- [01 — TCP эхо-сервер](03-tutorial/01-simple-tcp-server.md)
- [02 — WebSocket сервер](03-tutorial/02-simple-websocket.md)
- [03 — SOCKS5 прокси](03-tutorial/03-simple-socks5.md)
- [04 — Объединение SOCKS5 + WS](03-tutorial/04-bridge-socks5-ws.md)
- [05 — Финальный туннель](03-tutorial/05-full-tunnel.md)

### 4. Сетевые основы
- [01 — TCP: потоки и сокеты](04-network-education/01-tcp-streams.md)
- [02 — SOCKS5: байтовый протокол](04-network-education/02-socks5-deep.md)
- [03 — WebSocket: фреймы и upgrade](04-network-education/03-websocket-deep.md)
- [04 — Мультиплексирование](04-network-education/04-multiplexing.md)
- [05 — Паттерны прокси](04-network-education/05-proxy-patterns.md)
- [06 — Перехват трафика](04-network-education/06-traffic-capture.md)

---

## Как читать

- **Новичок**: 3 → 4 → 1 → 2
- **Хочешь понять код**: 2 + открытые исходники рядом
- **Хочешь расширить проект**: 1 + 4 (архитектура + сетевые паттерны)
