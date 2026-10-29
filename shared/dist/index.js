import { Chess } from 'chess.js';
const pieceSymbols = ['p', 'n', 'b', 'r', 'q', 'k'];
export function filterPosition(chess, playerColor, mode, lastMove) {
    const pieces = [];
    for (const file of 'abcdefgh') {
        for (let rank = 1; rank <= 8; rank += 1) {
            const square = `${file}${rank}`;
            const piece = chess.get(square);
            if (!piece)
                continue;
            const own = piece.color === playerColor;
            if (own || mode === 'normal')
                pieces.push({ square, color: piece.color, type: piece.type });
            else if (mode === 'semi-blind')
                pieces.push({ square, color: piece.color, hidden: true });
        }
    }
    const history = chess.history({ verbose: true }).map((move) => ({
        from: move.from,
        to: move.to,
        ...(mode === 'normal' ? { san: move.san } : {}),
    }));
    const checkmate = chess.isCheckmate();
    const stalemate = chess.isStalemate();
    const insufficientMaterial = chess.isInsufficientMaterial();
    const threefoldRepetition = chess.isThreefoldRepetition();
    const fiftyMoveRule = Number(chess.fen().split(' ')[4] ?? 0) >= 100;
    const status = checkmate ? 'checkmate' : stalemate || chess.isDraw() ? 'draw' : 'playing';
    const resultReason = checkmate ? 'checkmate' : stalemate ? 'stalemate' : insufficientMaterial ? 'insufficient-material' : threefoldRepetition ? 'threefold-repetition' : fiftyMoveRule ? 'fifty-move-rule' : status === 'draw' ? 'draw' : undefined;
    const checkedColor = chess.inCheck() || checkmate ? chess.turn() : undefined;
    const checkedKingSquare = checkedColor ? findKing(chess, checkedColor) : undefined;
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
    };
    function findKing(chess, color) {
        for (const file of 'abcdefgh') {
            for (let rank = 1; rank <= 8; rank += 1) {
                const square = `${file}${rank}`;
                if (chess.get(square)?.color === color && chess.get(square)?.type === 'k')
                    return square;
            }
        }
        return undefined;
    }
}
export function validateMove(chess, request) {
    return chess.move(request);
}
export function legalDestinations(chess, playerColor, from, mode) {
    if (chess.turn() !== playerColor || chess.get(from)?.color !== playerColor)
        return [];
    return chess.moves({ square: from, verbose: true }).map((move) => ({
        square: move.to,
        capture: mode === 'blind-pro' ? false : Boolean(chess.get(move.to)?.color && chess.get(move.to)?.color !== playerColor),
    }));
}
export function boardSquares(orientation) {
    const files = orientation === 'w' ? 'abcdefgh'.split('') : 'hgfedcba'.split('');
    const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
}
export function boardFromView(view) {
    return Object.fromEntries(view.pieces.map((piece) => [piece.square, piece]));
}
export { Chess, pieceSymbols };
