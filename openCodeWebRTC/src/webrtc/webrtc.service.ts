import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

interface Room {
  users: Map<string, { userId: string; socketId: string }>;
}

@Injectable()
export class WebrtcService implements OnModuleDestroy {
  private readonly logger = new Logger(WebrtcService.name);
  private io: Server;
  private rooms = new Map<string, Room>();

  setup(io: Server) {
    this.io = io;
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });
    this.logger.log('Signaling server ready');
  }

  onModuleDestroy() {
    this.io?.close();
  }

  private handleConnection(socket: Socket) {
    socket.on('join-room', (data: { roomId: string; userId: string }) => {
      this.handleJoinRoom(socket, data);
    });

    socket.on('leave-room', (_data: { roomId: string }) => {
      this.removeFromRoom(socket);
    });

    socket.on('offer', (data: { to: string; sdp: any }) => {
      this.forwardMessage(socket, 'offer', data);
    });

    socket.on('answer', (data: { to: string; sdp: any }) => {
      this.forwardMessage(socket, 'answer', data);
    });

    socket.on('ice-candidate', (data: { to: string; candidate: any }) => {
      this.forwardMessage(socket, 'ice-candidate', data);
    });

    socket.on('disconnect', () => {
      this.removeFromRoom(socket);
    });
  }

  private handleJoinRoom(socket: Socket, data: { roomId: string; userId: string }) {
    const { roomId, userId } = data;

    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { users: new Map() });
    }

    const room = this.rooms.get(roomId)!;
    socket.join(roomId);
    (socket as any).roomId = roomId;
    (socket as any).userId = userId;

    const user = { userId, socketId: socket.id };
    room.users.set(socket.id, user);

    const existingUsers = Array.from(room.users.values()).filter(
      (u) => u.socketId !== socket.id,
    );

    socket.emit('users-in-room', { users: existingUsers });

    socket.to(roomId).emit('user-joined', { user });

    this.logger.log(`User ${userId} joined room ${roomId}`);
  }

  private removeFromRoom(socket: Socket) {
    const roomId = (socket as any).roomId;
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.users.delete(socket.id);
    socket.to(roomId).emit('user-left', { socketId: socket.id });

    if (room.users.size === 0) {
      this.rooms.delete(roomId);
      this.logger.log(`Room ${roomId} deleted`);
    }

    socket.leave(roomId);
  }

  private forwardMessage(
    socket: Socket,
    event: string,
    data: { to: string; [key: string]: any },
  ) {
    const { to, ...payload } = data;
    const targetSocket = this.io.sockets.sockets.get(to);
    if (targetSocket) {
      targetSocket.emit(event, { from: socket.id, ...payload });
    }
  }
}
