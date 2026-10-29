import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
export type VisibilityMode = 'normal' | 'semi-blind' | 'blind-pro';
export type PlayMethod = 'local' | 'online';
export type PlayerColor = Color;
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
    status: 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'resigned';
    resultReason?: 'checkmate' | 'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule' | 'draw';
    winner?: PlayerColor;
    checkedColor?: PlayerColor;
    checkedKingSquare?: Square;
    moveCount: number;
    publicHistory: Array<{
        from: Square;
        to: Square;
        san?: string;
    }>;
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
}
export interface RoomCreateRequest {
    name: string;
    mode: VisibilityMode;
}
export interface RoomJoinRequest {
    name: string;
    roomCode: string;
}
export interface RoomResumeRequest {
    roomCode: string;
    playerToken: string;
}
declare const pieceSymbols: PieceSymbol[];
export declare function filterPosition(chess: Chess, playerColor: PlayerColor, mode: VisibilityMode, lastMove?: {
    from: Square;
    to: Square;
}): AuthorizedView;
export declare function validateMove(chess: Chess, request: MoveRequest): import("chess.js").Move;
export declare function legalDestinations(chess: Chess, playerColor: PlayerColor, from: Square, mode: VisibilityMode): LegalDestination[];
export declare function boardSquares(orientation: PlayerColor): Square[];
export declare function boardFromView(view: AuthorizedView): Record<string, PieceView>;
export { Chess, pieceSymbols };
