# BlindChess

BlindChess is a playable chess application where **what you can see is part of the strategy**. It supports standard chess rules with three visibility modes and two ways to play:

- **Pass N Play**: two people share one device and hand it over between turns.
- **Online Play**: two players connect from separate browsers through a Socket.IO room.

The application is built around a normal, authoritative chess position. Visibility changes the information presented to a player; it does not change legal movement, check, checkmate, castling, en passant, promotion, or draw rules.

## Features

- Standard chess powered by [`chess.js`](https://github.com/jhlywa/chess.js)
- Normal, Semi-Blind, and Blind-Pro visibility modes
- Local pass-and-play privacy handoff
- Online room creation and joining
- Five-character shareable room codes
- Deterministic White/Black assignment
- Server-authoritative online moves
- Per-player filtered online game snapshots
- Safe reconnect using a player session token
- Disconnect and reconnect status messages
- Player-perspective board orientation
- Legal move indicators and capture indicators
- Blind-Pro-safe legal move indicators
- Pawn promotion to queen, rook, bishop, or knight
- Check and checkmate king highlighting
- Checkmate winner announcement
- Stalemate and draw-reason announcements
- Optional Web Audio check/checkmate feedback with mute control
- Responsive pale-blue interface for desktop and mobile
- Optional chess clocks with increment time controls
- Shared TypeScript types and integration tests

## Game modes

All modes use the same standard chess engine and the same canonical position. Only the authorized view differs.

### Normal

Normal mode is traditional chess:

- Both players see every piece.
- Every piece displays its real type and color.
- Legal destinations are shown when a piece is selected.
- Known legal captures receive a restrained red capture marker.
- Move history includes SAN notation.
- Check, checkmate, and terminal results are shown normally.

This mode is the best choice for learning the interface or playing conventional chess.

### Semi-Blind

Semi-Blind hides opponent piece identities but preserves opponent occupancy:

- Your own pieces show their real type.
- Opponent-occupied squares remain visible.
- Every opponent piece uses the same anonymous marker.
- A marker never reveals whether the hidden piece is a pawn, knight, bishop, rook, queen, or king.
- Captured-piece identities are not displayed.
- Move history omits SAN details that could identify hidden pieces.
- Legal captures can use a red indicator because the opponent's occupied square is visible in this mode.

Example: if the opponent has a queen, bishop, and two pawns on the board, you see four identical opponent markers—not four different symbols.

### Blind-Pro

Blind-Pro hides the opponent's current pieces completely:

- Only your own pieces are rendered.
- Opponent-occupied squares are omitted.
- Opponent piece identities and positions are not sent to the online client.
- Captured-piece identities are not displayed.
- Legal moves are still available because the server evaluates the real position.
- Every legal destination uses the same neutral move marker.
- Captures do not receive a different visual treatment, because that would reveal hidden occupancy.
- Check and terminal information is presented conservatively through the authorized game status.

Blind-Pro is a hidden-information interface, not a chess variant. The server still knows the complete position and enforces normal chess rules.

## How to play

### Time controls

Both Pass N Play and Online Play support **No timer** or a server-authoritative timed game. Timed games offer these base-time presets: 1, 3, 5, 10, 15, and 30 minutes. Increment presets are 0, 1, 2, 3, 5, 10, and 15 seconds. The selected control is shown in standard notation such as `3|0`, `5|3`, or `10|5`.

In Online Play, the room creator selects the timer and the joining player receives the room's settings without being able to change them. The server owns both clocks, subtracts elapsed time from only the active player, awards increment only after an accepted move, and stops the clocks on every terminal result. Reconnection restores the current clock rather than resetting it. Clients animate the displayed countdown and periodically resynchronize with the server; client-provided time is never trusted.

In Pass N Play, the first clock starts when White confirms readiness. In hidden-information modes, a move pauses the clock during the privacy handoff and the next clock starts only after the next player presses the ready button. Timestamp-based calculations prevent browser tab throttling from granting extra time.

When a clock expires, the player normally loses on time. If the opponent has insufficient mating material according to the chess engine, the result is a timeout draw instead. Timers never become negative, invalid or out-of-turn moves never consume time or increment, and restart begins with the configured base time.

### Home screen

Choose one of:

- **Pass N Play**
- **Online Play**

The home screen also compares the three visibility modes so players can choose the desired amount of uncertainty before starting.

### Pass N Play flow

1. Select **Pass N Play**.
2. Enter the White and Black player names.
3. Choose Normal, Semi-Blind, or Blind-Pro.
4. Select **Start game**.
5. White begins.
6. Select a piece to see its legal destinations.
7. Select a legal destination to move.
8. In Semi-Blind and Blind-Pro, the board is removed behind a full-screen handoff before the next player sees their board.
9. The next player presses **I'm ready — reveal my board**.
10. Continue until checkmate, stalemate, a draw, or another supported terminal state.

The handoff is a physical-device privacy measure. It prevents the next player's authorized board from being mounted or visible before they confirm readiness. It cannot protect against someone intentionally inspecting the device or browser internals.

Normal mode transitions directly between turns. Hidden-information modes require the explicit handoff.

### Online create-room flow

1. Select **Online Play**.
2. Enter a display name.
3. Choose a visibility mode.
4. Select **Create room**.
5. Copy the generated five-character room code.
6. Share the code with the other player.
7. Wait for the second player to join.
8. The room creator is assigned White.
9. The joining player is assigned Black.
10. The game begins when both seats are connected.

The room mode is chosen by the creator and is stored on the server. A client cannot change it after the room is created.

### Online join-room flow

1. Select **Online Play**.
2. Enter a display name.
3. Choose **Join a room with a code**.
4. Enter the five-character room code.
5. Select **Join room**.
6. Wait for the room to synchronize.
7. The joiner receives Black.

Invalid room codes and full rooms are rejected by the server and displayed as useful UI errors.

### Board controls

- Click one of your pieces to select it.
- Legal destinations receive move indicators.
- Click the selected square again to clear the selection.
- Select another own piece to replace the current legal-move indicators.
- Click a legal destination to submit the move.
- Promotion presents Queen, Rook, Bishop, and Knight choices.
- The board is oriented toward the current player:
  - White sees White at the bottom.
  - Black sees Black at the bottom.
- Online orientation stays fixed to the assigned player color throughout the game.
- Pass N Play orientation follows the player whose board is currently revealed.

Online moves are disabled while a move is pending, when it is not your turn, or after the game ends.

## Check, checkmate, and game over

The shared game-state layer derives status from `chess.js` and includes it in each authorized view.

### Check

When a king is in check:

- Its square receives a soft red highlight and border.
- The game status announces that the king is under attack.
- A short warning tone plays once for the new check, unless sounds are muted.

The check indicator is removed when the king is no longer in check.

### Checkmate

When checkmate occurs:

- The checkmated king receives a stronger red highlight.
- The board stops accepting moves.
- A `CHECKMATE` result banner appears.
- The winning color/player is announced.
- A decisive end-game tone plays once, without an additional ordinary check tone.

### Other terminal states

The game also recognizes and communicates:

- Stalemate
- Insufficient material
- Threefold repetition
- Fifty-move rule, based on the FEN halfmove clock
- Generic draw fallback from the chess engine

Terminal state data includes:

- `status`
- `resultReason`
- `winner` for checkmate
- `checkedColor`
- `checkedKingSquare`

The board interaction is disabled after a terminal state. The existing **Play again** action returns the player to a clean setup flow.

### Sound controls

BlindChess generates lightweight tones with the Web Audio API instead of relying on external audio files:

- Check: short warning tone
- Checkmate: longer decisive tone

Audio is best-effort because browsers may block audio until the user interacts with the page. Visual status and accessible announcements work even when audio is unavailable. Use the speaker button in the game header to mute or unmute sounds.

## Privacy and security model

Client-side hiding is not treated as security. CSS opacity, DOM omission, and piece masking are not used as the primary privacy boundary for online play.

### Server-authoritative position

For each online room, the server owns:

- The complete `chess.js` position
- The selected visibility mode
- Player colors
- Player membership
- Whose turn it is
- Legal move validation
- Check, checkmate, and draw state

The server does not trust client-provided color, turn, room mode, membership, or game status.

### Allowlisted views

The server sends a filtered `AuthorizedView` to each connected player:

- Normal includes all piece types.
- Semi-Blind includes own piece types and anonymous opponent occupancy.
- Blind-Pro includes only own pieces.

The server does not send full FEN to Semi-Blind or Blind-Pro clients. Online legal destinations are requested through the `game:legal-moves` event and returned as square/capture metadata only. In Blind-Pro, capture metadata is normalized to avoid revealing hidden occupancy.

### Reconnection

Room seats use a session token:

- The browser stores the room code and player token locally.
- Socket.IO reconnects at the transport layer.
- The application explicitly sends `room:resume`.
- The server checks that the token belongs to the disconnected seat.
- A connected seat cannot be claimed by another client.
- A successful resume sends a fresh filtered game view.

An intentional room exit uses `room:leave` and releases that seat. An unexpected disconnect retains the seat for reconnection while the server process remains alive.

## Architecture

The project is an npm workspace monorepo:

```text
blindChess/
├── client/
│   ├── src/
│   │   ├── main.tsx       # React application, setup, board, local/online flows
│   │   ├── styles.css     # Pale-blue responsive interface
│   │   └── vite-env.d.ts
│   └── package.json
├── server/
│   ├── src/
│   │   ├── index.ts       # Express health endpoint and Socket.IO room server
│   │   └── index.test.ts  # Socket.IO integration tests
│   └── package.json
├── shared/
│   ├── src/
│   │   ├── index.ts       # Shared types, filtering, status, legal destinations
│   │   └── index.test.ts  # Chess and privacy unit tests
│   └── package.json
├── package.json
└── README.md
```

### Shared package

[`shared/src/index.ts`](./shared/src/index.ts) contains:

- `VisibilityMode`
- `AuthorizedView`
- `PieceView`
- `RoomState`
- `MoveRequest`
- `LegalDestination`
- Visibility filtering
- Terminal-state derivation
- Perspective-aware board-square ordering
- Server/client-compatible legal destination calculation

### Client package

[`client/src/main.tsx`](./client/src/main.tsx) contains:

- Home screen
- Local setup
- Online create/join setup
- Waiting room
- Socket.IO lifecycle handling
- Reconnect/resume behavior
- Local chess controller
- Online authorized-view controller
- Privacy handoff
- Board orientation and indicators
- Check/checkmate/game-over UI
- Audio feedback

### Server package

[`server/src/index.ts`](./server/src/index.ts) contains:

- Express app and `/health` endpoint
- Socket.IO server factory
- In-memory room registry
- Room creation and joining
- Color assignment
- Session-token reconnection
- Intentional leave handling
- Disconnect status events
- Server-authoritative move validation
- Per-player filtered game snapshots
- Authorized legal-destination responses

## Socket.IO protocol

The current online protocol uses these events.

### Client to server

| Event | Purpose |
|---|---|
| `room:create` | Create a room with `{ name, mode }` |
| `room:join` | Join a room with `{ name, roomCode }` |
| `room:resume` | Resume a seat with `{ roomCode, playerToken }` |
| `room:leave` | Intentionally leave with `{ roomCode, playerToken }` |
| `game:move` | Submit `{ roomCode, playerToken, move }` |
| `game:legal-moves` | Request legal destinations for `{ roomCode, playerToken, from }` |

### Server to client

| Event | Purpose |
|---|---|
| `room:state` | Player names, colors, room mode, connection state |
| `game:view` | Current player-specific filtered game state |
| `game:status` | Broad playing/game-over notification |

Acknowledgements include `ok` and either the requested result or a safe error message. Errors do not expose hidden positions or hidden piece identities.

## Development setup

### Requirements

- Node.js 20+ recommended
- npm 10+ recommended

Check installed versions:

```bash
node --version
npm --version
```

### Install dependencies

From the repository root:

```bash
npm install
```

### Start client and server together

```bash
npm run dev
```

This runs:

- Vite client: `http://localhost:5173`
- Socket.IO/Express server: `http://localhost:3001`

### Start workspaces separately

Server:

```bash
npm run dev -w server
```

Client:

```bash
npm run dev -w client
```

### Configure the Socket.IO URL

The client uses `VITE_SOCKET_URL` and defaults to `http://localhost:3001`.

```bash
VITE_SOCKET_URL=http://localhost:3001 npm run dev -w client
```

The server supports:

- `PORT`: listening port, default `3001`
- `CLIENT_ORIGIN`: Socket.IO CORS origin, default `*`

Example:

```bash
PORT=4000 CLIENT_ORIGIN=http://localhost:5173 npm run dev -w server
VITE_SOCKET_URL=http://localhost:4000 npm run dev -w client
```

## Testing and validation

Run the complete test command:

```bash
npm test
```

The root test command:

1. Builds the shared workspace.
2. Runs shared chess/privacy tests.
3. Runs server Socket.IO integration tests.

Build all workspaces:

```bash
npm run build
```

Health check:

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{"ok":true}
```

The tests cover:

- Normal, Semi-Blind, and Blind-Pro filtering
- Hidden piece identity protection
- Blind-Pro capture-marker normalization
- Legal move generation
- Board orientation
- Promotion
- Checkmate and winner detection
- Stalemate and insufficient-material detection
- Room creation and joining
- Invalid and full rooms
- Color assignment
- Out-of-turn move rejection
- Illegal move rejection
- Opponent move delivery
- Disconnect notification
- Reconnection to the original seat
- Seat takeover prevention

## Current limitations

- Rooms are stored in memory and disappear when the server restarts.
- Disconnected seats are retained only while the server process remains alive.
- There are no user accounts or authentication beyond room session tokens.
- There are no spectators, matchmaking, rankings, or persistent game history.
- There is no persistent database.
- Rematch is not yet a dedicated online Socket.IO protocol; Play again returns to setup.
- Pass N Play privacy protects the visible interface during handoff but cannot provide cryptographic isolation on a shared device.
- Browser audio remains subject to browser autoplay policies.

## Design direction

BlindChess intentionally uses a calm, pale-blue visual system:

| Token | Color |
|---|---|
| Main background | `#F3F8FC` |
| Alternate surface | `#EAF2F9` |
| Card background | `#FFFFFF` |
| Soft surface | `#E1EDF7` |
| Decorative accent | `#B8D0E8` |
| Interactive accent | `#7298C4` |
| Primary text | `#2F4560` |
| Secondary text | `#6F8196` |
| Borders | `#DCE6F0` |

The interface avoids neon, cyberpunk, and dark esports styling in favor of a quiet strategy-game atmosphere with restrained cloud-inspired details.
