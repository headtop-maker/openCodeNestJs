import WebSocket from 'ws';
import { Atyp } from './messages';

type ConnectRespCallback = (success: boolean, error?: string) => void;
type UdpRespCallback = (success: boolean, relayPort?: number, error?: string) => void;
type DataHandler = (dataBase64: string) => void;
type CloseHandler = () => void;
type UdpDataHandler = (dataBase64: string, srcAddr: string, srcPort: number) => void;

interface Handlers {
  data: Map<string, DataHandler>;
  close: Map<string, CloseHandler>;
  udpData: Map<string, UdpDataHandler>;
  connectResp: Map<string, ConnectRespCallback>;
  udpResp: Map<string, UdpRespCallback>;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private connecting = false;
  private handlers: Handlers = {
    data: new Map(),
    close: new Map(),
    udpData: new Map(),
    connectResp: new Map(),
    udpResp: new Map(),
  };

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.connecting || this.ws?.readyState === WebSocket.OPEN) return;
    this.connecting = true;

    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.connecting = false;
      console.log('[WS] Connected to', this.url);
    });

    this.ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.dispatch(msg);
      } catch (err) {
        console.error('[WS] Invalid message:', err);
      }
    });

    this.ws.on('close', () => {
      this.connecting = false;
      console.log('[WS] Disconnected, reconnecting in 3s...');
      setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (err) => {
      this.connecting = false;
      console.error('[WS] Error:', err.message);
    });
  }

  private dispatch(msg: { event: string; data?: any }) {
    if (!msg.event) return;

    switch (msg.event) {
      case 'connect_resp':
        this.handleConnectResp(msg.data);
        break;
      case 'data':
        this.handleData(msg.data);
        break;
      case 'close':
        this.handleClose(msg.data);
        break;
      case 'udp_associate_resp':
        this.handleUdpResp(msg.data);
        break;
      case 'udp_data':
        this.handleUdpData(msg.data);
        break;
    }
  }

  private send(event: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  private handleConnectResp(data: { id: string; success: boolean; error?: string }) {
    const cb = this.handlers.connectResp.get(data.id);
    if (cb) {
      cb(data.success, data.error);
      this.handlers.connectResp.delete(data.id);
    }
  }

  private handleUdpResp(data: { id: string; success: boolean; relayPort?: number; error?: string }) {
    const cb = this.handlers.udpResp.get(data.id);
    if (cb) {
      cb(data.success, data.relayPort, data.error);
      this.handlers.udpResp.delete(data.id);
    }
  }

  private handleData(data: { id: string; data: string }) {
    const handler = this.handlers.data.get(data.id);
    if (handler) handler(data.data);
  }

  private handleClose(data: { id: string }) {
    const handler = this.handlers.close.get(data.id);
    if (handler) handler();
  }

  private handleUdpData(data: { id: string; data: string; srcAddr: string; srcPort: number }) {
    const handler = this.handlers.udpData.get(data.id);
    if (handler) handler(data.data, data.srcAddr, data.srcPort);
  }

  sendConnect(connectionId: string, dstAddr: string, dstPort: number, atyp: Atyp) {
    this.send('connect', { id: connectionId, dstAddr, dstPort, atyp });
  }

  sendData(connectionId: string, dataBase64: string) {
    this.send('data', { id: connectionId, data: dataBase64 });
  }

  sendClose(connectionId: string) {
    this.send('close', { id: connectionId });
  }

  sendUdpAssociate(connectionId: string) {
    this.send('udp_associate', { id: connectionId });
  }

  sendUdpData(connectionId: string, dataBase64: string, atyp: Atyp, dstAddr: string, dstPort: number) {
    this.send('udp_data', { id: connectionId, data: dataBase64, atyp, dstAddr, dstPort });
  }

  onConnectResp(connectionId: string, cb: ConnectRespCallback): () => void {
    this.handlers.connectResp.set(connectionId, cb);
    return () => this.handlers.connectResp.delete(connectionId);
  }

  onUdpResp(connectionId: string, cb: UdpRespCallback): () => void {
    this.handlers.udpResp.set(connectionId, cb);
    return () => this.handlers.udpResp.delete(connectionId);
  }

  onData(connectionId: string, handler: DataHandler): () => void {
    this.handlers.data.set(connectionId, handler);
    return () => this.handlers.data.delete(connectionId);
  }

  onClose(connectionId: string, handler: CloseHandler): () => void {
    this.handlers.close.set(connectionId, handler);
    return () => this.handlers.close.delete(connectionId);
  }

  onUdpData(connectionId: string, handler: UdpDataHandler): () => void {
    this.handlers.udpData.set(connectionId, handler);
    return () => this.handlers.udpData.delete(connectionId);
  }

  cleanupConnection(connectionId: string) {
    this.handlers.data.delete(connectionId);
    this.handlers.close.delete(connectionId);
    this.handlers.udpData.delete(connectionId);
    this.handlers.connectResp.delete(connectionId);
    this.handlers.udpResp.delete(connectionId);
  }
}
