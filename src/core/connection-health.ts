/** Allow transient ICE loss, but never leave a dead session looking connected. */
export function monitorConnection(pc: RTCPeerConnection, onFailure: (error: Error) => void,
  graceMs = 15000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const fail = (message: string) => {
    if (stopped) return;
    dispose();
    onFailure(Error(message));
  };
  const changed = () => {
    if (stopped) return;
    const states = [pc.connectionState, pc.iceConnectionState];
    if (states.includes('failed') || states.includes('closed')) {
      fail('远程连接已中断，请重新连接');
    } else if (states.includes('disconnected')) {
      timer ??= setTimeout(() => fail('网络连接未恢复，请重新连接'), graceMs);
    } else if (pc.connectionState === 'connected' && ['connected', 'completed'].includes(pc.iceConnectionState)) {
      cancel();
    }
  };
  const dispose = () => {
    stopped = true; cancel();
    pc.removeEventListener('connectionstatechange', changed);
    pc.removeEventListener('iceconnectionstatechange', changed);
  };
  pc.addEventListener('connectionstatechange', changed);
  pc.addEventListener('iceconnectionstatechange', changed);
  changed();
  return dispose;
}
