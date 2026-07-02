import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { TunnelService } from './tunnel.service';
import { Atyp } from './messages.interface';
import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@WebSocketGateway()
export class TunnelGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TunnelGateway.name);

  constructor(private readonly tunnelService: TunnelService) {}

  handleConnection(client: WebSocket) {
    const clientId = crypto.randomUUID();
    (client as any).clientId = clientId;
    this.tunnelService.registerClient(clientId, client);
    this.logger.log(`Client connected: ${clientId}`);

    client.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.dispatch(client, msg);
      } catch (err: any) {
        this.logger.warn(`Invalid message from ${clientId}: ${err.message}`);
      }
    });
  }

  handleDisconnect(client: WebSocket) {
    const clientId = (client as any).clientId;
    if (clientId) {
      this.tunnelService.unregisterClient(clientId);
      this.logger.log(`Client disconnected: ${clientId}`);
    }
  }

  private dispatch(
    client: WebSocket,
    msg: { event: string; data?: any },
  ) {
    const clientId = (client as any).clientId;
    if (!clientId || !msg.event) return;

    switch (msg.event) {
      case 'connect':
        this.handleConnect(clientId, msg.data, client);
        break;
      case 'data':
        this.handleData(clientId, msg.data);
        break;
      case 'close':
        this.handleClose(clientId, msg.data);
        break;
      case 'udp_associate':
        this.handleUdpAssociate(clientId, msg.data, client);
        break;
      case 'udp_data':
        this.handleUdpData(clientId, msg.data);
        break;
      default:
        this.logger.warn(`Unknown event: ${msg.event}`);
    }
  }

  private async handleConnect(
    clientId: string,
    data: { id: string; dstAddr: string; dstPort: number; atyp: Atyp },
    client: WebSocket,
  ) {
    try {
      await this.tunnelService.createTcpConnection(
        clientId,
        data.id,
        data.dstAddr,
        data.dstPort,
      );
    } catch (err: any) {
      client.send(
        JSON.stringify({
          event: 'connect_resp',
          data: { id: data.id, success: false, error: err.message },
        }),
      );
    }
  }

  private handleData(
    clientId: string,
    data: { id: string; data: string },
  ) {
    this.tunnelService.writeToTcp(clientId, data.id, data.data);
  }

  private handleClose(clientId: string, data: { id: string }) {
    this.tunnelService.closeTcp(clientId, data.id);
    this.tunnelService.closeUdp(clientId, data.id);
  }

  private async handleUdpAssociate(
    clientId: string,
    data: { id: string },
    client: WebSocket,
  ) {
    try {
      const port = await this.tunnelService.createUdpRelay(
        clientId,
        data.id,
      );
      client.send(
        JSON.stringify({
          event: 'udp_associate_resp',
          data: { id: data.id, success: true, relayPort: port },
        }),
      );
    } catch (err: any) {
      client.send(
        JSON.stringify({
          event: 'udp_associate_resp',
          data: { id: data.id, success: false, error: err.message },
        }),
      );
    }
  }

  private handleUdpData(
    clientId: string,
    data: {
      id: string;
      data: string;
      atyp?: Atyp;
      dstAddr?: string;
      dstPort?: number;
    },
  ) {
    if (data.dstAddr && data.dstPort) {
      this.tunnelService.sendUdpData(
        clientId,
        data.id,
        data.data,
        data.dstAddr,
        data.dstPort,
      );
    }
  }
}
