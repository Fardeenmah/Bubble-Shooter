import { BubbleColor } from './engine';

export interface LevelConfig {
  colors: BubbleColor[];
  layout: string[];
  shotsPerDescent: number;
  maxExtraRows: number;
}

export const LEVELS: LevelConfig[] = [
  // Level 1: Very simple, 3 colors, slow descent
  {
    colors: ['red', 'blue', 'green'],
    shotsPerDescent: 10,
    maxExtraRows: 1,
    layout: [
      ". . . . R B G R B G . . . .",
      " . . . B G R B G R . . . . ",
      ". . . . R B G R B G . . . .",
      " . . . B G R B G R . . . . "
    ]
  },
  // Level 2
  {
    colors: ['red', 'blue', 'green'],
    shotsPerDescent: 9,
    maxExtraRows: 2,
    layout: [
      ". . . R R B B G G R R . . .",
      " . . R B B G G R R B . . . ",
      ". . . R R B B G G R R . . .",
      " . . R B B G G R R B . . . ",
      ". . . R R B B G G R R . . ."
    ]
  },
  // Level 3
  {
    colors: ['red', 'blue', 'green', 'yellow'],
    shotsPerDescent: 8,
    maxExtraRows: 2,
    layout: [
      ". . R B G Y R B G Y R B . .",
      " . R B G Y R B G Y R B . . ",
      ". . R B G Y R B G Y R B . .",
      " . R B G Y R B G Y R B . . ",
      ". . R B G Y R B G Y R B . ."
    ]
  },
  // Level 4
  {
    colors: ['red', 'blue', 'green', 'yellow'],
    shotsPerDescent: 7,
    maxExtraRows: 3,
    layout: [
      "R R R B B B G G G Y Y Y R R R",
      " R R B B B G G G Y Y Y R R R ",
      "Y Y Y R R R B B B G G G Y Y Y",
      " Y Y R R R B B B G G G Y Y Y ",
      "G G G Y Y Y R R R B B B G G G",
      " G G Y Y Y R R R B B B G G G "
    ]
  },
  // Level 5
  {
    colors: ['red', 'blue', 'green', 'yellow', 'purple'],
    shotsPerDescent: 6,
    maxExtraRows: 3,
    layout: [
      "R B G Y P R B G Y P R B G Y P",
      " B G Y P R B G Y P R B G Y P ",
      "R B G Y P R B G Y P R B G Y P",
      " B G Y P R B G Y P R B G Y P ",
      "R B G Y P R B G Y P R B G Y P",
      " B G Y P R B G Y P R B G Y P "
    ]
  },
  // Level 6
  {
    colors: ['red', 'blue', 'green', 'yellow', 'purple'],
    shotsPerDescent: 5,
    maxExtraRows: 4,
    layout: [
      "R R B B G G Y Y P P R R B B G",
      " R B B G G Y Y P P R R B B G ",
      "P P R R B B G G Y Y P P R R B",
      " P R R B B G G Y Y P P R R B ",
      "Y Y P P R R B B G G Y Y P P R",
      " Y P P R R B B G G Y Y P P R ",
      "G G Y Y P P R R B B G G Y Y P"
    ]
  },
  // Level 7
  {
    colors: ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'],
    shotsPerDescent: 5,
    maxExtraRows: 5,
    layout: [
      "R B G Y P C R B G Y P C R B G",
      " B G Y P C R B G Y P C R B G ",
      "R B G Y P C R B G Y P C R B G",
      " B G Y P C R B G Y P C R B G ",
      "R B G Y P C R B G Y P C R B G",
      " B G Y P C R B G Y P C R B G ",
      "R B G Y P C R B G Y P C R B G"
    ]
  },
  // Level 8
  {
    colors: ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'],
    shotsPerDescent: 4,
    maxExtraRows: 6,
    layout: [
      "R R B B G G Y Y P P C C R R B",
      " P P C C R R B B G G Y Y P P ",
      "B G G Y Y P P C C R R B B G G",
      " C R R B B G G Y Y P P C C R ",
      "Y Y P P C C R R B B G G Y Y P",
      " B B G G Y Y P P C C R R B B ",
      "P C C R R B B G G Y Y P P C C",
      " G Y Y P P C C R R B B G G Y "
    ]
  }
];

export function getLevelConfig(levelIndex: number): LevelConfig {
  if (levelIndex <= LEVELS.length) {
    return LEVELS[levelIndex - 1];
  }
  
  // Procedural generation for levels beyond predefined
  const difficulty = Math.min(10, Math.floor(levelIndex / 2));
  const numColors = Math.min(6, 3 + Math.floor(difficulty / 2));
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'].slice(0, numColors) as BubbleColor[];
  
  const rows = Math.min(12, 5 + Math.floor(difficulty / 1.5));
  const layout: string[] = [];
  
  for (let r = 0; r < rows; r++) {
    let rowStr = "";
    const cols = r % 2 === 0 ? 15 : 14;
    for (let c = 0; c < cols; c++) {
      const colorChar = colors[Math.floor(Math.random() * colors.length)].charAt(0).toUpperCase();
      rowStr += colorChar + " ";
    }
    if (r % 2 !== 0) {
      rowStr = " " + rowStr;
    }
    layout.push(rowStr.trimEnd());
  }
  
  return {
    colors,
    layout,
    shotsPerDescent: Math.max(2, 7 - Math.floor(difficulty / 2)),
    maxExtraRows: Math.floor(difficulty * 1.5)
  };
}
