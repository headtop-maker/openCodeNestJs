export type Atyp = 0x01 | 0x03 | 0x04;

export interface ConnectData {
  id: string;
  dstAddr: string;
  dstPort: number;
  atyp: Atyp;
}

export interface DataPayload {
  id: string;
  data: string;
}

export interface ClosePayload {
  id: string;
}

export interface UdpAssociateData {
  id: string;
}

export interface UdpDataPayload {
  id: string;
  data: string;
  atyp?: Atyp;
  dstAddr?: string;
  dstPort?: number;
  srcAddr?: string;
  srcPort?: number;
}
