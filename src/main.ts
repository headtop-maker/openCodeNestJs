import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = parseInt(process.env.PORT || '8080', 10);
  await app.listen(port);
  console.log(`NestJS tunnel server listening on port ${port}`);
}
bootstrap();
