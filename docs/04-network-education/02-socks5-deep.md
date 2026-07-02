# SOCKS5: байтовый протокол

SOCKS5 (RFC 1928) — протокол для проксирования TCP и UDP через прокси-сервер.

## Формат байтов — всё вручную

В отличие от HTTP, где есть заголовки и парсеры, SOCKS5 — сырой байтовый протокол.
Каждый байт имеет значение, и мы читаем их по смещениям.

## 1. Handshake (согласование)

```
Клиент → Сервер:
┌──────┬──────────┬───────────┐
│ VER  │ NMETHODS │  METHODS  │
│ 0x05 │   0x01   │   0x00    │ = всего 3 байта (no auth)
│ 0x05 │   0x02   │ 0x00 0x02 │ = 4 байта (no auth + user/pass)
└──────┴──────────┴───────────┘

Сервер → Клиент:
┌──────┬──────────┐
│ VER  │  METHOD  │
│ 0x05 │   0x00   │ = no auth принят
│ 0x05 │   0xFF   │ = ни один метод не подошёл
└──────┴──────────┘
```

Парсинг в коде:
```typescript
const ver = data[0];        // Должен быть 0x05
const nmethods = data[1];   // Сколько методов предложено
const methods = data.subarray(2, 2 + nmethods); // Список методов
```

## 2. Request (CONNECT)

```
Клиент → Сервер:
┌──────┬──────┬──────┬──────┬──────────┬──────────┐
│ VER  │ CMD  │ RSV  │ ATYP │ DST.ADDR │ DST.PORT │
│ 0x05 │ 0x01 │ 0x00 │ 0x01 │  4 байта │ 2 байта  │
└──────┴──────┴──────┴──────┴──────────┴──────────┘

CMD:
  0x01 = CONNECT (TCP)
  0x03 = UDP ASSOCIATE

ATYP:
  0x01 = IPv4 (4 байта)
  0x03 = Domain (1 байт длина + строка)
  0x04 = IPv6 (16 байт)
```

Парсинг адреса:
```typescript
const cmd = data[1];
const atyp = data[3];

let offset = 4;
let addr: string;

if (atyp === 0x01) { // IPv4
  addr = `${data[offset]}.${data[offset+1]}.${data[offset+2]}.${data[offset+3]}`;
  offset += 4;
} else if (atyp === 0x03) { // Domain
  const len = data[offset++];
  addr = data.subarray(offset, offset + len).toString();
  offset += len;
}

const port = data.readUInt16BE(offset);
```

## 3. Reply (ответ)

```
Сервер → Клиент:
┌──────┬──────┬──────┬──────┬──────────┬──────────┐
│ VER  │ REP  │ RSV  │ ATYP │ BND.ADDR │ BND.PORT │
│ 0x05 │ 0x00 │ 0x00 │ 0x01 │ 4 байта  │ 2 байта  │
└──────┴──────┴──────┴──────┴──────────┴──────────┘
```

Формируем ответ:
```typescript
function buildReply(rep: number): Buffer {
  const buf = Buffer.alloc(10); // IPv4: 4+2+4 = 10 байт
  buf[0] = 0x05;     // VER
  buf[1] = rep;      // REP (0x00 = success)
  buf[2] = 0x00;     // RSV
  buf[3] = 0x01;     // ATYP (IPv4)
  // BND.ADDR = 0.0.0.0 (4 байта)
  buf[4] = 0; buf[5] = 0; buf[6] = 0; buf[7] = 0;
  // BND.PORT = 0
  buf.writeUInt16BE(0, 8);
  return buf;
}
```

## 4. UDP ASSOCIATE

Для UDP SOCKS5 определяет специальный заголовок, который добавляется к каждой датаграмме:

```
UDP запрос (клиент → relay):
┌──────┬──────┬──────┬──────┬──────────┬──────────┬──────────┐
│ RSV  │ RSV  │ FRAG │ ATYP │ DST.ADDR │ DST.PORT │   DATA   │
│ 0x00 │ 0x00 │ 0x00 │ 0x01 │ 4 байта  │ 2 байта  │  ...     │
└──────┴──────┴──────┴──────┴──────────┴──────────┴──────────┘

UDP ответ (relay → клиент):
┌──────┬──────┬──────┬──────┬──────────┬──────────┬──────────┐
│ RSV  │ RSV  │ FRAG │ ATYP │ SRC.ADDR │ SRC.PORT │   DATA   │
│ 0x00 │ 0x00 │ 0x00 │ 0x01 │ 4 байта  │ 2 байта  │  ...     │
└──────┴──────┴──────┴──────┴──────────┴──────────┴──────────┘
```

FRAG — фрагментация (мы не поддерживаем, только FRAG=0).
В ответе вместо DST.ADDR/PORT указывается SRC.ADDR/PORT — кто отправил оригинальный ответ.

## Разбор UDP заголовка в коде

```typescript
function parseSocks5UdpHeader(data: Buffer) {
  const frag = data[2];
  const atyp = data[3];
  let offset = 4, dstAddr;

  if (atyp === 1) { // IPv4
    dstAddr = `${data[offset]}.${data[offset+1]}.${data[offset+2]}.${data[offset+3]}`;
    offset += 4;
  } else if (atyp === 3) { // Domain
    const len = data[offset++];
    dstAddr = data.subarray(offset, offset + len).toString();
    offset += len;
  }

  const dstPort = data.readUInt16BE(offset);
  offset += 2;
  const payload = data.subarray(offset); // Остаток — реальные данные

  return { frag, atyp, dstAddr, dstPort, payload };
}
```

## Зачем всё это знать

В проекте нет готовой SOCKS5-библиотеки. Мы написали парсер сами, потому что:
1. Нужен полный контроль над каждым байтом (чтобы пересылать через WS)
2. Хотим минимальные зависимости
3. SOCKS5 — простой протокол, его можно реализовать за вечер
