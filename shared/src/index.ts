import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'

export type VisibilityMode = 'normal' | 'semi-blind' | 'blind-pro'
export type PlayMethod = 'local' | 'online'
export type PlayerColor = Color

export interface Player {
  id: string
  name: string
  color: PlayerColor
}

export interface PieceView {
  square: Square
  color: PlayerColor
  type?: PieceSymbol
  hidden?: boolean
}

export interface AuthorizedView {
  mode: VisibilityMode
  playerColor: PlayerColor
  pieces: PieceView[]
  turn: PlayerColor
  lastMove?: { from: Square; to: Square }
  status: 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'resigned'
  resultReason?: 'checkmate' | 'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule' | 'draw'
  winner?: PlayerColor
  checkedColor?: PlayerColor
  checkedKingSquare?: Square
  moveCount: number
  publicHistory: Array<{ from: Square; to: Square; san?: string }>
}

export interface MoveRequest {
  from: Square
  to: Square
  promotion?: 'q' | 'r' | 'b' | 'n'
}

export interface LegalDestination {
  square: Square
  capture: boolean
}

export interface RoomPlayer {
  name: string
  color: PlayerColor
  connected?: boolean
}

export interface RoomState {
  roomCode: string
  mode: VisibilityMode
  players: RoomPlayer[]
  disconnected?: boolean
  connectionStatus?: 'opponent-disconnected' | 'opponent-reconnected' | 'player-left'
}

export interface RoomCreateRequest {
  name: string
  mode: VisibilityMode
}

export interface RoomJoinRequest {
  name: string
  roomCode: string
}

export interface RoomResumeRequest {
  roomCode: string
  playerToken: string
}

const pieceSymbols: PieceSymbol[] = ['p', 'n', 'b', 'r', 'q', 'k']

export function filterPosition(
  chess: Chess,
  playerColor: PlayerColor,
  mode: VisibilityMode,
  lastMove?: { from: Square; to: Square },
): AuthorizedView {
  const pieces: PieceView[] = []
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank += 1) {
      const square = `${file}${rank}` as Square
      const piece = chess.get(square)
      if (!piece) continue
      const own = piece.color === playerColor
      if (own || mode === 'normal') pieces.push({ square, color: piece.color, type: piece.type })
      else if (mode === 'semi-blind') pieces.push({ square, color: piece.color, hidden: true })
    }
  }
  const history = chess.history({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    ...(mode === 'normal' ? { san: move.san } : {}),
  }))
  const checkmate = chess.isCheckmate()
  const stalemate = chess.isStalemate()
  const insufficientMaterial = chess.isInsufficientMaterial()
  const threefoldRepetition = chess.isThreefoldRepetition()
  const fiftyMoveRule = Number(chess.fen().split(' ')[4] ?? 0) >= 100
  const status = checkmate ? 'checkmate' : stalemate || chess.isDraw() ? 'draw' : 'playing'
  const resultReason = checkmate ? 'checkmate' : stalemate ? 'stalemate' : insufficientMaterial ? 'insufficient-material' : threefoldRepetition ? 'threefold-repetition' : fiftyMoveRule ? 'fifty-move-rule' : status === 'draw' ? 'draw' : undefined
  const checkedColor = chess.inCheck() || checkmate ? chess.turn() : undefined
  const checkedKingSquare = checkedColor ? findKing(chess, checkedColor) : undefined
  return {
    mode,
    playerColor,
    pieces,
    turn: chess.turn(),
    lastMove,
    status,
    resultReason,
    winner: checkmate ? (chess.turn() === 'w' ? 'b' : 'w') : undefined,
    checkedColor,
    checkedKingSquare,
    moveCount: history.length,
    publicHistory: history,
  }

  function findKing(chess: Chess, color: PlayerColor): Square | undefined {
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank += 1) {
        const square = `${file}${rank}` as Square
        if (chess.get(square)?.color === color && chess.get(square)?.type === 'k') return square
      }
    }
    return undefined
  }
}

export function validateMove(chess: Chess, request: MoveRequest) {
  return chess.move(request)
}

export function legalDestinations(chess: Chess, playerColor: PlayerColor, from: Square, mode: VisibilityMode): LegalDestination[] {
  if (chess.turn() !== playerColor || chess.get(from)?.color !== playerColor) return []
  return chess.moves({ square: from, verbose: true }).map((move) => ({
    square: move.to,
    capture: mode === 'blind-pro' ? false : Boolean(chess.get(move.to)?.color && chess.get(move.to)?.color !== playerColor),
  }))
}

export function boardSquares(orientation: PlayerColor): Square[] {
  const files = orientation === 'w' ? 'abcdefgh'.split('') : 'hgfedcba'.split('')
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square))
}

export function boardFromView(view: AuthorizedView): Record<string, PieceView> {
  return Object.fromEntries(view.pieces.map((piece) => [piece.square, piece]))
}

export { Chess, pieceSymbols }
