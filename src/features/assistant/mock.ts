import type { Priority, Task } from '../../types';
import { addDays } from '../../lib/date';

export interface MockTaskDraft {
  title: string;
  date: string;
  time?: string;
  priority: Priority;
}

export interface MockProposal {
  summary: string;
  tasks: MockTaskDraft[];
}

export interface MockReply {
  text: string;
  proposal?: MockProposal;
}

export interface MockContext {
  today: string;
  openTasks: Task[];
}

/**
 * 助手提供方接口：本阶段只有 localMockProvider（本地规则，零费用）。
 * 未来接入真实 DeepSeek 时，新增一个实现该接口的 provider（走服务端代理、密钥不落前端），
 * 替换下方导出即可；对话 UI 与「提案 → 确认 → 执行」流程保持不变。
 */
export interface AssistantProvider {
  readonly id: 'mock' | 'deepseek';
  reply(input: string, ctx: MockContext): MockReply | Promise<MockReply>;
}

export const localMockProvider: AssistantProvider = {
  id: 'mock',
  reply: (input, ctx) => mockReply(input, ctx),
};

const hasAny = (text: string, keys: string[]) => keys.some((k) => text.includes(k));

function extractTopic(input: string): string {
  const quoted = input.match(/[「“"]([^」”"]{2,30})[」”"]/);
  if (quoted) return quoted[1].trim();
  const cleaned = input
    .replace(/帮我|请|麻烦|能不能|可以|一下|的|把|给/g, ' ')
    .replace(/拆解|分解|目标|计划|任务/g, ' ')
    .replace(/[，。！？、,.!?：:；;\s]+/g, ' ')
    .trim();
  return cleaned.split(' ').filter(Boolean).slice(0, 3).join(' ') || '我的目标';
}

/**
 * Jing的本地演示逻辑：不调用任何真实大模型、不产生费用。
 * 未来接入真实 API 时，保持 MockReply 结构不变即可替换实现。
 */
export function mockReply(input: string, ctx: MockContext): MockReply {
  const text = input.trim();

  if (hasAny(text, ['拆解', '分解', '目标', '步骤'])) {
    const topic = extractTopic(text);
    return {
      text: `可以。我把「${topic}」拆成 4 个可以今天开始的步骤（从确认标准到收尾复盘）。确认后我会把它们加入任务清单；这只是演示建议，不会调用真实 AI，也不会产生费用。`,
      proposal: {
        summary: `「${topic}」拆解为 4 个任务，按天递进安排`,
        tasks: [
          { title: `明确「${topic}」的验收标准`, date: ctx.today, priority: 2 },
          { title: '收集资料并列出关键路径', date: addDays(ctx.today, 1), priority: 2 },
          { title: '完成第一版（留出修改时间）', date: addDays(ctx.today, 2), priority: 2 },
          { title: '复盘并收尾提交', date: addDays(ctx.today, 3), priority: 3 },
        ],
      },
    };
  }

  if (hasAny(text, ['规划', '安排', '今天', '计划', '排一下'])) {
    const first = ctx.openTasks[0]?.title ?? '处理今天最重要的一件事';
    return {
      text: `我看了下今天的任务：还有 ${ctx.openTasks.length} 件没完成。建议把它们收成 3 个时间块，先做最重要的一件，晚上留 15 分钟复盘。确认后我就写进任务清单（演示模式，不会产生真实 AI 调用）。`,
      proposal: {
        summary: '把今天安排成 3 个时间块',
        tasks: [
          { title: first, date: ctx.today, time: '09:30', priority: 1 },
          { title: '专注推进核心任务（不被打断的 90 分钟）', date: ctx.today, time: '10:30', priority: 2 },
          { title: '复盘 15 分钟，整理明天的安排', date: ctx.today, time: '20:30', priority: 3 },
        ],
      },
    };
  }

  return {
    text: `我现在是演示模式：只会用本地规则回应，不会调用真实模型，也不会产生费用。你可以试试：\n· 「帮我规划今天」——我会生成一份今日时间安排提案\n· 「拆解『准备产品方案』」——我会把它拆成几步\n\n当前你还有 ${ctx.openTasks.length} 件待办任务。`,
  };
}
