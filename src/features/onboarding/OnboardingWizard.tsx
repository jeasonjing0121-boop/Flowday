import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { Modal, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { PROJECT_COLORS } from '../../types';
import { normalizeProjectName } from '../../lib/projects';
import { uid } from '../../lib/data';
import { todayKey } from '../../lib/date';
import { isOnboardingEligible } from './onboardingRules';

/** 设置页「重新查看上手引导」触发的事件（不重置 onboarded 标记）。 */
export const ONBOARDING_REVIEW_EVENT = 'fd:onboarding-review';

export function openOnboardingReview(): void {
  window.dispatchEvent(new CustomEvent(ONBOARDING_REVIEW_EVENT));
}

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: '欢迎使用 FlowDay',
  2: '创建第一个项目',
  3: '添加第一条任务',
};

/**
 * 首次上手引导（D5）。
 *
 * 触发条件（全部满足，避免打扰老用户）：
 * - 数据已就绪且未被安全阻断
 * - 未完成过引导（settings.onboarded !== true）
 * - 非示例数据
 * - 项目/任务/习惯均为空（真正的全新用户）
 *
 * 三步：欢迎 → 建项目 → 建任务；任意一步都可跳过；完成后写入 onboarded，
 * 之后不再自动弹出。设置页可「重新查看」（回顾模式不重置标记）。
 */
