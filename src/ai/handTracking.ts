import { Hands, Results } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

export class HandTracker {
  hands: Hands;
  camera: Camera | null = null;
  onResults: (results: Results) => void;

  constructor(videoElement: HTMLVideoElement, onResults: (results: Results) => void) {
    this.onResults = onResults;
    this.hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      }
    });

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.hands.onResults(this.onResults);

    this.camera = new Camera(videoElement, {
      onFrame: async () => {
        await this.hands.send({ image: videoElement });
      },
      width: 640,
      height: 480
    });
  }

  start() {
    this.camera?.start();
  }

  stop() {
    this.camera?.stop();
  }
}
