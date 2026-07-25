import React, { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'

export default function BoardView({
  chess,
  viewingColor,
  onMove,
  mode,
}: {
  chess: Chess
  viewingColor: 'white' | 'black'
  onMove: (from: string, to: string) => void
  mode: 'normal' | 'blind' | 'ultimate'
}) {
  const [fen, setFen] = useState(chess.fen())

  useEffect(() => {
    setFen(maskedFen())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess, viewingColor, mode])

  function maskedFen() {
    if (mode === 'normal') return chess.fen()
    const fullFen = chess.fen()
    const parts = fullFen.split(' ')
    const placement = parts[0] // e.g. rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR

    const ranks = placement.split('/')
    const maskedRanks = ranks.map((rank) => {
      // expand rank into array of single chars where digits become that many '1's
      const expanded: string[] = []
      for (let i = 0; i < rank.length; i++) {
        const ch = rank[i]
        if (/[1-8]/.test(ch)) {
          const n = parseInt(ch, 10)
          for (let j = 0; j < n; j++) expanded.push('1')
        } else {
          expanded.push(ch)
        }
      }

      // replace opponent pieces according to mode
      for (let i = 0; i < expanded.length; i++) {
        const ch = expanded[i]
        if (ch === '1') continue
        const isWhite = ch === ch.toUpperCase()
        const viewerIsWhite = viewingColor === 'white'
        const pieceVisible = (isWhite && viewerIsWhite) || (!isWhite && !viewerIsWhite)
        if (!pieceVisible) {
          if (mode === 'ultimate') {
            expanded[i] = '1'
          } else if (mode === 'blind') {
            // show a generic pawn of the same color so type is hidden but presence is visible
            expanded[i] = isWhite ? 'P' : 'p'
          }
        }
      }

      // compress back to FEN rank
      let out = ''
      let empty = 0
      for (const c of expanded) {
        if (c === '1') empty++
        else {
          if (empty > 0) {
            out += String(empty)
            empty = 0
          }
          out += c
        }
      }
      if (empty > 0) out += String(empty)
      return out
    })

    const maskedPlacement = maskedRanks.join('/')
    return [maskedPlacement, parts[1], parts[2], parts[3], parts[4], parts[5]].join(' ')
  }

  const onDrop = (sourceSquare: string, targetSquare: string) => {
    // forward to parent which updates the Chess instance
    onMove(sourceSquare, targetSquare)
    // after move, update local fen
    setFen(maskedFen())
    return true
  }

  const orientation = viewingColor === 'white' ? 'white' : 'black'

  return (
    <div>
      <Chessboard
        position={fen}
        onPieceDrop={(source, target) => onDrop(source, target)}
        boardOrientation={orientation}
        arePiecesDraggable={true}
        boardWidth={480}
      />
    </div>
  )
}
