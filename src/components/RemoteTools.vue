<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { useSession } from '../core/session';
import type { FileInfo, FileSink } from '../core/tools';
import { RESOLUTION_OPTIONS } from '../../shared/protocol.mjs';
import Icon from './Icon.vue';
import QualitySelect from './QualitySelect.vue';
const props = defineProps<{ session: ReturnType<typeof useSession> }>();
const localClipboard = navigator.clipboard;
const { quality, connected, transfer, error, inSession } = props.session;
const panel = ref(''), working = ref(false), text = ref(''), notice = ref('');
const contentPanel = ref('files'), arrowLeft = ref(32), availableHeight = ref(440);
const root = ref<HTMLElement>(), picker = ref<HTMLInputElement>();
const remoteFile = ref<FileInfo | null>(null);
const drawerLeft = ref(0), drawerTop = ref(0), drawerWidth = ref(360);
let trigger: HTMLElement | null = null, generation = 0;
let resizeObserver: ResizeObserver | undefined;
function positionPanel() {
  if (!panel.value || !root.value || !trigger) return;
  const bounds = root.value.getBoundingClientRect(), button = trigger.getBoundingClientRect();
  drawerWidth.value = Math.min(panel.value === 'files' ? 244 : 360, bounds.width - 24);
  drawerLeft.value = Math.max(12, Math.min(button.left - bounds.left, bounds.width - drawerWidth.value - 12));
  drawerTop.value = bounds.height + 8;
  arrowLeft.value = Math.max(16, Math.min(button.left + button.width / 2 - bounds.left - drawerLeft.value, drawerWidth.value - 16));
  availableHeight.value = Math.max(100, window.innerHeight - bounds.top - drawerTop.value - 16);
}
function closePanel(restoreFocus = false) { panel.value = ''; if (restoreFocus) trigger?.focus(); }
function togglePanel(name: string, event: Event) {
  trigger = event.currentTarget as HTMLElement;
  panel.value = panel.value === name ? '' : name;
  if (panel.value) contentPanel.value = panel.value;
  notice.value = '';
  positionPanel();
}
function outside(event: PointerEvent) { if (panel.value && !root.value?.contains(event.target as Node)) closePanel(); }
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  resizeObserver = new ResizeObserver(positionPanel);
  if (root.value) resizeObserver.observe(root.value);
});
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); resizeObserver?.disconnect(); });
watch(inSession, value => { if (!value) { generation++; panel.value = ''; working.value = false; text.value = ''; notice.value = ''; remoteFile.value = null; } });
async function run(action: () => Promise<void>) {
  if (working.value) return;
  const token = generation; working.value = true; error.value = ''; notice.value = '';
  try { await action(); }
  catch (cause) { if (token === generation && !(cause instanceof DOMException && cause.name === 'AbortError')) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (token === generation) working.value = false; }
}
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function chosen(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files || []);
  if (files.length) void run(async () => { await props.session.upload(files); });
  input.value = '';
}
async function selectRemote() {
  const token = generation;
  notice.value = '请在远程桌面的文件窗口中选择文件';
  const file = await props.session.selectRemoteFile();
  if (token === generation) { remoteFile.value = file; notice.value = ''; }
}
async function download() {
  const file = remoteFile.value; if (!file) return;
  let sink: FileSink;
  const savePicker = (window as any).showSaveFilePicker;
  if (savePicker) {
    const handle = await savePicker({ suggestedName: file.name });
    const stream = await handle.createWritable();
    sink = { write: data => stream.write(data), close: () => stream.close(), abort: () => stream.abort() };
  } else {
    if (file.size > 128 * 1024 ** 2) throw Error('超过 128 MB 的文件请使用 Chrome 或 Edge 下载');
    let chunks: Uint8Array[] = [];
    sink = { write: async data => { chunks.push(data); }, close: async () => { save(new Blob(chunks), file.name); chunks = []; }, abort: async () => { chunks = []; } };
  }
  await props.session.downloadRemote(file, sink); remoteFile.value = null; notice.value = '文件已保存';
}
</script>

