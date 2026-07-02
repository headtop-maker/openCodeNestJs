import 'dotenv/config';
import { Socks5Server } from './socks5-server';
import { WsClient } from './ws-client';

const WS_SSL = process.env.WS_SSL === 'true';
const WS_HOST = process.env.WS_HOST || 'localhost';
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const WS_URL = process.env.WS_URL || `${WS_SSL ? 'wss' : 'ws'}://${WS_HOST}:${WS_PORT}`;
const SOCKS5_PORT = parseInt(process.env.SOCKS5_PORT || '1080', 10);

const wsClient = new WsClient(WS_URL);
const socks5Server = new Socks5Server(wsClient);

wsClient.connect();
socks5Server.start(SOCKS5_PORT);

console.log(`[Local Proxy] Started`);
console.log(`  SOCKS5  : 0.0.0.0:${SOCKS5_PORT}`);
console.log(`  WS URL  : ${WS_URL}`);

process.on('SIGINT', () => {
  console.log('\n[Local Proxy] Shutting down...');
  socks5Server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  socks5Server.stop();
  process.exit(0);
});
