import cors from 'cors'
import express from 'express'
import { createServer, type Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { Chess, filterPosition, legalDestinations, type MoveRequest, type RoomCreateRequest, type RoomJoinRequest, type RoomResumeRequest, type VisibilityMode } from '@blind-chess/shared'
import type { Square } from 'chess.js'

const app = express()
app.use(cors())
export const httpApp = app
type Seat = { name: string; color: 'w' | 'b'; token: string; socketId?: string; disconnectedAt?: number }
type Room = { mode: VisibilityMode; chess: Chess; players: Map<string, Seat>; lastMove?: { from: Square; to: Square } }
export const rooms = new Map<string, Room>()
const code = () => Math.random().toString(36).slice(2, 7).toUpperCase()
const token = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

function roomState(roomCode: string, room: Room, disconnected = false, connectionStatus?: 'opponent-disconnected' | 'opponent-reconnected' | 'player-left') {
  return {
    roomCode,
    mode: room.mode,
    players: [...room.players.values()].map(({ name, color, socketId }) => ({ name, color, connected: Boolean(socketId) })),
    ...(disconnected ? { disconnected: true } : {}),
    ...(connectionStatus ? { connectionStatus } : {}),
  }
}

function emitViews(io: Server, roomCode: string) {
  const room = rooms.get(roomCode)
  if (!room) return
  for (const [id, player] of room.players) {
    if (player.socketId) io.to(player.socketId).emit('game:view', filterPosition(room.chess, player.color, room.mode, room.lastMove))
  }
}

export function createGameServer(httpServer: HttpServer = createServer(app)) {
  const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN ?? '*' } })
  io.on('connection', (socket) => {
  socket.on('room:create', ({ name, mode }: RoomCreateRequest, ack) => {
    let roomCode = code()
    while (rooms.has(roomCode)) roomCode = code()
    const playerToken = token()
    const room = { mode, chess: new Chess(), players: new Map([[playerToken, { name: name.trim() || 'White', color: 'w' as const, token: playerToken, socketId: socket.id }]]) }
    rooms.set(roomCode, room)
    socket.join(roomCode)
    ack({ ok: true, roomCode, color: 'w', playerToken })
    socket.emit('room:state', roomState(roomCode, room))
  })
  socket.on('room:join', ({ name, roomCode }: RoomJoinRequest, ack) => {
    const room = rooms.get(roomCode.toUpperCase())
    if (!room) return ack({ ok: false, error: 'That room does not exist.' })
    if ([...room.players.values()].some((player) => player.socketId === socket.id)) return ack({ ok: false, error: 'You are already in that room.' })
    if (room.players.size >= 2) return ack({ ok: false, error: 'That room is already full.' })
    const playerToken = token()
    room.players.set(playerToken, { name: name.trim() || 'Black', color: 'b', token: playerToken, socketId: socket.id })
    socket.join(roomCode.toUpperCase())
    ack({ ok: true, roomCode: roomCode.toUpperCase(), color: 'b', playerToken })
    io.to(roomCode.toUpperCase()).emit('room:state', roomState(roomCode.toUpperCase(), room))
    emitViews(io, roomCode.toUpperCase())
  })
  socket.on('room:resume', ({ roomCode, playerToken }: RoomResumeRequest, ack) => {
    const room = rooms.get(roomCode.toUpperCase())
    const player = room?.players.get(playerToken)
    if (!room || !player) return ack({ ok: false, error: 'That room session has expired.' })
    if (player.socketId || [...room.players.values()].some((seat) => seat.socketId === socket.id)) return ack({ ok: false, error: 'That player seat is already connected.' })
    player.socketId = socket.id
    player.disconnectedAt = undefined
    socket.join(roomCode.toUpperCase())
    ack({ ok: true, roomCode: roomCode.toUpperCase(), color: player.color, playerToken })
    io.to(roomCode.toUpperCase()).emit('room:state', roomState(roomCode.toUpperCase(), room, false, 'opponent-reconnected'))
    emitViews(io, roomCode.toUpperCase())
  })
  socket.on('room:leave', ({ roomCode, playerToken }: RoomResumeRequest, ack) => {
    const room = rooms.get(roomCode.toUpperCase())
    const player = room?.players.get(playerToken)
    if (!room || !player || player.socketId !== socket.id) return ack?.({ ok: false, error: 'You are not in that room.' })
    room.players.delete(playerToken)
    socket.leave(roomCode.toUpperCase())
    io.to(roomCode.toUpperCase()).emit('room:state', roomState(roomCode.toUpperCase(), room, true, 'player-left'))
    if (room.players.size === 0) rooms.delete(roomCode.toUpperCase())
    ack?.({ ok: true })
  })
  socket.on('game:move', ({ roomCode, move, playerToken }: { roomCode: string; move: MoveRequest; playerToken: string }, ack) => {
    const room = rooms.get(roomCode)
    const player = room?.players.get(playerToken)
    if (!room || !player || player.socketId !== socket.id) return ack({ ok: false, error: 'You are not a member of that room.' })
    if (room.chess.turn() !== player.color) return ack({ ok: false, error: 'It is not your turn.' })
    try {
      const result = room.chess.move(move)
      room.lastMove = { from: result.from, to: result.to }
      ack({ ok: true })
      emitViews(io, roomCode)
      io.to(roomCode).emit('game:status', { status: room.chess.isGameOver() ? 'game-over' : 'playing' })
    } catch {
      ack({ ok: false, error: 'That move is not legal.' })
    }
  })
  socket.on('game:legal-moves', ({ roomCode, playerToken, from }: { roomCode: string; playerToken: string; from: Square }, ack) => {
    const room = rooms.get(roomCode)
    const player = room?.players.get(playerToken)
    if (!room || !player || player.socketId !== socket.id) return ack({ ok: false, error: 'You are not a member of that room.' })
    ack({ ok: true, destinations: legalDestinations(room.chess, player.color, from, room.mode) })
  })
  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms) {
      const player = [...room.players.values()].find((seat) => seat.socketId === socket.id)
      if (!player) continue
      player.socketId = undefined
      player.disconnectedAt = Date.now()
      io.to(roomCode).emit('room:state', roomState(roomCode, room, true, 'opponent-disconnected'))
    }
  })
  })
  return { io, httpServer }
}

app.get('/health', (_req, res) => res.json({ ok: true }))
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3001)
  const httpServer = createServer(app)
  createGameServer(httpServer)
  httpServer.listen(port, () => console.log(`Blind Chess server listening on ${port}`))
}
