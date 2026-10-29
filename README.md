# BlindChess

BlindChess is a React/Vite chess experience with Normal, Semi-Blind, and Blind-Pro visibility modes. The local Pass N Play flow uses `chess.js` as the canonical rules engine and inserts a full-screen privacy handoff before each hidden-information turn.

## Development

```bash
npm install
npm run dev
```

The client runs on Vite's default port and the Socket.IO server runs on `3001`.

## Checks

```bash
npm test
npm run build
```

## Architecture

- `shared/src/index.ts` contains the typed authorized-view model and allowlisted visibility filter.
- `client/src/main.tsx` contains the responsive home, setup, handoff, board, and local game views.
- `server/src/index.ts` owns online room state and validates moves against its canonical `chess.js` position.

The server never sends complete FEN data to clients. Semi-Blind sends opponent occupancy as anonymous markers; Blind-Pro omits opponent squares entirely. Online clients receive only the allowlisted `AuthorizedView`.
Online legal-move indicators come from a server-authorized destination request; Blind-Pro deliberately normalizes capture markers so they do not reveal hidden occupancy. Boards render from the assigned player's perspective.

## Online multiplayer

The client uses `VITE_SOCKET_URL` for the Socket.IO server URL and defaults to `http://localhost:3001`:

```bash
VITE_SOCKET_URL=http://localhost:3001 npm run dev -w client
```

Create a room, copy the five-character code, and join it from another browser or device. The server assigns White to the creator and Black to the joiner, validates every move, and sends a filtered snapshot to each player. Short-lived player tokens allow a reconnecting browser to resume its seat; a third connection cannot claim it. Leaving a room explicitly releases the seat.

The current server keeps rooms in memory, so rooms are lost when the process restarts and disconnected seats are retained only for the lifetime of the running process. There are no accounts, spectators, persistent history, or server-side rematch flow yet.
