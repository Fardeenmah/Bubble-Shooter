import React, { useEffect, useRef, useState } from 'react';
import { GameEngine, Bubble, COLORS, BUBBLE_RADIUS } from './game/engine';
import { HandTracker } from './ai/handTracking';
import { recognizeGesture, GestureState } from './ai/gestureRecognition';
import { Results } from '@mediapipe/hands';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { HAND_CONNECTIONS } from '@mediapipe/hands';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 800;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const smoothedAimAngleRef = useRef<number>(0);

  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [shots, setShots] = useState(0);
  const [gameState, setGameState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [isIntro, setIsIntro] = useState(true);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);

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
      const colorMap: Record<string, string> = {
        red: '#ff4757', blue: '#1e90ff', green: '#2ed573',
        yellow: '#ffa502', purple: '#9b59b6', cyan: '#00cec9'
      };
      engine.particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = colorMap[p.color] || p.color;
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
      if (currentGesture && cameraEnabled) {
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

      // Draw launcher
      const launcherX = CANVAS_WIDTH / 2;
      const launcherY = CANVAS_HEIGHT - 40;
      
      // Aim line
      const targetAimAngle = gestureRef.current?.aimAngle || 0;

      // Use a smaller smoothing factor (0.08 instead of 0.3) to heavily reduce flickering/jitter
      smoothedAimAngleRef.current += (targetAimAngle - smoothedAimAngleRef.current) * 0.08;
      const aimAngle = smoothedAimAngleRef.current;

      ctx.save();
      ctx.translate(launcherX, launcherY);
      ctx.rotate(aimAngle);
      
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -800);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.stroke();
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
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    
    const gradient = ctx.createRadialGradient(
      b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.1,
      b.x, b.y, b.radius
    );
    
    const colorMap: Record<string, string> = {
      red: '#ff4757',
      blue: '#1e90ff',
      green: '#2ed573',
      yellow: '#ffa502',
      purple: '#9b59b6',
      cyan: '#00cec9'
    };
    
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.3, colorMap[b.color]);
    gradient.addColorStop(1, '#000000');
    
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.closePath();
    
    // Highlight
    ctx.beginPath();
    ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fill();
    ctx.closePath();
  };

  const initCamera = async () => {
    if (!videoRef.current || !previewCanvasRef.current) return;
    try {
      trackerRef.current = new HandTracker(videoRef.current, (results: Results) => {
        const previewCtx = previewCanvasRef.current?.getContext('2d');
        if (previewCtx && previewCanvasRef.current) {
          previewCtx.save();
          previewCtx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
          previewCtx.drawImage(results.image, 0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
          
          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            drawConnectors(previewCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
            drawLandmarks(previewCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 2 });
            
            const g = recognizeGesture(landmarks, CANVAS_WIDTH, CANVAS_HEIGHT);
            
            if (g.isPinching && (!gestureRef.current || !gestureRef.current.isPinching)) {
              // Just pinched
              if (engineRef.current && engineRef.current.state === 'playing') {
                engineRef.current.shoot(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40, g.aimAngle, 1);
                playSound('shoot');
              }
            }
            gestureRef.current = g;
            setGesture(g);
          } else {
            gestureRef.current = null;
            setGesture(null);
          }
          previewCtx.restore();
        }
      });
      trackerRef.current.start();
      setCameraEnabled(true);
    } catch (e) {
      console.error("Camera error:", e);
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
    if (!canvasRef.current || !engineRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
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
    if (!engineRef.current) return;
    const aimAngle = gestureRef.current?.aimAngle || 0;
    engineRef.current.shoot(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40, aimAngle, 1);
    playSound('shoot');
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (engineRef.current) {
      engineRef.current.swapColors();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center justify-center p-4">
      <div className="max-w-6xl w-full flex flex-col md:flex-row gap-8 items-start">
        
        {/* Left/Main Game Area */}
        <div className="flex-1 flex flex-col items-center relative">
          <div className="w-full max-w-[600px] flex justify-between items-center mb-4 bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
            <div className="text-xl font-bold text-blue-400">SCORE: {score}</div>
            <div className="text-xl font-bold text-purple-400">LEVEL: {level}</div>
            <div className="text-xl font-bold text-green-400">SHOTS: {shots}</div>
          </div>
          
          <div className="relative rounded-xl overflow-hidden shadow-2xl border-4 border-gray-800 cursor-crosshair">
            <canvas 
              ref={canvasRef} 
              width={CANVAS_WIDTH} 
              height={CANVAS_HEIGHT}
              className="bg-black block"
              onMouseMove={handleCanvasMouseMove}
              onClick={handleCanvasClick}
              onContextMenu={handleContextMenu}
            />
            
            {isIntro && (
              <div className="absolute inset-0 bg-gray-900/95 flex flex-col items-center justify-center z-50 p-8">
                <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-6 drop-shadow-lg text-center leading-tight">
                  GESTURE<br/>BUBBLE SHOOTER
                </h1>
                <p className="text-gray-300 mb-8 max-w-sm text-center text-lg">
                  Use your webcam and hand gestures to aim and shoot! Pinch your fingers to fire.
                </p>
                <div className="flex flex-col gap-4 w-full max-w-xs">
                  <button 
                    onClick={() => { setIsIntro(false); initCamera(); }}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-full text-lg font-bold transition-transform hover:scale-105 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                  >
                    ENABLE CAMERA
                  </button>
                  <button 
                    onClick={() => setIsIntro(false)}
                    className="w-full py-4 bg-gray-700 hover:bg-gray-600 rounded-full text-lg font-bold transition-transform hover:scale-105"
                  >
                    PLAY WITH MOUSE
                  </button>
                </div>
              </div>
            )}

            {gameState === 'won' && !isIntro && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
                <h2 className="text-5xl font-bold text-green-400 mb-4 drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]">LEVEL CLEARED!</h2>
                <button 
                  onClick={handleNextLevel}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-full text-xl font-bold transition-transform hover:scale-105"
                >
                  NEXT LEVEL
                </button>
              </div>
            )}
            
            {gameState === 'lost' && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
                <h2 className="text-5xl font-bold text-red-500 mb-4 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]">GAME OVER</h2>
                <button 
                  onClick={handleRestart}
                  className="px-8 py-3 bg-red-600 hover:bg-red-500 rounded-full text-xl font-bold transition-transform hover:scale-105"
                >
                  TRY AGAIN
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-full md:w-80 flex flex-col gap-6">
          <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-gray-200">Camera Controls</h3>
            
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4 border-2 border-gray-600">
              <video 
                ref={videoRef} 
                className="hidden" 
                playsInline 
              />
              <canvas 
                ref={previewCanvasRef} 
                width={320} 
                height={240} 
                className="w-full h-full object-cover transform -scale-x-100"
              />
              {!cameraEnabled && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                  <button 
                    onClick={initCamera}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold"
                  >
                    Enable Camera
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3 font-mono text-sm">
              <div className="flex justify-between items-center p-2 bg-gray-900 rounded">
                <span className="text-gray-400">HAND DETECTED</span>
                <span className={gesture ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                  {gesture ? "YES" : "NO"}
                </span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-900 rounded">
                <span className="text-gray-400">GESTURE</span>
                <span className={gesture?.isPinching ? "text-yellow-400 font-bold" : "text-gray-500"}>
                  {gesture?.isPinching ? "PINCH (SHOOT)" : "OPEN"}
                </span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-900 rounded">
                <span className="text-gray-400">AIM ANGLE</span>
                <span className="text-blue-400 font-bold">
                  {gesture ? Math.round(gesture.aimAngle * (180/Math.PI)) + '°' : '0°'}
                </span>
              </div>
            </div>
            
            <p className="mt-6 text-xs text-gray-500 text-center">
              Your camera is used only for hand gesture detection. No video is recorded or stored.
            </p>
          </div>

          <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
            <h3 className="text-lg font-bold mb-2 text-gray-200">Fallback Controls</h3>
            <ul className="text-sm text-gray-400 space-y-2">
              <li><kbd className="bg-gray-700 px-2 py-1 rounded text-gray-200">←</kbd> <kbd className="bg-gray-700 px-2 py-1 rounded text-gray-200">→</kbd> Aim left/right</li>
              <li><kbd className="bg-gray-700 px-2 py-1 rounded text-gray-200">Space</kbd> Shoot</li>
              <li><kbd className="bg-gray-700 px-2 py-1 rounded text-gray-200">Shift</kbd> / <kbd className="bg-gray-700 px-2 py-1 rounded text-gray-200">Right Click</kbd> Swap Colors</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
