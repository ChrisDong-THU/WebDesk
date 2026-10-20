// @ts-nocheck
// GENERATED from billd-desk 61be620eb35b0004dc66c296f0fdd8c62700b1b9 (MIT).
// Run npm run upstream:check; edit extraction/adapters, not this file.
import { getRandomString } from 'billd-utils';
import { NUT_KEY_MAP } from './keys';
import { BilldDeskBehaviorEnum, WsMsgTypeEnum } from './enums';
const ENGLISH_LETTER = 'abcdefghijklmnopqrstuvwxyz'.split('');
export function createControllerPage(environment) {
const { networkStore, receiverId, mySocketId, roomId, isWatchMode } = environment;
let clickTimer;
let isLongClick = false;
function handleMouseWheel(event: WheelEvent) {
  if (isWatchMode.value) return;
  event.preventDefault();
  if (event.deltaY > 0) {
    networkStore.rtcMap
      .get(receiverId.value)
      ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
        requestId: getRandomString(8),
        msgType: WsMsgTypeEnum.billdDeskBehavior,
        data: {
          roomId: roomId.value,
          sender: mySocketId.value,
          receiver: receiverId.value,
          type: BilldDeskBehaviorEnum.scrollDown,
          key: [0],
          x: 0,
          y: 0,
          amount: Math.abs(event.deltaY),
        },
      });
  } else if (event.deltaY < 0) {
    networkStore.rtcMap
      .get(receiverId.value)
      ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
        requestId: getRandomString(8),
        msgType: WsMsgTypeEnum.billdDeskBehavior,
        data: {
          roomId: roomId.value,
          sender: mySocketId.value,
          receiver: receiverId.value,
          type: BilldDeskBehaviorEnum.scrollUp,
          key: [0],
          x: 0,
          y: 0,
          amount: Math.abs(event.deltaY),
        },
      });
  }
  if (event.deltaX > 0) {
    networkStore.rtcMap
      .get(receiverId.value)
      ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
        requestId: getRandomString(8),
        msgType: WsMsgTypeEnum.billdDeskBehavior,
        data: {
          roomId: roomId.value,
          sender: mySocketId.value,
          receiver: receiverId.value,
          type: BilldDeskBehaviorEnum.scrollRight,
          key: [0],
          x: 0,
          y: 0,
          amount: Math.abs(event.deltaX),
        },
      });
  } else if (event.deltaX < 0) {
    networkStore.rtcMap
      .get(receiverId.value)
      ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
        requestId: getRandomString(8),
        msgType: WsMsgTypeEnum.billdDeskBehavior,
        data: {
          roomId: roomId.value,
          sender: mySocketId.value,
          receiver: receiverId.value,
          type: BilldDeskBehaviorEnum.scrollLeft,
          key: [0],
          x: 0,
          y: 0,
          amount: Math.abs(event.deltaX),
        },
      });
  }
}
function handleKeyDown(event: KeyboardEvent) {
  if (isWatchMode.value) return;
  if (event.ctrlKey || event.metaKey) {
    return;
  }
  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        type: BilldDeskBehaviorEnum.keyboardPressKey,
        key: [
          NUT_KEY_MAP[event.code] ||
            NUT_KEY_MAP[event.key.toUpperCase()] ||
            event.key,
        ],
        x: 0,
        y: 0,
        amount: 0,
      },
    });
}
function handleKeyUp(event: KeyboardEvent) {
  if (isWatchMode.value) return;
  if (event.ctrlKey || event.metaKey) {
    return;
  }
  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        type: BilldDeskBehaviorEnum.keyboardReleaseKey,
        key: [
          NUT_KEY_MAP[event.code] ||
            NUT_KEY_MAP[event.key.toUpperCase()] ||
            event.key,
        ],
        x: 0,
        y: 0,
        amount: 0,
      },
    });
}
function handleKeyCombination(event: KeyboardEvent) {
  if (isWatchMode.value) return;
  if (event.ctrlKey) {
    const key = event.key.toLowerCase();
    ENGLISH_LETTER.forEach((item) => {
      if (item === key) {

        networkStore.rtcMap
          .get(receiverId.value)
          ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
            requestId: getRandomString(8),
            msgType: WsMsgTypeEnum.billdDeskBehavior,
            data: {
              roomId: roomId.value,
              sender: mySocketId.value,
              receiver: receiverId.value,
              type: BilldDeskBehaviorEnum.keyboardPressKey,
              key: [
                NUT_KEY_MAP.ControlLeft,
                NUT_KEY_MAP[event.code] ||
                  NUT_KEY_MAP[event.key.toUpperCase()] ||
                  event.key,
              ],
              x: 0,
              y: 0,
              amount: 0,
            },
          });
      }
    });
  }
  if (event.metaKey) {
    const key = event.key.toLowerCase();
    ENGLISH_LETTER.forEach((item) => {
      if (item === key) {

        networkStore.rtcMap
          .get(receiverId.value)
          ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
            requestId: getRandomString(8),
            msgType: WsMsgTypeEnum.billdDeskBehavior,
            data: {
              roomId: roomId.value,
              sender: mySocketId.value,
              receiver: receiverId.value,
              type: BilldDeskBehaviorEnum.keyboardPressKey,
              key: [
                NUT_KEY_MAP.MetaLeft,
                NUT_KEY_MAP[event.code] ||
                  NUT_KEY_MAP[event.key.toUpperCase()] ||
                  event.key,
              ],
              x: 0,
              y: 0,
              amount: 0,
            },
          });
      }
    });
  }
}
function handleDoublelclick() {
  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        type: BilldDeskBehaviorEnum.doubleClick,
        key: [0],
        x: 0,
        y: 0,
        amount: 0,
      },
    });
}
function handleContextmenu() {
  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        type: BilldDeskBehaviorEnum.rightClick,
        key: [0],
        x: 0,
        y: 0,
        amount: 0,
      },
    });
}
function handleMouseDown(event: MouseEvent) {
  clickTimer = setTimeout(function () {

    isLongClick = true;
    clearTimeout(clickTimer);
  }, 300);
  // 获取点击相对于视窗的位置
  const clickX = event.clientX;
  const clickY = event.clientY;

  // 获取目标元素的位置和尺寸信息
  // @ts-ignore
  const rect: DOMRect = event.target.getBoundingClientRect();
  // 计算点击位置相对于元素的坐标
  const xInsideElement = clickX - rect.left;
  const yInsideElement = clickY - rect.top;
  const x = (xInsideElement / rect.width) * 1000;
  const y = (yInsideElement / rect.height) * 1000;

  if (event.button === 2) {

    return;
  }
  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        key: [0],
        type: BilldDeskBehaviorEnum.pressButtonLeft,
        x,
        y,
        amount: 0,
      },
    });
}
function handleMouseMove(event: MouseEvent) {
  // 获取点击相对于视窗的位置
  const clickX = event.clientX;
  const clickY = event.clientY;

  // 获取目标元素的位置和尺寸信息
  // @ts-ignore
  const rect: DOMRect = event.target.getBoundingClientRect();
  // 计算点击位置相对于元素的坐标
  const xInsideElement = clickX - rect.left;
  const yInsideElement = clickY - rect.top;
  const x = (xInsideElement / rect.width) * 1000;
  const y = (yInsideElement / rect.height) * 1000;
  const requestId = getRandomString(8);

  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId,
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        type: BilldDeskBehaviorEnum.mouseMove,
        key: [0],
        x,
        y,
        amount: 0,
      },
    });
}
function handleMouseUp(event: MouseEvent) {
  if (clickTimer) {
    clearTimeout(clickTimer);
  }
  // 获取点击相对于视窗的位置
  const clickX = event.clientX;
  const clickY = event.clientY;

  // 获取目标元素的位置和尺寸信息
  // @ts-ignore
  const rect: DOMRect = event.target.getBoundingClientRect();
  // 计算点击位置相对于元素的坐标
  const xInsideElement = clickX - rect.left;
  const yInsideElement = clickY - rect.top;
  const x = (xInsideElement / rect.width) * 1000;
  const y = (yInsideElement / rect.height) * 1000;

  if (event.button === 2) {

    return;
  }
  networkStore.rtcMap
    .get(receiverId.value)
    ?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskBehavior,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        key: [0],
        type: isLongClick
          ? BilldDeskBehaviorEnum.releaseButtonLeft
          : BilldDeskBehaviorEnum.releaseButtonLeft,
        x,
        y,
        amount: 0,
      },
    });
  isLongClick = false;
}
return { handleMouseWheel, handleKeyDown, handleKeyUp, handleKeyCombination, handleDoublelclick, handleContextmenu, handleMouseDown, handleMouseMove, handleMouseUp, dispose: () => clearTimeout(clickTimer) };
}
