/** Values allowed across the renderer/main desktop boundary. No runtime imports. */
export type CaptureSource = { sourceId: string; name: string; width: number; height: number; scaleFactor: number; nativeDesktop?: boolean };
export type NativeCommand = { requestId: string; data: Record<string, any> };
