# local-proxy/src/messages.ts — типы

```typescript
export type Atyp = 0x01 | 0x03 | 0x04;

export interface Socks5Request {
  cmd: number;    // 0x01=CONNECT, 0x03=UDP
  atyp: Atyp;     // Тип адреса
  dstAddr: string;
  dstPort: number;
}
```

Тип `Atyp` используется и на сервере (`messages.interface.ts`) и на клиенте
для единообразия при отправке сообщений через WebSocket.
