import * as net from 'net';
import * as dgram from 'dgram';
import * as crypto from 'crypto';
import { WsClient } from './ws-client';
import { Atyp } from './messages';

type ParseState = 'greeting' | 'request_header' | 'request_addr' | 'relay';
interface PendingReq { cmd: number; atyp: Atyp }

function buildSocks5Reply(rep: number, bndAddr?: string, bndPort?: number): Buffer {
  const parts = (bndAddr || '0.0.0.0').split('.');
  const buf = Buffer.alloc(10);
  buf[0] = 0x05; buf[1] = rep; buf[2] = 0x00; buf[3] = 0x01;
  for (let i = 0; i < 4; i++) buf[4 + i] = parseInt(parts[i]) || 0;
  buf.writeUInt16BE(bndPort || 0, 8);
  return buf;
}

function parseSocks5UdpHeader(data: Buffer): { frag: number; atyp: Atyp; dstAddr: string; dstPort: number; payload: Buffer } | null {
  if (data.length < 6) return null;
  const frag = data[2];
  const atyp = data[3] as Atyp;
  let offset = 4, dstAddr: string;
  switch (atyp) {
    case 0x01:
      if (offset + 4 > data.length) return null;
      dstAddr = `${data[offset]}.${data[offset+1]}.${data[offset+2]}.${data[offset+3]}`;
      offset += 4;
      break;
    case 0x03: {
      if (offset + 1 > data.length) return null;
      const len = data[offset++];
      if (offset + len > data.length) return null;
      dstAddr = data.subarray(offset, offset + len).toString();
      offset += len;
      break;
    }
    case 0x04:
      if (offset + 16 > data.length) return null;
      dstAddr = Array.from({ length: 8 }, (_, i) => data.subarray(offset + i * 2, offset + i * 2 + 2).toString('hex')).join(':');
      offset += 16;
      break;
    default: return null;
  }
  if (offset + 2 > data.length) return null;
  const dstPort = data.readUInt16BE(offset);
  offset += 2;
  return { frag, atyp, dstAddr, dstPort, payload: data.subarray(offset) };
}

function buildSocks5UdpResponse(payload: Buffer, srcAddr: string, srcPort: number): Buffer {
  const parts = srcAddr.split('.');
  const addrBuf = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) addrBuf[i] = parseInt(parts[i]) || 0;
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(srcPort);
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), addrBuf, portBuf, payload]);
}

class Socks5Connection {
  private buf = Buffer.alloc(0);
  private state: ParseState = 'greeting';
  private pendingReq: PendingReq | null = null;
  private connectionId: string | null = null;

