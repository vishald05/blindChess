import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { io, type Socket } from 'socket.io-client'
import { ArrowLeft, Cloud, Copy, Eye, EyeOff, RotateCcw, Shield, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { Chess, boardSquares, filterPosition, type AuthorizedView, type ClockRequest, type ClockResponse, type ClockSnapshot, type LegalDestination, type MoveRequest, type PlayMethod, type RoomState, type TimerConfig, type VisibilityMode } from '@blind-chess/shared'
import './styles.css'

const modes: Array<{ id: VisibilityMode; title: string; description: string; icon: React.ReactNode }> = [
  { id: 'normal', title: 'Normal', description: 'Every piece, every plan. Classic chess with a clearer sky.', icon: <Eye size={18} /> },
  { id: 'semi-blind', title: 'Semi-Blind', description: 'See where they are, not what they are. Trust your instincts.', icon: <Shield size={18} /> },
  { id: 'blind-pro', title: 'Blind-Pro', description: 'Your pieces only. The rest is beautifully uncertain.', icon: <EyeOff size={18} /> },
]
const symbols: Record<string, string> = { wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔', bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚' }
const serverUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001'

type OnlinePhase = 'setup' | 'waiting' | 'game'
type OnlineState = { phase: OnlinePhase; roomCode?: string; playerToken?: string; color?: 'w' | 'b'; room?: RoomState; view?: AuthorizedView; clock?: ClockSnapshot; error?: string; connected: boolean; pending: boolean; message?: string }
type Promotion = { from: string; to: string }
const timerPresets = [60, 180, 300, 600, 900, 1800]
const incrementPresets = [0, 1, 2, 3, 5, 10, 15]
const disabledClock: ClockSnapshot = { mode: 'disabled', whiteMs: null, blackMs: null, running: false }
const onlineClockSince = { current: 0 }
const formatClock = (milliseconds: number | null | undefined) => {
  if (milliseconds === null || milliseconds === undefined) return '—'
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}
const clockWithElapsed = (clock: ClockSnapshot | undefined, since: number, now: number): ClockSnapshot => {
  if (!clock || clock.mode === 'disabled' || !clock.running || !clock.activeColor) return clock ?? disabledClock
  const elapsed = Math.max(0, now - since)
  return {
    ...clock,
    whiteMs: Math.max(0, (clock.whiteMs ?? 0) - (clock.activeColor === 'w' ? elapsed : 0)),
    blackMs: Math.max(0, (clock.blackMs ?? 0) - (clock.activeColor === 'b' ? elapsed : 0)),
  }
}

function playTone(kind: 'check' | 'checkmate') {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = kind === 'checkmate' ? 220 : 520
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (kind === 'checkmate' ? 0.42 : 0.16))
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + (kind === 'checkmate' ? 0.42 : 0.16))
  oscillator.addEventListener('ended', () => void context.close())
}

