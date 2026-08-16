/**
 * dsh 服务状态 → 用户可见文案（「状态文案」的单一事实来源）。
 * 术语表见 CONTEXT.md「服务状态 (DshStatus)」/「状态文案」。
 *
 * 未知值回落原串：契约跟随——dsh 升级新增状态值时文案缺失不崩、原样显示，
 * 不静默吞掉真实状态。
 */

export const STATUS_COPY: Record<string, string> = {
  discovering: "DeepSeek Harness 服务检测中",
  starting: "DeepSeek Harness 服务启动中",
  ready: "DeepSeek Harness 服务已就绪",
  reconnecting: "DeepSeek Harness 服务重连中",
  stopped: "DeepSeek Harness 服务已停止",
  error: "DeepSeek Harness 服务出错",
};

export function statusCopy(status: string): string {
  return STATUS_COPY[status] ?? status;
}
