import { Module } from '@nestjs/common';
import { TunnelModule } from './tunnel/tunnel.module';

@Module({
  imports: [TunnelModule],
})
export class AppModule {}
