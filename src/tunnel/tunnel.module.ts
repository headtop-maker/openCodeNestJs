import { Module } from '@nestjs/common';
import { TunnelGateway } from './tunnel.gateway';
import { TunnelService } from './tunnel.service';

@Module({
  providers: [TunnelGateway, TunnelService],
})
export class TunnelModule {}