  constructor(
    private readonly socket: net.Socket,
    private readonly wsClient: WsClient,
  ) {
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.cleanup());
    socket.on('close', () => this.cleanup());
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.process();
  }

  private process() {
    while (true) {
      switch (this.state) {
        case 'greeting': if (!this.parseGreeting()) return; break;
        case 'request_header': if (!this.parseRequestHeader()) return; break;
        case 'request_addr': if (!this.parseRequestAddr()) return; break;
        case 'relay': return;
      }
    }
  }

  private parseGreeting(): boolean {
    if (this.buf.length < 3) return false;
    if (this.buf[0] !== 0x05) { this.socket.end(); return false; }
    const nmethods = this.buf[1];
    if (this.buf.length < 2 + nmethods) return false;
    this.socket.write(Buffer.from([0x05, 0x00]));
    this.buf = this.buf.subarray(2 + nmethods);
    this.state = 'request_header';
    return true;
  }

  private parseRequestHeader(): boolean {
    if (this.buf.length < 5) return false;
    if (this.buf[0] !== 0x05) { this.socket.end(); return false; }
    this.pendingReq = { cmd: this.buf[1], atyp: this.buf[3] as Atyp };
    this.buf = this.buf.subarray(4);
    this.state = 'request_addr';
    return true;
  }

  private parseRequestAddr(): boolean {
    const req = this.pendingReq;
    if (!req) return false;

    let addrLen: number;
    switch (req.atyp) {
      case 0x01: addrLen = 4; break;
      case 0x03:
        if (this.buf.length < 1) return false;
        addrLen = 1 + this.buf[0];
        break;
      case 0x04: addrLen = 16; break;
      default: this.socket.end(); return false;
    }

    const totalNeeded = addrLen + 2;
    if (this.buf.length < totalNeeded) return false;

    let dstAddr: string;
    let offset = 0;

    if (req.atyp === 0x01) {
      dstAddr = `${this.buf[offset]}.${this.buf[offset+1]}.${this.buf[offset+2]}.${this.buf[offset+3]}`;
      offset += 4;
    } else if (req.atyp === 0x03) {
      const len = this.buf[offset++];
      dstAddr = this.buf.subarray(offset, offset + len).toString();
      offset += len;
    } else {
      dstAddr = Array.from({ length: 8 }, (_, i) =>
        this.buf.subarray(offset + i * 2, offset + i * 2 + 2).toString('hex'),
      ).join(':');
      offset += 16;
    }

    const dstPort = this.buf.readUInt16BE(offset);
    this.buf = this.buf.subarray(totalNeeded);
    this.state = 'relay';

    if (req.cmd === 0x01) this.handleConnect(dstAddr, dstPort, req.atyp);
    else if (req.cmd === 0x03) this.handleUdpAssociate();
    else { this.socket.write(buildSocks5Reply(0x07)); this.socket.end(); }
    return true;
  }

  private handleConnect(dstAddr: string, dstPort: number, atyp: Atyp) {
    const connectionId = crypto.randomUUID();
    this.connectionId = connectionId;
    this.wsClient.sendConnect(connectionId, dstAddr, dstPort, atyp);

    const removeResp = this.wsClient.onConnectResp(connectionId, (success) => {
      removeResp();
      if (success) {
        this.socket.write(buildSocks5Reply(0x00));
        this.startTcpRelay(connectionId);
      } else {
        this.socket.write(buildSocks5Reply(0x04));
        this.socket.end();
      }
    });
  }

  private startTcpRelay(connectionId: string) {
    const onSocksData = (data: Buffer) => this.wsClient.sendData(connectionId, data.toString('base64'));
    const onSocksEnd = () => { this.wsClient.sendClose(connectionId); this.socket.removeListener('data', onSocksData); };

    this.socket.on('data', onSocksData);
    this.socket.on('end', onSocksEnd);
    this.socket.on('error', onSocksEnd);

    const removeData = this.wsClient.onData(connectionId, (dataBase64) => {
      if (!this.socket.destroyed) this.socket.write(Buffer.from(dataBase64, 'base64'));
    });
    const removeClose = this.wsClient.onClose(connectionId, () => {
      if (!this.socket.destroyed) this.socket.end();
    });

    const cleanup = () => { removeData(); removeClose(); this.wsClient.cleanupConnection(connectionId); };
    this.socket.on('close', cleanup);
  }

  private handleUdpAssociate() {
    const connectionId = crypto.randomUUID();
    this.connectionId = connectionId;
    this.wsClient.sendUdpAssociate(connectionId);

    const removeResp = this.wsClient.onUdpResp(connectionId, (success) => {
      removeResp();
      if (!success) {
        this.socket.write(buildSocks5Reply(0x04));
        this.socket.end();
        return;
      }

      const udpRelay = dgram.createSocket('udp4');
      udpRelay.bind(0, '127.0.0.1', () => {
        const localPort = (udpRelay.address() as { address: string; family: string; port: number }).port;
        this.socket.write(buildSocks5Reply(0x00, '127.0.0.1', localPort));

        udpRelay.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
          const parsed = parseSocks5UdpHeader(msg);
          if (!parsed || parsed.frag !== 0) return;
          (udpRelay as any)._browserAddr = rinfo;
          this.wsClient.sendUdpData(connectionId, parsed.payload.toString('base64'), parsed.atyp, parsed.dstAddr, parsed.dstPort);
        });

        udpRelay.on('error', () => {});

        const removeUdpData = this.wsClient.onUdpData(connectionId, (dataBase64, srcAddr, srcPort) => {
          const browserAddr = (udpRelay as any)._browserAddr as dgram.RemoteInfo | undefined;
          if (!browserAddr) return;
          const payload = Buffer.from(dataBase64, 'base64');
          udpRelay.send(buildSocks5UdpResponse(payload, srcAddr, srcPort), browserAddr.port, browserAddr.address);
        });

        this.socket.on('close', () => { removeUdpData(); this.wsClient.sendClose(connectionId); udpRelay.close(); this.wsClient.cleanupConnection(connectionId); });
      });
    });
  }

  private cleanup() {
    if (this.connectionId) this.wsClient.cleanupConnection(this.connectionId);
  }
}

export class Socks5Server {
  private server: net.Server | null = null;

  constructor(private readonly wsClient: WsClient) {}

  start(port: number = 1080) {
    this.server = net.createServer((socket) => new Socks5Connection(socket, this.wsClient));
    this.server.listen(port, '0.0.0.0', () => console.log(`[SOCKS5] Listening on 0.0.0.0:${port}`));
  }

  stop() { this.server?.close(); }
}
