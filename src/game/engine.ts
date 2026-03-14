export type BubbleColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'cyan';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: BubbleColor;
  size: number;
}

export interface Bubble {
  x: number;
  y: number;
  row: number;
  col: number;
  color: BubbleColor;
  state: 'grid' | 'moving' | 'falling' | 'popping';
  vx: number;
  vy: number;
  radius: number;
  popTimer?: number;
}

export const COLORS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'];
export const BUBBLE_RADIUS = 20;
export const ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3);

export class GameEngine {
  rows: number;
  cols: number;
  grid: (Bubble | null)[][];
  offsetX: number;
  offsetY: number;
  movingBubbles: Bubble[] = [];
  fallingBubbles: Bubble[] = [];
  poppingBubbles: Bubble[] = [];
  score: number = 0;
  level: number = 1;
  shots: number = 20;
  state: 'playing' | 'won' | 'lost' = 'playing';
  width: number;
  height: number;
  nextColor: BubbleColor;
  currentColor: BubbleColor;
  particles: Particle[] = [];
  combo: number = 0;
  comboTimer: number = 0;
  comboText: { text: string, timer: number, x: number, y: number } | null = null;

  constructor(width: number, height: number, rows: number = 15, cols: number = 10) {
    this.width = width;
    this.height = height;
    this.rows = rows;
    this.cols = cols;
    this.offsetX = (width - (cols * BUBBLE_RADIUS * 2 + BUBBLE_RADIUS)) / 2 + BUBBLE_RADIUS;
    this.offsetY = BUBBLE_RADIUS;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.currentColor = this.getRandomColor();
    this.nextColor = this.getRandomColor();
    this.initLevel(this.level);
  }

  getRandomColor(): BubbleColor {
    const numColors = Math.min(COLORS.length, 2 + Math.floor(this.level / 2));
    return COLORS[Math.floor(Math.random() * numColors)];
  }