function App() {
  const [page, setPage] = useState<'home' | 'setup' | 'game'>('home')
  const [method, setMethod] = useState<PlayMethod>('local')
  const [mode, setMode] = useState<VisibilityMode>('normal')
  const [names, setNames] = useState(['Alex', 'Robin'])
  const [timer, setTimer] = useState<TimerConfig>({ mode: 'disabled' })
  const [chess, setChess] = useState(() => new Chess())
  const [selected, setSelected] = useState<string>()
  const [handoff, setHandoff] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w')
  const [promotion, setPromotion] = useState<Promotion>()
  const [legalMoves, setLegalMoves] = useState<LegalDestination[]>([])
  const [muted, setMuted] = useState(false)
  const [online, setOnline] = useState<OnlineState>({ phase: 'setup', connected: false, pending: false })
  const [localClock, setLocalClock] = useState<ClockSnapshot>(disabledClock)
  const [clockNow, setClockNow] = useState(() => performance.now())
  const localClockSince = useRef(0)
  const socketRef = useRef<Socket>()
  const selectionVersion = useRef(0)

  useEffect(() => () => { socketRef.current?.disconnect() }, [])
  useEffect(() => {
    const timerId = window.setInterval(() => setClockNow(performance.now()), 100)
    return () => window.clearInterval(timerId)
  }, [])
  useEffect(() => {
    if (method !== 'online' || !online.roomCode || !online.playerToken || online.room?.timer.mode !== 'timed') return
    const sync = () => {
      const socket = socketRef.current
      if (!socket || !online.roomCode || !online.playerToken) return
      const request: ClockRequest = { roomCode: online.roomCode, playerToken: online.playerToken }
      socket.timeout(1500).emit('game:clock-request', request, (error: Error | null, response: ClockResponse) => {
        if (error) {
          setOnline((current) => ({ ...current, message: 'Clock synchronization is delayed. Retrying…' }))
          return
        }
        if (!response?.ok) {
          setOnline((current) => ({ ...current, error: response?.error ?? 'Clock synchronization failed.' }))
        }
      })
    }
    sync()
    const timerId = window.setInterval(sync, 500)
    return () => window.clearInterval(timerId)
  }, [method, online.roomCode, online.playerToken, online.room?.timer.mode])
  useEffect(() => { setSelected(undefined); setLegalMoves([]); setPromotion(undefined) }, [online.view?.moveCount])
  const localView = useMemo(() => filterPosition(chess, playerColor, mode), [chess, mode, playerColor])
  const activeView = method === 'online' ? online.view : localView
  const displayedClock = method === 'online'
    ? clockWithElapsed(online.clock ?? online.view?.clock, onlineClockSince.current, clockNow)
    : clockWithElapsed(localClock, localClockSince.current, clockNow)
  const lastAnnounced = useRef('')
  useEffect(() => {
    if (!activeView || activeView.status === 'playing') return
    const announcement = `${activeView.status}:${activeView.moveCount}`
    if (lastAnnounced.current === announcement) return
    lastAnnounced.current = announcement
    if (activeView.status === 'checkmate' && !muted) playTone('checkmate')
  }, [activeView, muted])
  useEffect(() => {
    if (!activeView?.checkedColor || activeView.status === 'checkmate') return
    const announcement = `check:${activeView.moveCount}`
    if (lastAnnounced.current === announcement) return
    lastAnnounced.current = announcement
    if (!muted) playTone('check')
  }, [activeView, muted])
  const localLegalMoves = useMemo(() => selected ? chess.moves({ square: selected as never, verbose: true }).map((move) => ({ square: move.to, capture: mode !== 'blind-pro' && Boolean(chess.get(move.to)?.color && chess.get(move.to)?.color !== playerColor) })) : [], [chess, mode, playerColor, selected])
  const startLocal = () => {
    setChess(new Chess()); setPlayerColor('w'); setPage('game'); setReady(mode === 'normal'); setHandoff(mode !== 'normal'); setMessage(''); lastAnnounced.current = ''
    const initialClock: ClockSnapshot = timer.mode === 'timed'
      ? { mode: 'timed', whiteMs: timer.baseSeconds * 1000, blackMs: timer.baseSeconds * 1000, activeColor: mode === 'normal' ? 'w' : undefined, running: mode === 'normal' }
      : disabledClock
    setLocalClock(initialClock); localClockSince.current = performance.now()
  }
  const openSetup = (nextMethod: PlayMethod) => { setMethod(nextMethod); setOnline({ phase: 'setup', connected: false, pending: false }); setPage('setup') }
  const leaveOnline = () => {
    const socket = socketRef.current
    if (socket && online.roomCode && online.playerToken) socket.emit('room:leave', { roomCode: online.roomCode, playerToken: online.playerToken })
    localStorage.removeItem('blindChessSession')
    socket?.disconnect(); socketRef.current = undefined
    setOnline({ phase: 'setup', connected: false, pending: false }); setPage('home')
  }
  const makeLocalMove = (move: MoveRequest) => {
    try {
      const moveStartedAt = performance.now()
      chess.move(move)
      if (timer.mode === 'timed') {
        const elapsed = Math.max(0, moveStartedAt - localClockSince.current)
        const mover = chess.turn() === 'w' ? 'b' : 'w'
        const moverKey = mover === 'w' ? 'whiteMs' : 'blackMs'
        const handoffPause = mode !== 'normal' && !chess.isGameOver()
        const nextClock: ClockSnapshot = { ...localClock, [moverKey]: Math.max(0, (localClock[moverKey] ?? 0) - elapsed + timer.incrementSeconds * 1000), activeColor: chess.isGameOver() || handoffPause ? undefined : chess.turn(), running: !chess.isGameOver() && !handoffPause }
        setLocalClock(nextClock); localClockSince.current = moveStartedAt
      }
      setChess(new Chess(chess.fen())); setSelected(undefined); setLegalMoves([]); setPromotion(undefined)
      if (chess.isGameOver()) setMessage(chess.isCheckmate() ? 'Checkmate. A questionable move, a perfectly valid lesson.' : 'Draw game.')
      else { setPlayerColor(chess.turn()); if (mode !== 'normal') { setReady(false); setHandoff(true) } }
    } catch { setMessage('That move is not legal.') }
  }
  const chooseLocalSquare = (square: string) => {
    if (!ready || chess.isGameOver()) return
    const piece = chess.get(square as never)
    if (!selected) {
      if (square === selected) { setSelected(undefined); setLegalMoves([]); return }
      if (piece?.color === chess.turn()) {
        setSelected(square)
        setLegalMoves(chess.moves({ square: square as never, verbose: true }).map((move) => ({ square: move.to, capture: mode !== 'blind-pro' && Boolean(chess.get(move.to)?.color && chess.get(move.to)?.color !== playerColor) })))
      }
      return
    }
    const movingPiece = chess.get(selected as never)
    if (piece?.color === chess.turn()) {
      setSelected(square)
      setLegalMoves(chess.moves({ square: square as never, verbose: true }).map((move) => ({ square: move.to, capture: mode !== 'blind-pro' && Boolean(chess.get(move.to)?.color && chess.get(move.to)?.color !== playerColor) })))
      return
    }
    if (movingPiece?.type === 'p' && (square.endsWith('1') || square.endsWith('8'))) return setPromotion({ from: selected, to: square })
    makeLocalMove({ from: selected as never, to: square as never })
  }
  const choosePromotion = (piece: 'q' | 'r' | 'b' | 'n') => {
    if (promotion && method === 'local') makeLocalMove({ from: promotion.from as never, to: promotion.to as never, promotion: piece })
    else if (promotion) { chooseOnlineSquare(promotion.to, online, setSelected, socketRef, promotion.from, setOnline, piece, setPromotion, setLegalMoves, selectionVersion) }
  }
  if (page === 'home') return <Home onStart={openSetup} />
  if (page === 'setup') return <Setup method={method} names={names} setNames={setNames} mode={mode} setMode={setMode} timer={timer} setTimer={setTimer} online={online} setOnline={setOnline} onBack={() => setPage('home')} onStart={() => method === 'local' ? startLocal() : undefined} onOnlineStart={(state) => { setOnline(state); setPage('game') }} socketRef={socketRef} />
  if (method === 'online') {
    if (online.phase === 'waiting') return <Waiting online={online} onLeave={leaveOnline} />
    return <Game view={online.view} clock={displayedClock} mode={online.room?.mode ?? mode} names={online.room?.players.map((p) => p.name) ?? ['You', 'Opponent']} selected={selected} legalMoves={legalMoves} onSquare={(square) => chooseOnlineSquare(square, online, setSelected, socketRef, selected, setOnline, undefined, setPromotion, setLegalMoves, selectionVersion)} handoff={false} ready={true} setReady={() => undefined} onExit={leaveOnline} message={online.error ?? online.message ?? (online.connected ? '' : 'Connecting to the game server…')} pending={online.pending} onlineColor={online.color} promotion={promotion} onPromotion={choosePromotion} muted={muted} onToggleMute={() => setMuted((value) => !value)} />
  }
  return <Game view={localView} clock={displayedClock} chess={chess} selected={selected} legalMoves={localLegalMoves} onSquare={chooseLocalSquare} mode={mode} names={names} handoff={handoff} ready={ready} setReady={() => { setReady(true); setHandoff(false); if (timer.mode === 'timed') { setLocalClock((current) => ({ ...current, activeColor: chess.turn(), running: true })); localClockSince.current = performance.now() } }} onExit={() => setPage('home')} message={message} pending={false} promotion={promotion} onPromotion={choosePromotion} muted={muted} onToggleMute={() => setMuted((value) => !value)} />
}

