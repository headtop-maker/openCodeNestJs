# main.ts — точка входа

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = parseInt(process.env.PORT || '8080', 10);
  await app.listen(port);
  console.log(`NestJS tunnel server listening on port ${port}`);
}
bootstrap();
```

## Что происходит

1. **NestFactory.create(AppModule)** — создаёт Nest-приложение с модулем `AppModule`, который импортирует `TunnelModule`.
2. **WsAdapter** — подключает адаптер для `@nestjs/websockets` на библиотеке `ws` (нативный WebSocket, не Socket.IO). Без этого вызова `@WebSocketGateway()` не будет работать.
3. **app.listen(port)** — запускает HTTP-сервер на указанном порту. WsAdapter автоматически прикрепляет `ws.Server` к этому HTTP-серверу.
4. **PORT** — читается из `process.env`, по умолчанию `8080`.

## Как работает WsAdapter

```typescript
// Упрощённо:
// 1. Создаёт ws.Server, привязанный к HTTP-серверу NestJS
// 2. При подключении клиента вызывает handleConnection() у Gateway
// 3. При сообщении парсит JSON и ищет обработчик по полю event
// 4. Результат обработчика отправляет обратно через client.send()
```

В нашем проекте мы не используем встроенный dispatch по event, а обрабатываем сообщения вручную в `handleConnection`, потому что:
- Нужен полный контроль над маршрутизацией
- Не хотим зависеть от версии NestJS и деталей реализации WsAdapter
