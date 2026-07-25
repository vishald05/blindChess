import React, { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import BoardView from './components/BoardView'

export default function App() {
  const chessRef = useRef(new Chess())
  const [, setTick] = useState(0)
  const [viewingColor, setViewingColor] = useState<'white' | 'black'>('white')
  const [mode, setMode] = useState<'normal' | 'blind' | 'ultimate'>('ultimate')
  const [history, setHistory] = useState<string[]>([])
  const [capturedWhite, setCapturedWhite] = useState<string[]>([])
  const [capturedBlack, setCapturedBlack] = useState<string[]>([])

  const tick = () => setTick((t) => t + 1)

  useEffect(() => {
    // history API differs between chess.js versions; try verbose form first
    try {
      setHistory(chessRef.current.history({ verbose: false }))
    } catch (e) {
      try {
        setHistory(chessRef.current.history())
      } catch (e) {
        setHistory([])
      }
    }
  }, [])

  const onMove = (from: string, to: string) => {
    const chess = chessRef.current
    const move = chess.move({ from, to, promotion: 'q' as any })
    if (move) {
      if (move.captured) {
        if (move.color === 'w') {
          setCapturedBlack((c) => [...c, move.captured])
        } else {
          setCapturedWhite((c) => [...c, move.captured])
        }
      }
      try {
        setHistory(chess.history({ verbose: false }))
      } catch (e) {
        try {
          setHistory(chess.history())
        } catch (e) {
          setHistory([])
        }
      }
      // toggle view for pass-and-play
      setViewingColor((v) => (v === 'white' ? 'black' : 'white'))
      tick()
    }
  }

  const onUndo = () => {
    const chess = chessRef.current
    const move = chess.undo()
    if (move && move.captured) {
      // remove last captured from the appropriate list
      if (move.color === 'w') {
        setCapturedBlack((c) => c.slice(0, -1))
      } else {
        setCapturedWhite((c) => c.slice(0, -1))
      }
    }
    // after undo, keep viewing color consistent with current turn
    const turn = chess.turn() === 'w' ? 'white' : 'black'
    setViewingColor(turn)
    try {
      setHistory(chess.history({ verbose: false }))
    } catch (e) {
      try {
        setHistory(chess.history())
      } catch (e) {
        setHistory([])
      }
    }
    tick()
  }

  const onRestart = () => {
    chessRef.current = new Chess()
    setCapturedWhite([])
    setCapturedBlack([])
    setHistory([])
    setViewingColor('white')
    tick()
  }

  const onPass = () => {
    setViewingColor((v) => (v === 'white' ? 'black' : 'white'))
  }

  const chess = chessRef.current

  const isInCheck = (c: any) => {
    try {
      if (typeof c.in_check === 'function') return c.in_check()
      if (typeof c.inCheck === 'function') return c.inCheck()
    } catch (e) {
      return false
    }
    return false
  }

  const isInCheckmate = (c: any) => {
    try {
      if (typeof c.in_checkmate === 'function') return c.in_checkmate()
      if (typeof c.inCheckmate === 'function') return c.inCheckmate()
    } catch (e) {
      return false
    }
    return false
  }

  return (
    <div className="min-h-screen flex items-start justify-center p-6">
      <div className="w-full max-w-4xl bg-white rounded shadow p-6">
        <div className="flex gap-6">
          <div>
            <BoardView
              chess={chess}
              viewingColor={viewingColor}
              onMove={onMove}
              mode={mode}
            />
            <div className="flex gap-2 mt-4">
              <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={onUndo}>Undo</button>
              <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={onRestart}>Restart</button>
              <button className="px-3 py-1 bg-gray-600 text-white rounded" onClick={onPass}>Pass</button>
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Mode</h2>
              <div className="flex gap-2 mt-2">
                <button className={`px-3 py-1 rounded ${mode==='normal'?'bg-blue-600 text-white':'bg-gray-200'}`} onClick={()=>setMode('normal')}>Normal</button>
                <button className={`px-3 py-1 rounded ${mode==='blind'?'bg-blue-600 text-white':'bg-gray-200'}`} onClick={()=>setMode('blind')}>Blind</button>
                <button className={`px-3 py-1 rounded ${mode==='ultimate'?'bg-blue-600 text-white':'bg-gray-200'}`} onClick={()=>setMode('ultimate')}>Ultimate Blind</button>
              </div>
            </div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Status</h2>
              <p>Turn: {chess.turn() === 'w' ? 'White' : 'Black'}</p>
              <p>Viewing as: {viewingColor}</p>
              <p>Check: {isInCheck(chess) ? 'Yes' : 'No'}</p>
              <p>Checkmate: {isInCheckmate(chess) ? 'Yes' : 'No'}</p>
            </div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Move History</h2>
              <ol className="list-decimal list-inside">
                {history.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Captured</h2>
              <div className="flex gap-4 mt-2">
                <div>
                  <strong>White captured:</strong>
                  <div>{capturedWhite.join(', ')}</div>
                </div>
                <div>
                  <strong>Black captured:</strong>
                  <div>{capturedBlack.join(', ')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
