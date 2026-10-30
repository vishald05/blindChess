import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
export type VisibilityMode = 'normal' | 'semi-blind' | 'blind-pro';
export type PlayMethod = 'local' | 'online';
export type PlayerColor = Color;
export type TimerConfig = {
    mode: 'disabled';
} | {
    mode: 'timed';
    baseSeconds: number;
    incrementSeconds: number;
};
export interface ClockSnapshot {
    mode: TimerConfig['mode'];
    whiteMs: number | null;
    blackMs: number | null;
    activeColor?: PlayerColor;
    running: boolean;
}
export interface Player {
    id: string;
    name: string;
    color: PlayerColor;
}
export interface PieceView {
    square: Square;
    color: PlayerColor;
    type?: PieceSymbol;
    hidden?: boolean;
}
export interface AuthorizedView {
    mode: VisibilityMode;
    playerColor: PlayerColor;
    pieces: PieceView[];
    turn: PlayerColor;
    lastMove?: {
        from: Square;
        to: Square;
    };
    status: 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'resigned' | 'timeout';
    resultReason?: 'checkmate' | 'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule' | 'timeout' | 'timeout-insufficient-material' | 'draw';
    winner?: PlayerColor;
    checkedColor?: PlayerColor;
    checkedKingSquare?: Square;
    moveCount: number;
    publicHistory: Array<{
        from: Square;
        to: Square;
        san?: string;
    }>;
    clock: ClockSnapshot;
}
export interface MoveRequest {
    from: Square;
    to: Square;
    promotion?: 'q' | 'r' | 'b' | 'n';
}
export interface LegalDestination {
    square: Square;
    capture: boolean;
}
export interface RoomPlayer {
    name: string;
    color: PlayerColor;
    connected?: boolean;
}
export interface RoomState {
    roomCode: string;
    mode: VisibilityMode;
    players: RoomPlayer[];
    disconnected?: boolean;
    connectionStatus?: 'opponent-disconnected' | 'opponent-reconnected' | 'player-left';
    timer: TimerConfig;
    clock: ClockSnapshot;
}
export interface RoomCreateRequest {
    name: string;
    mode: VisibilityMode;
    timer?: TimerConfig;
}
export interface RoomJoinRequest {
    name: string;
    roomCode: string;
}
export interface RoomResumeRequest {
    roomCode: string;
    playerToken: string;
}
export interface ClockRequest {
    roomCode: string;
    playerToken: string;
}
export type ClockResponse = {
    ok: true;
    clock: ClockSnapshot;
} | {
    ok: false;
    error: string;
};
declare const pieceSymbols: PieceSymbol[];
export declare function filterPosition(chess: Chess, playerColor: PlayerColor, mode: VisibilityMode, lastMove?: {
    from: Square;
    to: Square;
}, clock?: ClockSnapshot): AuthorizedView;
export declare function validateMove(chess: Chess, request: MoveRequest): import("chess.js").Move;
export declare function validateTimerConfig(config: TimerConfig | undefined): TimerConfig;
export declare function legalDestinations(chess: Chess, playerColor: PlayerColor, from: Square, mode: VisibilityMode): LegalDestination[];
export declare function boardSquares(orientation: PlayerColor): Square[];
export declare function boardFromView(view: AuthorizedView): Record<string, PieceView>;
export { Chess, pieceSymbols };