function connectOnline(socketRef: React.MutableRefObject<Socket | undefined>, setOnline: React.Dispatch<React.SetStateAction<OnlineState>>) {
  if (socketRef.current) return socketRef.current
  const socket = io(serverUrl, { autoConnect: true, reconnection: true })
  socketRef.current = socket
  setOnline((current) => ({ ...current, connected: socket.connected, error: undefined }))
  socket.on('connect', () => {
    setOnline((current) => ({ ...current, connected: true, error: undefined }))
    const saved = localStorage.getItem('blindChessSession')
    if (!saved) return
    try {
      const session = JSON.parse(saved) as { roomCode?: string; playerToken?: string }
      if (session.roomCode && session.playerToken) {
        socket.emit('room:resume', session, (result: { ok: boolean; error?: string; color?: 'w' | 'b' }) => {
          if (!result.ok) {
            localStorage.removeItem('blindChessSession')
            setOnline((current) => ({ ...current, error: result.error ?? 'Your room session has expired.', pending: false }))
          } else {
            setOnline((current) => ({ ...current, roomCode: session.roomCode, playerToken: session.playerToken, color: result.color, pending: false }))
          }
        })
      }
    } catch {
      localStorage.removeItem('blindChessSession')
    }
  })
  socket.on('connect_error', () => setOnline((current) => ({ ...current, connected: false, pending: false, error: 'The game server is unavailable. Check the server URL and try again.' })))
  socket.on('disconnect', () => setOnline((current) => ({ ...current, connected: false, message: 'Your connection was interrupted. Trying to reconnect…' })))
  socket.on('room:state', (room: RoomState) => setOnline((current) => {
    onlineClockSince.current = performance.now()
    const opponent = current.color ? room.players.find((player) => player.color !== current.color) : undefined
    const opponentDisconnected = Boolean(opponent && opponent.connected === false)
    return {
      ...current,
      room,
      phase: room.players.length === 2 ? 'game' : 'waiting',
      message: room.connectionStatus === 'player-left' ? 'Your opponent left the room.' : opponentDisconnected ? 'Your opponent disconnected. Waiting for them to reconnect…' : current.connected ? (current.message?.includes('opponent') ? 'Your opponent is connected again.' : undefined) : current.message,
      error: room.connectionStatus === 'player-left' ? 'The other player left this room.' : undefined,
    }
  }))
  socket.on('game:view', (view: AuthorizedView) => {
    onlineClockSince.current = performance.now()
    setOnline((current) => ({ ...current, view, clock: view.clock, phase: 'game', pending: false, error: undefined, message: current.message === 'Your opponent is connected again.' ? undefined : current.message?.includes('opponent') ? current.message : undefined }))
  })
  socket.on('game:clock', (clock: ClockSnapshot) => {
    onlineClockSince.current = performance.now()
    setOnline((current) => ({ ...current, clock }))
  })
  socket.on('game:status', ({ status }: { status: string }) => setOnline((current) => ({ ...current, message: status === 'game-over' ? 'Game over.' : undefined })))
  return socket
}