  initLevel(level: number) {
    this.level = level;
    this.shots = 20 + level * 5;
    this.score = 0;
    this.state = 'playing';
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    this.movingBubbles = [];
    this.fallingBubbles = [];
    this.poppingBubbles = [];
    this.particles = [];
    this.combo = 0;
    this.comboTimer = 0;
    this.comboText = null;
    
    const startRows = Math.min(4 + Math.floor(level / 2), this.rows - 4);
    for (let r = 0; r < startRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r % 2 === 1 && c === this.cols - 1) continue; // Hex grid offset
        
        let placeBubble = false;
        
        // Level patterns
        if (level === 1) {
          placeBubble = r < 4; // Simple block
        } else if (level === 2) {
          placeBubble = r < 5 && (c >= Math.floor(r/2) && c < this.cols - Math.floor(r/2)); // Pyramid-ish
        } else if (level === 3) {
          placeBubble = r < 6 && (c % 2 === 0); // Columns
        } else if (level === 4) {
          placeBubble = r < 6 && ((r + c) % 2 === 0); // Checkerboard
        } else {
          // Procedural generation for higher levels
          placeBubble = Math.random() > 0.2; // 80% chance to place a bubble
        }

        if (placeBubble) {
          let color = this.getRandomColor();
          // Try to match neighbor color to create clusters on higher levels
          if (level > 4 && r > 0 && Math.random() > 0.4) {
             const neighbors = this.getNeighbors(r, c);
             const coloredNeighbors = neighbors.map(n => this.grid[n.r][n.c]).filter(b => b !== null);
             if (coloredNeighbors.length > 0) {
               color = coloredNeighbors[Math.floor(Math.random() * coloredNeighbors.length)]!.color;
             }
          }

          const pos = this.getBubblePos(r, c);
          this.grid[r][c] = {
            x: pos.x,
            y: pos.y,
            row: r,
            col: c,
            color: color,
            state: 'grid',
            vx: 0,
            vy: 0,
            radius: BUBBLE_RADIUS
          };
        }
      }
    }

    // Ensure at least one bubble exists
    let hasBubbles = false;
    for(let r=0; r<this.rows; r++) for(let c=0; c<this.cols; c++) if(this.grid[r][c]) hasBubbles = true;
    if (!hasBubbles) {
       const pos = this.getBubblePos(0, Math.floor(this.cols/2));
       this.grid[0][Math.floor(this.cols/2)] = {
          x: pos.x, y: pos.y, row: 0, col: Math.floor(this.cols/2),
          color: this.getRandomColor(), state: 'grid', vx: 0, vy: 0, radius: BUBBLE_RADIUS
       };
    }

    this.currentColor = this.getRandomColor();
    this.nextColor = this.getRandomColor();
  }

  getBubblePos(row: number, col: number) {
    const x = this.offsetX + col * BUBBLE_RADIUS * 2 + (row % 2 === 1 ? BUBBLE_RADIUS : 0);
    const y = this.offsetY + row * ROW_HEIGHT;
    return { x, y };
  }

  getNeighbors(row: number, col: number) {
    const neighbors = [];
    const dirs = row % 2 === 0 ? 
      [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]] :
      [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
    
    for (const [dr, dc] of dirs) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < this.rows && c >= 0 && c < this.cols && (r % 2 === 0 || c < this.cols - 1)) {
        neighbors.push({ r, c });
      }
    }
    return neighbors;
  }

  shoot(x: number, y: number, angle: number, power: number) {
    if (this.state !== 'playing' || this.movingBubbles.length > 0) return;
    if (this.shots <= 0) {
      this.state = 'lost';
      return;
    }

    const speed = 15;
    const vx = Math.sin(angle) * speed;
    const vy = -Math.cos(angle) * speed;

    this.movingBubbles.push({
      x,
      y,
      row: -1,
      col: -1,
      color: this.currentColor,
      state: 'moving',
      vx,
      vy,
      radius: BUBBLE_RADIUS
    });

    this.currentColor = this.nextColor;
    this.nextColor = this.getRandomColor();
    this.shots--;
  }

  update(dt: number) {
    if (this.state !== 'playing') return;

    // Combo timers
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.comboText && this.comboText.timer > 0) {
      this.comboText.timer -= dt;
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Update moving bubbles
    for (let i = this.movingBubbles.length - 1; i >= 0; i--) {
      const b = this.movingBubbles[i];
      b.x += b.vx;
      b.y += b.vy;

      // Trail particles
      this.particles.push({
        x: b.x + (Math.random() - 0.5) * 10,
        y: b.y + (Math.random() - 0.5) * 10,
        vx: -b.vx * 0.2 + (Math.random() - 0.5) * 2,
        vy: -b.vy * 0.2 + (Math.random() - 0.5) * 2,
        life: 300, maxLife: 300, color: b.color, size: Math.random() * 4 + 2
      });

      // Wall collisions
      if (b.x - b.radius < 0) {
        b.x = b.radius;
        b.vx *= -1;
      } else if (b.x + b.radius > this.width) {
        b.x = this.width - b.radius;
        b.vx *= -1;
      }

      // Top collision
      if (b.y - b.radius < 0) {
        b.y = b.radius;
        this.snapToGrid(b);
        this.movingBubbles.splice(i, 1);
        continue;
      }

      // Bubble collisions
      let collided = false;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const target = this.grid[r][c];
          if (target) {
            const dx = b.x - target.x;
            const dy = b.y - target.y;
            const dist = Math.hypot(dx, dy);
            if (dist < BUBBLE_RADIUS * 2 - 2) {
              collided = true;
              break;
            }
          }
        }
        if (collided) break;
      }

      if (collided) {
        this.snapToGrid(b);
        this.movingBubbles.splice(i, 1);
      }
    }

    // Update falling bubbles
    for (let i = this.fallingBubbles.length - 1; i >= 0; i--) {
      const b = this.fallingBubbles[i];
      b.vy += 0.5; // gravity
      b.x += b.vx;
      b.y += b.vy;
      if (b.y - b.radius > this.height) {
        this.fallingBubbles.splice(i, 1);
      }
    }

    // Update popping bubbles
    for (let i = this.poppingBubbles.length - 1; i >= 0; i--) {
      const b = this.poppingBubbles[i];
      b.popTimer = (b.popTimer || 0) + 1;
      if (b.popTimer > 15) {
        this.poppingBubbles.splice(i, 1);
      }
    }

    this.checkWinLoss();
  }

  snapToGrid(b: Bubble) {
    let bestDist = Infinity;
    let bestR = 0;
    let bestC = 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r % 2 === 1 && c === this.cols - 1) continue;
        if (this.grid[r][c]) continue;

        const pos = this.getBubblePos(r, c);
        const dist = Math.hypot(pos.x - b.x, pos.y - b.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestR = r;
          bestC = c;
        }
      }
    }

    b.row = bestR;
    b.col = bestC;
    const pos = this.getBubblePos(bestR, bestC);
    b.x = pos.x;
    b.y = pos.y;
    b.state = 'grid';
    b.vx = 0;
    b.vy = 0;
    this.grid[bestR][bestC] = b;

    this.resolveMatches(bestR, bestC);
  }

  resolveMatches(row: number, col: number) {
    const startBubble = this.grid[row][col];
    if (!startBubble) return;

    const color = startBubble.color;
    const matchGroup: {r: number, c: number}[] = [];
    const visited = new Set<string>();
    const queue = [{r: row, c: col}];
    visited.add(`${row},${col}`);

    while (queue.length > 0) {
      const {r, c} = queue.shift()!;
      matchGroup.push({r, c});

      const neighbors = this.getNeighbors(r, c);
      for (const n of neighbors) {
        const key = `${n.r},${n.c}`;
        if (!visited.has(key)) {
          const neighborBubble = this.grid[n.r][n.c];
          if (neighborBubble && neighborBubble.color === color) {
            visited.add(key);
            queue.push(n);
          }
        }
      }
    }

    if (matchGroup.length >= 3) {
      this.combo++;
      this.comboTimer = 2000; // 2 seconds to keep combo
      if (this.combo > 1) {
        this.comboText = { text: `${this.combo}x COMBO!`, timer: 1500, x: this.width / 2, y: this.height / 2 };
        this.score += this.combo * 50;
      } else {
        this.score += matchGroup.length * 10;
      }

      for (const {r, c} of matchGroup) {
        const b = this.grid[r][c]!;
        b.state = 'popping';
        b.popTimer = 0;
        this.poppingBubbles.push(b);
        this.grid[r][c] = null;

        // Spawn pop particles
        for (let i = 0; i < 15; i++) {
          this.particles.push({
            x: b.x, y: b.y,
            vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15,
            life: 600, maxLife: 600, color: b.color, size: Math.random() * 6 + 2
          });
        }
      }
      this.dropFloatingBubbles();
    } else {
      // Reset combo if shot didn't match
      this.combo = 0;
    }
  }

  dropFloatingBubbles() {
    const connected = new Set<string>();
    const queue: {r: number, c: number}[] = [];

    // Start from top row
    for (let c = 0; c < this.cols; c++) {
      if (this.grid[0][c]) {
        queue.push({r: 0, c});
        connected.add(`0,${c}`);
      }
    }

    while (queue.length > 0) {
      const {r, c} = queue.shift()!;
      const neighbors = this.getNeighbors(r, c);
      for (const n of neighbors) {
        const key = `${n.r},${n.c}`;
        if (!connected.has(key) && this.grid[n.r][n.c]) {
          connected.add(key);
          queue.push(n);
        }
      }
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const b = this.grid[r][c];
        if (b && !connected.has(`${r},${c}`)) {
          b.state = 'falling';
          b.vx = (Math.random() - 0.5) * 4;
          b.vy = 0;
          this.fallingBubbles.push(b);
          this.grid[r][c] = null;
          this.score += 20; // Bonus for dropping
        }
      }
    }
  }

  checkWinLoss() {
    let hasBubbles = false;
    let lowestRow = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) {
          hasBubbles = true;
          lowestRow = Math.max(lowestRow, r);
        }
      }
    }

    if (!hasBubbles) {
      this.state = 'won';
    } else if (lowestRow >= this.rows - 2) {
      this.state = 'lost';
    } else if (this.shots <= 0 && this.movingBubbles.length === 0 && this.poppingBubbles.length === 0 && this.fallingBubbles.length === 0) {
      this.state = 'lost';
    }
  }

  swapColors() {
    const temp = this.currentColor;
    this.currentColor = this.nextColor;
    this.nextColor = temp;
  }
}