<template>
  <div ref="root" class="remote-tools-shell" @keydown.esc="panel && (closePanel(true), $event.stopPropagation())">
    <div class="remote-tools" aria-label="远程工具栏">
      <div class="tool-settings">
        <div class="tool-setting"><span>画质</span>
          <QualitySelect v-model="quality.resolutionRatio" :disabled="!connected" label="实时画质（分辨率）" :options="RESOLUTION_OPTIONS" @open="closePanel()" />
        </div>
        <div class="tool-setting"><span>码率</span>
          <QualitySelect v-model="quality.maxBitrate" :disabled="!connected" label="实时码率"
            :options="[{ label: '自动', value: 0 }, ...[1000, 2000, 4000, 8000, 16000].map(value => ({ value, label: `${value / 1000} Mbps` }))]" @open="closePanel()" />
        </div>
        <div class="tool-setting"><span>帧率</span>
          <QualitySelect v-model="quality.maxFramerate" :disabled="!connected" label="实时帧率"
            :options="[10, 20, 30, 60].map(value => ({ value, label: `${value} FPS` }))" @open="closePanel()" />
        </div>
      </div>
      <span class="tool-divider" />
      <div class="tool-triggers">
        <button v-for="tool in [{ id: 'files', label: '文件传输', icon: 'file' }, { id: 'clipboard', label: '剪贴板', icon: 'clipboard' }]"
          :id="`trigger-${tool.id}`" :key="tool.id" class="toolbar-button tool-trigger" :class="{ active: panel === tool.id }"
          :disabled="!connected" :aria-expanded="panel === tool.id" aria-controls="remote-tool-drawer" @click="togglePanel(tool.id, $event)">
          <Icon :name="tool.icon" />{{ tool.label }}<Icon name="chevron" class="tool-chevron" />
        </button>
      </div>
      <slot />
    </div>
    <input ref="picker" type="file" multiple hidden @change="chosen($event)" />
    <div id="remote-tool-drawer" class="tool-drawer" :class="{ open: panel }"
      :style="{ left: `${drawerLeft}px`, top: `${drawerTop}px`, width: `${drawerWidth}px`, '--tool-origin': `${arrowLeft}px`, '--tool-max-height': `${availableHeight}px` }" :inert="!panel" :aria-hidden="!panel">
      <div class="tool-drawer-clip">
        <section class="tool-panel" role="region" :aria-labelledby="`trigger-${contentPanel}`">
          <div class="tool-panel-inner">
            <div v-if="contentPanel === 'files'" class="file-actions">
              <button class="file-action" :disabled="working" @click="picker?.click()">
                <span class="file-action-icon"><Icon name="upload" /></span><span>发送到远程</span>
              </button>
              <button class="file-action" :disabled="working" @click="run(selectRemote)">
                <span class="file-action-icon"><Icon name="download" /></span><span>接收到本机</span>
              </button>
              <div v-if="remoteFile" class="selected-file">
                <span :title="remoteFile.name">{{ remoteFile.name }}</span>
                <button class="toolbar-button action-accent" :disabled="working" @click="run(download)">保存</button>
              </div>
            </div>
            <div v-else-if="contentPanel === 'clipboard'" class="clipboard-editor">
              <textarea v-model="text" maxlength="65536" aria-label="剪贴板文字" placeholder="输入或粘贴文字…" />
              <div class="clipboard-actions">
                <button class="toolbar-button" :disabled="working" @click="run(async () => { text = await localClipboard.readText(); })"><Icon name="clipboardRead" />读取本机</button>
                <button class="toolbar-button" :disabled="working" @click="run(async () => { text = await session.readClipboard(); notice = '已读取远程剪贴板'; })"><Icon name="remoteRead" />读取远程</button>
                <button class="toolbar-button" :disabled="working" @click="run(async () => { await localClipboard.writeText(text); notice = '已复制到本机'; })"><Icon name="copy" />复制到本机</button>
                <button class="toolbar-button" :disabled="working" @click="run(async () => { await session.writeClipboard(text); notice = '已写入远程剪贴板'; })"><Icon name="send" />发送到远程</button>
              </div>
            </div>
            <div v-if="notice || working || (transfer && contentPanel === 'files')" class="tool-feedback" role="status">
              <span v-if="working" class="spinner" /><Icon v-else name="check" />
              <span>{{ notice || (working ? '正在处理…' : transfer) }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