function chooseOnlineSquare(square: string, online: OnlineState, setSelected: React.Dispatch<React.SetStateAction<string | undefined>>, socketRef: React.MutableRefObject<Socket | undefined>, selected: string | undefined, setOnline: React.Dispatch<React.SetStateAction<OnlineState>>, promotion?: 'q' | 'r' | 'b' | 'n', setPromotion?: React.Dispatch<React.SetStateAction<Promotion | undefined>>, setLegalMoves?: React.Dispatch<React.SetStateAction<LegalDestination[]>>, selectionVersion?: React.MutableRefObject<number>) {
  if (!online.view || online.pending || online.view.status !== 'playing' || online.view.turn !== online.color || !online.roomCode || !online.playerToken) return
  const ownPiece = online.view.pieces.find((piece) => piece.square === square && piece.color === online.color)
  if (!selected) {
    if (!ownPiece) return
    setSelected(square)
    const requestVersion = selectionVersion ? ++selectionVersion.current : 0
    socketRef.current?.emit('game:legal-moves', { roomCode: online.roomCode, playerToken: online.playerToken, from: square }, (result: { ok: boolean; destinations?: LegalDestination[]; error?: string }) => {
      if (result.ok && (!selectionVersion || selectionVersion.current === requestVersion)) setLegalMoves?.(result.destinations ?? [])
      else setOnline((current) => ({ ...current, error: result.error ?? 'Legal moves are unavailable.' }))
    })
    return
  }
  if (square === selected) { if (selectionVersion) selectionVersion.current += 1; setSelected(undefined); setLegalMoves?.([]); return }
  if (ownPiece) {
    setSelected(square)
    const requestVersion = selectionVersion ? ++selectionVersion.current : 0
    setLegalMoves?.([])
    socketRef.current?.emit('game:legal-moves', { roomCode: online.roomCode, playerToken: online.playerToken, from: square }, (result: { ok: boolean; destinations?: LegalDestination[]; error?: string }) => {
      if (result.ok && (!selectionVersion || selectionVersion.current === requestVersion)) setLegalMoves?.(result.destinations ?? [])
      else setOnline((current) => ({ ...current, error: result.error ?? 'Legal moves are unavailable.' }))
    })
    return
  }
  const selectedPiece = online.view.pieces.find((piece) => piece.square === selected)
  if (!promotion && selectedPiece?.type === 'p' && (square.endsWith('1') || square.endsWith('8'))) return setPromotion?.({ from: selected, to: square })
  const move: MoveRequest = { from: selected as never, to: square as never, ...(promotion ? { promotion } : {}) }
  if (selectionVersion) selectionVersion.current += 1
  setSelected(undefined); setLegalMoves?.([]); setOnline((current) => ({ ...current, pending: true, error: undefined }))
  socketRef.current?.emit('game:move', { roomCode: online.roomCode, playerToken: online.playerToken, move }, (result: { ok: boolean; error?: string }) => {
    if (!result.ok) setOnline((current) => ({ ...current, pending: false, error: result.error ?? 'The server rejected that move.' }))
  })
}

