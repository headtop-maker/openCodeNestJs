# tunnel.module.ts — DI модуль

```typescript
import { Module } from '@nestjs/common';
import { TunnelGateway } from './tunnel.gateway';
import { TunnelService } from './tunnel.service';

@Module({
  providers: [TunnelGateway, TunnelService],
})
export class TunnelModule {}
```

## Роль

Связывает `TunnelGateway` и `TunnelService` через DI.

- `TunnelGateway` — WebSocket слой (зависит от TunnelService)
- `TunnelService` — бизнес-логика (не зависит от Gateway)

NestJS автоматически внедрит `TunnelService` в `TunnelGateway` через конструктор.
