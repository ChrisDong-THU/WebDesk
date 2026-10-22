<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useSession } from './core/session';
import Icon from './components/Icon.vue';
import RemoteTools from './components/RemoteTools.vue';
import appIcon from './assets/webdesk-icon.svg';

const video = ref<HTMLElement>();
const viewport = ref<HTMLElement>();
const session = useSession(() => video.value);
const { isHost, serverUrl, deviceId, password, enabled, busy, connected, error, status, stats, inSession, audioEnabled, audioBusy } = session;
const showPassword = ref(false), copied = ref(false);
const deviceLabel = computed(() => deviceId.value.replace(/(\d{3})(?=\d)/g, '$1 '));
const remoteVisible = computed(() => !isHost && inSession.value);
let copyTimer: ReturnType<typeof setTimeout>;
onBeforeUnmount(() => clearTimeout(copyTimer));
async function copyInfo() {
  try { await navigator.clipboard.writeText(`WebDesk\n设备代码：${deviceId.value}\n连接密码：${password.value}`); copied.value = true; copyTimer = setTimeout(() => copied.value = false, 2000); }
  catch { error.value = '复制失败，请手动复制设备代码和密码'; }
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else { await viewport.value?.requestFullscreen(); video.value?.querySelector('video')?.focus({ preventScroll: true }); }
  }
  catch { error.value = '浏览器未允许全屏'; }
}
watch(remoteVisible, visible => {
  if (!visible && document.fullscreenElement === viewport.value) void document.exitFullscreen().catch(() => {});
});
</script>

<template>
  <div class="app-shell" :class="{ 'remote-active': remoteVisible }">
    <header v-show="!remoteVisible" class="topbar">
      <div class="brand">
        <span class="brand-mark"><img :src="appIcon" alt="" width="32" height="32" /></span>
        <span>WebDesk</span>
      </div>
      <span class="mode-label">{{ isHost ? 'Windows' : '浏览器' }}</span>
    </header>

    <main v-show="!remoteVisible" class="dashboard">
      <section class="connect-card compact-connect-card" :aria-label="isHost ? 'Windows 被控端' : '连接远程电脑'">
        <form v-if="!isHost" class="connect-form" @submit.prevent="session.connect">
          <div class="connect-fields">
            <div class="field floating-field">
              <input id="device" v-model="deviceId" class="device-input" placeholder=" "
                inputmode="numeric" maxlength="11" autocomplete="off" :disabled="busy" required />
              <label for="device">设备代码</label>
            </div>
            <div class="field floating-field password-field">
              <input id="password" v-model="password" :type="showPassword ? 'text' : 'password'"
                placeholder=" " autocomplete="off" :disabled="busy" required />
              <label for="password">连接密码</label>
              <button type="button" class="icon-button" @click="showPassword = !showPassword"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword"
                :title="showPassword ? '隐藏密码' : '显示密码'">
                <Icon :name="showPassword ? 'eyeOff' : 'eye'" />
              </button>
            </div>
          </div>
          <button class="connect-button" type="submit" :disabled="busy"
            :aria-label="busy ? '连接中' : '连接'" :title="busy ? '连接中' : '连接'" :aria-busy="busy">
            <span v-if="busy" class="spinner" />
            <Icon v-if="!busy" name="power" />
          </button>
          <button v-if="busy" type="button" class="cancel-button" @click="session.end('已取消连接')">取消</button>
        </form>

        <form v-else class="host-form" @submit.prevent="!enabled && session.enable()">
          <template v-if="enabled">
            <div class="connect-fields">
              <div class="field floating-field">
                <input id="host-device" :value="deviceLabel" class="device-input" placeholder=" " readonly />
                <label for="host-device">设备代码</label>
              </div>
              <div class="field floating-field password-field">
                <input id="host-password" :value="password" :type="showPassword ? 'text' : 'password'" placeholder=" " readonly />
                <label for="host-password">连接密码</label>
                <button type="button" class="icon-button" @click="showPassword = !showPassword"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword">
                  <Icon :name="showPassword ? 'eyeOff' : 'eye'" />
                </button>
              </div>
            </div>
            <div class="host-actions">
              <button type="button" class="connect-button host-copy" @click="copyInfo"
                :aria-label="copied ? '已复制' : '复制连接信息'" :title="copied ? '已复制' : '复制连接信息'">
                <Icon :name="copied ? 'check' : 'copy'" />
              </button>
              <button type="button" class="connect-button host-stop" :disabled="busy" @click="session.disable" aria-label="停止远程控制" title="停止远程控制">
                <Icon name="power" />
              </button>
            </div>
          </template>
          <template v-else>
            <div class="connect-fields">
              <div class="field floating-field">
                <input id="host-server" v-model="serverUrl" type="url" placeholder=" " :disabled="busy" required spellcheck="false" />
                <label for="host-server">服务地址</label>
              </div>
            </div>
            <button class="connect-button" type="submit" :disabled="busy" :aria-busy="busy"
              :aria-label="busy ? '开启中' : '开启远程控制'" :title="busy ? '开启中' : '开启远程控制'">
              <span v-if="busy" class="spinner" />
              <Icon v-else name="power" />
            </button>
          </template>
        </form>
        <div v-if="error" class="error-box" role="alert">{{ error }}</div>
      </section>
    </main>

    <section v-show="remoteVisible" class="remote-stage" aria-label="远程桌面">
      <RemoteTools :session="session">
        <div class="remote-actions" role="group" aria-label="连接操作">
          <button class="toolbar-button remote-action audio-toggle" :class="{ active: audioEnabled }"
            role="switch" aria-label="远程电脑声音" :aria-checked="audioEnabled"
            :disabled="!connected || audioBusy" :aria-busy="audioBusy"
            :title="audioEnabled ? '关闭远程电脑声音' : '开启远程电脑声音'"
            @click="session.toggleAudio()">
            <Icon :name="audioEnabled ? 'volume' : 'volumeOff'" />
          </button>
          <button class="toolbar-button remote-action" @click="fullscreen" title="全屏" aria-label="全屏">
            <Icon name="expand" />
          </button>
          <button class="toolbar-button remote-action disconnect-button" @click="session.end()"
            title="断开连接" aria-label="断开连接"><Icon name="power" /></button>
        </div>
      </RemoteTools>
      <div ref="viewport" class="video-area">
        <div ref="video" class="billd-video-container" aria-label="远程 Windows 桌面" />
        <div v-if="!connected" class="video-overlay"><span class="spinner" /><p>{{ status }}</p></div>
      </div>
      <footer class="remote-footer">
        <span>{{ stats.path }}</span><span>{{ stats.width }} × {{ stats.height }}</span>
        <span>{{ stats.fps.toFixed(0) }} FPS</span><span>{{ (stats.bitrate / 1000).toFixed(2) }} Mbps</span>
        <span v-if="stats.codec" :title="stats.mediaDiagnostics">{{ stats.codec }}</span>
        <span title="网络往返时间，不等于输入到画面的响应时间">RTT {{ stats.rtt.toFixed(0) }} ms</span><span class="keyboard-tip">全屏时 <kbd>Esc</kbd> 释放键盘</span>
      </footer>
      <div v-if="error" class="error-box" role="alert">{{ error }}</div>
    </section>
  </div>
</template>