function Home({ onStart }: { onStart: (method: PlayMethod) => void }) {
  return <main className="shell home"><header><div className="brand"><span className="brand-mark"><Cloud size={21} /></span> Blind<span>Chess</span></div><span className="eyebrow">QUIETLY COMPETITIVE</span></header><section className="hero"><div className="hero-copy"><p className="kicker"><Sparkles size={15} /> A different kind of chess</p><h1>Read the board.<br /><em>Question everything.</em></h1><p className="lede">A thoughtful chess game where visibility is part of the strategy. Play it classic, semi-blind, or go all the way into the fog.</p><div className="actions"><button className="primary" onClick={() => onStart('local')}>Pass N Play <span>→</span></button><button className="secondary" onClick={() => onStart('online')}>Online Play <span>↗</span></button></div><p className="fine-print">Built with chess logic, patience, and at least one questionable commit.</p></div><div className="preview-card"><div className="sky-line" /><MiniBoard /><div className="preview-caption"><span>THE BOARD IS QUIET</span><span>YOUR MOVE ISN'T</span></div></div></section><section className="mode-section"><div><p className="kicker">CHOOSE YOUR VISIBILITY</p><h2>Three ways to see the same game.</h2></div><div className="mode-grid">{modes.map((item, index) => <article className={`mode-card mode-${index}`} key={item.id}><div className="mode-icon">{item.icon}</div><h3>{item.title}</h3><p>{item.description}</p><div className="mode-number">0{index + 1}</div></article>)}</div></section></main>
}

function MiniBoard() { return <div className="mini-board">{Array.from({ length: 64 }, (_, i) => <div className={(Math.floor(i / 8) + i) % 2 ? 'dark' : ''} key={i}>{[0, 7].includes(Math.floor(i / 8)) ? <span>{symbols[`w${['r','n','b','q','k','b','n','r'][i % 8]}`]}</span> : null}</div>)}</div> }

