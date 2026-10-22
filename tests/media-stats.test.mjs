import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['src/core/media-stats.ts'],outfile:'test-results/media-stats.mjs',bundle:true,platform:'node',format:'esm'});
const {ReceiverMediaStats}=await import('../test-results/media-stats.mjs');
const report=(values={})=>new Map([['video',{id:'video',type:'inbound-rtp',kind:'video',codecId:'codec',timestamp:1000,bytesReceived:100,framesDecoded:10,totalDecodeTime:.1,jitterBufferDelay:1,jitterBufferEmittedCount:10,freezeCount:0,...values}],['codec',{mimeType:'video/VP8'}]]);
test('receiver interval statistics distinguish buffering, decoding and transport',()=>{
  const stats=new ReceiverMediaStats();
  assert.equal(stats.sample(report()).decodeMs,undefined);
  const next=stats.sample(report({timestamp:2000,bytesReceived:200100,framesDecoded:30,totalDecodeTime:.3,jitterBufferDelay:3,jitterBufferEmittedCount:30,freezeCount:1}));
  assert.equal(next.bitrate,1600);assert.ok(Math.abs(next.decodeMs-10)<.001);
  assert.equal(next.jitterBufferMs,100);assert.equal(next.freezes,1);
});
test('receiver resets intervals on counter rollback, stream/codec changes and no video',()=>{
  const stats=new ReceiverMediaStats();stats.sample(report());
  assert.equal(stats.sample(report({timestamp:2000,bytesReceived:0,framesDecoded:0,totalDecodeTime:0})).decodeMs,undefined);
  assert.equal(stats.sample(report({timestamp:3000,codecId:'other'})).bitrate,0);
  assert.equal(stats.sample(new Map()),undefined);
  assert.equal(stats.sample(report({timestamp:4000})).jitterBufferMs,undefined);
});
