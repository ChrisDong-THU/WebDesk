/// <reference types="vite/client" />
import type { CaptureSource, NativeCommand } from './core/runtime';
declare global {
  interface Window {
    webdesk?: {
      platform: string;
      enable(): Promise<{ deviceId: string; password: string }>;
      capture(sessionId: string): Promise<CaptureSource>;
      desktopState(sessionId: string): Promise<{ secure: boolean; width: number; height: number }>;
      desktopFrame(sessionId: string, height: number): Promise<Uint8Array>;
      desktopSource(sessionId: string): Promise<string>;
      tool(sessionId: string, operation: string, data?: unknown): Promise<any>;
      command(sessionId: string, channel: string, input: NativeCommand): void;
      end(): Promise<void>;
      disable(): Promise<void>;
      onPower(callback: (state: 'suspend' | 'resume') => void): () => void;
      onStop(callback: () => void): () => void;
      onError(callback: (error: string) => void): () => void;
    };
  }
}
export {};
