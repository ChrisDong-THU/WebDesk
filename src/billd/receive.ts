// @ts-nocheck
// GENERATED from billd-desk 61be620eb35b0004dc66c296f0fdd8c62700b1b9 (MIT).
// Run npm run upstream:check; edit extraction/adapters, not this file.
import { createNullVideo } from './utils';
import { WsMsgTypeEnum } from './enums';
export function registerRemoteReceivers(environment) {
const { ws, networkStore, roomId, mySocketId, deskUserUuid, remoteDeskUserUuid, webRtcRemoteDesk, updateWebRtcRemoteDeskConfig } = environment;
const userStream = { value: undefined }, canvasVideoStream = { value: undefined };
ws.socketIo.on(WsMsgTypeEnum.nativeWebRtcOffer, async (data) => {
if (data.isRemoteDesk) {
          if (data.receiver === mySocketId.value) {
            console.warn('是发给我的nativeWebRtcOffer-isRemoteDesk');
            if (networkStore.rtcMap.get(data.sender)) {
              return;
            }
            updateWebRtcRemoteDeskConfig({
              roomId: roomId.value,
              userStream: userStream.value,
              anchorStream: canvasVideoStream.value,
            });
            webRtcRemoteDesk.newWebRtc({
              // 因为这里是收到offer，而offer是房主发的，所以此时的data.data.sender是房主；data.data.receiver是接收者；
              // 但是这里的nativeWebRtc的sender，得是自己，不能是data.data.sender，不要混淆
              sender: mySocketId.value,
              receiver: data.sender,
              videoEl: createNullVideo(),
              deskUserUuid: deskUserUuid.value,
              remoteDeskUserUuid: remoteDeskUserUuid.value,
            });
            await webRtcRemoteDesk.sendAnswer({
              sender: mySocketId.value,
              // data.data.receiver是接收者；我们现在new pc，发送者是自己，接收者肯定是房主，不能是data.data.receiver，因为data.data.receiver是自己
              receiver: data.sender,
              sdp: data.sdp,
            });
          } else {
            console.error('不是发给我的nativeWebRtcOffer-isRemoteDesk');
          }
          return;
        }
});
ws.socketIo.on(
      WsMsgTypeEnum.nativeWebRtcAnswer,
      async (data: WsAnswerType['data']) => {
        console.log('收到nativeWebRtcAnswer', data);
        if (data.receiver === mySocketId.value) {
          console.warn('是发给我的nativeWebRtcAnswer');
          const rtc = networkStore.rtcMap.get(data.sender);
          if (rtc) {
            await rtc.setRemoteDescription(data.sdp);
          }
        } else {
          console.error('不是发给我的nativeWebRtcAnswer');
        }
      }
    );
ws.socketIo.on(
      WsMsgTypeEnum.nativeWebRtcCandidate,
      (data: WsCandidateType['data']) => {
        console.log('收到nativeWebRtcCandidate', data);
        if (data.receiver === mySocketId.value) {
          console.warn('是发给我的nativeWebRtcCandidate');
          const rtc = networkStore.rtcMap.get(data.sender);
          return rtc?.addIceCandidate(data.candidate);
        } else {
          console.error('不是发给我的nativeWebRtcCandidate');
        }
      }
    );
}
