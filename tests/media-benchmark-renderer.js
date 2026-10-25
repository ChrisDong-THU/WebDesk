// Isolated Chromium receiver; no canvas capture or fake media tracks.
(async () => {
  const bridge = window.mediaBench,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  document.body.append(video);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const results = [];
  for (const scenario of await bridge.plan()) {
    let pc,
      poll,
      channel,
      pending,
      samples = [],
      latencies = [],
      colorErrors = [],
      decoded = 0,
      ready = false;
    try {
      const start = await bridge.host('/start', scenario);
      const videoOffer = start.sdp.sdp.split(/\r?\nm=video /)[1]?.split(/\r?\nm=/)[0];
      const firstPayload = videoOffer?.split(/\r?\n/)[0].split(' ')[2];
      const offeredFirst = new RegExp(`^a=rtpmap:${firstPayload} ([^/]+)`, 'm').exec(videoOffer ?? '')?.[1];
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.ontrack = ({ track }) => {
        video.srcObject = new MediaStream([track]);
        video.play().catch(() => {});
      };
      pc.ondatachannel = (e) => {
        channel = e.channel;
      };
      await pc.setRemoteDescription(start.sdp);
      const desiredCodec = scenario.receiverCodec ?? scenario.codec;
      if (desiredCodec !== 'auto') {
        const cap = RTCRtpReceiver.getCapabilities('video').codecs;
        const wanted = cap.filter((c) => c.mimeType.toLowerCase() === `video/${desiredCodec.toLowerCase()}`);
        if (!wanted.length) throw Error('Receiver does not support ' + scenario.codec);
        pc.getTransceivers()[0].setCodecPreferences([
          ...wanted,
          ...cap.filter((c) => /\/(rtx|red|ulpfec)$/i.test(c.mimeType)),
        ]);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // Omit browser candidates, including candidates embedded in SDP.
      await bridge.host('/answer', {
        type: answer.type,
        sdp: answer.sdp.replace(/^a=candidate:.*\r?\n/gm, ''),
      });
      let polling = false;
      poll = setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          for (const c of await bridge.candidates()) await pc.addIceCandidate(c);
        } catch (e) {
          console.error(e);
        } finally {
          polling = false;
        }
      }, 100);
      const deadline = performance.now() + 25000;
      while (
        performance.now() < deadline &&
        !(pc.connectionState === 'connected' && channel?.readyState === 'open' && video.videoWidth)
      )
        await sleep(100);
      if (!video.videoWidth || pc.connectionState !== 'connected')
        throw Error('Media connection timed out: ' + pc.connectionState);
      const readFrame = () => {
        if (!ready) return;
        ctx.drawImage(video, 0, 0, 320, 200);
        decoded++;
        let id = 0;
        for (let i = 0; i < 16; i++) if (ctx.getImageData(i * 20 + 10, 5, 1, 1).data[0] > 128) id |= 1 << i;
        if (pending && id === pending.id) {
          latencies.push(performance.now() - pending.at);
          pending = null;
        }
        const rgb = [
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
          [255, 255, 255],
          [0, 0, 0],
          [0, 255, 255],
          [255, 0, 255],
          [255, 255, 0],
        ];
        let error = 0;
        for (let i = 0; i < 8; i++) {
          const p = ctx.getImageData(i * 40 + 20, 30, 1, 1).data;
          for (let j = 0; j < 3; j++) error += (p[j] - rgb[i][j]) ** 2;
        }
        colorErrors.push(error / 24);
        video.requestVideoFrameCallback(readFrame);
      };
      // Permit congestion control to settle before interval measurements.
      await sleep(scenario.warmupMs ?? 6000);
      ctx.drawImage(video, 0, 0, 320, 200);
      if (ctx.getImageData(140, 30, 1, 1).data[0] < 220 || ctx.getImageData(20, 30, 1, 1).data[0] < 220)
        throw Error('Test pattern occluded or dimmed; reject these measurements');
      ready = true;
      video.requestVideoFrameCallback(readFrame);
      for (let second = 0; second < (scenario.sampleSeconds ?? 12); second++) {
        if (!pending) {
          const id = 1 + (((second + 1) * 7919) % 65534);
          pending = { id, at: performance.now() };
          channel.send(String(id));
        }
        const reports = await pc.getStats();
        const sender = await bridge.host('/stats');
        samples.push({ at: performance.now(), receiver: [...reports.values()], sender });
        await sleep(1000);
      }
      ready = false;
      const reports = await pc.getStats();
      const capture = document.createElement('canvas');
      capture.width = video.videoWidth;
      capture.height = video.videoHeight;
      capture.getContext('2d').drawImage(video, 0, 0);
      await bridge.frame(scenario.name, capture.toDataURL('image/png'));
      const transport = [...reports.values()].find(
        (x) => x.type === 'transport' && x.selectedCandidatePairId,
      );
      const pair = reports.get(transport?.selectedCandidatePairId),
        remote = reports.get(pair?.remoteCandidateId);
      const network = await bridge.network();
      if (!network.proxyPorts.includes(remote?.port) || !network.packets)
        throw Error('Network shaper bypassed: ' + JSON.stringify(remote));
      const inbound = [...reports.values()].find((x) => x.type === 'inbound-rtp' && x.kind === 'video');
      const negotiated = reports.get(inbound?.codecId)?.mimeType;
      if (desiredCodec !== 'auto' && negotiated?.toLowerCase() !== `video/${desiredCodec.toLowerCase()}`)
        throw Error('Codec preference ignored: ' + negotiated);
      const codecTransitions = [];
      const originalPc = pc,
        originalChannel = channel,
        originalVideo = video.srcObject.getVideoTracks()[0];
      for (const codec of scenario.codecSequence ?? []) {
        const offer = await bridge.host('/codec', { codec });
        await pc.setRemoteDescription(offer.sdp);
        for (const t of pc.getTransceivers())
          if (t.receiver.track?.kind === 'video') t.setCodecPreferences([]);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await bridge.host('/answer', {
          type: answer.type,
          sdp: answer.sdp.replace(/^a=candidate:.*\r?\n/gm, ''),
        });
        const wanted = codec === 'auto' ? offer.order[0] : `video/${codec.toLowerCase()}`;
        const limit = performance.now() + 10000;
        let actual, sent, currentFrames, baselineFrames;
        while (performance.now() < limit) {
          const rows = [...(await pc.getStats()).values()];
          const incoming = rows.find(
            (r) =>
              r.type === 'inbound-rtp' &&
              r.kind === 'video' &&
              rows.find((c) => c.id === r.codecId)?.mimeType?.toLowerCase() === wanted,
          );
          currentFrames = incoming?.framesDecoded;
          const outgoing = await bridge.host('/stats');
          const source = outgoing.find(
            (r) => r.type === 'outbound-rtp' && (r.values.kind ?? r.values.mediaType) === 'video',
          );
          sent = outgoing.find((c) => c.id === source?.values.codecId)?.values.mimeType?.toLowerCase();
          if (incoming && currentFrames > 0 && sent === wanted) {
            if (baselineFrames === undefined) baselineFrames = currentFrames;
            else if (currentFrames > baselineFrames) {
              actual = wanted;
              break;
            }
          }
          await sleep(150);
        }
        if (
          actual !== wanted ||
          pc !== originalPc ||
          channel !== originalChannel ||
          channel.readyState !== 'open' ||
          video.srcObject.getVideoTracks()[0] !== originalVideo
        )
          throw Error(
            'Native codec renegotiation failed: ' + JSON.stringify({ codec, wanted, actual, sent }),
          );
        codecTransitions.push({
          requested: codec,
          actual,
          sender: sent,
          decodedFrames: currentFrames,
          samePeer: true,
          sameChannel: true,
          sameVideo: true,
        });
      }
      const health = await bridge.host('/health').catch(() => null);
      results.push({
        scenario,
        offeredFirst,
        negotiated,
        capabilities: start.capabilities,
        nativeCapabilities: start.nativeCapabilities,
        codecCapabilities: start.codecCapabilities,
        codecTransitions,
        health,
        samples,
        latencies,
        decoded,
        colorMse: colorErrors,
        swatches: Array.from({ length: 8 }, (_, i) => [...ctx.getImageData(i * 40 + 20, 30, 1, 1).data]),
        path: { pair, remote },
        network: await bridge.network(),
      });
    } catch (e) {
      if (video.videoWidth) {
        const snapshot = document.createElement('canvas');
        snapshot.width = video.videoWidth;
        snapshot.height = video.videoHeight;
        snapshot.getContext('2d').drawImage(video, 0, 0);
        await bridge.frame(scenario.name, snapshot.toDataURL('image/png'));
      }
      results.push({
        scenario,
        error: String(e),
        health: await bridge.host('/health').catch(() => null),
        samples,
        network: await bridge.network(),
        failedReceiver: pc ? [...(await pc.getStats()).values()] : [],
      });
    } finally {
      ready = false;
      clearInterval(poll);
      pc?.close();
      video.srcObject = null;
      await bridge.host('/stop');
      await bridge.completed(results);
    }
  }
  await bridge.done(results);
})().catch((e) => window.mediaBench.failed(String(e)));
