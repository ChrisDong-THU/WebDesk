// GENERATED from billd-desk-server c73983e543341c08ce9e4fb7c52446be50b6c6a2 (MIT).
// edit extraction/adapters; verify with npm run upstream:check.
export var WsMsgTypeEnum;
(function (WsMsgTypeEnum) {
    /** 用户进入聊天 */
    WsMsgTypeEnum["join"] = "join";
    /** 用户进入聊天完成 */
    WsMsgTypeEnum["joined"] = "joined";
    /** 用户进入聊天 */
    WsMsgTypeEnum["otherJoin"] = "otherJoin";
    /** 用户退出聊天 */
    WsMsgTypeEnum["leave"] = "leave";
    /** 用户退出聊天完成 */
    WsMsgTypeEnum["leaved"] = "leaved";
    /** 当前所有在线用户 */
    WsMsgTypeEnum["liveUser"] = "liveUser";
    /** 用户发送消息 */
    WsMsgTypeEnum["message"] = "message";
    /** 房间正在直播 */
    WsMsgTypeEnum["roomLiving"] = "roomLiving";
    /** 房间不在直播 */
    WsMsgTypeEnum["roomNoLive"] = "roomNoLive";
    /** 获取在线用户 */
    WsMsgTypeEnum["getLiveUser"] = "getLiveUser";
    /** 更新加入信息 */
    WsMsgTypeEnum["updateJoinInfo"] = "updateJoinInfo";
    /** 心跳 */
    WsMsgTypeEnum["heartbeat"] = "heartbeat";
    /** 开始直播 */
    WsMsgTypeEnum["startLive"] = "startLive";
    /** 结束直播 */
    WsMsgTypeEnum["endLive"] = "endLive";
    /** 直播pk秘钥 */
    WsMsgTypeEnum["livePkKey"] = "livePkKey";
    /** 主播禁言用户 */
    WsMsgTypeEnum["disableSpeaking"] = "disableSpeaking";
    /** 主播踢掉用户 */
    WsMsgTypeEnum["kick"] = "kick";
    WsMsgTypeEnum["srsOffer"] = "srsOffer";
    WsMsgTypeEnum["srsAnswer"] = "srsAnswer";
    WsMsgTypeEnum["srsCandidate"] = "srsCandidate";
    WsMsgTypeEnum["nativeWebRtcOffer"] = "nativeWebRtcOffer";
    WsMsgTypeEnum["nativeWebRtcAnswer"] = "nativeWebRtcAnswer";
    WsMsgTypeEnum["nativeWebRtcCandidate"] = "nativeWebRtcCandidate";
    WsMsgTypeEnum["msrBlob"] = "msrBlob";
    WsMsgTypeEnum["batchSendOffer"] = "batchSendOffer";
    WsMsgTypeEnum["changeMaxBitrate"] = "changeMaxBitrate";
    WsMsgTypeEnum["changeMaxFramerate"] = "changeMaxFramerate";
    WsMsgTypeEnum["changeResolutionRatio"] = "changeResolutionRatio";
    WsMsgTypeEnum["changeVideoContentHint"] = "changeVideoContentHint";
    WsMsgTypeEnum["changeAudioContentHint"] = "changeAudioContentHint";
    WsMsgTypeEnum["billdDeskJoin"] = "billdDeskJoin";
    WsMsgTypeEnum["billdDeskJoined"] = "billdDeskJoined";
    WsMsgTypeEnum["billdDeskUpdateUser"] = "billdDeskUpdateUser";
    WsMsgTypeEnum["billdDeskStartRemote"] = "billdDeskStartRemote";
    WsMsgTypeEnum["billdDeskStartRemoteResult"] = "billdDeskStartRemoteResult";
    WsMsgTypeEnum["billdDeskBehavior"] = "billdDeskBehavior";
    WsMsgTypeEnum["billdDeskOffer"] = "billdDeskOffer";
    WsMsgTypeEnum["billdDeskAnswer"] = "billdDeskAnswer";
    WsMsgTypeEnum["billdDeskCandidate"] = "billdDeskCandidate";
})(WsMsgTypeEnum || (WsMsgTypeEnum = {}));
export function socketEmit({ socket, msgType, roomId, data, }) {
    try {
        // console.log('===== websocket socketEmit =====', roomId, socket.id, msgType);
        if (roomId) {
            socket.to(`${roomId}`).emit(msgType, data);
        }
        else {
            socket.emit(msgType, data);
        }
    }
    catch (error) {
        console.log(error);
    }
}
export function registerRemoteSignals({ socket, prettierInfoLog = () => { } }) {
    socket.on(WsMsgTypeEnum.nativeWebRtcOffer, (data) => {
        prettierInfoLog({
            msg: '收到nativeWebRtcOffer',
            socket,
            roomId: data.data.live_room_id,
        });
        socketEmit({
            roomId: data.data.live_room_id,
            socket,
            msgType: WsMsgTypeEnum.nativeWebRtcOffer,
            data: data.data,
        });
    });
    socket.on(WsMsgTypeEnum.nativeWebRtcAnswer, (data) => {
        prettierInfoLog({
            msg: '收到nativeWebRtcAnswer',
            socket,
            roomId: data.data.live_room_id,
        });
        socketEmit({
            roomId: data.data.live_room_id,
            socket,
            msgType: WsMsgTypeEnum.nativeWebRtcAnswer,
            data: data.data,
        });
    });
    socket.on(WsMsgTypeEnum.nativeWebRtcCandidate, (data) => {
        prettierInfoLog({
            msg: '收到nativeWebRtcCandidate',
            socket,
            roomId: data.data.live_room_id,
        });
        socketEmit({
            socket,
            roomId: data.data.live_room_id,
            msgType: WsMsgTypeEnum.nativeWebRtcCandidate,
            data: data.data,
        });
    });
}