function Setup({ method, names, setNames, mode, setMode, timer, setTimer, online, setOnline, onBack, onStart, onOnlineStart, socketRef }: { method: PlayMethod; names: string[]; setNames: (v: string[]) => void; mode: VisibilityMode; setMode: (v: VisibilityMode) => void; timer: TimerConfig; setTimer: (v: TimerConfig) => void; online: OnlineState; setOnline: React.Dispatch<React.SetStateAction<OnlineState>>; onBack: () => void; onStart: () => void; onOnlineStart: (state: OnlineState) => void; socketRef: React.MutableRefObject<Socket | undefined> }) {
  const [joinCode, setJoinCode] = useState('')
  const [join, setJoin] = useState(false)
  const submit = () => {
    if (method === 'local') return onStart()
    if (!names[0].trim()) return setOnline((current) => ({ ...current, error: 'Enter a display name first.' }))
    const socket = connectOnline(socketRef, setOnline)
    setOnline((current) => ({ ...current, pending: true, error: undefined }))
    const event = join ? 'room:join' : 'room:create'
    const payload = join ? { name: names[0], roomCode: joinCode.trim().toUpperCase() } : { name: names[0], mode, timer }
    socket.emit(event, payload, (result: { ok: boolean; error?: string; roomCode?: string; color?: 'w' | 'b'; playerToken?: string }) => {
      if (!result.ok || !result.roomCode || !result.playerToken || !result.color) return setOnline((current) => ({ ...current, pending: false, error: result.error ?? 'The server rejected the request.' }))
      const state = { ...online, phase: 'waiting' as const, roomCode: result.roomCode, playerToken: result.playerToken, color: result.color, pending: false, error: undefined, connected: true }
      localStorage.setItem('blindChessSession', JSON.stringify({ roomCode: result.roomCode, playerToken: result.playerToken }))
      setOnline(state); onOnlineStart(state)
    })
  }
  const timerSummary = timer.mode === 'timed' ? `${timer.baseSeconds / 60}|${timer.incrementSeconds}` : 'No timer'
  return <main className="shell setup"><button className="back" onClick={onBack}><ArrowLeft size={16} /> Back home</button><div className="setup-inner"><p className="kicker">{method === 'local' ? 'PASS N PLAY' : 'ONLINE PLAY'}</p><h1>{method === 'local' ? 'Set the atmosphere.' : join ? 'Join the table.' : 'Open a table.'}</h1><p className="lede">Two minds, one board. Pick how much of it you want to reveal.</p>{online.error && <div className="error-banner" role="alert">{online.error}</div>}<div className="form-grid single"><label>Your display name<input value={names[0]} maxLength={24} onChange={(e) => setNames([e.target.value, names[1]])} /></label>{method === 'local' && <label>Black player<input value={names[1]} onChange={(e) => setNames([names[0], e.target.value])} /></label>}</div>{method === 'online' && join ? <><label>Room code<input value={joinCode} maxLength={5} autoCapitalize="characters" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} /></label>{online.room?.timer && <div className="status-banner">Room settings: {online.room.mode} · {online.room.timer.mode === 'timed' ? `${online.room.timer.baseSeconds / 60}|${online.room.timer.incrementSeconds}` : 'No timer'}</div>}</> : <><p className="label">Visibility mode</p><div className="setup-modes">{modes.map((item) => <button type="button" className={mode === item.id ? 'mode-choice active' : 'mode-choice'} onClick={() => setMode(item.id)} key={item.id}>{item.icon}<strong>{item.title}</strong><small>{item.description}</small></button>)}</div><p className="label">Time control</p><div className="timer-options"><button type="button" className={timer.mode === 'disabled' ? 'mode-choice active' : 'mode-choice'} onClick={() => setTimer({ mode: 'disabled' })}><strong>No timer</strong><small>Play without a clock.</small></button><button type="button" className={timer.mode === 'timed' ? 'mode-choice active' : 'mode-choice'} onClick={() => setTimer({ mode: 'timed', baseSeconds: 300, incrementSeconds: 0 })}><strong>Timed game</strong><small>{timerSummary}</small></button></div>{timer.mode === 'timed' && <div className="timer-selects"><label>Base time<select value={timer.baseSeconds} onChange={(e) => setTimer({ ...timer, baseSeconds: Number(e.target.value) })}>{timerPresets.map((seconds) => <option value={seconds} key={seconds}>{seconds / 60} minutes</option>)}</select></label><label>Increment<select value={timer.incrementSeconds} onChange={(e) => setTimer({ ...timer, incrementSeconds: Number(e.target.value) })}>{incrementPresets.map((seconds) => <option value={seconds} key={seconds}>{seconds} seconds</option>)}</select></label></div>}</>}</div>{method === 'online' && <button className="text-button" onClick={() => setJoin(!join)}>{join ? 'Create a new room instead' : 'Join a room with a code'}</button>}<button className="primary wide" disabled={online.pending} onClick={submit}>{online.pending ? 'Connecting…' : method === 'local' ? 'Start game' : join ? 'Join room' : 'Create room'} <span>→</span></button></main>
}

