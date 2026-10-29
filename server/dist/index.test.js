import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import { createGameServer, httpApp, rooms } from './index.js';
const waitFor = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.once(event, (value) => { clearTimeout(timer); resolve(value); });
});
describe('online room protocol', () => {
    const servers = [];
    const clients = [];
    afterEach(async () => {
        clients.forEach((client) => client.disconnect());
        rooms.clear();
        await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve()))));
    });
    it('creates, joins, filters, validates, and resynchronizes a room', async () => {
        const http = createServer(httpApp);
        createGameServer(http);
        servers.push(http);
        await new Promise((resolve) => http.listen(0, resolve));
        const address = http.address();
        if (!address || typeof address === 'string')
            throw new Error('test server did not start');
        const url = `http://localhost:${address.port}`;
        const white = connect(url);
        const black = connect(url);
        clients.push(white, black);
        await Promise.all([waitFor(white, 'connect'), waitFor(black, 'connect')]);
        const created = await new Promise((resolve) => white.emit('room:create', { name: 'Alice', mode: 'semi-blind' }, resolve));
        expect(created.ok).toBe(true);
        const whiteView = waitFor(white, 'game:view');
        const blackView = waitFor(black, 'game:view');
        const joined = await new Promise((resolve) => black.emit('room:join', { name: 'Bob', roomCode: created.roomCode }, resolve));
        expect(joined).toMatchObject({ ok: true, color: 'b' });
        const [whiteState, blackState] = await Promise.all([whiteView, blackView]);
        expect(whiteState.pieces.some((piece) => piece.color === 'b' && piece.type)).toBe(false);
        expect(blackState.pieces.some((piece) => piece.color === 'w' && piece.type)).toBe(false);
        const outOfTurn = await new Promise((resolve) => black.emit('game:move', { roomCode: created.roomCode, playerToken: joined.playerToken, move: { from: 'e7', to: 'e5' } }, resolve));
        expect(outOfTurn.ok).toBe(false);
        const nextBlackView = waitFor(black, 'game:view');
        const moved = await new Promise((resolve) => white.emit('game:move', { roomCode: created.roomCode, playerToken: created.playerToken, move: { from: 'e2', to: 'e4' } }, resolve));
        expect(moved.ok).toBe(true);
        expect(await nextBlackView).toMatchObject({ turn: 'b', lastMove: { to: 'e4' } });
        white.disconnect();
        const resumed = connect(url);
        clients.push(resumed);
        await waitFor(resumed, 'connect');
        const resumedView = waitFor(resumed, 'game:view');
        const resumeResult = await new Promise((resolve) => resumed.emit('room:resume', { roomCode: created.roomCode, playerToken: created.playerToken }, resolve));
        expect(resumeResult.ok).toBe(true);
        expect((await resumedView).pieces.some((piece) => piece.color === 'b' && piece.type)).toBe(false);
    });
    it('rejects invalid and full rooms', async () => {
        const http = createServer(httpApp);
        createGameServer(http);
        servers.push(http);
        await new Promise((resolve) => http.listen(0, resolve));
        const address = http.address();
        if (!address || typeof address === 'string')
            throw new Error('test server did not start');
        const url = `http://localhost:${address.port}`;
        const first = connect(url);
        const second = connect(url);
        const third = connect(url);
        clients.push(first, second, third);
        await Promise.all([waitFor(first, 'connect'), waitFor(second, 'connect'), waitFor(third, 'connect')]);
        const invalid = await new Promise((resolve) => second.emit('room:join', { name: 'Bob', roomCode: 'XXXXX' }, resolve));
        expect(invalid.ok).toBe(false);
        const created = await new Promise((resolve) => first.emit('room:create', { name: 'Alice', mode: 'normal' }, resolve));
        await new Promise((resolve) => second.emit('room:join', { name: 'Bob', roomCode: created.roomCode }, resolve));
        const full = await new Promise((resolve) => third.emit('room:join', { name: 'Eve', roomCode: created.roomCode }, resolve));
        expect(full.ok).toBe(false);
    });
});
