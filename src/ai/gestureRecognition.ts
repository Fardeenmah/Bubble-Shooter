import { NormalizedLandmarkList } from '@mediapipe/hands';

export interface GestureState {
  isPinching: boolean;
  aimAngle: number;
  handX: number;
  handY: number;
  cursorX: number;
  cursorY: number;
}

export function recognizeGesture(landmarks: NormalizedLandmarkList, canvasWidth: number, canvasHeight: number): GestureState {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const indexMcp = landmarks[5];
  const wrist = landmarks[0];

  // Scale-invariant pinch detection
  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const pinchDist = Math.sqrt(dx * dx + dy * dy);
  
  const refDx = wrist.x - indexMcp.x;
  const refDy = wrist.y - indexMcp.y;
  const refDist = Math.sqrt(refDx * refDx + refDy * refDy);
  
  // Threshold relative to hand size
  const isPinching = (pinchDist / refDist) < 0.25;

  // Virtual cursor based on index finger tip
  // Mirrored X because camera is mirrored
  const cursorX = (1 - indexTip.x) * canvasWidth;
  const cursorY = indexTip.y * canvasHeight;

  // Calculate aim angle from launcher (bottom center) to cursor
  const launcherX = canvasWidth / 2;
  const launcherY = canvasHeight - 40;
  const aimDx = cursorX - launcherX;
  const aimDy = launcherY - cursorY; // Invert Y

  let aimAngle = Math.atan2(aimDx, aimDy);
  
  // Clamp angle to -80 to 80 degrees for wider aiming
  const maxAngle = 80 * (Math.PI / 180);
  aimAngle = Math.max(-maxAngle, Math.min(maxAngle, aimAngle));

  return {
    isPinching,
    aimAngle,
    handX: (1 - wrist.x) * canvasWidth,
    handY: wrist.y * canvasHeight,
    cursorX,
    cursorY
  };
}