function Waiting({ online, onLeave }: { online: OnlineState; onLeave: () => void }) {
  const copy = () => { if (online.roomCode) void navigator.clipboard?.writeText(online.roomCode) }
  const timerLabel = online.room?.timer.mode === 'timed' ? `${online.room.timer.baseSeconds / 60}|${online.room.timer.incrementSeconds}` : 'No timer'
  return <main className="shell waiting"><button className="back" onClick={onLeave}><ArrowLeft size={16} /> Leave room</button><div className="waiting-card"><p className="kicker">WAITING FOR A SECOND PLAYER</p><h1>Your table is ready.</h1><p className="lede">Share this code with your opponent. The game begins as soon as they join.</p>{online.error && <div className="error-banner" role="alert">{online.error}</div>}{online.message && <div className="status-banner" role="status">{online.message}</div>}<button className="room-code" onClick={copy} aria-label="Copy room code">{online.roomCode}<Copy size={17} /></button><div className="status-banner">Visibility: {online.room?.mode ?? 'normal'} · Time: {timerLabel}</div><div className="waiting-player"><span className="avatar">W</span><strong>{online.room?.players[0]?.name ?? 'You'}</strong><small>White · connected</small></div><p className="fine-print">{online.connected ? 'Connected to the game server.' : 'Reconnecting…'}</p></div></main>
}

function Game({ view, clock = disabledClock, chess, selected, legalMoves, onSquare, mode, names, handoff, ready, setReady, onExit, message, pending, onlineColor, promotion, onPromotion, muted, onToggleMute }: { view?: AuthorizedView; clock?: ClockSnapshot; chess?: Chess; selected?: string; legalMoves: LegalDestination[]; onSquare: (square: string) => void; mode: VisibilityMode; names: string[]; handoff: boolean; ready: boolean; setReady: () => void; onExit: () => void; message: string; pending: boolean; onlineColor?: 'w' | 'b'; promotion?: Promotion; onPromotion: (piece: 'q' | 'r' | 'b' | 'n') => void; muted: boolean; onToggleMute: () => void }) {
  const activeView = view
  const orientation = onlineColor ?? activeView?.playerColor ?? 'w'
  const timedOut = clock.mode === 'timed' && ((clock.activeColor === 'w' && clock.whiteMs === 0) || (clock.activeColor === 'b' && clock.blackMs === 0))
  const terminal = activeView?.status !== 'playing' || timedOut
  const reason = activeView?.resultReason
  const winnerName = activeView?.winner === 'w' ? names[0] : names[1]
  const resultText = timedOut && chess?.isInsufficientMaterial() ? 'Draw — opponent has insufficient mating material' : timedOut ? `${clock.activeColor === 'w' ? names[1] : names[0]} wins on time` : activeView?.status === 'timeout' || reason === 'timeout' ? `${activeView?.winner === 'w' ? names[0] : names[1]} wins on time` : reason === 'timeout-insufficient-material' ? 'Draw — opponent has insufficient mating material' : activeView?.status === 'checkmate' ? `${winnerName} wins by checkmate` : reason === 'stalemate' ? 'Draw by stalemate' : reason === 'insufficient-material' ? 'Draw by insufficient material' : reason === 'threefold-repetition' ? 'Draw by threefold repetition' : reason === 'fifty-move-rule' ? 'Draw by the fifty-move rule' : terminal ? 'Draw game' : ''
  const statusText = message || resultText || (activeView?.checkedColor ? 'Check — the king is under attack.' : activeView ? activeView.turn === onlineColor ? 'Your turn.' : 'Opponent’s turn.' : chess?.isGameOver() ? 'Game over.' : `${names[0]}'s turn`)
  return <main className="shell game"><header><button className="back" onClick={onExit}><ArrowLeft size={16} /> Exit game</button><div className="game-meta"><span className="mode-pill">{modes.find((item) => item.id === mode)?.title}</span><span>Move {Math.floor((activeView?.moveCount ?? 0) / 2) + 1}</span><button className="sound-toggle" onClick={onToggleMute} aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div></header><div className="live-region" role="status" aria-live="polite">{statusText}</div><div className="game-layout"><aside className="player-panel"><ClockView color="w" name={names[0]} milliseconds={clock.whiteMs} active={clock.activeColor === 'w' && !terminal} /><div className={`player ${activeView?.turn === 'w' ? 'turn' : ''}`}><span className="avatar">W</span><div><strong>{names[0]}</strong><small>White</small></div></div><div className={`status-note ${activeView?.checkedColor === 'w' ? 'check-note' : ''}`}>{pending ? 'Sending move…' : statusText}</div><div className="rules-note"><Shield size={16} /><span>{mode === 'normal' ? 'Full board visibility' : mode === 'semi-blind' ? 'Opponent pieces are anonymous' : 'Only your pieces are visible'}</span></div></aside><div className="board-wrap"><Board view={activeView} selected={selected} legalMoves={legalMoves} orientation={orientation} onSquare={onSquare} disabled={terminal} /></div><aside className="player-panel right"><ClockView color="b" name={names[1]} milliseconds={clock.blackMs} active={clock.activeColor === 'b' && !terminal} /><div className={`player ${activeView?.turn === 'b' ? 'turn' : ''}`}><span className="avatar dark-avatar">B</span><div><strong>{names[1]}</strong><small>Black</small></div></div><div className="history"><p className="label">Recent moves</p>{activeView?.publicHistory.slice(-6).map((move, i) => <div className="history-row" key={`${move.from}-${move.to}-${i}`}><span>{move.from} → {move.to}</span>{move.san && <small>{move.san}</small>}</div>)}</div><button className="quiet-button" onClick={onExit}><RotateCcw size={15} /> Leave table</button></aside></div>{terminal && <div className={`result-banner ${activeView?.status === 'checkmate' ? 'mate' : ''}`} role="alert"><strong>{activeView?.status === 'checkmate' ? 'CHECKMATE' : 'GAME OVER'}</strong><span>{resultText}</span><button className="primary" onClick={onExit}>Play again</button></div>}{promotion && <div className="promotion"><div className="promotion-card"><p className="kicker">CHOOSE PROMOTION</p><h2>Select a new piece.</h2><div className="promotion-actions">{(['q', 'r', 'b', 'n'] as const).map((piece) => <button key={piece} onClick={() => onPromotion(piece)}>{piece.toUpperCase()}</button>)}</div></div></div>}{handoff && <div className="handoff"><div className="handoff-card"><div className="handoff-cloud"><Cloud size={28} /></div><p className="kicker">A QUIET HANDOFF</p><h2>Pass the device to {names[activeView?.turn === 'w' ? 0 : 1]}.</h2><p>Make sure the previous player isn't peeking. Your board is waiting behind this little cloud.</p><button className="primary" onClick={setReady}>I'm ready — reveal my board</button></div></div>}</main>
}

