import { type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { Chess, type VisibilityMode } from '@blind-chess/shared';
import type { Square } from 'chess.js';
export declare const httpApp: import("express-serve-static-core").Express;
type Seat = {
    name: string;
    color: 'w' | 'b';
    token: string;
    socketId?: string;
    disconnectedAt?: number;
};
type Room = {
    mode: VisibilityMode;
    chess: Chess;
    players: Map<string, Seat>;
    lastMove?: {
        from: Square;
        to: Square;
    };
};
export declare const rooms: Map<string, Room>;
export declare function createGameServer(httpServer?: HttpServer): {
    io: Server<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
    httpServer: HttpServer<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
};
export {};