export function OnboardingWizard() {
  const { data, dispatch, storage } = useApp();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('工作');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [error, setError] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const projectIdRef = useRef<string | null>(null);

  const shouldAutoOpen = isOnboardingEligible({ data, ready: storage.ready, blocked: Boolean(storage.blocked) });

  useEffect(() => {
    if (!shouldAutoOpen) return;
    setReview(false);
    setStep(1);
    setName('工作');
    setColor(PROJECT_COLORS[0]);
    setError('');
    setTaskTitle('');
    projectIdRef.current = null;
    setOpen(true);
  }, [shouldAutoOpen]);

  useEffect(() => {
    const handler = () => {
      setReview(true);
      setStep(1);
      setError('');
      setTaskTitle('');
      projectIdRef.current = null;
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_REVIEW_EVENT, handler);
    return () => window.removeEventListener(ONBOARDING_REVIEW_EVENT, handler);
  }, []);

  const finish = (message: string) => {
    // 回顾模式不写库；正常流程记录完成状态，之后不再自动弹出
    if (!review) dispatch({ type: 'settings/update', patch: { onboarded: true } });
    setOpen(false);
    toast(message, 'success');
    if (step === 3) navigate('/today');
  };

  const skipAll = () => finish(review ? '已结束回顾' : '已跳过引导，可随时在「设置 → 应用」中重新查看');

  const createProject = () => {
    const normalized = normalizeProjectName(name);
    if (!normalized) {
      setError('给项目起个名字，或者选择「暂时跳过」');
      requestAnimationFrame(() => document.getElementById('onboarding-project-name')?.focus());
      return;
    }
    const id = uid('p');
    dispatch({
      type: 'project/add',
      project: { id, name: normalized, color, archived: false, createdAt: new Date().toISOString() },
    });
    projectIdRef.current = id;
    setError('');
    setStep(3);
  };

  const finishWithTask = (withTask: boolean) => {
    const title = taskTitle.trim();
    if (withTask && title) {
      dispatch({
        type: 'task/add',
        task: {
          id: uid('t'),
          title,
          date: todayKey(),
          priority: 3,
          completed: false,
          createdAt: new Date().toISOString(),
          source: 'manual',
          projectId: projectIdRef.current ?? undefined,
        },
      });
    }
    finish(withTask && title ? '第一条任务已创建，开始今天吧' : '引导已完成，可以随时新建任务');
  };

  const footer =
    step === 1 ? (
      <>
        <button type="button" className="fd-btn-ghost" onClick={skipAll} data-fd-onboarding-skip="1">
          {review ? '关闭' : '跳过引导'}
        </button>
        <button type="button" className="fd-btn-primary" onClick={() => setStep(2)} data-fd-onboarding-next="1">
          开始
        </button>
      </>
    ) : step === 2 ? (
      <>
        <button type="button" className="fd-btn-ghost" onClick={() => setStep(3)} data-fd-onboarding-skip="1">
          暂时跳过
        </button>
        <button type="button" className="fd-btn-primary" onClick={createProject} data-fd-onboarding-create-project="1">
          创建并继续
        </button>
      </>
    ) : (
      <>
        <button type="button" className="fd-btn-ghost" onClick={() => finishWithTask(false)} data-fd-onboarding-skip="1">
          稍后再说
        </button>
        <button type="button" className="fd-btn-primary" onClick={() => finishWithTask(true)} data-fd-onboarding-finish="1">
          完成
        </button>
      </>
    );

  return (
    <Modal open={open} onClose={review ? () => setOpen(false) : skipAll} title={STEP_TITLES[step]} footer={footer}>
      <div data-fd-onboarding={step} data-fd-onboarding-review={review ? '1' : '0'} className="space-y-4 text-xs leading-5 text-ink-2">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={`h-1.5 rounded-full transition-all ${s === step ? 'w-5 bg-accent' : s < step ? 'w-1.5 bg-accent/60' : 'w-1.5 bg-sunken-2'}`}
            />
          ))}
          <span className="ml-1.5 text-[11px] text-ink-3">第 {step} / 3 步</span>
        </div>

        {review ? (
          <p className="rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[11px] text-ink-3">回顾模式：不会重置你的引导状态</p>
        ) : null}

        {step === 1 ? (
          <div className="space-y-2.5">
            <p>
              FlowDay 把<strong className="text-ink">今天要做的事</strong>、日程、习惯集中在一个界面，帮你决定「现在先做哪一件」。
            </p>
            <div className="flex items-start gap-2 rounded-xl border border-line bg-sunken px-3 py-2.5">
              <Icon name="flag" size={14} className="mt-0.5 shrink-0 text-accent" />
              <p>
                你的数据<strong className="text-ink">只保存在这台设备的本地数据库</strong>，默认不上传任何服务器；可随时在设置中导出备份。
              </p>
            </div>
            <p>接下来两步：建一个项目，再放进第一条任务。两步都可以跳过。</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <p>项目用来给任务分组（例如「工作」「生活」「考研」），之后可以看完成率与本周进度。</p>
            <div>
              <label className="fd-label" htmlFor="onboarding-project-name">
                项目名称
              </label>
              <input
                id="onboarding-project-name"
                className={`fd-input${error ? ' fd-input-error' : ''}`}
                value={name}
                maxLength={64}
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'onboarding-project-error' : undefined}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createProject();
                }}
              />
              {error ? (
                <p id="onboarding-project-error" role="alert" className="fd-field-error">
                  {error}
                </p>
              ) : null}
            </div>
            <div>
              <span className="fd-label" id="onboarding-color-label">
                颜色
              </span>
              <div role="radiogroup" aria-labelledby="onboarding-color-label" className="flex flex-wrap gap-2">
                {PROJECT_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={color === option}
                    aria-label={`颜色 ${option}`}
                    onClick={() => setColor(option)}
                    className={`h-7 w-7 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fd-focus-ring)] ${
                      color === option ? 'scale-110 border-ink' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ background: option }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <p>写下一件今天想完成的事。它会出现在「今日焦点」里。</p>
            <div>
              <label className="fd-label" htmlFor="onboarding-task-title">
                第一件事
              </label>
              <input
                id="onboarding-task-title"
                className="fd-input"
                placeholder="例如：整理本周待办"
                value={taskTitle}
                maxLength={200}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishWithTask(true);
                }}
              />
            </div>
            <p className="text-[11px] text-ink-3">不写也可以直接完成，之后随时能新建任务。</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
