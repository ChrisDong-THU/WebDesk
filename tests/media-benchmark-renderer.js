// Isolated Chromium receiver; no canvas capture or fake media tracks.
(async () => {
  const bridge = window.mediaBench, sleep = ms => new Promise(r => setTimeout(r, ms));
  const video = document.createElement('video'); video.autoplay = true; video.muted = true; document.body.append(video);
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const results = [];
  for (const scenario of await bridge.plan()) {
    let pc, poll, channel, pending, samples = [], latencies = [], colorErrors = [], decoded = 0, ready = false;
    try {
      const start = await bridge.host('/start', scenario);
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.ontrack = ({ track }) => { video.srcObject = new MediaStream([track]); video.play().catch(() => {}); };
      pc.ondatachannel = e => { channel = e.channel; };
      await pc.setRemoteDescription(start.sdp);
      const desiredCodec = scenario.receiverCodec ?? scenario.codec;
      if (desiredCodec !== 'auto') {
        const cap = RTCRtpReceiver.getCapabilities('video').codecs;
        const wanted = cap.filter(c => c.mimeType.toLowerCase() === `video/${desiredCodec.toLowerCase()}`);
        if (!wanted.length) throw Error('Receiver does not support ' + scenario.codec);
        pc.getTransceivers()[0].setCodecPreferences([...wanted, ...cap.filter(c => /\/(rtx|red|ulpfec)$/i.test(c.mimeType))]);
      }
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      // Omit browser candidates, including candidates embedded in SDP.
      await bridge.host('/answer', { type: answer.type, sdp: answer.sdp.replace(/^a=candidate:.*\r?\n/gm, '') });
      let polling = false;
      poll = setInterval(async () => {
        if (polling) return; polling = true;
        try { for (const c of await bridge.candidates()) await pc.addIceCandidate(c); }
        catch (e) { console.error(e); } finally { polling = false; }
      }, 100);
      const deadline = performance.now() + 25000;
      while (performance.now() < deadline && !(pc.connectionState === 'connected' && channel?.readyState === 'open' && video.videoWidth)) await sleep(100);
      if (!video.videoWidth || pc.connectionState !== 'connected') throw Error('Media connection timed out: ' + pc.connectionState);
      const readFrame = () => {
        if (!ready) return;
        ctx.drawImage(video, 0, 0, 320, 200); decoded++;
        let id = 0;
        for (let i = 0; i < 16; i++) if (ctx.getImageData(i * 20 + 10, 5, 1, 1).data[0] > 128) id |= 1 << i;
        if (pending && id === pending.id) { latencies.push(performance.now() - pending.at); pending = null; }
        const rgb = [[255,0,0],[0,255,0],[0,0,255],[255,255,255],[0,0,0],[0,255,255],[255,0,255],[255,255,0]];
        let error = 0;
        for (let i=0;i<8;i++) { const p=ctx.getImageData(i*40+20,30,1,1).data;for(let j=0;j<3;j++)error+=(p[j]-rgb[i][j])**2; }
        colorErrors.push(error/24);
        video.requestVideoFrameCallback(readFrame);
      };
      // Permit congestion control to settle before interval measurements.
      await sleep(6000);
      ctx.drawImage(video,0,0,320,200);
      if (ctx.getImageData(140,30,1,1).data[0] < 220 || ctx.getImageData(20,30,1,1).data[0] < 220) throw Error('Test pattern occluded or dimmed; reject these measurements');
      ready = true; video.requestVideoFrameCallback(readFrame);
      for (let second = 0; second < 12; second++) {
        if (!pending) { const id = 1 + ((second + 1) * 7919) % 65534; pending = { id, at: performance.now() }; channel.send(String(id)); }
        const reports = await pc.getStats();
        const sender = await bridge.host('/stats');
        samples.push({ at: performance.now(), receiver: [...reports.values()], sender });
        await sleep(1000);
      }
      ready = false;
      const reports = await pc.getStats();
      const capture = document.createElement('canvas'); capture.width = video.videoWidth; capture.height = video.videoHeight;
      capture.getContext('2d').drawImage(video, 0, 0);
      await bridge.frame(scenario.name, capture.toDataURL('image/png'));
      const transport = [...reports.values()].find(x => x.type === 'transport' && x.selectedCandidatePairId);
      const pair = reports.get(transport?.selectedCandidatePairId), remote = reports.get(pair?.remoteCandidateId);
      const network = await bridge.network();
      if (!network.proxyPorts.includes(remote?.port) || !network.packets) throw Error('Network shaper bypassed: ' + JSON.stringify(remote));
      const inbound = [...reports.values()].find(x => x.type === 'inbound-rtp' && x.kind === 'video');
      const negotiated = reports.get(inbound?.codecId)?.mimeType;
      if (desiredCodec !== 'auto' && negotiated?.toLowerCase() !== `video/${desiredCodec.toLowerCase()}`) throw Error('Codec preference ignored: ' + negotiated);
      results.push({ scenario, negotiated, capabilities: start.capabilities, samples, latencies, decoded, colorMse: colorErrors, swatches: Array.from({length:8},(_,i)=>[...ctx.getImageData(i*40+20,30,1,1).data]), path: { pair, remote }, network: await bridge.network() });
    } catch (e) { results.push({ scenario, error: String(e), samples, network: await bridge.network(), failedReceiver: pc ? [...(await pc.getStats()).values()] : [] }); }
    finally { ready = false; clearInterval(poll); pc?.close(); video.srcObject = null; await bridge.host('/stop'); await bridge.completed(results); }
  }
  await bridge.done(results);
})().catch(e => window.mediaBench.failed(String(e)));
