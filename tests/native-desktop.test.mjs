import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
await build({entryPoints:['electron-main/native-protocol.ts'],outfile:'test-results/native-protocol.cjs',bundle:true,platform:'node',format:'cjs'});
const {encodeInput}=require('../test-results/native-protocol.cjs');
const size={width:3200,height:2000,secure:true,system:true,uiAccess:true};
const decode=buffer=>{const rows=[];for(let p=1;p<buffer.length;p+=20)rows.push(Array.from({length:5},(_,i)=>buffer.readInt32LE(p+i*4)));return rows;};
test('native protocol retains physical coordinates, modifiers and signed wheel input',()=>{
  assert.deepEqual(decode(encodeInput('mouseMove',{data:{x:3199,y:1999}},size)),[[0,65535,65535,0x8001,0]]);
  assert.deepEqual(decode(encodeInput('keyboardType',{data:{key:[103,71]}},size)),[[1,162,0,0,0],[1,65,0,0,0],[1,65,0,2,0],[1,162,0,2,0]]);
  assert.deepEqual(decode(encodeInput('keyboardReleaseKey',{data:{key:[114]}},size)),[[1,163,0,3,0]]);
  assert.equal(decode(encodeInput('mouseScrollDown',{data:{amount:1}},size))[0][4],-120);
});
test('native protocol rejects malformed input and unsupported operations',()=>{
  for(const [channel,data] of [['mouseMove',{x:NaN,y:1}],['keyboardPressKey',{key:[-1]}],['keyboardPressKey',{key:Array(9).fill(1)}],['mouseScrollDown',{amount:Infinity}],['shell',{command:'ignored'}]]) assert.equal(encodeInput(channel,{data},size),undefined);
});
await build({entryPoints:['src/core/host-capture.ts'],outfile:'test-results/host-capture.cjs',bundle:true,platform:'node',format:'cjs'});
const {HostCapture}=require('../test-results/host-capture.cjs');

await build({entryPoints:['electron-main/native-response.ts'],outfile:'test-results/native-response.cjs',bundle:true,platform:'node',format:'cjs'});
const {NativeResponseDecoder}=require('../test-results/native-response.cjs');
const response=(error,body)=>{const header=Buffer.alloc(8);header.writeUInt32LE(error);header.writeUInt32LE(body.length,4);return Buffer.concat([header,body]);};
test('native responses survive arbitrary pipe fragmentation and coalesced empty replies',()=>{
  const expected=[Buffer.alloc(0),Buffer.from('first'),Buffer.from('second')];
  const stream=Buffer.concat(expected.map((body,i)=>response(i,body)));
  for(const step of [1,3,8,19,stream.length]) {
    const decoder=new NativeResponseDecoder();const actual=[];
    for(let offset=0;offset<stream.length;offset+=step) decoder.push(stream.subarray(offset,offset+step),(error,body)=>actual.push({error,body}));
    assert.deepEqual(actual,expected.map((body,error)=>({error,body})));
  }
});
test('native response decoder rejects oversized frames and releases cancelled fragments',()=>{
  const decoder=new NativeResponseDecoder(10);const header=Buffer.alloc(8);header.writeUInt32LE(11,4);
  assert.throws(()=>decoder.push(header,()=>{}),/Invalid native response/);
  decoder.reset();decoder.push(response(0,Buffer.from('hello')).subarray(0,9),()=>assert.fail());decoder.reset();
  const decoded=[];decoder.push(response(5,Buffer.alloc(0)),(error,body)=>decoded.push([error,body.length]));
  assert.deepEqual(decoded,[[5,0]]);
});
test('desktop switching and ended-track recovery replace media without replacing the sender',async t=>{
  const streams=[];const make=()=>{const track={readyState:'live',muted:false,stop(){this.readyState='ended';}};const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};streams.push(stream);return stream;};
  let secure=false,frames=0,opens=0,disposed=0;
  const peer={sender:{track:null}}; const originalPeer=peer;const replacements=[];
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{opens++;return make();}}}});
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),captureStream:make})};
  globalThis.createImageBitmap=async()=>({width:3200,height:2000,close(){disposed++;}});
  t.after(()=>{if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;delete globalThis.document;delete globalThis.createImageBitmap;});
  const capture=new HostCapture({state:async()=>({secure}),source:async()=>'screen:0',frame:async()=>{frames++;return new Uint8Array([1]);},quality:()=>({height:4320,fps:60}),replace:async stream=>{peer.sender.track=stream.getVideoTracks()[0];replacements.push(stream);}});
  t.after(()=>capture.stop());
  await capture.start('screen:0');clearTimeout(capture.timer);
  const normal=peer.sender.track;
  secure=true;await capture.tick();clearTimeout(capture.timer);
  assert.equal(createsSamePeer(),true);assert.notEqual(peer.sender.track,normal);assert.equal(normal.readyState,'live');
  secure=false;await capture.tick();clearTimeout(capture.timer);
  assert.equal(peer.sender.track,normal,'normal capture must resume without a new connection');
  normal.stop();await capture.tick();clearTimeout(capture.timer);
  assert.notEqual(peer.sender.track,normal);assert.equal(opens,2);assert.equal(frames,1);assert.equal(disposed,1);
  capture.stop();assert.ok(streams.every(s=>s.getVideoTracks()[0].readyState==='ended'));
  function createsSamePeer(){return peer===originalPeer;}
});
test('closing during an outstanding frame request does not resurrect capture',async t=>{
  let finish,swaps=0;
  const capture=new HostCapture({state:async()=>({secure:true}),source:async()=>'',frame:()=>new Promise(resolve=>{finish=resolve;}),quality:()=>({height:1080,fps:30}),replace:async()=>{swaps++;}});
  const starting=capture.start('');await Promise.resolve();await Promise.resolve();capture.stop();finish(new Uint8Array([1]));await starting;
  assert.equal(swaps,0);assert.equal(capture.timer,undefined);
});
