// @ts-nocheck
// GENERATED from billd-desk 61be620eb35b0004dc66c296f0fdd8c62700b1b9 (MIT).
// Run npm run upstream:check; edit extraction/adapters, not this file.
export enum LiveLineEnum {
  rtc = 'rtc',
  hls = 'hls',
  flv = 'flv',
}
export enum LiveRenderEnum {
  video = 'video',
  canvas = 'canvas',
}
export enum MediaTypeEnum {
  camera,
  screen,
  microphone,
  txt,
  img,
  media,
  time,
  stopwatch,
  webAudio,
  pk,
  metting,
}
export enum WsMsgTypeEnum {
  /** 用户进入聊天 */
  join = 'join',
  /** 用户进入聊天完成 */
  joined = 'joined',
  /** 用户进入聊天 */
  otherJoin = 'otherJoin',
  /** 用户退出聊天 */
  leave = 'leave',
  /** 用户退出聊天完成 */
  leaved = 'leaved',
  /** 当前所有在线用户 */
  liveUser = 'liveUser',
  /** 用户发送消息 */
  message = 'message',
  /** 房间正在直播 */
  roomLiving = 'roomLiving',
  /** 房间不在直播 */
  roomNoLive = 'roomNoLive',
  /** 获取在线用户 */
  getLiveUser = 'getLiveUser',
  /** 更新加入信息 */
  updateJoinInfo = 'updateJoinInfo',
  /** 更新直播间预览图 */
  updateLiveRoomCoverImg = 'updateLiveRoomCoverImg',
  /** 心跳 */
  heartbeat = 'heartbeat',
  /** 开始直播 */
  startLive = 'startLive',
  /** 结束直播 */
  endLive = 'endLive',
  /** 直播pk秘钥 */
  livePkKey = 'livePkKey',
  /** 主播禁言用户 */
  disableSpeaking = 'disableSpeaking',
  /** 主播踢掉用户 */
  kick = 'kick',

  srsOffer = 'srsOffer',
  srsAnswer = 'srsAnswer',
  srsCandidate = 'srsCandidate',

  nativeWebRtcOffer = 'nativeWebRtcOffer',
  nativeWebRtcAnswer = 'nativeWebRtcAnswer',
  nativeWebRtcCandidate = 'nativeWebRtcCandidate',

  msrBlob = 'msrBlob',
  batchSendOffer = 'batchSendOffer',
  fileTransfer = 'fileTransfer',

  changeMaxBitrate = 'changeMaxBitrate',
  changeMaxFramerate = 'changeMaxFramerate',
  changeResolutionRatio = 'changeResolutionRatio',
  changeVideoContentHint = 'changeVideoContentHint',
  changeAudioContentHint = 'changeAudioContentHint',

  billdDeskJoin = 'billdDeskJoin',
  billdDeskJoined = 'billdDeskJoined',
  billdDeskUpdateUser = 'billdDeskUpdateUser',
  billdDeskStartRemote = 'billdDeskStartRemote',
  billdDeskStartRemoteResult = 'billdDeskStartRemoteResult',
  billdDeskBehavior = 'billdDeskBehavior',
  billdDeskOffer = 'billdDeskOffer',
  billdDeskAnswer = 'billdDeskAnswer',
  billdDeskCandidate = 'billdDeskCandidate',
}
export enum BilldDeskBehaviorEnum {
  mouseMove,
  mouseDrag,
  pressButtonLeft,
  pressButtonRight,
  releaseButtonLeft,
  releaseButtonRight,
  setPosition,
  doubleClick,
  leftClick,
  rightClick,
  scrollDown,
  scrollUp,
  scrollLeft,
  scrollRight,

  keyboardType,
  keyboardPressKey,
  keyboardReleaseKey,
}
export enum WsConnectStatusEnum {
  /** 已连接 */
  connection = 'connection',
  /** 连接中 */
  connecting = 'connecting',
  /** 已连接 */
  connected = 'connected',
  /** 断开连接中 */
  disconnecting = 'disconnecting',
  /** 已断开连接 */
  disconnect = 'disconnect',
  /** 重新连接 */
  reconnect = 'reconnect',
  /** 客户端的已连接 */
  connect = 'connect',
}
