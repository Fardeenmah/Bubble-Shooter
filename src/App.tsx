import React, { useEffect, useRef, useState } from 'react';
import { GameEngine, Bubble, COLORS, BUBBLE_RADIUS } from './game/engine';
import { HandTracker } from './ai/handTracking';
import { GestureRecognizer, GestureState } from './ai/gestureRecognition';
import { Results } from '@mediapipe/hands';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { HAND_CONNECTIONS } from '@mediapipe/hands';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 800;

const COLOR_MAP: Record<string, string> = {
  red: '#ff4757',
  blue: '#1e90ff',
  green: '#2ed573',
  yellow: '#ffa502',
  purple: '#9b59b6',
  cyan: '#00cec9'
};

// Pre-render bubbles to offscreen canvases for performance
const bubbleCache: Record<string, HTMLCanvasElement> = {};

function getCachedBubble(color: string, radius: number): HTMLCanvasElement {
  const key = `${color}-${radius}`;
  if (bubbleCache[key]) return bubbleCache[key];

  const canvas = document.createElement('canvas');
  canvas.width = radius * 2;
  canvas.height = radius * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cx = radius;
  const cy = radius;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  
  const gradient = ctx.createRadialGradient(
    cx - radius * 0.3, cy - radius * 0.3, radius * 0.1,
    cx, cy, radius
  );
  
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.3, COLOR_MAP[color] || color);
  gradient.addColorStop(1, '#000000');
  
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.closePath();
  
  // Highlight
  ctx.beginPath();
  ctx.arc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fill();
  ctx.closePath();

  bubbleCache[key] = canvas;
  return canvas;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const smoothedAimAngleRef = useRef<number>(0);
  const gestureRecognizerRef = useRef(new GestureRecognizer());

  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [shots, setShots] = useState(0);
  const [gameState, setGameState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [isIntro, setIsIntro] = useState(true);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'initializing' | 'tracking' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  // Audio context
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playSound = (type: 'shoot' | 'pop' | 'win' | 'lose' | 'combo') => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'shoot') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'pop') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === 'lose') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === 'combo') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    engineRef.current = new GameEngine(CANVAS_WIDTH, CANVAS_HEIGHT);
    setShots(engineRef.current.shots);

    let animationFrameId: number;
    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;

      const engine = engineRef.current;
      if (!engine) return;

      const oldScore = engine.score;
      const oldState = engine.state;
      const oldCombo = engine.combo;

      engine.update(dt);

      if (engine.score > oldScore) {
        playSound('pop');
      }
      if (engine.combo > oldCombo && engine.combo > 1) {
        playSound('combo');
      }
      if (engine.state === 'won' && oldState !== 'won') {
        playSound('win');
      } else if (engine.state === 'lost' && oldState !== 'lost') {
        playSound('lose');
      }

      setScore(engine.score);
      setLevel(engine.level);
      setShots(engine.shots);
      setGameState(engine.state);

      // Draw
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Background
      const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      gradient.addColorStop(0, '#1a1a2e');
      gradient.addColorStop(1, '#16213e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw grid bubbles
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          const b = engine.grid[r][c];
          if (b) drawBubble(ctx, b);
        }
      }

      // Draw moving bubbles
      engine.movingBubbles.forEach(b => drawBubble(ctx, b));
      engine.fallingBubbles.forEach(b => drawBubble(ctx, b));
      
      // Draw popping bubbles
      engine.poppingBubbles.forEach(b => {
        ctx.save();
        ctx.globalAlpha = 1 - (b.popTimer || 0) / 15;
        drawBubble(ctx, b);
        ctx.restore();
      });

      // Draw particles
      engine.particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = COLOR_MAP[p.color] || p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Draw combo text
      if (engine.comboText && engine.comboText.timer > 0) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, engine.comboText.timer / 1500);
        ctx.fillStyle = '#feca57';
        ctx.font = '900 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff9f43';
        ctx.shadowBlur = 20;
        const scale = 1 + (1500 - engine.comboText.timer) / 3000;
        ctx.translate(engine.comboText.x, engine.comboText.y);
        ctx.scale(scale, scale);
        ctx.fillText(engine.comboText.text, 0, 0);
        ctx.restore();
      }

      // Draw virtual cursor
      const currentGesture = gestureRef.current;
      if (currentGesture && cameraStatus === 'tracking') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(currentGesture.cursorX, currentGesture.cursorY, 12, 0, Math.PI * 2);
        ctx.fillStyle = currentGesture.isPinching ? 'rgba(255, 50, 50, 0.8)' : 'rgba(50, 255, 50, 0.5)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw small dot in center
        ctx.beginPath();
        ctx.arc(currentGesture.cursorX, currentGesture.cursorY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      }

      // Draw debug info
      if (debugMode) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(10, 10, 200, 100);
        ctx.fillStyle = '#00FF00';
        ctx.font = '12px monospace';
        ctx.fillText(`FPS: ${Math.round(1000 / dt)}`, 20, 30);
        ctx.fillText(`Bubbles (Grid): ${engine.grid.flat().filter(Boolean).length}`, 20, 50);
        ctx.fillText(`Bubbles (Moving): ${engine.movingBubbles.length}`, 20, 70);
        ctx.fillText(`Particles: ${engine.particles.length}`, 20, 90);
      }

      // Draw launcher
      const launcherX = CANVAS_WIDTH / 2;
      const launcherY = CANVAS_HEIGHT - 40;
      
      // Aim line
      const aimAngle = gestureRef.current?.aimAngle || 0;

      ctx.save();
      ctx.strokeStyle = COLOR_MAP[engine.currentColor] || 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      
      let cx = launcherX;
      let cy = launcherY;
      ctx.moveTo(cx, cy);

      let cdx = Math.sin(aimAngle) * 5;
      let cdy = -Math.cos(aimAngle) * 5;
      
      let hit = false;
      for (let step = 0; step < 300; step++) {
        cx += cdx;
        cy += cdy;
        
        let bounced = false;
        // Wall collisions
        if (cx - BUBBLE_RADIUS < 0) {
          cx = BUBBLE_RADIUS;
          cdx *= -1;
          bounced = true;
        } else if (cx + BUBBLE_RADIUS > CANVAS_WIDTH) {
          cx = CANVAS_WIDTH - BUBBLE_RADIUS;
          cdx *= -1;
          bounced = true;
        }
        
        if (bounced) {
          ctx.lineTo(cx, cy);
        }
        
        // Top collision
        if (cy - BUBBLE_RADIUS < 0) {
          cy = BUBBLE_RADIUS;
          hit = true;
        }
        
        // Bubble collisions
        if (!hit) {
          for (let r = 0; r < engine.rows; r++) {
            for (let c = 0; c < engine.cols; c++) {
              const target = engine.grid[r][c];
              if (target) {
                const dist = Math.hypot(cx - target.x, cy - target.y);
                if (dist < BUBBLE_RADIUS * 2 - 2) {
                  hit = true;
                  break;
                }
              }
            }
            if (hit) break;
          }
        }
        
        if (hit) {
          ctx.lineTo(cx, cy);
          ctx.stroke();
          
          // Draw landing indicator
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(cx, cy, BUBBLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = (COLOR_MAP[engine.currentColor] || '#ffffff') + '40';
          ctx.fill();
          ctx.stroke();
          break;
        }
      }
      
      if (!hit) {
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      ctx.restore();

      // Current bubble in launcher
      if (engine.state === 'playing') {
        drawBubble(ctx, {
          x: launcherX,
          y: launcherY,
          color: engine.currentColor,
          radius: BUBBLE_RADIUS,
          state: 'grid',
          row: -1, col: -1, vx: 0, vy: 0
        });
        
        // Next bubble indicator
        drawBubble(ctx, {
          x: launcherX + 60,
          y: launcherY + 10,
          color: engine.nextColor,
          radius: BUBBLE_RADIUS * 0.6,
          state: 'grid',
          row: -1, col: -1, vx: 0, vy: 0
        });
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const drawBubble = (ctx: CanvasRenderingContext2D, b: Bubble) => {
    const cachedCanvas = getCachedBubble(b.color, b.radius);
    ctx.drawImage(cachedCanvas, b.x - b.radius, b.y - b.radius);
  };

  const initCamera = async () => {
    if (!videoRef.current || !previewCanvasRef.current) return;
    setCameraStatus('initializing');
    setCameraError(null);
    try {
      // Explicitly request permissions to catch errors early
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // We don't need to keep this stream, MediaPipe will request its own,
      // but this ensures permissions are granted and errors are caught.
      stream.getTracks().forEach(track => track.stop());

      trackerRef.current = new HandTracker(videoRef.current, (results: Results) => {
        setCameraStatus('tracking');
        const previewCtx = previewCanvasRef.current?.getContext('2d');
        if (previewCtx && previewCanvasRef.current) {
          previewCtx.save();
          previewCtx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
          previewCtx.drawImage(results.image, 0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
          
          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            
            // Draw landmarks only in debug mode or preview
            previewCtx.strokeStyle = '#00FF00';
            previewCtx.lineWidth = 2;
            // Simplified drawing for preview
            landmarks.forEach(lm => {
              previewCtx.beginPath();
              previewCtx.arc(lm.x * previewCanvasRef.current!.width, lm.y * previewCanvasRef.current!.height, 2, 0, Math.PI*2);
              previewCtx.fillStyle = '#FF0000';
              previewCtx.fill();
            });
            
            const g = gestureRecognizerRef.current.recognizeGesture(landmarks, CANVAS_WIDTH, CANVAS_HEIGHT);
            
            if (g.isPinching && (!gestureRef.current || !gestureRef.current.isPinching)) {
              // Just pinched
              if (engineRef.current && engineRef.current.state === 'playing') {
                engineRef.current.shoot(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40, g.aimAngle, 1);
                playSound('shoot');
              }
            }
            if (g.isSwapping && (!gestureRef.current || !gestureRef.current.isSwapping)) {
              // Just swapped
              if (engineRef.current && engineRef.current.state === 'playing') {
                engineRef.current.swapColors();
              }
            }
            gestureRef.current = g;
            setGesture(g);
          } else {
            gestureRecognizerRef.current.resetSmoothing();
            gestureRef.current = null;
            setGesture(null);
          }
          previewCtx.restore();
        }
      });
      await trackerRef.current.start();
    } catch (e) {
      console.error("Camera error:", e);
      setCameraStatus('error');
      setCameraError(e instanceof Error ? e.message : 'Failed to access camera');
    }
  };

  // Keyboard fallback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!engineRef.current) return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        const aimAngle = gestureRef.current?.aimAngle || 0;
        engineRef.current.shoot(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40, aimAngle, 1);
        playSound('shoot');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const maxAngle = 80 * (Math.PI / 180);
        const newAngle = Math.max(-maxAngle, (gestureRef.current?.aimAngle || 0) - 0.1);
        const g = { isPinching: false, aimAngle: newAngle, handX: 0, handY: 0, cursorX: 0, cursorY: 0 };
        gestureRef.current = g;
        setGesture(g);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const maxAngle = 80 * (Math.PI / 180);
        const newAngle = Math.min(maxAngle, (gestureRef.current?.aimAngle || 0) + 0.1);
        const g = { isPinching: false, aimAngle: newAngle, handX: 0, handY: 0, cursorX: 0, cursorY: 0 };
        gestureRef.current = g;
        setGesture(g);
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyS') {
        e.preventDefault();
        engineRef.current.swapColors();
      } else if (e.code === 'KeyD') {
        setDebugMode(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNextLevel = () => {
    if (engineRef.current) {
      engineRef.current.initLevel(engineRef.current.level + 1);
    }
  };

  const handleRestart = () => {
    if (engineRef.current) {
      engineRef.current.initLevel(1);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !engineRef.current || cameraStatus === 'tracking') return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const launcherX = CANVAS_WIDTH / 2;
    const launcherY = CANVAS_HEIGHT - 40;
    
    // Calculate angle from launcher to mouse
    const dx = x - launcherX;
    const dy = launcherY - y; // Invert Y because canvas Y goes down
    
    let angle = Math.atan2(dx, dy);
    const maxAngle = 80 * (Math.PI / 180);
    angle = Math.max(-maxAngle, Math.min(maxAngle, angle));
    
    const g = {
      isPinching: gestureRef.current?.isPinching || false,
      isSwapping: gestureRef.current?.isSwapping || false,
      aimAngle: angle,
      handX: x,
      handY: y,
      cursorX: x,
      cursorY: y
    };
    gestureRef.current = g;
    setGesture(g);
  };

  const handleCanvasTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !engineRef.current || cameraStatus === 'tracking') return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const touch = e.touches[0];
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    
    const launcherX = CANVAS_WIDTH / 2;
    const launcherY = CANVAS_HEIGHT - 40;
    
    const dx = x - launcherX;
    const dy = launcherY - y;
    
    let angle = Math.atan2(dx, dy);
    const maxAngle = 80 * (Math.PI / 180);
    angle = Math.max(-maxAngle, Math.min(maxAngle, angle));
    
    const g = {
      isPinching: gestureRef.current?.isPinching || false,
      isSwapping: gestureRef.current?.isSwapping || false,
      aimAngle: angle,
      handX: x,
      handY: y,
      cursorX: x,
      cursorY: y
    };
    gestureRef.current = g;
    setGesture(g);
  };

  const handleCanvasClick = () => {
    if (!engineRef.current || cameraStatus === 'tracking') return;
    const aimAngle = gestureRef.current?.aimAngle || 0;
    engineRef.current.shoot(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40, aimAngle, 1);
    playSound('shoot');
  };

  const handleSwapColor = () => {
    if (engineRef.current) {
      engineRef.current.swapColors();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (engineRef.current) {
      engineRef.current.swapColors();
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-gray-900 text-white font-sans flex flex-col items-center justify-center p-2 md:p-4 overflow-hidden box-border">
      <div className="h-full max-w-7xl flex flex-col md:flex-row gap-2 md:gap-6 items-center justify-center min-h-0 w-full mx-auto">
        
        {/* Left/Main Game Area */}
        <div 
          className="flex-1 flex flex-col items-center justify-center w-full h-full min-h-0 relative"
          style={{ maxWidth: 'calc((100dvh - 108px) * 0.75)' }}
        >
          
          <div className="w-full flex-shrink-0 flex justify-between items-center mb-2 md:mb-4 bg-gray-800 p-2 md:p-4 rounded-xl shadow-lg border border-gray-700">
            <div className="text-xs md:text-xl font-bold text-blue-400">SCORE: {score}</div>
            <div className="text-xs md:text-xl font-bold text-purple-400">LEVEL: {level}</div>
            <div className="text-xs md:text-xl font-bold text-green-400">SHOTS: {shots}</div>
          </div>
          
          <div className="flex-1 w-full min-h-0 flex justify-center items-center relative">
            <div 
              className="relative rounded-xl overflow-hidden shadow-2xl border-2 md:border-4 border-gray-800 cursor-crosshair w-full h-full"
            >
              <canvas 
                ref={canvasRef} 
                width={CANVAS_WIDTH} 
                height={CANVAS_HEIGHT}
                className="bg-black block w-full h-full touch-none"
                onMouseMove={handleCanvasMouseMove}
                onTouchMove={handleCanvasTouchMove}
                onTouchStart={handleCanvasTouchMove}
                onClick={handleCanvasClick}
                onContextMenu={handleContextMenu}
              />
              
              {isIntro && (
                <div className="absolute inset-0 bg-gray-900/95 flex flex-col items-center justify-center z-50 p-4 md:p-8">
                  <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-2 md:mb-6 drop-shadow-lg text-center leading-tight">
                    GESTURE<br/>BUBBLE SHOOTER
                  </h1>
                  <p className="text-gray-300 mb-4 md:mb-8 max-w-sm text-center text-xs md:text-lg">
                    Use your webcam and hand gestures to aim and shoot! Pinch your fingers to fire.
                  </p>
                  <div className="flex flex-col gap-3 w-full max-w-xs">
                    <button 
                      onClick={() => { setIsIntro(false); initCamera(); }}
                      className="w-full py-3 md:py-4 bg-blue-600 hover:bg-blue-500 rounded-full text-base md:text-lg font-bold transition-transform hover:scale-105 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                    >
                      ENABLE CAMERA
                    </button>
                    <button 
                      onClick={() => setIsIntro(false)}
                      className="w-full py-3 md:py-4 bg-gray-700 hover:bg-gray-600 rounded-full text-base md:text-lg font-bold transition-transform hover:scale-105"
                    >
                      PLAY WITH MOUSE
                    </button>
                  </div>
                </div>
              )}

              {gameState === 'won' && !isIntro && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
                  <h2 className="text-4xl md:text-5xl font-bold text-green-400 mb-4 drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]">LEVEL CLEARED!</h2>
                  <button 
                    onClick={handleNextLevel}
                    className="px-6 py-2 md:px-8 md:py-3 bg-blue-600 hover:bg-blue-500 rounded-full text-lg md:text-xl font-bold transition-transform hover:scale-105"
                  >
                    NEXT LEVEL
                  </button>
                </div>
              )}
              
              {gameState === 'lost' && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
                  <h2 className="text-4xl md:text-5xl font-bold text-red-500 mb-4 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]">GAME OVER</h2>
                  <button 
                    onClick={handleRestart}
                    className="px-6 py-2 md:px-8 md:py-3 bg-red-600 hover:bg-red-500 rounded-full text-lg md:text-xl font-bold transition-transform hover:scale-105"
                  >
                    TRY AGAIN
                  </button>
                </div>
              )}
            </div>
          </div>

          {!isIntro && cameraStatus !== 'tracking' && (
            <div className="w-full max-w-[600px] flex-shrink-0 flex gap-2 mt-2 md:hidden pb-2">
              <button 
                onClick={handleSwapColor}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl text-sm font-bold shadow-lg active:scale-95 transition-transform"
              >
                SWAP COLOR
              </button>
              <button 
                onClick={handleCanvasClick}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-bold shadow-lg active:scale-95 transition-transform"
              >
                SHOOT
              </button>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="w-full md:w-80 lg:w-96 flex-shrink-0 flex flex-col gap-2 md:gap-6 h-full">
          
          <div className="flex-1 bg-gray-800 p-2 md:p-6 rounded-xl shadow-lg border-2 border-blue-400 md:border-gray-700 flex flex-col min-h-0 items-center md:items-stretch justify-start">
            <h3 className="text-sm md:text-xl font-bold mb-1 md:mb-4 text-gray-200 hidden md:block">Camera Controls</h3>
            
            <div className="flex flex-row md:flex-col items-center md:items-stretch justify-center gap-4 w-full">
              <div className="relative aspect-video w-[50%] max-w-[250px] md:w-full md:max-w-none mx-auto md:mx-0 bg-black rounded-lg overflow-hidden mb-0 md:mb-4 min-h-0 flex-shrink-0">
                <video 
                  ref={videoRef} 
                  className="absolute opacity-0 w-[1px] h-[1px] pointer-events-none" 
                  playsInline 
                  autoPlay
                  muted
                />
                <canvas 
                  ref={previewCanvasRef} 
                  width={320} 
                  height={240} 
                  className="w-full h-full object-cover transform -scale-x-100"
                />
                {cameraStatus === 'idle' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                    <button 
                      onClick={initCamera}
                      className="px-3 py-1 md:px-4 md:py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold text-xs md:text-base"
                    >
                      Enable Camera
                    </button>
                  </div>
                )}
                {cameraStatus === 'initializing' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                    <div className="text-blue-400 font-semibold animate-pulse text-xs md:text-base">Initializing...</div>
                  </div>
                )}
                {cameraStatus === 'error' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/90 p-2 text-center">
                    <div className="text-red-400 font-semibold mb-1 text-xs md:text-base">Camera Error</div>
                    <div className="text-[10px] md:text-xs text-gray-400 hidden md:block">{cameraError}</div>
                    <button 
                      onClick={initCamera}
                      className="mt-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>

              <div className="mb-0 md:mb-4 block flex-1 md:flex-none">
                <h4 className="text-[10px] md:text-sm font-bold text-gray-300 mb-1 md:mb-2">How to Play:</h4>
                <ul className="text-[8px] md:text-xs text-gray-400 space-y-0.5 md:space-y-1">
                  <li><span className="text-blue-400 font-bold">Aim:</span> Move your Index Finger</li>
                  <li><span className="text-yellow-400 font-bold">Shoot:</span> Pinch (Thumb + Index)</li>
                  <li><span className="text-purple-400 font-bold">Swap Color:</span> Closed Fist</li>
                </ul>
              </div>
            </div>

            <div className="space-y-1 md:space-y-3 font-mono text-[10px] md:text-sm overflow-y-auto hidden md:block">
              <div className="flex justify-between items-center p-1 md:p-2 bg-gray-900 rounded">
                <span className="text-gray-400">HAND DETECTED</span>
                <span className={gesture ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                  {gesture ? "YES" : "NO"}
                </span>
              </div>
              <div className="flex justify-between items-center p-1 md:p-2 bg-gray-900 rounded">
                <span className="text-gray-400">GESTURE</span>
                <span className={gesture?.isPinching ? "text-yellow-400 font-bold" : gesture?.isSwapping ? "text-purple-400 font-bold" : "text-gray-500"}>
                  {gesture?.isPinching ? "PINCH (SHOOT)" : gesture?.isSwapping ? "SWAP COLOR" : "OPEN"}
                </span>
              </div>
              <div className="flex justify-between items-center p-1 md:p-2 bg-gray-900 rounded">
                <span className="text-gray-400">AIM ANGLE</span>
                <span className="text-blue-400 font-bold">
                  {gesture ? Math.round(gesture.aimAngle * (180/Math.PI)) + '°' : '0°'}
                </span>
              </div>
            </div>
            
            <p className="mt-2 md:mt-6 text-[8px] md:text-xs text-gray-500 text-center hidden md:block">
              Your camera is used only for hand gesture detection. No video is recorded or stored.
            </p>
          </div>

          <div className="flex-shrink-0 bg-gray-800 p-2 md:p-6 rounded-xl shadow-lg border border-gray-700 hidden md:block">
            <h3 className="text-sm md:text-lg font-bold mb-1 md:mb-2 text-gray-200">Fallback Controls</h3>
            <ul className="text-[10px] md:text-sm text-gray-400 space-y-1 md:space-y-2">
              <li><kbd className="bg-gray-700 px-1 md:px-2 py-0.5 md:py-1 rounded text-gray-200">←</kbd> <kbd className="bg-gray-700 px-1 md:px-2 py-0.5 md:py-1 rounded text-gray-200">→</kbd> Aim left/right</li>
              <li><kbd className="bg-gray-700 px-1 md:px-2 py-0.5 md:py-1 rounded text-gray-200">Space</kbd> Shoot</li>
              <li><kbd className="bg-gray-700 px-1 md:px-2 py-0.5 md:py-1 rounded text-gray-200">Shift</kbd> / <kbd className="bg-gray-700 px-1 md:px-2 py-0.5 md:py-1 rounded text-gray-200">Right Click</kbd> Swap Colors</li>
              <li><kbd className="bg-gray-700 px-1 md:px-2 py-0.5 md:py-1 rounded text-gray-200">D</kbd> Toggle Debug Mode</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
