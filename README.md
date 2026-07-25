# Blind Chess — Phase 1

Local pass-and-play chess where each player only sees their own pieces.

Features implemented:
- Pass-and-play
- Undo
- Restart
- Move history
- Captured pieces
- Check / checkmate detection
- Pawn promotion (auto-queen)

Quick start:

1. Install dependencies

```bash
npm install
```

2. Run dev server

```bash
npm run dev
```

Notes:
- This scaffold uses `chess.js` for game logic and `react-chessboard` for the UI.
- Opponent pieces are masked from view; the engine still tracks full state.

