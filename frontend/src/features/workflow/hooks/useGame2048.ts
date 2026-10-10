import { useCallback, useEffect, useMemo, useState } from 'react';

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

type Board = number[][];

interface PersistedGameState {
  board: Board;
  score: number;
  bestScore: number;
  isGameOver: boolean;
  hasWon: boolean;
  moveCount: number;
}

const STORAGE_KEY = 'manimcat_2048_state_v1';
const BOARD_SIZE = 4;
const TARGET_TILE = 2048;

const createEmptyBoard = (): Board =>
  Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0));

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

function addRandomTile(board: Board): Board {
  return addRandomTileWithProbability(board, 0.1);
}

function addRandomTileWithProbability(board: Board, fourProbability: number): Board {
  const emptyCells: Array<{ row: number; col: number }> = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === 0) {
        emptyCells.push({ row, col });
      }
    }
  }

  if (emptyCells.length === 0) {
    return board;
  }

  const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  const nextBoard = cloneBoard(board);
  const clampedProbability = Math.max(0.02, Math.min(0.35, fourProbability));
  nextBoard[randomCell.row][randomCell.col] = Math.random() < 1 - clampedProbability ? 2 : 4;
  return nextBoard;
}

function getFilledCellCount(board: Board): number {
  return board.flat().filter((value) => value !== 0).length;
}

function getDynamicFourProbability(moveCount: number, board: Board): number {
  const cycleLength = 28;
  const phase = (moveCount % cycleLength) / cycleLength;

  let baseProbability = 0.08;

  if (phase < 0.45) {
    const progress = phase / 0.45;
    baseProbability = 0.06 + progress * 0.12;
  } else if (phase < 0.7) {
    baseProbability = 0.18;
  } else {
    const progress = (phase - 0.7) / 0.3;
    baseProbability = 0.18 - progress * 0.11;
  }

  const filledCount = getFilledCellCount(board);
  if (filledCount >= 13) {
    baseProbability -= 0.05;
  } else if (filledCount >= 10) {
    baseProbability -= 0.03;
  }

  return Math.max(0.04, Math.min(0.22, baseProbability));
}

function compressAndMerge(line: number[]): { line: number[]; scoreGain: number; moved: boolean } {
  const filtered = line.filter((value) => value !== 0);
  const merged: number[] = [];
  let scoreGain = 0;
  let index = 0;

  while (index < filtered.length) {
    if (filtered[index] !== 0 && filtered[index] === filtered[index + 1]) {
      const combined = filtered[index] * 2;
      merged.push(combined);
      scoreGain += combined;
      index += 2;
      continue;
    }

    merged.push(filtered[index]);
    index += 1;
  }

  while (merged.length < BOARD_SIZE) {
    merged.push(0);
  }

  const moved = merged.some((value, lineIndex) => value !== line[lineIndex]);
  return { line: merged, scoreGain, moved };
}

function transpose(board: Board): Board {
  return board[0].map((_, colIndex) => board.map((row) => row[colIndex]));
}

function reverseRows(board: Board): Board {
  return board.map((row) => [...row].reverse());
}

function moveLeft(board: Board): { board: Board; scoreGain: number; moved: boolean } {
  let totalScoreGain = 0;
  let moved = false;
  const movedBoard = board.map((row) => {
    const result = compressAndMerge(row);
    totalScoreGain += result.scoreGain;
    moved = moved || result.moved;
    return result.line;
  });

  return { board: movedBoard, scoreGain: totalScoreGain, moved };
}