function ClockView({ color, name, milliseconds, active }: { color: 'w' | 'b'; name: string; milliseconds: number | null; active: boolean }) {
  const urgency = milliseconds !== null && milliseconds < 10000 ? 'critical' : milliseconds !== null && milliseconds < 60000 ? 'low' : ''
  return <div className={`clock ${active ? 'active' : ''} ${urgency}`} aria-label={`${name} ${color === 'w' ? 'White' : 'Black'} clock`}><span>{name}</span><strong>{formatClock(milliseconds)}</strong></div>
}

function Board({ view, selected, legalMoves, orientation, onSquare, disabled }: { view?: AuthorizedView; selected?: string; legalMoves: LegalDestination[]; orientation: 'w' | 'b'; onSquare: (square: string) => void; disabled?: boolean }) {
  const pieces = Object.fromEntries((view?.pieces ?? []).map((piece) => [piece.square, piece]))
  const files = orientation === 'w' ? 'abcdefgh'.split('') : 'hgfedcba'.split('')
  const destinations = new Map(legalMoves.map((move) => [move.square, move]))
  return <div className="board-shell"><div className="coordinates top">{files.map((x) => <span key={x}>{x}</span>)}</div><div className="board">{boardSquares(orientation).map((square, i) => { const piece = pieces[square]; const destination = destinations.get(square); const fileIndex = i % 8; const rankIndex = Math.floor(i / 8); const checked = view?.checkedKingSquare === square; return <button aria-label={`square ${square}`} disabled={disabled || !view || view.status !== 'playing'} className={`${(rankIndex + fileIndex) % 2 ? 'dark' : ''} ${selected === square ? 'selected' : ''} ${destination ? destination.capture ? 'capture-destination' : 'legal-destination' : ''} ${checked ? view.status === 'checkmate' ? 'checkmate-king' : 'checked-king' : ''} ${view?.lastMove && (view.lastMove.from === square || view.lastMove.to === square) ? 'last' : ''}`} onClick={() => onSquare(square)} key={square}>{destination && <span className="move-marker" aria-hidden="true" />}{piece?.hidden ? <span className="hidden-piece">•</span> : piece?.type ? <span className={`piece ${piece.color === 'b' ? 'black-piece' : ''}`}>{symbols[`${piece.color}${piece.type}`]}</span> : null}</button> })}</div><div className="coordinates bottom">{files.map((x) => <span key={x}>{x}</span>)}</div></div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
