import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Server } from 'socket.io';
import { Chess, filterPosition, legalDestinations, validateTimerConfig, } from '@blind-chess/shared';
const app = express();
app.use(cors());
export const httpApp = app;
export const rooms = new Map();
const code = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const token = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
function snapshot(room, now) {
    if (room.timer.mode === 'disabled')
        return { mode: 'disabled', whiteMs: null, blackMs: null, running: false };
    const whiteMs = room.clock.whiteMs;
    const blackMs = room.clock.blackMs;
    const elapsed = room.clock.running && room.clock.activeSince !== undefined ? Math.max(0, now() - room.clock.activeSince) : 0;
    return {
        mode: 'timed',
        whiteMs: Math.max(0, Math.round(whiteMs - (room.clock.activeColor === 'w' ? elapsed : 0))),
        blackMs: Math.max(0, Math.round(blackMs - (room.clock.activeColor === 'b' ? elapsed : 0))),
        activeColor: room.clock.running ? room.clock.activeColor : undefined,
        running: room.clock.running,
    };
}
function refreshClock(room, now) {
    if (!room.clock.running || room.clock.activeSince === undefined || room.timer.mode === 'disabled')
        return;
    const elapsed = Math.max(0, now - room.clock.activeSince);
    const key = room.clock.activeColor === 'w' ? 'whiteMs' : 'blackMs';
    room.clock[key] = Math.max(0, room.clock[key] - elapsed);
    room.clock.activeSince = now;
}
function roomState(roomCode, room, now, disconnected = false, connectionStatus) {
    return {
        roomCode, mode: room.mode, timer: room.timer, clock: snapshot(room, now),
        players: [...room.players.values()].map(({ name, color, socketId }) => ({ name, color, connected: Boolean(socketId) })),
        ...(disconnected ? { disconnected: true } : {}),
        ...(connectionStatus ? { connectionStatus } : {}),
    };
}
function view(room, player, now) {
    const result = filterPosition(room.chess, player.color, room.mode, room.lastMove, snapshot(room, now));
    if (room.timeoutResult) {
        result.status = room.timeoutResult.draw ? 'draw' : 'timeout';
        result.resultReason = room.timeoutResult.draw ? 'timeout-insufficient-material' : 'timeout';
        result.winner = room.timeoutResult.winner;
    }
    return result;
}
function emitViews(io, roomCode, now) {
    const room = rooms.get(roomCode);
    if (!room)
        return;
    for (const player of room.players.values())
        if (player.socketId)
            io.to(player.socketId).emit('game:view', view(room, player, now));
    io.to(roomCode).emit('game:clock', snapshot(room, now));
}
function adjudicateTimeout(room, now) {
    refreshClock(room, now);
    const timedOut = room.clock.activeColor;
    if ((timedOut === 'w' ? room.clock.whiteMs : room.clock.blackMs) > 0)
        return false;
    room.timeoutResult = room.chess.isInsufficientMaterial()
        ? { draw: true }
        : { draw: false, winner: timedOut === 'w' ? 'b' : 'w' };
    room.clock.running = false;
    room.clock.activeSince = undefined;
    return true;
}
export function createGameServer(httpServer = createServer(app), clockNow = () => performance.now()) {
    const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN ?? '*' } });
    io.on('connection', (socket) => {
        socket.on('room:create', (request, ack) => {
            let timer;
            try {
                timer = validateTimerConfig(request.timer);
            }
            catch {
                return ack({ ok: false, error: 'Invalid timer configuration.' });
            }
            let roomCode = code();
            while (rooms.has(roomCode))
                roomCode = code();
            const playerToken = token();
            const baseMs = timer.mode === 'timed' ? timer.baseSeconds * 1000 : 0;
            const room = {
                mode: request.mode, timer, chess: new Chess(),
                players: new Map([[playerToken, { name: request.name.trim() || 'White', color: 'w', token: playerToken, socketId: socket.id }]]),
                clock: { whiteMs: baseMs, blackMs: baseMs, activeColor: 'w', running: false },
            };
            rooms.set(roomCode, room);
            socket.join(roomCode);
            ack({ ok: true, roomCode, color: 'w', playerToken });
            socket.emit('room:state', roomState(roomCode, room, clockNow));
        });
        socket.on('room:join', (request, ack) => {
            const roomCode = request.roomCode.toUpperCase();
            const room = rooms.get(roomCode);
            if (!room)
                return ack({ ok: false, error: 'That room does not exist.' });
            if ([...room.players.values()].some((player) => player.socketId === socket.id))
                return ack({ ok: false, error: 'You are already in that room.' });
            if (room.players.size >= 2)
                return ack({ ok: false, error: 'That room is already full.' });
            const playerToken = token();
            room.players.set(playerToken, { name: request.name.trim() || 'Black', color: 'b', token: playerToken, socketId: socket.id });
            if (room.timer.mode === 'timed') {
                room.clock.running = true;
                room.clock.activeSince = clockNow();
            }
            socket.join(roomCode);
            ack({ ok: true, roomCode, color: 'b', playerToken });
            io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow));
            emitViews(io, roomCode, clockNow);
        });
        socket.on('room:resume', (request, ack) => {
            const roomCode = request.roomCode.toUpperCase();
            const room = rooms.get(roomCode);
            const player = room?.players.get(request.playerToken);
            if (!room || !player)
                return ack({ ok: false, error: 'That room session has expired.' });
            if (player.socketId || [...room.players.values()].some((seat) => seat.socketId === socket.id))
                return ack({ ok: false, error: 'That player seat is already connected.' });
            player.socketId = socket.id;
            player.disconnectedAt = undefined;
            socket.join(roomCode);
            ack({ ok: true, roomCode, color: player.color, playerToken: request.playerToken });
            io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow, false, 'opponent-reconnected'));
            emitViews(io, roomCode, clockNow);
        });
        socket.on('room:leave', (request, ack) => {
            const roomCode = request.roomCode.toUpperCase();
            const room = rooms.get(roomCode);
            const player = room?.players.get(request.playerToken);
            if (!room || !player || player.socketId !== socket.id)
                return ack?.({ ok: false, error: 'You are not in that room.' });
            room.players.delete(request.playerToken);
            socket.leave(roomCode);
            io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow, true, 'player-left'));
            if (room.players.size === 0)
                rooms.delete(roomCode);
            ack?.({ ok: true });
        });
        socket.on('game:move', (request, ack) => {
            const room = rooms.get(request.roomCode);
            const player = room?.players.get(request.playerToken);
            if (!room || !player || player.socketId !== socket.id)
                return ack({ ok: false, error: 'You are not a member of that room.' });
            const now = clockNow();
            if (room.timeoutResult || room.chess.isGameOver())
                return ack({ ok: false, error: 'The game is over.' });
            if (room.timer.mode === 'timed' && adjudicateTimeout(room, now)) {
                emitViews(io, request.roomCode, clockNow);
                return ack({ ok: false, error: 'Time expired.' });
            }
            if (room.chess.turn() !== player.color)
                return ack({ ok: false, error: 'It is not your turn.' });
            try {
                const result = room.chess.move(request.move);
                room.lastMove = { from: result.from, to: result.to };
                if (room.timer.mode === 'timed') {
                    refreshClock(room, now);
                    const moverKey = player.color === 'w' ? 'whiteMs' : 'blackMs';
                    room.clock[moverKey] += room.timer.incrementSeconds * 1000;
                    if (room.chess.isGameOver()) {
                        room.clock.running = false;
                        room.clock.activeSince = undefined;
                    }
                    else {
                        room.clock.activeColor = player.color === 'w' ? 'b' : 'w';
                        room.clock.activeSince = now;
                    }
                }
                ack({ ok: true });
                emitViews(io, request.roomCode, clockNow);
                io.to(request.roomCode).emit('game:status', { status: room.chess.isGameOver() ? 'game-over' : 'playing' });
            }
            catch {
                ack({ ok: false, error: 'That move is not legal.' });
            }
        });
        const clockRequest = (request, ack) => {
            const reply = (response) => {
                if (typeof ack === 'function')
                    ack(response);
            };
            if (!request || typeof request !== 'object')
                return reply({ ok: false, error: 'Invalid clock request.' });
            const { roomCode, playerToken } = request;
            if (typeof roomCode !== 'string' || typeof playerToken !== 'string' || !roomCode || !playerToken) {
                return reply({ ok: false, error: 'Invalid clock request.' });
            }
            const room = rooms.get(roomCode.toUpperCase());
            const player = room?.players.get(playerToken);
            if (!room || !player || player.socketId !== socket.id)
                return reply({ ok: false, error: 'You are not a member of that room.' });
            if (room.timer.mode === 'timed' && !room.timeoutResult && adjudicateTimeout(room, clockNow()))
                emitViews(io, roomCode.toUpperCase(), clockNow);
            reply({ ok: true, clock: snapshot(room, clockNow) });
        };
        socket.on('game:clock', clockRequest);
        socket.on('game:clock-request', clockRequest);
        socket.on('game:legal-moves', (request, ack) => {
            const room = rooms.get(request.roomCode);
            const player = room?.players.get(request.playerToken);
            if (!room || !player || player.socketId !== socket.id)
                return ack({ ok: false, error: 'You are not a member of that room.' });
            ack({ ok: true, destinations: legalDestinations(room.chess, player.color, request.from, room.mode) });
        });
        socket.on('disconnect', () => {
            for (const [roomCode, room] of rooms) {
                const player = [...room.players.values()].find((seat) => seat.socketId === socket.id);
                if (!player)
                    continue;
                player.socketId = undefined;
                player.disconnectedAt = Date.now();
                io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow, true, 'opponent-disconnected'));
            }
        });
    });
    return { io, httpServer };
}
app.get('/health', (_req, res) => res.json({ ok: true }));
if (process.env.NODE_ENV !== 'test') {
    const port = Number(process.env.PORT ?? 3001);
    const httpServer = createServer(app);
    createGameServer(httpServer);
    httpServer.listen(port, () => console.log(`Blind Chess server listening on ${port}`));
}
