import { type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { Chess, type TimerConfig, type VisibilityMode } from '@blind-chess/shared';
import type { Color, Square } from 'chess.js';
export declare const httpApp: import("express-serve-static-core").Express;
type Seat = {
    name: string;
    color: Color;
    token: string;
    socketId?: string;
    disconnectedAt?: number;
};
type Clock = {
    whiteMs: number;
    blackMs: number;
    activeColor: Color;
    activeSince?: number;
    running: boolean;
};
type Room = {
    mode: VisibilityMode;
    timer: TimerConfig;
    chess: Chess;
    players: Map<string, Seat>;
    clock: Clock;
    lastMove?: {
        from: Square;
        to: Square;
    };
    timeoutResult?: {
        winner?: Color;
        draw: boolean;
    };
};
export declare const rooms: Map<string, Room>;
export declare function createGameServer(httpServer?: HttpServer, clockNow?: () => number): {
    io: Server<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
    httpServer: HttpServer<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
};
export {};
