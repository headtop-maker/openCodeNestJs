# messages.interface.ts — типы сообщений

```typescript
export type Atyp = 0x01 | 0x03 | 0x04;
```

## Интерфейсы

### ConnectData — запрос на TCP-соединение

```typescript
export interface ConnectData {
  id: string;        // UUID сессии
  dstAddr: string;   // IP или домен
  dstPort: number;   // Порт
  atyp: Atyp;        // Тип адреса (1=IPv4, 3=Domain, 4=IPv6)
}
```

### DataPayload — потоковые данные

```typescript
export interface DataPayload {
  id: string;        // ID сессии
  data: string;      // Данные в base64
}
```

### ClosePayload — закрытие сессии

```typescript
export interface ClosePayload {
  id: string;
}
```

### UdpDataPayload — UDP датаграмма

```typescript
export interface UdpDataPayload {
  id: string;
  data: string;       // base64
  atyp?: Atyp;        // Тип адреса назначения
  dstAddr?: string;   // Куда (от клиента)
  dstPort?: number;
  srcAddr?: string;   // Откуда (к клиенту, ответ)
  srcPort?: number;
}
```
