import cors from 'cors'
import express from 'express'
import { createServer, type Server as HttpServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { Server } from 'socket.io'
import {
  Chess, filterPosition, legalDestinations, validateTimerConfig,
  type ClockRequest, type ClockResponse, type ClockSnapshot, type MoveRequest,
  type RoomCreateRequest, type RoomJoinRequest, type RoomResumeRequest, type TimerConfig,
  type VisibilityMode, type RematchRequest, type RematchState,
} from '@blind-chess/shared'
import type { Color, Square } from 'chess.js'

const app = express()
app.use(cors())
export const httpApp = app
type Seat = { name: string; color: Color; token: string; socketId?: string; disconnectedAt?: number }
type Clock = { whiteMs: number; blackMs: number; activeColor: Color; activeSince?: number; running: boolean }
type Room = {
  mode: VisibilityMode; timer: TimerConfig; chess: Chess; players: Map<string, Seat>
  clock: Clock; lastMove?: { from: Square; to: Square }
  timeoutResult?: { winner?: Color; draw: boolean }
  rematchRequested: Set<Color>
}
export const rooms = new Map<string, Room>()
const code = () => Math.random().toString(36).slice(2, 7).toUpperCase()
const token = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

function snapshot(room: Room, now: () => number): ClockSnapshot {
  if (room.timer.mode === 'disabled') return { mode: 'disabled', whiteMs: null, blackMs: null, running: false }
  const whiteMs = room.clock.whiteMs
  const blackMs = room.clock.blackMs
  const elapsed = room.clock.running && room.clock.activeSince !== undefined ? Math.max(0, now() - room.clock.activeSince) : 0
  return {
    mode: 'timed',
    whiteMs: Math.max(0, Math.round(whiteMs - (room.clock.activeColor === 'w' ? elapsed : 0))),
    blackMs: Math.max(0, Math.round(blackMs - (room.clock.activeColor === 'b' ? elapsed : 0))),
    activeColor: room.clock.running ? room.clock.activeColor : undefined,
    running: room.clock.running,
  }
}

function refreshClock(room: Room, now: number) {
  if (!room.clock.running || room.clock.activeSince === undefined || room.timer.mode === 'disabled') return
  const elapsed = Math.max(0, now - room.clock.activeSince)
  const key = room.clock.activeColor === 'w' ? 'whiteMs' : 'blackMs'
  room.clock[key] = Math.max(0, room.clock[key] - elapsed)
  room.clock.activeSince = now
}

function roomState(roomCode: string, room: Room, now: () => number, disconnected = false, connectionStatus?: 'opponent-disconnected' | 'opponent-reconnected' | 'player-left') {
  return {
    roomCode, mode: room.mode, timer: room.timer, clock: snapshot(room, now),
    players: [...room.players.values()].map(({ name, color, socketId }) => ({ name, color, connected: Boolean(socketId) })),
    ...(disconnected ? { disconnected: true } : {}),
    ...(connectionStatus ? { connectionStatus } : {}),
  }
}

function view(room: Room, player: Seat, now: () => number) {
  const result = filterPosition(room.chess, player.color, room.mode, room.lastMove, snapshot(room, now))
  if (room.timeoutResult) {
    result.status = room.timeoutResult.draw ? 'draw' : 'timeout'
    result.resultReason = room.timeoutResult.draw ? 'timeout-insufficient-material' : 'timeout'
    result.winner = room.timeoutResult.winner
  }
  return result
}

function emitViews(io: Server, roomCode: string, now: () => number) {
  const room = rooms.get(roomCode)
  if (!room) return
  for (const player of room.players.values()) if (player.socketId) io.to(player.socketId).emit('game:view', view(room, player, now))
  io.to(roomCode).emit('game:clock', snapshot(room, now))
}

function rematchState(room: Room): RematchState {
  const requested = [...room.rematchRequested]
  if (requested.length === 0) return { status: 'idle' }
  if (requested.length === 2) return { status: 'agreed', agreedBy: requested }
  return { status: 'requested', requestedBy: requested[0] }
}

function emitRematch(io: Server, roomCode: string, room: Room) {
  const state = rematchState(room)
  io.to(roomCode).emit('game:rematch-state', state)
  io.to(roomCode).emit('game:rematch-status', state)
  io.to(roomCode).emit('game:rematch', state)
}

function adjudicateTimeout(room: Room, now: number) {
  refreshClock(room, now)
  const timedOut = room.clock.activeColor
  if ((timedOut === 'w' ? room.clock.whiteMs : room.clock.blackMs) > 0) return false
  room.timeoutResult = room.chess.isInsufficientMaterial()
    ? { draw: true }
    : { draw: false, winner: timedOut === 'w' ? 'b' : 'w' }
  room.clock.running = false
  room.clock.activeSince = undefined
  return true
}

export function createGameServer(httpServer: HttpServer = createServer(app), clockNow: () => number = () => performance.now()) {
  const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN ?? '*' } })
  io.on('connection', (socket) => {
    socket.on('room:create', (request: RoomCreateRequest, ack) => {
      let timer: TimerConfig
      try { timer = validateTimerConfig(request.timer) } catch { return ack({ ok: false, error: 'Invalid timer configuration.' }) }
      let roomCode = code()
      while (rooms.has(roomCode)) roomCode = code()
      const playerToken = token()
      const baseMs = timer.mode === 'timed' ? timer.baseSeconds * 1000 : 0
      const room: Room = {
        mode: request.mode, timer, chess: new Chess(),
        players: new Map([[playerToken, { name: request.name.trim() || 'White', color: 'w', token: playerToken, socketId: socket.id }]]),
        clock: { whiteMs: baseMs, blackMs: baseMs, activeColor: 'w', running: false },
        rematchRequested: new Set(),
      }
      rooms.set(roomCode, room)
      socket.join(roomCode)
      ack({ ok: true, roomCode, color: 'w', playerToken })
      socket.emit('room:state', roomState(roomCode, room, clockNow))
    })
    socket.on('room:join', (request: RoomJoinRequest, ack) => {
      const roomCode = request.roomCode.toUpperCase()
      const room = rooms.get(roomCode)
      if (!room) return ack({ ok: false, error: 'That room does not exist.' })
      if ([...room.players.values()].some((player) => player.socketId === socket.id)) return ack({ ok: false, error: 'You are already in that room.' })
      if (room.players.size >= 2) return ack({ ok: false, error: 'That room is already full.' })
      const playerToken = token()
      room.players.set(playerToken, { name: request.name.trim() || 'Black', color: 'b', token: playerToken, socketId: socket.id })
      if (room.timer.mode === 'timed') { room.clock.running = true; room.clock.activeSince = clockNow() }
      socket.join(roomCode)
      ack({ ok: true, roomCode, color: 'b', playerToken })
      io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow))
      emitViews(io, roomCode, clockNow)
    })
    socket.on('room:resume', (request: RoomResumeRequest, ack) => {
      const roomCode = request.roomCode.toUpperCase()
      const room = rooms.get(roomCode)
      const player = room?.players.get(request.playerToken)
      if (!room || !player) return ack({ ok: false, error: 'That room session has expired.' })
      if (player.socketId || [...room.players.values()].some((seat) => seat.socketId === socket.id)) return ack({ ok: false, error: 'That player seat is already connected.' })
      player.socketId = socket.id; player.disconnectedAt = undefined
      socket.join(roomCode)
      ack({ ok: true, roomCode, color: player.color, playerToken: request.playerToken })
      io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow, false, 'opponent-reconnected'))
      emitViews(io, roomCode, clockNow)
    })
    socket.on('room:leave', (request: RoomResumeRequest, ack) => {
      const roomCode = request.roomCode.toUpperCase(); const room = rooms.get(roomCode); const player = room?.players.get(request.playerToken)
      if (!room || !player || player.socketId !== socket.id) return ack?.({ ok: false, error: 'You are not in that room.' })
      room.players.delete(request.playerToken); socket.leave(roomCode)
      room.rematchRequested.clear()
      io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow, true, 'player-left'))
      io.to(roomCode).emit('game:rematch-state', { status: 'unavailable', reason: 'opponent-left' } satisfies RematchState)
      io.to(roomCode).emit('game:rematch-status', { status: 'unavailable', reason: 'opponent-left' } satisfies RematchState)
      io.to(roomCode).emit('game:rematch', { status: 'unavailable', reason: 'opponent-left' } satisfies RematchState)
      if (room.players.size === 0) rooms.delete(roomCode)
      ack?.({ ok: true })
    })
    const rematchRequest = (request: unknown, ack?: (value: { ok: boolean; error?: string; duplicate?: boolean }) => void) => {
      const reply = (value: { ok: boolean; error?: string; duplicate?: boolean }) => { if (typeof ack === 'function') ack(value) }
      if (!request || typeof request !== 'object') return reply({ ok: false, error: 'Invalid rematch request.' })
      const { roomCode, playerToken } = request as Partial<RematchRequest>
      if (typeof roomCode !== 'string' || typeof playerToken !== 'string' || !roomCode || !playerToken) {
        return reply({ ok: false, error: 'Invalid rematch request.' })
      }
      const normalizedCode = roomCode.toUpperCase()
      const room = rooms.get(normalizedCode)
      const player = room?.players.get(playerToken)
      if (!room || !player || player.socketId !== socket.id) return reply({ ok: false, error: 'You are not a member of that room.' })
      if (room.players.size !== 2 || [...room.players.values()].some((seat) => !seat.socketId)) {
        const state = { status: 'unavailable', reason: [...room.players.values()].some((seat) => !seat.socketId) ? 'opponent-disconnected' : 'opponent-left' } satisfies RematchState
        io.to(normalizedCode).emit('game:rematch-state', state)
        io.to(normalizedCode).emit('game:rematch-status', state)
        io.to(normalizedCode).emit('game:rematch', state)
        return reply({ ok: false, error: 'Your opponent is unavailable.' })
      }
      if (room.rematchRequested.has(player.color)) {
        emitRematch(io, normalizedCode, room)
        return reply({ ok: true, duplicate: true })
      }
      room.rematchRequested.add(player.color)
      if (room.rematchRequested.size < 2) {
        emitRematch(io, normalizedCode, room)
        return reply({ ok: true })
      }
      room.chess = new Chess()
      room.lastMove = undefined
      room.timeoutResult = undefined
      const baseMs = room.timer.mode === 'timed' ? room.timer.baseSeconds * 1000 : 0
      room.clock = { whiteMs: baseMs, blackMs: baseMs, activeColor: 'w', running: room.timer.mode === 'timed', activeSince: room.timer.mode === 'timed' ? clockNow() : undefined }
      emitRematch(io, normalizedCode, room)
      io.to(normalizedCode).emit('room:state', roomState(normalizedCode, room, clockNow))
      emitViews(io, normalizedCode, clockNow)
      return reply({ ok: true })
    }
    socket.on('game:rematch-request', rematchRequest)
    socket.on('game:rematch', rematchRequest)
    socket.on('game:move', (request: { roomCode: string; move: MoveRequest; playerToken: string }, ack) => {
      const room = rooms.get(request.roomCode); const player = room?.players.get(request.playerToken)
      if (!room || !player || player.socketId !== socket.id) return ack({ ok: false, error: 'You are not a member of that room.' })
      const now = clockNow()
      if (room.timeoutResult || room.chess.isGameOver()) return ack({ ok: false, error: 'The game is over.' })
      if (room.timer.mode === 'timed' && adjudicateTimeout(room, now)) {
        emitViews(io, request.roomCode, clockNow); return ack({ ok: false, error: 'Time expired.' })
      }
      if (room.chess.turn() !== player.color) return ack({ ok: false, error: 'It is not your turn.' })
      try {
        const result = room.chess.move(request.move)
        room.lastMove = { from: result.from, to: result.to }
        if (room.timer.mode === 'timed') {
          refreshClock(room, now)
          const moverKey = player.color === 'w' ? 'whiteMs' : 'blackMs'
          room.clock[moverKey] += room.timer.incrementSeconds * 1000
          if (room.chess.isGameOver()) { room.clock.running = false; room.clock.activeSince = undefined }
          else { room.clock.activeColor = player.color === 'w' ? 'b' : 'w'; room.clock.activeSince = now }
        }
        ack({ ok: true }); emitViews(io, request.roomCode, clockNow)
        io.to(request.roomCode).emit('game:status', { status: room.chess.isGameOver() ? 'game-over' : 'playing' })
      } catch { ack({ ok: false, error: 'That move is not legal.' }) }
    })
    const clockRequest = (request: unknown, ack?: (value: ClockResponse) => void) => {
      const reply = (response: ClockResponse) => {
        if (typeof ack === 'function') ack(response)
      }
      if (!request || typeof request !== 'object') return reply({ ok: false, error: 'Invalid clock request.' })
      const { roomCode, playerToken } = request as Partial<ClockRequest>
      if (typeof roomCode !== 'string' || typeof playerToken !== 'string' || !roomCode || !playerToken) {
        return reply({ ok: false, error: 'Invalid clock request.' })
      }
      const room = rooms.get(roomCode.toUpperCase()); const player = room?.players.get(playerToken)
      if (!room || !player || player.socketId !== socket.id) return reply({ ok: false, error: 'You are not a member of that room.' })
      if (room.timer.mode === 'timed' && !room.timeoutResult && adjudicateTimeout(room, clockNow())) emitViews(io, roomCode.toUpperCase(), clockNow)
      reply({ ok: true, clock: snapshot(room, clockNow) })
    }
    socket.on('game:clock', clockRequest)
    socket.on('game:clock-request', clockRequest)
    socket.on('game:legal-moves', (request: { roomCode: string; playerToken: string; from: Square }, ack) => {
      const room = rooms.get(request.roomCode); const player = room?.players.get(request.playerToken)
      if (!room || !player || player.socketId !== socket.id) return ack({ ok: false, error: 'You are not a member of that room.' })
      ack({ ok: true, destinations: legalDestinations(room.chess, player.color, request.from, room.mode) })
    })
    socket.on('disconnect', () => {
      for (const [roomCode, room] of rooms) {
        const player = [...room.players.values()].find((seat) => seat.socketId === socket.id)
        if (!player) continue
        player.socketId = undefined; player.disconnectedAt = Date.now()
        io.to(roomCode).emit('room:state', roomState(roomCode, room, clockNow, true, 'opponent-disconnected'))
        room.rematchRequested.clear()
        const state = { status: 'unavailable', reason: 'opponent-disconnected' } satisfies RematchState
        io.to(roomCode).emit('game:rematch-state', state)
        io.to(roomCode).emit('game:rematch-status', state)
        io.to(roomCode).emit('game:rematch', state)
      }
    })
  })
  return { io, httpServer }
}

app.get('/health', (_req, res) => res.json({ ok: true }))
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3001); const httpServer = createServer(app); createGameServer(httpServer)
  httpServer.listen(port, () => console.log(`Blind Chess server listening on ${port}`))
}