function moveBoard(board: Board, direction: MoveDirection): { board: Board; scoreGain: number; moved: boolean } {
  if (direction === 'left') {
    return moveLeft(board);
  }

  if (direction === 'right') {
    const reversed = reverseRows(board);
    const result = moveLeft(reversed);
    return {
      board: reverseRows(result.board),
      scoreGain: result.scoreGain,
      moved: result.moved,
    };
  }

  if (direction === 'up') {
    const transposed = transpose(board);
    const result = moveLeft(transposed);
    return {
      board: transpose(result.board),
      scoreGain: result.scoreGain,
      moved: result.moved,
    };
  }

  const transposed = transpose(board);
  const reversed = reverseRows(transposed);
  const result = moveLeft(reversed);
  return {
    board: transpose(reverseRows(result.board)),
    scoreGain: result.scoreGain,
    moved: result.moved,
  };
}

function canMove(board: Board): boolean {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const value = board[row][col];
      if (value === 0) {
        return true;
      }

      if (col + 1 < BOARD_SIZE && value === board[row][col + 1]) {
        return true;
      }

      if (row + 1 < BOARD_SIZE && value === board[row + 1][col]) {
        return true;
      }
    }
  }

  return false;
}

function hasTargetTile(board: Board): boolean {
  return board.some((row) => row.some((value) => value >= TARGET_TILE));
}

function isValidPersistedState(value: unknown): value is PersistedGameState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as PersistedGameState;
  if (!Array.isArray(state.board) || state.board.length !== BOARD_SIZE) {
    return false;
  }

  return state.board.every(
    (row) =>
      Array.isArray(row) &&
      row.length === BOARD_SIZE &&
      row.every((cell) => typeof cell === 'number' && cell >= 0),
  );
}

function createInitialState(): PersistedGameState {
  const boardWithFirstTile = addRandomTile(createEmptyBoard());
  const boardWithTwoTiles = addRandomTile(boardWithFirstTile);

  return {
    board: boardWithTwoTiles,
    score: 0,
    bestScore: 0,
    isGameOver: false,
    hasWon: false,
    moveCount: 0,
  };
}

function loadInitialState(): PersistedGameState {
  if (typeof window === 'undefined') {
    return createInitialState();
  }

  const rawState = window.localStorage.getItem(STORAGE_KEY);
  if (!rawState) {
    return createInitialState();
  }

  try {
    const parsed = JSON.parse(rawState);
    if (!isValidPersistedState(parsed)) {
      return createInitialState();
    }

    return {
      board: parsed.board,
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : 0,
      isGameOver: Boolean(parsed.isGameOver),
      hasWon: Boolean(parsed.hasWon),
      moveCount: typeof parsed.moveCount === 'number' ? parsed.moveCount : 0,
    };
  } catch {
    return createInitialState();
  }
}

export function useGame2048() {
  const [state, setState] = useState<PersistedGameState>(() => loadInitialState());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const move = useCallback((direction: MoveDirection) => {
    setState((previous) => {
      if (previous.isGameOver) {
        return previous;
      }

      const result = moveBoard(previous.board, direction);
      if (!result.moved) {
        return previous;
      }

      const nextMoveCount = previous.moveCount + 1;
      const fourProbability = getDynamicFourProbability(nextMoveCount, result.board);
      const boardWithSpawn = addRandomTileWithProbability(result.board, fourProbability);
      const score = previous.score + result.scoreGain;
      const bestScore = Math.max(previous.bestScore, score);
      const won = previous.hasWon || hasTargetTile(boardWithSpawn);

      return {
        board: boardWithSpawn,
        score,
        bestScore,
        hasWon: won,
        isGameOver: !canMove(boardWithSpawn),
        moveCount: nextMoveCount,
      };
    });
  }, []);

  const restart = useCallback(() => {
    setState((previous) => {
      const fresh = createInitialState();
      return {
        ...fresh,
        bestScore: Math.max(previous.bestScore, fresh.bestScore),
      };
    });
  }, []);

  const maxTile = useMemo(
    () => Math.max(...state.board.flat()),
    [state.board],
  );

  return {
    board: state.board,
    score: state.score,
    bestScore: state.bestScore,
    isGameOver: state.isGameOver,
    hasWon: state.hasWon,
    maxTile,
    move,
    restart,
  };
}
