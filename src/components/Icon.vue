<script setup lang="ts">
defineProps<{ name: string }>();

const paths: Record<string, string> = {
  monitor: 'M8 21h8m-4-4v4M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  eyeOff: 'm3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9 5.5c1-.3 2-.5 3-.5 6.5 0 10 7 10 7a21 21 0 0 1-3 4M6 6.5A23 23 0 0 0 2 12s3.5 7 10 7c1.8 0 3.5-.5 5-1.3',
  settings: 'M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6',
  chevron: 'm9 5 7 7-7 7',
  copy: 'M9 9h11v11H9V9ZM5 15H3V3h12v2',
  clipboardRead: 'M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M15 4h2a2 2 0 0 1 2 2v4M9 2h6v4H9V2Zm3 14h10m-4-4 4 4-4 4',
  remoteRead: 'M8 21h5m-2-4v4M14 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M18 12v9m-3-3 3 3 3-3',
  send: 'm22 2-7 20-4-9L2 9 22 2ZM22 2 11 13',
  check: 'm5 12 4 4L19 6',
  power: 'M12 2v10M6.5 5a9 9 0 1 0 11 0',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  volume: 'M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  volumeOff: 'M11 4 6 8H3v8h3l5 4V4Zm5 5 6 6m0-6-6 6',
  close: 'm6 6 12 12M6 18 18 6',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h5',
  clipboard: 'M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3M9 2h6v4H9V2Zm-1 9h8m-8 4h6',
  camera: 'M8 5 10 2h4l2 3h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm8 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6',
};
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path :d="paths[name] || paths.monitor" />
  </svg>
</template>
