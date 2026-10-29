import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { io as connect, type Socket } from 'socket.io-client'
import { createGameServer, httpApp, rooms } from './index.js'

const waitFor = <T>(socket: Socket, event: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000)
  socket.once(event, (value: T) => { clearTimeout(timer); resolve(value) })
})

describe('online room protocol', () => {
  const servers: Array<{ close: (callback?: (error?: Error) => void) => void }> = []
  const clients: Socket[] = []

  afterEach(async () => {
    clients.forEach((client) => client.disconnect())
    rooms.clear()
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  })

  it('creates, joins, filters, validates, and resynchronizes a room', async () => {
    const http = createServer(httpApp)
    createGameServer(http)
    servers.push(http)
    await new Promise<void>((resolve) => http.listen(0, resolve))
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = `http://localhost:${address.port}`
    const white = connect(url)
    const black = connect(url)
    clients.push(white, black)
    await Promise.all([waitFor(white, 'connect'), waitFor(black, 'connect')])

    const created = await new Promise<{ ok: boolean; roomCode: string; color: string; playerToken: string }>((resolve) => white.emit('room:create', { name: 'Alice', mode: 'semi-blind' }, resolve))
    expect(created.ok).toBe(true)
    const whiteView = waitFor<{ pieces: Array<{ color: string; type?: string }> }>(white, 'game:view')
    const blackView = waitFor<{ pieces: Array<{ color: string; type?: string }> }>(black, 'game:view')
    const joined = await new Promise<{ ok: boolean; color: string; playerToken: string }>((resolve) => black.emit('room:join', { name: 'Bob', roomCode: created.roomCode }, resolve))
    expect(joined).toMatchObject({ ok: true, color: 'b' })
    const [whiteState, blackState] = await Promise.all([whiteView, blackView])
    expect(whiteState.pieces.some((piece) => piece.color === 'b' && piece.type)).toBe(false)
    expect(blackState.pieces.some((piece) => piece.color === 'w' && piece.type)).toBe(false)

    const outOfTurn = await new Promise<{ ok: boolean; error?: string }>((resolve) => black.emit('game:move', { roomCode: created.roomCode, playerToken: joined.playerToken, move: { from: 'e7', to: 'e5' } }, resolve))
    expect(outOfTurn.ok).toBe(false)
    const nextBlackView = waitFor<{ turn: string; lastMove?: { to: string } }>(black, 'game:view')
    const moved = await new Promise<{ ok: boolean }>((resolve) => white.emit('game:move', { roomCode: created.roomCode, playerToken: created.playerToken, move: { from: 'e2', to: 'e4' } }, resolve))
    expect(moved.ok).toBe(true)
    expect(await nextBlackView).toMatchObject({ turn: 'b', lastMove: { to: 'e4' } })

    white.disconnect()
    const resumed = connect(url)
    clients.push(resumed)
    await waitFor(resumed, 'connect')
    const resumedView = waitFor<{ pieces: Array<{ color: string; type?: string }> }>(resumed, 'game:view')
    const resumeResult = await new Promise<{ ok: boolean }>((resolve) => resumed.emit('room:resume', { roomCode: created.roomCode, playerToken: created.playerToken }, resolve))
    expect(resumeResult.ok).toBe(true)
    expect((await resumedView).pieces.some((piece) => piece.color === 'b' && piece.type)).toBe(false)
  })

  it('rejects invalid and full rooms', async () => {
    const http = createServer(httpApp)
    createGameServer(http)
    servers.push(http)
    await new Promise<void>((resolve) => http.listen(0, resolve))
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = `http://localhost:${address.port}`
    const first = connect(url)
    const second = connect(url)
    const third = connect(url)
    clients.push(first, second, third)
    await Promise.all([waitFor(first, 'connect'), waitFor(second, 'connect'), waitFor(third, 'connect')])
    const invalid = await new Promise<{ ok: boolean }>((resolve) => second.emit('room:join', { name: 'Bob', roomCode: 'XXXXX' }, resolve))
    expect(invalid.ok).toBe(false)
    const created = await new Promise<{ roomCode: string }>((resolve) => first.emit('room:create', { name: 'Alice', mode: 'normal' }, resolve))
    await new Promise((resolve) => second.emit('room:join', { name: 'Bob', roomCode: created.roomCode }, resolve))
    const full = await new Promise<{ ok: boolean }>((resolve) => third.emit('room:join', { name: 'Eve', roomCode: created.roomCode }, resolve))
    expect(full.ok).toBe(false)
  })

  it('notifies the remaining player about disconnect and allows only the same seat to resume', async () => {
    const http = createServer(httpApp)
    createGameServer(http)
    servers.push(http)
    await new Promise<void>((resolve) => http.listen(0, resolve))
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = `http://localhost:${address.port}`
    const white = connect(url)
    const black = connect(url)
    clients.push(white, black)
    await Promise.all([waitFor(white, 'connect'), waitFor(black, 'connect')])
    const created = await new Promise<{ roomCode: string; playerToken: string }>((resolve) => white.emit('room:create', { name: 'Alice', mode: 'blind-pro' }, resolve))
    const whiteView = waitFor(white, 'game:view')
    const blackView = waitFor(black, 'game:view')
    const joined = await new Promise<{ playerToken: string }>((resolve) => black.emit('room:join', { name: 'Bob', roomCode: created.roomCode }, resolve))
    await Promise.all([whiteView, blackView])
    const intruder = connect(url)
    clients.push(intruder)
    await waitFor(intruder, 'connect')
    const deniedWhileConnected = await new Promise<{ ok: boolean }>((resolve) => intruder.emit('room:resume', { roomCode: created.roomCode, playerToken: joined.playerToken }, resolve))
    expect(deniedWhileConnected.ok).toBe(false)
    const disconnectState = waitFor<{ connectionStatus?: string; players: Array<{ connected?: boolean }> }>(white, 'room:state')
    black.disconnect()
    expect(await disconnectState).toMatchObject({ connectionStatus: 'opponent-disconnected' })
    const resumedView = waitFor<{ pieces: Array<{ color: string }> }>(intruder, 'game:view')
    const resumed = await new Promise<{ ok: boolean }>((resolve) => intruder.emit('room:resume', { roomCode: created.roomCode, playerToken: joined.playerToken }, resolve))
    expect(resumed.ok).toBe(true)
    expect((await resumedView).pieces.some((piece) => piece.color === 'w')).toBe(false)
  })
})
