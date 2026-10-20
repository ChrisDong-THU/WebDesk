export const RESOLUTION_OPTIONS = Object.freeze([
  { label: '360p', value: 360 },
  { label: '720p', value: 720 },
  { label: '1080p', value: 1080 },
  { label: '2K', value: 1440 },
  { label: '4K', value: 2160 },
  { label: '8K', value: 4320 },
]);
// Upstream remote/index.vue selects 60 FPS; remoteDesk.newWebRtc leaves the
// bitrate override unset. 0 keeps WebRTC's congestion control without an app cap.
export const DEFAULT_QUALITY = Object.freeze({ maxBitrate: 0, maxFramerate: 60, resolutionRatio: 4320, videoContentHint: 'detail' });
export function validQuality(value) {
  return !!value && [0, 1000, 2000, 4000, 8000, 16000].includes(value.maxBitrate)
    && [10, 20, 30, 60, 120].includes(value.maxFramerate)
    && RESOLUTION_OPTIONS.some(option => option.value === value.resolutionRatio)
    && ['', 'detail', 'text', 'motion'].includes(value.videoContentHint);
}
