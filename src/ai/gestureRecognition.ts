import { NormalizedLandmarkList } from '@mediapipe/hands';

export interface GestureState {
  isPinching: boolean;
  isSwapping: boolean;
  aimAngle: number;
  handX: number;
  handY: number;
  cursorX: number;
  cursorY: number;
}

/**
 * Class responsible for interpreting hand landmarks into game gestures.
 * Includes temporal smoothing and debounce logic for stability.
 */
export class GestureRecognizer {
  private smoothedCursorX: number | null = null;
  private smoothedCursorY: number | null = null;
  private smoothedAimAngle: number | null = null;
  
  private lastPinchTime: number = 0;
  private lastSwapTime: number = 0;
  
  private readonly SMOOTHING_ALPHA = 0.4; // Lower = smoother, Higher = more responsive
  private readonly COOLDOWN_MS = 300; // Prevent accidental double triggers

  /**
   * Analyzes hand landmarks to determine cursor position and gestures
   * @param landmarks - Normalized hand landmarks from MediaPipe
   * @param canvasWidth - Width of the game canvas
   * @param canvasHeight - Height of the game canvas
   * @returns GestureState containing smoothed coordinates and boolean triggers
   */
  public recognizeGesture(landmarks: NormalizedLandmarkList, canvasWidth: number, canvasHeight: number): GestureState {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const indexMcp = landmarks[5];
    const wrist = landmarks[0];

    // Scale-invariant pinch detection (Thumb + Index)
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const pinchDist = Math.sqrt(dx * dx + dy * dy);
    
    const refDx = wrist.x - indexMcp.x;
    const refDy = wrist.y - indexMcp.y;
    const refDist = Math.sqrt(refDx * refDx + refDy * refDy);
    
    // Threshold relative to hand size
    const isPinchingRaw = (pinchDist / refDist) < 0.25;

    // Swap detection (Thumb + Middle)
    const swapDx = thumbTip.x - middleTip.x;
    const swapDy = thumbTip.y - middleTip.y;
    const swapDist = Math.sqrt(swapDx * swapDx + swapDy * swapDy);
    const isSwappingRaw = (swapDist / refDist) < 0.25;

    const now = Date.now();
    let isPinching = false;
    let isSwapping = false;

    // Debounce gestures
    if (isPinchingRaw && now - this.lastPinchTime > this.COOLDOWN_MS) {
      isPinching = true;
      this.lastPinchTime = now;
    }

    if (isSwappingRaw && now - this.lastSwapTime > this.COOLDOWN_MS) {
      isSwapping = true;
      this.lastSwapTime = now;
    }

    // Virtual cursor based on index finger tip
    // Mirrored X because camera is mirrored
    const rawCursorX = (1 - indexTip.x) * canvasWidth;
    const rawCursorY = indexTip.y * canvasHeight;

    // Apply exponential smoothing to cursor
    if (this.smoothedCursorX === null || this.smoothedCursorY === null) {
      this.smoothedCursorX = rawCursorX;
      this.smoothedCursorY = rawCursorY;
    } else {
      this.smoothedCursorX = this.SMOOTHING_ALPHA * rawCursorX + (1 - this.SMOOTHING_ALPHA) * this.smoothedCursorX;
      this.smoothedCursorY = this.SMOOTHING_ALPHA * rawCursorY + (1 - this.SMOOTHING_ALPHA) * this.smoothedCursorY;
    }

    // Calculate aim angle from launcher (bottom center) to cursor
    const launcherX = canvasWidth / 2;
    const launcherY = canvasHeight - 40;
    const aimDx = this.smoothedCursorX - launcherX;
    const aimDy = launcherY - this.smoothedCursorY; // Invert Y

    let rawAimAngle = Math.atan2(aimDx, aimDy);
    
    // Clamp angle to -80 to 80 degrees for wider aiming
    const maxAngle = 80 * (Math.PI / 180);
    rawAimAngle = Math.max(-maxAngle, Math.min(maxAngle, rawAimAngle));

    // Apply exponential smoothing to aim angle
    if (this.smoothedAimAngle === null) {
      this.smoothedAimAngle = rawAimAngle;
    } else {
      this.smoothedAimAngle = this.SMOOTHING_ALPHA * rawAimAngle + (1 - this.SMOOTHING_ALPHA) * this.smoothedAimAngle;
    }

    return {
      isPinching,
      isSwapping,
      aimAngle: this.smoothedAimAngle,
      handX: (1 - wrist.x) * canvasWidth,
      handY: wrist.y * canvasHeight,
      cursorX: this.smoothedCursorX,
      cursorY: this.smoothedCursorY
    };
  }
  
  /**
   * Resets the smoothing filters (useful when hand tracking is lost and regained)
   */
  public resetSmoothing() {
    this.smoothedCursorX = null;
    this.smoothedCursorY = null;
    this.smoothedAimAngle = null;
  }
}
