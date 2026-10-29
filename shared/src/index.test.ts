import { describe, expect, it } from 'vitest'
import { Chess, boardSquares, filterPosition, legalDestinations } from './index.js'

describe('visibility filtering', () => {
  it('keeps own pieces and hides opponent identities in semi-blind mode', () => {
    const view = filterPosition(new Chess(), 'w', 'semi-blind')
    expect(view.pieces.filter((piece) => piece.color === 'w').every((piece) => piece.type)).toBe(true)
    expect(view.pieces.filter((piece) => piece.color === 'b').every((piece) => piece.hidden && !piece.type)).toBe(true)
  })
  it('does not expose opponent occupancy in blind-pro mode', () => {
    const view = filterPosition(new Chess(), 'w', 'blind-pro')
    expect(view.pieces.every((piece) => piece.color === 'w')).toBe(true)
    expect(JSON.stringify(view)).not.toContain('"color":"b"')
  })
  it('exposes complete types only in normal mode', () => {
    const view = filterPosition(new Chess(), 'w', 'normal')
    expect(view.pieces).toHaveLength(32)
    expect(view.pieces.every((piece) => piece.type)).toBe(true)
  })
})

describe('canonical chess rules', () => {
  it('returns legal destinations without exposing blind capture occupancy', () => {
    const chess = new Chess()
    const normal = legalDestinations(chess, 'w', 'e2', 'normal')
    expect(normal.map((move) => move.square)).toEqual(['e3', 'e4'])
    expect(legalDestinations(chess, 'w', 'e2', 'blind-pro')).toEqual(normal)
  })
  it('orders the board from each player perspective', () => {
    expect(boardSquares('w').slice(0, 2)).toEqual(['a8', 'b8'])
    expect(boardSquares('b').slice(0, 2)).toEqual(['h1', 'g1'])
    expect(boardSquares('b').at(-1)).toBe('a8')
  })
  it('marks captures only when the selected visibility mode allows occupancy', () => {
    const chess = new Chess('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')
    expect(legalDestinations(chess, 'w', 'e4', 'normal').find((move) => move.square === 'd5')?.capture).toBe(true)
    expect(legalDestinations(chess, 'w', 'e4', 'semi-blind').find((move) => move.square === 'd5')?.capture).toBe(true)
    expect(legalDestinations(chess, 'w', 'e4', 'blind-pro').find((move) => move.square === 'd5')?.capture).toBe(false)
  })
  it('rejects a move for the opponent', () => {
    const chess = new Chess()
    expect(() => chess.move({ from: 'e7', to: 'e5' })).toThrow()
  })
  it('supports promotion', () => {
    const chess = new Chess('8/P7/8/8/8/8/7k/K7 w - - 0 1')
    chess.move({ from: 'a7', to: 'a8', promotion: 'q' })
    expect(chess.get('a8')?.type).toBe('q')
  })
  it('describes checkmate and the winning color', () => {
    const view = filterPosition(new Chess('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1'), 'w', 'normal')
    expect(view.status).toBe('checkmate')
    expect(view.resultReason).toBe('checkmate')
    expect(view.winner).toBe('w')
    expect(view.checkedKingSquare).toBe('h8')
  })
  it('describes stalemate and insufficient-material draws', () => {
    const stalemate = filterPosition(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'w', 'normal')
    const material = filterPosition(new Chess('7k/8/6K1/8/8/8/8/8 w - - 0 1'), 'w', 'normal')
    expect(stalemate.resultReason).toBe('stalemate')
    expect(material.resultReason).toBe('insufficient-material')
  })
})
