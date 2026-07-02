# 05 — Финальный туннель

Этот проект целиком. После предыдущих шагов всё становится понятно:

## Структура

- `local-proxy/` — код из шага 4, но с state machine вместо `once`
- `src/tunnel/` — сервер из шага 4, но с NestJS и нормальной архитектурой

## Что добавилось сверх шага 4

### 1. State machine для SOCKS5

Вместо цепочки `once` мы используем настоящий конечный автомат:

```typescript
type ParseState = 'greeting' | 'request_header' | 'request_addr' | 'relay';
```

Состояние хранится в объекте соединения. Новые данные добавляются в буфер,
автомат перебирает состояния, пока хватает данных.

### 2. Мультиплексирование через WsClient

WsClient хранит отдельные Map для каждого типа сообщения:

```
data:        Map<connectionId, DataHandler>
close:       Map<connectionId, CloseHandler>
connectResp: Map<connectionId, Callback>
...
```

### 3. UDP ASSOCIATE

Сложность UDP в том, что:
- Нужен отдельный UDP-релей на локал хосте (для браузера)
- Нужен отдельный UDP-релей на сервере (для внешнего мира)
- SOCKS5 добавляет свой заголовок к UDP датаграммам

```
Браузер → Local UDP Relay (SOCKS5 header) → WS → NestJS UDP → target DNS
           ↑                                                      ↓
           └──────── SOCKS5 response header ← WS ←──────────────┘
```

### 4. Обработка ошибок

| Ситуация | Что происходит |
|----------|---------------|
| WS отвалился | Local proxy переподключается, NestJS чистит сокеты |
| TCP connect failed (timeout 10s) | `connect_resp { success: false }`, браузер получает SOCKS5 error |
| TCP закрылся (FIN) | NestJS шлёт `{ event: close }` → local proxy закрывает SOCKS5-сокет |
| Браузер закрыл | local proxy шлёт `{ event: close }` → NestJS закрывает TCP |
| Idle 30s | Автоматический close, чистка ресурсов |

### 5. Деплой

- `Dockerfile` + `docker-compose.yml` + Caddy (авто SSL)
- `systemd` сервис как альтернатива
- WSS поддержка: `WS_SSL=true` меняет `ws://` на `wss://`

## Куда двигаться дальше

| Идея | Что нужно сделать |
|------|------------------|
| Аутентификация | Добавить `username/password` метод в SOCKS5 и WS токен |
| Шифрование трафика | Добавить свой crypto слой поверх WS |
| Балансировка | Несколько WS-соединений между local proxy и NestJS |
| Метрики | Prometheus endpoint с числом соединений/трафика |
| IPv6 поддержка | Уже частично есть (ATYP=0x04), нужно тестировать |
| SOCKS5 AUTH | Реализовать `05 02` (user/pass) в socks5-server.ts |
