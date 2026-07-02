import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Server } from 'socket.io';

async function bootstrap() {
  const httpsOptions = {
    key: readFileSync(join(__dirname, '..', 'certs', 'key.pem')),
    cert: readFileSync(join(__dirname, '..', 'certs', 'cert.pem')),
  };

  const app = await NestFactory.create(AppModule, { httpsOptions });

  const httpServer = app.getHttpServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const { WebrtcService } = await import('./webrtc/webrtc.service');
  const webrtcService = app.get(WebrtcService);
  webrtcService.setup(io);

  const port = parseInt(process.env.PORT || '443', 10);
  await app.listen(port, () => {
    console.log(`Server on https://192.168.1.46:${port}`);
    console.log(`Signaling on wss://192.168.1.46:${port}`);
  });
}
bootstrap();
