# Мультиплексирование

## Проблема

У нас **одно** WebSocket-соединение между Local Proxy и NestJS.
Через него проходят данные от **множества** SOCKS5-сессий (вкладки браузера, запросы).

Как отличить данные для одной сессии от данных для другой?

## Решение: connectionId (UUID)

Каждая SOCKS5-сессия получает уникальный `connectionId`. Все сообщения через WS
содержат этот ID, и на обеих сторонах есть Map, который связывает ID → сокет.

```
WS соединение:
  ┌─────────────────────────────────────────┐
  │ { event: 'connect', data: { id: 'A' }}  │ ← Вкладка 1
  │ { event: 'connect', data: { id: 'B' }}  │ ← Вкладка 2
  │ { event: 'data',    data: { id: 'A' }}  │ ← Данные для вкладки 1
  │ { event: 'data',    data: { id: 'B' }}  │ ← Данные для вкладки 2
  │ { event: 'close',   data: { id: 'A' }}  │ ← Вкладка 1 закрыта
  └─────────────────────────────────────────┘
```

## Структуры данных

**На сервере (NestJS):**

```typescript
// Уровень 1: группировка по WebSocket-клиентам
tcpConnections: Map<clientId, Map<connectionId, net.Socket>>

// Уровень 2: конкретное TCP-соединение
  clientA: Map {
    'aaaa' → Socket (google.com:80)
    'bbbb' → Socket (example.com:443)
  }
  clientB: Map {
    'cccc' → Socket (youtube.com:80)
  }
```

Когда приходит `{ event: 'data', data: { id: 'aaaa', data: '...' } }`:
1. Находим клиента (сообщение пришло на его WS)
2. Находим сокет по ID 'aaaa'
3. Пишем данные в сокет

**На клиенте (Local Proxy):**

```typescript
handlers: {
  data: Map<connectionId, DataHandler>,
  close: Map<connectionId, CloseHandler>,
  connectResp: Map<connectionId, Callback>,
  // ...
}
```

Когда приходит `{ event: 'data', data: { id: 'aaaa', data: '...' } }`:
1. Берём handler из `handlers.data.get('aaaa')`
2. Вызываем: `handler(data)` → пишем в SOCKS5-сокет

## Зачем два уровня (clientId → connectionId)

На сервере может быть **несколько** Local Proxy клиентов (разные пользователи,
каждый со своим браузером). У каждого свой `clientId`.

Если бы был только `connectionId`, то при отключении одного клиента пришлось бы
перебирать все connectionId в поиске тех, что принадлежат ему.

С двухуровневой структурой:

```typescript
unregisterClient(clientId: string) {
  // Просто берём Map этого клиента и закрываем всё
  const tcpMap = this.tcpConnections.get(clientId);
  for (const [_, socket] of tcpMap) socket.destroy();
  this.tcpConnections.delete(clientId);
  // + чистка UDP, таймаутов, роутов
}
```

## Альтернатива: отдельное WS-соединение на сессию

Можно было бы открывать новое WS-соединение для каждой SOCKS5-сессии.
Это проще (не нужно мультиплексирование), но:

| Одно WS-соединение | WS на сессию |
|--------------------|--------------|
| + Меньше накладных расходов | - Много соединений |
| + Один TLS handshake | - N TLS handshake |
| + Проще reconnect | - Сложнее reconnect |
| - Сложнее код | + Код проще |

Выбор одного соединения — правильное решение для production.
