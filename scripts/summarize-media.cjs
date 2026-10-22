const fs=require('node:fs');
const filename=process.argv[2];
const data=JSON.parse(fs.readFileSync(filename));
const quantile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]:null;
const average=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const rounded=x=>typeof x==='number'?Math.round(x*100)/100:x;
const result=data.results.map(row=>{
  if(row.error)return {name:row.scenario.name,error:row.error};
  const first=row.samples[0],last=row.samples.at(-1);
  const inbound=s=>s.receiver.find(r=>r.type==='inbound-rtp'&&r.kind==='video');
  const outbound=s=>s.sender.find(r=>r.type==='outbound-rtp'&&(r.values.kind??r.values.mediaType)==='video')?.values;
  const a=inbound(first),b=inbound(last),c=outbound(first),d=outbound(last);
  const duration=(b.timestamp-a.timestamp)/1000;
  const encodeFrames=d.framesEncoded-c.framesEncoded,decodeFrames=b.framesDecoded-a.framesDecoded;
  const codec=last.receiver.find(r=>r.id===b.codecId);
  const qps=row.samples.map(s=>outbound(s)?.qualityLimitationReason);
  return Object.fromEntries(Object.entries({
    name:row.scenario.name,codec:codec?.mimeType,encoder:d.encoderImplementation,width:b.frameWidth,height:b.frameHeight,
    fps:decodeFrames/duration,kbps:(b.bytesReceived-a.bytesReceived)*8/duration/1000,
    encodeMs:encodeFrames>0?(d.totalEncodeTime-c.totalEncodeTime)*1000/encodeFrames:null,
    decodeMs:decodeFrames>0?(b.totalDecodeTime-a.totalDecodeTime)*1000/decodeFrames:null,
    jitterMs:(b.jitterBufferEmittedCount-a.jitterBufferEmittedCount)>0?(b.jitterBufferDelay-a.jitterBufferDelay)*1000/(b.jitterBufferEmittedCount-a.jitterBufferEmittedCount):null,
    inputMedianMs:quantile(row.latencies,.5),inputP95Ms:quantile(row.latencies,.95),inputSamples:row.latencies.length,
    freezes:b.freezeCount-a.freezeCount,freezeSeconds:b.totalFreezesDuration-a.totalFreezesDuration,
    packetsLost:b.packetsLost-a.packetsLost,colorRmse:Math.sqrt(average(row.colorMse)),
    qualityLimits:[...new Set(qps)].join(','),network:row.network,
  }).map(([k,v])=>[k,rounded(v)]));
});
fs.writeFileSync(filename.replace(/\.json$/,'.summary.json'),JSON.stringify(result,null,2));
console.table(result.map(({network,...rest})=>rest));
