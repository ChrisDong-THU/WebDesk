// @ts-nocheck
// GENERATED from billd-desk 61be620eb35b0004dc66c296f0fdd8c62700b1b9 (MIT).
// Run npm run upstream:check; edit extraction/adapters, not this file.
import { IPC_EVENT } from '../../src/billd/events';
export function registerNativeHandlers(environment) {
const { ipcMain, nutjs, windowMap, winWebContentsSend, desktopCapturer, screen, platform } = environment;
ipcMain.on(
    IPC_EVENT.mouseScrollDown,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseScrollDown}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, amount } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.scrollDown(amount);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollDown,
            requestId,
            data: { amount },
            code: 0,
          });
        } catch (error) {
          console.log(error);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollDown,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseScrollUp,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseScrollUp}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, amount } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.scrollUp(amount);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollUp,
            requestId,
            data: { amount },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollUp,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseScrollLeft,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseScrollLeft}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, amount } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.scrollLeft(amount);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollLeft,
            requestId,
            data: { amount },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollLeft,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseScrollRight,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseScrollRight}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, amount } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.scrollRight(amount);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollRight,
            requestId,
            data: { amount },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseScrollRight,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseSetPosition,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseSetPosition}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, x, y } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.setPosition({ x, y });
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseSetPosition,
            requestId,
            data: { x, y },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseSetPosition,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(IPC_EVENT.mouseMove, async (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.mouseMove}`, reqData);
    const { requestId, data } = reqData;
    const { windowId, x, y } = data;
    const win = windowMap.get(windowId);
    if (win) {
      try {
        await nutjs.mouse.move([{ x, y }]);
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_mouseMove,
          requestId,
          data: { x, y },
          code: 0,
        });
      } catch (error) {
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_mouseMove,
          requestId,
          data,
          code: 1,
          msg: JSON.stringify(error),
        });
      }
    }
  });
ipcMain.on(IPC_EVENT.mouseDrag, async (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.mouseDrag}`, reqData);
    const { requestId, data } = reqData;
    const { windowId, x, y } = data;
    const win = windowMap.get(windowId);
    if (win) {
      try {
        await nutjs.mouse.drag([{ x, y }]);
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_mouseDrag,
          requestId,
          data: { x, y },
          code: 0,
        });
      } catch (error) {
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_mouseDrag,
          requestId,
          data,
          code: 1,
          msg: JSON.stringify(error),
        });
      }
    }
  });
ipcMain.on(
    IPC_EVENT.keyboardType,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.keyboardType}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, key } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.keyboard.type(key);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_keyboardType,
            requestId,
            data: { key },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_keyboardType,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.keyboardPressKey,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.keyboardPressKey}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, key } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.keyboard.pressKey(...key);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_keyboardPressKey,
            requestId,
            data: { key },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_keyboardPressKey,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.keyboardReleaseKey,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.keyboardReleaseKey}`, reqData);
      const { requestId, data } = reqData;
      const { windowId, key } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.keyboard.releaseKey(...key);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_keyboardReleaseKey,
            requestId,
            data: { key },
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_keyboardReleaseKey,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mousePressButtonLeft,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mousePressButtonLeft}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.pressButton(nutjs.Button.LEFT);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mousePressButtonLeft,
            requestId,
            data: {},
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mousePressButtonLeft,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseReleaseButtonLeft,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseReleaseButtonLeft}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.releaseButton(nutjs.Button.LEFT);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseReleaseButtonLeft,
            requestId,
            data: {},
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseReleaseButtonLeft,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseDoubleClick,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseDoubleClick}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.doubleClick(nutjs.Button.LEFT);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseDoubleClick,
            requestId,
            data: {},
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseDoubleClick,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseLeftClick,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseLeftClick}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.click(nutjs.Button.LEFT);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseLeftClick,
            requestId,
            data: {},
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseLeftClick,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.mouseRightClick,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.mouseRightClick}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(windowId);
      if (win) {
        try {
          await nutjs.mouse.click(nutjs.Button.RIGHT);
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseRightClick,
            requestId,
            data: {},
            code: 0,
          });
        } catch (error) {
          winWebContentsSend({
            windowId,
            channel: IPC_EVENT.response_mouseRightClick,
            requestId,
            data,
            code: 1,
            msg: JSON.stringify(error),
          });
        }
      }
    }
  );
ipcMain.on(
    IPC_EVENT.getScreenStream,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.getScreenStream}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(Number(windowId));
      if (win) {
        const inputSources = await desktopCapturer.getSources({
          types: ['screen'],
        });
        const res: any[] = [];
        Object.keys(inputSources).forEach((key) => {
          const source = inputSources[key];
          if (!res.length) {
            res.push(source);
          }
        });
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_getScreenStream,
          requestId,
          data: { stream: res[0] },
          code: 0,
        });
      }
    }
  );
ipcMain.handle(IPC_EVENT.scaleFactor, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.scaleFactor}`, reqData);
    const { requestId, data } = reqData;
    const { windowId } = data;
    const win = windowMap.get(Number(windowId));
    const res = {
      windowId,
      requestId,
      data: { scaleFactor: 0, platform: '' },
      code: 0,
    };
    if (win) {
      const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
      res.data.scaleFactor = scaleFactor;
      res.data.platform = platform;
    } else {
      res.code = 1;
    }
    return res;
  });
ipcMain.handle(
    IPC_EVENT.getPrimaryDisplaySize,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.getPrimaryDisplaySize}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(Number(windowId));
      const res = {
        windowId,
        requestId,
        data: { width: 0, height: 0 },
        code: 0,
      };
      if (win) {
        const { width, height } = screen.getPrimaryDisplay().size;
        res.data.width = width;
        res.data.height = height;
      } else {
        res.code = 1;
      }
      return res;
    }
  );
}
