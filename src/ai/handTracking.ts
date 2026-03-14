import { Hands, Results } from '@mediapipe/hands';

export class HandTracker {
  hands: Hands;
  videoElement: HTMLVideoElement;
  onResults: (results: Results) => void;
  stream: MediaStream | null = null;
  animationFrameId: number | null = null;
  isRunning: boolean = false;

  constructor(videoElement: HTMLVideoElement, onResults: (results: Results) => void) {
    this.videoElement = videoElement;
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
  }

  async start() {
    if (this.isRunning) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      this.videoElement.srcObject = this.stream;
      await new Promise<void>((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
      this.isRunning = true;
      this.processFrame();
    } catch (error) {
      console.error("Error starting camera:", error);
      throw error;
    }
  }

  async processFrame() {
    if (!this.isRunning) return;
    
    if (this.videoElement.readyState >= 2) {
      await this.hands.send({ image: this.videoElement });
    }
    
    this.animationFrameId = requestAnimationFrame(() => this.processFrame());
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.videoElement.srcObject = null;
  }
}
