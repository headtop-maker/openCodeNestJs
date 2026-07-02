import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import * as dgram from 'dgram';
import { WebSocket } from 'ws';

interface UdpRoute {
  clientId: string;
  connectionId: string;
}

interface ConnStats {
  host: string;
  port: number;
  upBytes: number;
  downBytes: number;
}

@Injectable()
export class TunnelService {
  private readonly logger = new Logger(TunnelService.name);

  private readonly tcpConnections = new Map<string, Map<string, net.Socket>>();
  private readonly connStats = new Map<string, ConnStats>();
  private readonly udpConnections = new Map<string, Map<string, dgram.Socket>>();
  private readonly udpRoutes = new Map<string, UdpRoute>();
  private readonly clientSockets = new Map<string, WebSocket>();
  private readonly clientConnectionIds = new Map<string, Set<string>>();
  private readonly idleTimeouts = new Map<string, NodeJS.Timeout>();

  private readonly IDLE_TIMEOUT_MS = 30000;

  registerClient(clientId: string, socket: WebSocket) {
    this.clientSockets.set(clientId, socket);
    this.tcpConnections.set(clientId, new Map());
    this.udpConnections.set(clientId, new Map());
    this.clientConnectionIds.set(clientId, new Set());
  }

  unregisterClient(clientId: string) {
    this.logger.log(`Cleaning up client: ${clientId}`);
    this.cleanupClient(clientId);
  }

  private cleanupClient(clientId: string) {
    const tcpMap = this.tcpConnections.get(clientId);
    if (tcpMap) {
      for (const [connId, socket] of tcpMap) {
        socket.destroy();
        this.clearIdleTimeout(connId);
      }
    }
    this.tcpConnections.delete(clientId);

    const udpMap = this.udpConnections.get(clientId);
    if (udpMap) {
      for (const [, socket] of udpMap) socket.close();
    }
    this.udpConnections.delete(clientId);

    for (const [key, route] of this.udpRoutes) {
      if (route.clientId === clientId) this.udpRoutes.delete(key);
    }

    this.clientSockets.delete(clientId);
    this.clientConnectionIds.delete(clientId);
  }

