type HostMediaStats = {
  encoder?: string;
  encodeMs?: number;
  qualityLimit?: string;
  capture?: string;
  backend?: string;
  captureMs?: number;
  adaptationReason?: string;
  codecPreference?: string;
  codecDecision?: string;
  codecOrder?: string[];
  codecSwitches?: number;
  codecCooldownMs?: number;
};

const duration = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)} ms` : '未报告';

export function formatHostMediaDiagnostics(media: HostMediaStats): string {
  const cooldown =
    typeof media.codecCooldownMs === 'number' && Number.isFinite(media.codecCooldownMs)
      ? Math.max(0, media.codecCooldownMs)
      : 0;
  const backend = media.backend && media.backend !== 'unknown' ? ` / ${media.backend.toUpperCase()}` : '';
  const details = [
    `编码器：${media.encoder || '未报告'}`,
    `编码耗时：${duration(media.encodeMs)}/帧`,
    `质量限制：${media.qualityLimit || '未报告'}`,
    `采集：${media.capture === 'secure' ? '安全桌面' : '普通桌面'}${backend}`,
  ];
  if (media.captureMs !== undefined) details.push(`采集耗时：${duration(media.captureMs)}`);
  if (media.adaptationReason && media.adaptationReason !== 'none') {
    details.push(`调整原因：${media.adaptationReason === 'cpu' ? '编码负载' : '网络带宽'}`);
  }
  details.push(
    `编码设置：${media.codecPreference === 'auto' ? '自动' : `${media.codecPreference || '未报告'} 首选`}`,
    `选择原因：${media.codecDecision || '未报告'}`,
    `编码顺序：${Array.isArray(media.codecOrder) ? media.codecOrder.join(' / ') : '未报告'}`,
    `编码切换：${media.codecSwitches ?? 0}`,
    `切换冷却：${Math.ceil(cooldown / 1000)} s`,
  );
  return details.join('；');
}
