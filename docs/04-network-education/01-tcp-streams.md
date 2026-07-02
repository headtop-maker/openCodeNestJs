# TCP: потоки и сокеты

## Что такое TCP-сокет

TCP-сокет — это двусторонний канал между двумя программами.
В Node.js это `net.Socket` — дуплексный поток (Readable + Writable).

```
┌────────────────┐          TCP           ┌────────────────┐
│  Приложение A  │◄──────────────────────►│  Приложение B  │
│  net.Socket    │    segments/пакеты      │  net.Socket    │
└────────────────┘                        └────────────────┘
```

## События socket'a

```typescript
const socket = new net.Socket();

// 1. Подключение
socket.connect(80, 'example.com', () => {
  console.log('Соединение установлено');
});

// 2. Получение данных
socket.on('data', (chunk: Buffer) => {
  // chunk — кусок данных (может быть меньше или больше одного сообщения)
  console.log(`Получено ${chunk.length} байт`);
});

// 3. Закрытие (FIN от удалённой стороны)
socket.on('end', () => {
  console.log('Удалённая сторона закрыла соединение');
});

// 4. Полное закрытие (сокет уничтожен)
socket.on('close', () => {
  console.log('Сокет полностью закрыт');
});

// 5. Ошибка
socket.on('error', (err) => {
  console.error('Ошибка:', err.message);
});
```

## Разница между end и close

- **`end`** — удалённая сторона отправила FIN (половина соединения закрыта)
- **`close`** — сокет полностью закрыт (все ресурсы освобождены)

Обычно `end` → `close` (но close вызывается всегда, end — только при нормальном завершении).

## Backpressure (обратное давление)

Когда `socket.write()` вызывается быстрее, чем данные отправляются по сети,
внутренний буфер заполняется. Node.js возвращает `false` из `write()`,
сигнализируя о необходимости приостановить запись:

```typescript
const canWrite = socket.write(data);
if (!canWrite) {
  // Приостанавливаем чтение из источника
  source.pause();
  socket.once('drain', () => {
    // Буфер опустел — можно продолжать
    source.resume();
  });
}
```

**В проекте:** в `tunnel.service.ts` `writeToTcp` не обрабатывает backpressure.
Для production это стоит добавить — если `socket.write()` возвращает `false`,
нужно приостановить чтение из WS и возобновить по событию `drain`.

## TCP в нашем проекте

| Файл | Что делает с TCP |
|------|-----------------|
| `socks5-server.ts` | `net.createServer()` — SOCKS5 сервер |
| `tunnel.service.ts` | `new net.Socket()` + `connect()` — подключение к target |

## Полезные команды

```bash
# Просмотр TCP-соединений
lsof -i :1080          # Кто слушает порт 1080
netstat -an | grep 1080  # Состояние соединений

# tcpdump трафика
sudo tcpdump -i lo0 port 1080 -X
# -X покажет содержимое пакетов в hex+ascii
```
