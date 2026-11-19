import type { AppData } from '../../types';

/**
 * 首次引导判定（纯函数，便于单元测试与 E2E 复现）。
 * 只有「真正的全新用户」才自动弹引导，避免打扰老用户与示例数据体验。
 */
export function isOnboardingEligible(input: { data: AppData; ready: boolean; blocked: boolean }): boolean {
  const { data, ready, blocked } = input;
  if (!ready || blocked) return false;
  if (data.settings.onboarded === true) return false;
  if (data.settings.demoData) return false;
  return (
    data.projects.length === 0 &&
    data.tasks.length === 0 &&
    data.habits.length === 0 &&
    data.habitLogs.length === 0
  );
}

/** 回顾模式（从设置页重看）不写库、不重置标记；正常流程才登记完成。 */
export function shouldMarkOnboarded(review: boolean): boolean {
  return !review;
}

/** 空状态引导文案（集中管理，避免各页面文案漂移）。 */
export const EMPTY_STATE_COPY = {
  projects: {
    title: '还没有项目',
    description: '先创建一个项目（例如「工作」「生活」），再把任务归进去，就能看到每个目标的推进情况。',
    action: '创建第一个项目',
  },
  tasks: {
    title: '这里还没有任务',
    action: '新建一个',
    secondary: '先创建第一个项目',
  },
  habits: {
    title: '还没有习惯',
    description: '从一件小事开始：早起、阅读、运动、喝水都可以。',
    action: '添加第一个习惯',
  },
} as const;
