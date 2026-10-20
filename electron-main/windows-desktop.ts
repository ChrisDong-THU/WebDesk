import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { encodeInput, type DesktopState } from './native-protocol';
import { NativeResponseDecoder } from './native-response';
import type { NativeCommand } from '../shared/desktop';
type Pending = { resolve: (data: Buffer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
/** One authenticated session owns one worker and one bounded command stream. */
export class WindowsDesktop {
  private relay?: ChildProcessWithoutNullStreams;
  private decoder = new NativeResponseDecoder();
  private requests: Pending[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private stopped = false;
  state: DesktopState = { secure: false, width: 1, height: 1, system: false, uiAccess: false };
  constructor(private onState: (state: DesktopState) => void, private onFailure: (error: Error) => void) {}
  async start() {
    if (this.stopped) throw Error('Desktop session cancelled');
    const executable = path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:/Program Files', 'WebDesk Native/WebDeskNative.exe');
    this.relay = spawn(executable, ['--bridge'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.relay.stdout.on('data', data => this.receive(data));
    this.relay.stderr.resume();
    this.relay.stdin.on('error', error => this.abort(error));
    this.relay.on('error', error => this.abort(error));
    this.relay.on('exit', () => { if (!this.stopped) this.abort(Error('Windows desktop worker disconnected')); });
    await this.status();
    this.timer = setInterval(() => { if(this.polling) return; this.polling=true; void this.status().catch(()=>{}).finally(()=>{this.polling=false;}); },250);
  }
  private receive(chunk: Buffer) {
    if (this.stopped) return;
    try {
      this.decoder.push(chunk, (error, payload) => {
        const pending = this.requests.shift();
        if (!pending) throw Error('Unexpected native response');
        clearTimeout(pending.timer);
        if (error) pending.reject(Error(`Windows desktop error ${error}${payload.length && payload.length < 80 ? ` (${payload.toString('ascii').replace(/[^a-zA-Z]/g, '')})` : ''}`));
        else pending.resolve(payload);
      });
    } catch (error) { this.abort(error instanceof Error ? error : Error(String(error))); }
  }
  private request(body: Buffer): Promise<Buffer> {
    if(this.stopped || !this.relay) return Promise.reject(Error('Desktop worker unavailable'));
    if(this.requests.length>=128) {this.abort(Error('Desktop input queue full'));return Promise.reject(Error('Desktop input queue full'));}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.abort(Error('Desktop worker timed out')),10000);
      this.requests.push({resolve,reject,timer});
      const header=Buffer.alloc(4);header.writeUInt32LE(body.length);this.relay!.stdin.write(Buffer.concat([header,body]));
    });
  }
  private async status() {
    const data=await this.request(Buffer.from([1]));
    if(data.length!==20) throw Error('Invalid desktop status');
    const state={secure:!!data.readInt32LE(0),width:data.readInt32LE(4),height:data.readInt32LE(8),system:!!data.readInt32LE(12),uiAccess:!!data.readInt32LE(16)};
    if(!state.system || !state.uiAccess) throw Error('Windows desktop worker lacks required permissions');
    const changed=JSON.stringify(state)!==JSON.stringify(this.state); this.state=state; if(changed)this.onState(state);
  }
  async input(channel: string, command: NativeCommand) {
    const body=encodeInput(channel,command,this.state); if(body) await this.request(body);
  }
  frame(height: number) { const body=Buffer.alloc(5);body[0]=3;body.writeInt32LE(height,1);return this.request(body); }
  async release() { if(!this.stopped) await this.request(Buffer.from([4])); }
  stop() { this.stopped=true;clearInterval(this.timer);this.decoder.reset();this.relay?.kill();for(const p of this.requests.splice(0)){clearTimeout(p.timer);p.reject(Error('Desktop session ended'));} }
  private abort(error: Error) { if(this.stopped)return;this.stop();this.onFailure(error); }
}
