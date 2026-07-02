# Перехват трафика

## tcpdump

Сниффер пакетов. Показывает, что реально летит по сети.

```bash
# Весь трафик на порту 1080 (SOCKS5)
sudo tcpdump -i lo0 port 1080 -X

# Только SYN-пакеты на порту 8080 (WebSocket upgrade)
sudo tcpdump -i lo0 'tcp port 8080 and tcp[tcpflags] & tcp-syn != 0'

# Трафик с сервера к google.com
sudo tcpdump -i eth0 'host google.com' -X

# Сохранить в файл для анализа
sudo tcpdump -i lo0 port 1080 -w socks5.pcap
```

Флаг `-X` показывает содержимое пакетов в hex + ASCII.
`-i lo0` — интерфейс loopback (для localhost).
`-i eth0` — внешний интерфейс (на сервере).

## Wireshark

Открыть `.pcap` файлы в графическом интерфейсе.

```bash
# Записали на сервере
ssh root@server "tcpdump -i eth0 port 80 -w /tmp/traffic.pcap"
scp root@server:/tmp/traffic.pcap .
open traffic.pcap  # Откроется в Wireshark
```

В Wireshark можно:
- Фильтровать по протоколам (`tcp`, `http`, `socks`)
- Смотреть содержимое пакетов
- Следить за TCP-потоком (`Follow TCP Stream`)
- Анализировать задержки

## Что смотреть в нашем проекте

### 1. SOCKS5 handshake (localhost:1080)

```
sudo tcpdump -i lo0 port 1080 -X
```

Должны увидеть:
```
05 01 00        ← browser: greeting (VER + NMETHODS + METHOD)
05 00           ← proxy: response (VER + METHOD)
05 01 00 03 ... ← browser: CONNECT + domain
05 00 00 01 ... ← proxy: SUCCESS + address
```

### 2. WebSocket upgrade (localhost:8080)

```
sudo tcpdump -i lo0 port 8080 -A
```

Ищем `Upgrade: websocket` в HTTP-запросе.

### 3. TCP-трафик с сервера

```
# На сервере (45.9.116.71):
sudo tcpdump -i eth0 not port 22 and not port 8080
```

Увидим TCP-соединения от сервера к целевым хостам (google.com, example.com и т.д.).

## Логирование в самом проекте

На сервере NestJS логируются:
```json
TCP example.com:80 — connected [a1b2c3d4]
TCP example.com:80 — closed ↑4096B ↓128B [a1b2c3d4]
```

Достаточно следить за логами:

```bash
# Docker
docker compose logs -f tunnel

# systemd
journalctl -u tunnel-server -f
```

## mitmproxy (альтернатива для HTTP/HTTPS)

Если нужно не просто перехватить, но и модифицировать трафик:

```bash
pip install mitmproxy
mitmproxy --listen-port 8081 --mode socks5
# Настроить браузер на SOCKS5 127.0.0.1:8081
```

Но mitmproxy требует установки SSL-сертификата для HTTPS.

## Проверка: действительно ли трафик идёт через сервер?

```bash
# 1. На сервере смотрим логи
docker compose logs -f tunnel

# 2. На сервере смотрим tcpdump
sudo tcpdump -i eth0 port 80 -n

# 3. В браузере открываем http://whatsmyip.org
# Если в ответе IP сервера (45.9.116.71) — трафик идёт через туннель
```
