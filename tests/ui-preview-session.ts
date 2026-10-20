import { onMounted, reactive, ref } from 'vue';

// Visual fixture: the real App and RemoteTools, with no network or native IPC.
export function useSession(container: () => HTMLElement | undefined) {
  const isHost = new URLSearchParams(location.search).get('view') === 'host';
  const enabled = ref(false);
  const audioEnabled = ref(false), audioBusy = ref(false);
  const connected = ref(!isHost), inSession = ref(!isHost), transfer = ref('');
  const canvas = document.createElement('canvas');
  canvas.width = 1920; canvas.height = 1080;
  canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 1920, 1080);
  sky.addColorStop(0, '#102b32'); sky.addColorStop(.55, '#315f5d'); sky.addColorStop(1, '#839a83');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1920, 1080);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ['#34605a', '#224b48', '#173934'][i];
    ctx.beginPath(); ctx.moveTo(0, 640 + i * 130);
    ctx.bezierCurveTo(500, 300 + i * 160, 1050, 1000 - i * 100, 1920, 520 + i * 170);
    ctx.lineTo(1920, 1080); ctx.lineTo(0, 1080); ctx.fill();
  }
  ctx.fillStyle = '#e1eee8'; ctx.font = '500 40px Segoe UI'; ctx.fillText('WebDesk', 84, 100);
  ctx.fillStyle = '#bad0c8'; ctx.font = '22px Microsoft YaHei'; ctx.fillText('本地界面预览 · 模拟桌面', 84, 145);
  ctx.fillStyle = '#13251ee8'; ctx.beginPath(); ctx.roundRect(550, 300, 820, 440, 20); ctx.fill();
  ctx.strokeStyle = '#79978a55'; ctx.stroke();
  ctx.fillStyle = '#9ed5bb'; ctx.font = '30px Microsoft YaHei'; ctx.fillText('更多空间，留给远程桌面', 610, 395);
  ctx.fillStyle = '#9bb7aa'; ctx.font = '20px Microsoft YaHei'; ctx.fillText('使用上方工具栏查看文件传输与文字剪贴板。', 610, 450);
  ctx.fillText('此预览不会连接或控制任何电脑。', 610, 492);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = '#365346'; ctx.beginPath(); ctx.roundRect(610, 550 + i * 40, 560 - i * 90, 12, 6); ctx.fill(); }
  onMounted(() => { container()?.append(canvas); document.title = 'WebDesk · 本地界面预览'; });
  return {
    isHost, serverUrl: ref(isHost ? 'https://desk.example.com' : '本地预览'), deviceId: ref('000000000'), password: ref(isHost ? 'preview-only' : ''),
    quality: reactive({ resolutionRatio: 4320, maxBitrate: 0, maxFramerate: 60, videoContentHint: 'detail' }),
    enabled, busy: ref(false), connected, inSession, error: ref(''), status: ref('本地预览'), transfer,
    audioEnabled, audioBusy, toggleAudio: async () => { audioEnabled.value = !audioEnabled.value; },
    stats: reactive({ path: '本地预览', width: 1920, height: 1080, fps: 0, bitrate: 0, rtt: 0 }),
    enable: async () => { enabled.value = true; }, disable: async () => { enabled.value = false; }, connect: async () => { connected.value = inSession.value = true; },
    end: () => { connected.value = inSession.value = false; },
    upload: async (_files: File[]) => { transfer.value = '预览：文件发送操作已触发'; },
    selectRemoteFile: async () => ({ id: 'preview-file', name: '预览文件.txt', size: 0 }),
    downloadRemote: async (_file: unknown, sink: { close(): Promise<void> }) => { await sink.close(); },
    readClipboard: async () => '这是远程剪贴板的演示文字。', writeClipboard: async () => {},
  };
}
