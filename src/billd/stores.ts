// @ts-nocheck
// GENERATED from billd-desk 61be620eb35b0004dc66c296f0fdd8c62700b1b9 (MIT).
// Run npm run upstream:check; edit extraction/adapters, not this file.
import { defineStore } from 'pinia';
import { LiveLineEnum, LiveRenderEnum } from './enums';
export const useAppStore = defineStore('app', {
  state: (): AppRootState => {
    return {
      isMac: false,
      showDebug: false,
      version: '',
      updateModalInfo: undefined,
      deskVersionInfo: undefined,
      lastBuildDate: '',
      scaleFactor: 1,
      windowId: -1,
      workAreaSize: { width: 0, height: 0 },
      primaryDisplaySize: { width: 0, height: 0 },
      remoteDesk: new Map(),
      playing: false,
      videoRatio: 16 / 9,
      videoControls: {
        renderMode: LiveRenderEnum.video,
      },
      videoControlsValue: {
        pipMode: false,
      },
      normalVolume: 70,
      navList: [],
      allTrack: [],
      liveLine: LiveLineEnum.hls,
      liveRoomInfo: undefined,
      showLoginModal: false,
      disableSpeaking: new Map(),
      showSigninRedDot: false,
    };
  },
  actions: {
    setLiveRoomInfo(res: AppRootState['liveRoomInfo']) {
      this.liveRoomInfo = res;
    },
    setLiveLine(res: AppRootState['liveLine']) {
      this.liveLine = res;
    },
    setAllTrack(res: AppRootState['allTrack']) {
      this.allTrack = res;
    },
    getTrackInfo() {
      const res = { audio: 0, video: 0 };
      this.allTrack.forEach((item) => {
        // if (item.stream) {
        if (item.audio === 1) {
          res.audio += 1;
        }
        if (item.video === 1) {
          res.video += 1;
        }
        // }
      });
      return res;
    },
  },
});
export const useNetworkStore = defineStore('network', {
  state: (): NetworkRootState => {
    return {
      wsMap: new Map(),
      rtcMap: new Map(),
    };
  },
  actions: {
    updateWsMap(roomId: string, arg) {
      const val = this.wsMap.get(roomId);
      if (val) {
        this.wsMap.set(roomId, { ...val, ...arg });
      } else {
        this.wsMap.set(roomId, arg);
      }
    },
    removeWs(roomId: string) {
      const old = this.wsMap.get(roomId);
      if (old) {
        old.close();
      }
      this.wsMap.delete(roomId);
    },
    removeRtc(socketId: string) {
      const old = this.rtcMap.get(socketId);
      if (old) {
        old.close();
      }
      this.rtcMap.delete(socketId);
    },
    removeAllWsAndRtc() {
      this.wsMap.forEach((item) => {
        item.close();
      });
      this.rtcMap.forEach((item) => {
        item.close();
      });
      this.wsMap.clear();
      this.rtcMap.clear();
    },
    removeAllRtc() {
      this.rtcMap.forEach((item) => {
        item.close();
      });
      this.rtcMap.clear();
    },
    removeAllWs() {
      this.wsMap.forEach((item) => {
        item.close();
      });
      this.wsMap.clear();
    },
  },
});
