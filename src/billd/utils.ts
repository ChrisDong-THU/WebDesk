// @ts-nocheck
// GENERATED from billd-desk 61be620eb35b0004dc66c296f0fdd8c62700b1b9 (MIT).
// Run npm run upstream:check; edit extraction/adapters, not this file.
import { computeBox } from 'billd-utils';
export async function handlConstraints(data: {
  frameRate: number;
  height: number;
  stream: MediaStream;
}): Promise<number> {
  const { frameRate, height, stream } = data;
  const queue: Promise<any>[] = [];
  console.log('开始设置约束', JSON.stringify({ height, frameRate }));
  stream.getTracks().forEach((track) => {
    if (track.kind === 'video') {
      queue.push(
        track.applyConstraints({
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        })
      );
    }
  });
  try {
    await Promise.all(queue);
    console.log('设置设置约束成功');
    return 1;
  } catch (error) {
    console.error('设置设置约束失败', error);
    return 0;
  }
}
export function setVideoTrackContentHints(
  stream: MediaStream,
  hint: 'detail' | 'text' | 'motion'
) {
  const tracks = stream.getVideoTracks();
  tracks.forEach((track) => {
    track.contentHint = hint;
    console.log('setVideoTrackContentHints', track.id, hint);
  });
}
export function setAudioTrackContentHints(
  stream: MediaStream,
  hint: 'music' | 'speech' | 'speech-recognition'
) {
  const tracks = stream.getAudioTracks();
  tracks.forEach((track) => {
    track.contentHint = hint;
    console.log('setAudioTrackContentHints', track.id, hint);
  });
}
export function createNullVideo() {
  const videoEl = document.createElement('video');
  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.loop = true;
  videoEl.setAttribute('webkit-playsinline', 'true');
  videoEl.setAttribute('x5-video-player-type', 'h5');
  videoEl.setAttribute('x5-video-player-fullscreen', 'true');
  videoEl.setAttribute('x5-video-orientation', 'portraint');
  videoEl.oncontextmenu = (e) => {
    e.preventDefault();
  };
  return videoEl;
}
export function videoFullBox(data: {
  wrapSize: { width: number; height: number };
  videoEl: HTMLVideoElement;
  videoResize?: (data: { w: number; h: number }) => void;
}) {
  const { videoEl } = data;
  let wrapSize = data.wrapSize;

  if (!videoEl) {
    throw new Error('videoEl不能为空！');
  }

  let w = videoEl.videoWidth;
  let h = videoEl.videoHeight;
  function handleResize() {
    w = videoEl.videoWidth;
    h = videoEl.videoHeight;
    data.videoResize?.({ w, h });
    setVideoSize({ width: w, height: h });
  }
  function setVideoSize({ width, height }) {
    const res = computeBox({
      width,
      height,
      maxHeight: wrapSize.height,
      minHeight: wrapSize.height,
      maxWidth: wrapSize.width,
      minWidth: wrapSize.width,
    });
    videoEl.style.width = `${res.width as number}px`;
    videoEl.style.height = `${res.height as number}px`;
    videoEl.setAttribute('resolution-width', width);
    videoEl.setAttribute('resolution-height', height);
  }
  setVideoSize({ width: w, height: h });
  data.videoResize?.({ w, h });
  videoEl.addEventListener('resize', handleResize);
  function changeWrapSize(data: { width; height }) {
    wrapSize = data;
    setVideoSize({ width: videoEl.videoWidth, height: videoEl.videoHeight });
  }
  return { changeWrapSize };
}
