import { Key } from '@nut-tree-fork/shared/dist/lib/enums/key.enum';

// WebDesk adapter: the pinned upstream map falls back to strings for punctuation,
// whereas both Windows hosts require numeric nut.js keys. Use physical codes so
// Shift/AltGr and the remote Windows keyboard layout determine the character.
export const physicalKeys: Readonly<Record<string, Key>> = Object.freeze({
  ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => [`Key${letter}`, Key[letter as keyof typeof Key]])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`Digit${n}`, Key[`Num${n}` as keyof typeof Key]])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`Numpad${n}`, Key[`NumPad${n}` as keyof typeof Key]])),
  ...Object.fromEntries(Array.from({ length: 24 }, (_, n) => [`F${n + 1}`, Key[`F${n + 1}` as keyof typeof Key]])),
  Backquote: Key.Grave, Minus: Key.Minus, Equal: Key.Equal,
  BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket, Backslash: Key.Backslash,
  Semicolon: Key.Semicolon, Quote: Key.Quote, Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash,
  Enter: Key.Return, Space: Key.Space, Tab: Key.Tab, Backspace: Key.Backspace,
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt, MetaLeft: Key.LeftWin, MetaRight: Key.RightWin,
  CapsLock: Key.CapsLock, NumLock: Key.NumLock, ScrollLock: Key.ScrollLock,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  Insert: Key.Insert, Delete: Key.Delete, Home: Key.Home, End: Key.End,
  PageUp: Key.PageUp, PageDown: Key.PageDown, Pause: Key.Pause,
  PrintScreen: Key.Print, ContextMenu: Key.Menu,
  NumpadEnter: Key.Enter, NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract,
  NumpadMultiply: Key.Multiply, NumpadDivide: Key.Divide, NumpadDecimal: Key.Decimal,
});

type KeyEvent = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'preventDefault'>;
type KeyBehavior = { type: 15 | 16; key: number[] };
const modifiers = [
  ['shiftKey', Key.LeftShift, Key.RightShift], ['ctrlKey', Key.LeftControl, Key.RightControl],
  ['altKey', Key.LeftAlt, Key.RightAlt], ['metaKey', Key.LeftWin, Key.RightWin],
] as const;

export function createKeyboardInput(send: (data: KeyBehavior) => void) {
  const pressed = new Set<Key>();
  function emit(key: Key, up: boolean) {
    if (up) pressed.delete(key); else pressed.add(key);
    send({ type: up ? 16 : 15, key: [key] });
  }
  function handle(event: KeyEvent, up: boolean) {
    const key = Object.hasOwn(physicalKeys, event.code) ? physicalKeys[event.code] : undefined;
    if (key === undefined) return;
    event.preventDefault();
    // Recover modifiers held before the video gained focus, and release ones
    // whose keyup was consumed locally. Preserve left/right when observed.
    for (const [flag, left, right] of modifiers) {
      if (key === left || key === right) continue;
      if (event[flag]) {
        if (!pressed.has(left) && !pressed.has(right)) emit(left, false);
      } else {
        if (pressed.has(left)) emit(left, true);
        if (pressed.has(right)) emit(right, true);
      }
    }
    if (!up || pressed.has(key)) emit(key, up);
  }
  return {
    down: (event: KeyEvent) => handle(event, false),
    up: (event: KeyEvent) => handle(event, true),
    // The caller sends the existing release-all message on blur/Escape/close.
    reset: () => pressed.clear(),
  };
}