  private send(clientId: string, message: unknown) {
    const socket = this.clientSockets.get(clientId);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async createTcpConnection(
    clientId: string,
    connectionId: string,
    host: string,
    port: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let established = false;
      let settled = false;

      socket.connect(port, host, () => {
        established = true;
        settled = true;
        this.tcpConnections.get(clientId)?.set(connectionId, socket);
        this.clientConnectionIds.get(clientId)?.add(connectionId);
        this.connStats.set(connectionId, { host, port, upBytes: 0, downBytes: 0 });
        this.logger.log(`TCP ${host}:${port} — connected [${connectionId.slice(0,8)}]`);
        this.send(clientId, {
          event: 'connect_resp',
          data: { id: connectionId, success: true },
        });
        resolve();
      });

      socket.on('data', (data: Buffer) => {
        if (!established) return;
        const stats = this.connStats.get(connectionId);
        if (stats) stats.upBytes += data.length;
        this.refreshIdleTimeout(connectionId);
        this.send(clientId, {
          event: 'data',
          data: { id: connectionId, data: data.toString('base64') },
        });
      });

      socket.on('error', () => {
        if (!established && !settled) {
          settled = true;
          reject(new Error('Connection failed'));
        }
      });

      socket.on('close', () => {
        if (established) {
          if (this.tcpConnections.get(clientId)?.has(connectionId)) {
            const s = this.connStats.get(connectionId);
            this.logger.log(`TCP ${s ? `${s.host}:${s.port}` : '?'} — closed ↑${s?.upBytes ?? 0}B ↓${s?.downBytes ?? 0}B [${connectionId.slice(0,8)}]`);
            this.send(clientId, {
              event: 'close',
              data: { id: connectionId },
            });
            this.cleanupConnection(clientId, connectionId);
          }
        } else if (!settled) {
          settled = true;
          reject(new Error('Connection closed before established'));
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  writeToTcp(clientId: string, connectionId: string, dataBase64: string) {
    const tcpMap = this.tcpConnections.get(clientId);
    if (!tcpMap) return;
    const socket = tcpMap.get(connectionId);
    if (!socket || socket.destroyed) return;

    const buffer = Buffer.from(dataBase64, 'base64');
    const stats = this.connStats.get(connectionId);
    if (stats) stats.downBytes += buffer.length;
    socket.write(buffer);
    this.refreshIdleTimeout(connectionId);
  }

  closeTcp(clientId: string, connectionId: string) {
    const tcpMap = this.tcpConnections.get(clientId);
    if (!tcpMap) return;
    const socket = tcpMap.get(connectionId);
    if (socket) socket.end();
    this.cleanupConnection(clientId, connectionId);
  }

  async createUdpRelay(clientId: string, connectionId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');

      socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        const routeKey = `${rinfo.address}:${rinfo.port}`;
        const route = this.udpRoutes.get(routeKey);
        if (route?.clientId === clientId && route.connectionId === connectionId) {
          this.send(clientId, {
            event: 'udp_data',
            data: {
              id: connectionId,
              data: msg.toString('base64'),
              srcAddr: rinfo.address,
              srcPort: rinfo.port,
            },
          });
        }
      });

      socket.on('error', (err: Error) =>
        this.logger.error(`UDP relay[${connectionId}]: ${err.message}`),
      );

      socket.bind(0, '0.0.0.0', () => {
        const port = (socket.address() as { address: string; family: string; port: number }).port;
        this.udpConnections.get(clientId)?.set(connectionId, socket);
        this.clientConnectionIds.get(clientId)?.add(connectionId);
        resolve(port);
      });

      socket.on('error', reject);
    });
  }

  sendUdpData(
    clientId: string,
    connectionId: string,
    dataBase64: string,
    dstAddr: string,
    dstPort: number,
  ) {
    const udpMap = this.udpConnections.get(clientId);
    if (!udpMap) return;
    const socket = udpMap.get(connectionId);
    if (!socket) return;

    const buffer = Buffer.from(dataBase64, 'base64');
    this.udpRoutes.set(`${dstAddr}:${dstPort}`, { clientId, connectionId });

    socket.send(buffer, dstPort, dstAddr, (err) => {
      if (err) this.logger.error(`UDP send error: ${err.message}`);
    });
  }

  closeUdp(clientId: string, connectionId: string) {
    const udpMap = this.udpConnections.get(clientId);
    if (!udpMap) return;
    const socket = udpMap.get(connectionId);
    if (socket) socket.close();
    this.cleanupConnection(clientId, connectionId);
  }

  private cleanupConnection(clientId: string, connectionId: string) {
    this.tcpConnections.get(clientId)?.delete(connectionId);
    this.udpConnections.get(clientId)?.delete(connectionId);
    this.clientConnectionIds.get(clientId)?.delete(connectionId);
    this.connStats.delete(connectionId);
    this.clearIdleTimeout(connectionId);
    for (const [key, route] of this.udpRoutes) {
      if (route.clientId === clientId && route.connectionId === connectionId) {
        this.udpRoutes.delete(key);
      }
    }
  }

  private refreshIdleTimeout(connectionId: string) {
    this.clearIdleTimeout(connectionId);
    const timeout = setTimeout(() => {
      for (const [cId, connIds] of this.clientConnectionIds) {
        if (connIds.has(connectionId)) {
          this.send(cId, { event: 'close', data: { id: connectionId } });
          this.cleanupConnection(cId, connectionId);
          break;
        }
      }
    }, this.IDLE_TIMEOUT_MS);
    this.idleTimeouts.set(connectionId, timeout);
  }

  private clearIdleTimeout(connectionId: string) {
    const timeout = this.idleTimeouts.get(connectionId);
    if (timeout) {
      clearTimeout(timeout);
      this.idleTimeouts.delete(connectionId);
    }
  }
}
