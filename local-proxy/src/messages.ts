export type Atyp = 0x01 | 0x03 | 0x04;

export interface Socks5Request {
  cmd: number;
  atyp: Atyp;
  dstAddr: string;
  dstPort: number;
}
