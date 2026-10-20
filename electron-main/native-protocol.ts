/** Fixed, local-only protocol for the Windows desktop worker. */
import { Key } from '@nut-tree-fork/shared/dist/lib/enums/key.enum';
import type { NativeCommand } from '../shared/desktop';
export type DesktopState = { secure: boolean; width: number; height: number; system: boolean; uiAccess: boolean };
const vk: Record<string, number> = {
  Escape:27,Print:44,ScrollLock:145,Pause:19,Grave:192,Minus:189,Equal:187,Backspace:8,
  Insert:45,Home:36,PageUp:33,NumLock:144,Divide:111,Multiply:106,Subtract:109,Tab:9,
  LeftBracket:219,RightBracket:221,Backslash:220,Delete:46,End:35,PageDown:34,Add:107,
  CapsLock:20,Semicolon:186,Quote:222,Return:13,LeftShift:160,Comma:188,Period:190,Slash:191,
  RightShift:161,Up:38,Enter:13,LeftControl:162,LeftSuper:91,LeftWin:91,LeftCmd:91,LeftAlt:164,
  Space:32,RightAlt:165,RightSuper:92,RightWin:92,RightCmd:92,Menu:93,RightControl:163,
  Left:37,Down:40,Right:39,Decimal:110,Clear:12,AudioMute:173,AudioVolDown:174,AudioVolUp:175,
  AudioPlay:179,AudioPause:179,AudioStop:178,AudioPrev:177,AudioNext:176,
};
const extended = new Set([33,34,35,36,37,38,39,40,45,46,91,92,93,111,144,163,165]);
function keyInput(key: number, up: boolean): number[] {
  const name = Key[key];
  let code = vk[name];
  if (/^[A-Z]$/.test(name)) code = name.charCodeAt(0);
  else if (/^F\d+$/.test(name)) code = 111 + Number(name.slice(1));
  else if (/^NumPad\d$/.test(name)) code = 96 + Number(name.slice(-1));
  else if (/^Num\d$/.test(name)) code = 48 + Number(name.slice(-1));
  if (!code) throw Error('Unsupported Windows key');
  return [1, code, 0, (up ? 2 : 0) | (extended.has(code) || name === 'Enter' ? 1 : 0), 0];
}
export function encodeInput(channel: string, command: NativeCommand, size: DesktopState): Buffer | undefined {
  const data = command?.data;
  if (!data) return;
  const entries: number[][] = [];
  const mouse = (flags: number, amount = 0, x = 0, y = 0) => entries.push([0, x, y, flags, amount]);
  if (['mouseSetPosition','mouseMove','mouseDrag'].includes(channel)) {
    if (![data.x,data.y].every(Number.isFinite)) return;
    const x = Math.round(Math.max(0,Math.min(size.width-1,data.x)) * 65535 / Math.max(1,size.width-1));
    const y = Math.round(Math.max(0,Math.min(size.height-1,data.y)) * 65535 / Math.max(1,size.height-1));
    mouse(0x8001,0,x,y);
  } else if (channel.startsWith('keyboard')) {
    if (!Array.isArray(data.key) || data.key.length > 8 || !data.key.every((key: unknown) => Number.isInteger(key) && Number(key) >= 0 && Number(key) < 256)) return;
    for (const key of data.key) entries.push(keyInput(key,channel === 'keyboardReleaseKey'));
    if (channel === 'keyboardType') for (const key of [...data.key].reverse()) entries.push(keyInput(key,true));
    else if (!['keyboardPressKey','keyboardReleaseKey'].includes(channel)) return;
  } else if (channel.startsWith('mouseScroll')) {
    if (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 10000) return;
    const horizontal = /Left|Right/.test(channel), negative = /Down|Left/.test(channel);
    mouse(horizontal ? 0x1000 : 0x800, Math.round(data.amount * 120) * (negative ? -1 : 1));
  } else {
    switch(channel) {
      case 'mousePressButtonLeft': mouse(2); break;
      case 'mouseReleaseButtonLeft': mouse(4); break;
      case 'mouseLeftClick': mouse(2); mouse(4); break;
      case 'mouseRightClick': mouse(8); mouse(16); break;
      case 'mouseDoubleClick': mouse(2); mouse(4); mouse(2); mouse(4); break;
      default: return;
    }
  }
  if (!entries.length) return;
  const result = Buffer.alloc(1 + entries.length * 20); result[0] = 2;
  entries.flat().forEach((value,index) => result.writeInt32LE(value,1+index*4));
  return result;
}
