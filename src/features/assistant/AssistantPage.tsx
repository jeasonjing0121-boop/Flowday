import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Task } from '../../types';
import { useApp } from '../../store/AppStore';
import { uid } from '../../lib/data';
import { todayKey } from '../../lib/date';
import { Icon } from '../../components/Icons';
import { localMockProvider, type MockProposal } from './mock';

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  proposal?: MockProposal;
  status?: 'pending' | 'applied' | 'dismissed';
}

const CHIPS = ['帮我规划今天', '拆解「准备产品方案」', '我下午 3 点有空，安排一件事'];

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'ai',
  text: '你好，我是Jing。当前是演示模式：我会用本地规则帮你做规划与拆解，所有改动都需要你确认，且不会调用真实模型、不产生费用。',
};

export function AssistantPage() {
  const { data, dispatch } = useApp();
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || thinking) return;
    const userMsg: ChatMessage = { id: uid('m'), role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setThinking(true);
    const openTasks = data.tasks.filter((t) => !t.completed && t.date <= todayKey());
    const reply = await localMockProvider.reply(text, { today: todayKey(), openTasks });
    timerRef.current = window.setTimeout(() => {
      setMessages((prev) => [...prev, { id: uid('m'), role: 'ai', text: reply.text, proposal: reply.proposal, status: reply.proposal ? 'pending' : undefined }]);
      setThinking(false);
    }, 600);
  };

  // 从首页「让Jing安排」带 prompt 跳转时，自动发一次
  useEffect(() => {
    if (bootRef.current) return;
    const prompt = params.get('prompt');
    if (prompt) {
      bootRef.current = true;
      send(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const applyProposal = (messageId: string, proposal: MockProposal) => {
    proposal.tasks.forEach((draft: MockProposal['tasks'][number]) => {
      const task: Task = {
        id: uid('t'),
        title: draft.title,
        date: draft.date,
        time: draft.time,
        priority: draft.priority,
        completed: false,
        createdAt: new Date().toISOString(),
        source: 'ai',
      };
      dispatch({ type: 'task/add', task });
    });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: 'applied' } : m)));
  };

  const dismissProposal = (messageId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: 'dismissed' } : m)));
  };

  return (
    <div className="mx-auto max-w-[860px] space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="fd-gradient-bg grid h-9 w-9 place-items-center rounded-xl text-white">
            <Icon name="sparkles" size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Jing · 你的 AI 助手</p>
            <p className="text-[11px] text-ink-3">演示模式：本地规则 + 用户确认，不调用真实 API、不产生费用</p>
          </div>
        </div>
        <span className="fd-chip border-p2/30 text-p2">DEMO</span>
      </section>

      {!data.settings.aiEnabled ? (
        <div className="fd-card text-sm text-ink-2">
          AI 助手已在设置中关闭。你可以前往
          <Link className="mx-1 text-accent-ink hover:underline" to="/settings">
            设置
          </Link>
          重新开启，或继续手动管理任务（不影响其他功能）。
        </div>
      ) : null}

      <section className="fd-card flex flex-col p-0">
        <div ref={scrollRef} className="fd-scroll max-h-[56dvh] min-h-[320px] space-y-4 overflow-y-auto p-4">
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex items-start gap-2.5'}>
              {msg.role === 'ai' ? (
                <span className="fd-gradient-bg mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white">
                  <Icon name="sparkles" size={14} />
                </span>
              ) : null}
              <div className={msg.role === 'user' ? 'max-w-[86%]' : 'min-w-0 max-w-[88%]'}>
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                    msg.role === 'user' ? 'bg-accent text-white' : 'border border-line bg-paper text-ink'
                  }`}
                >
                  {msg.text}
                </div>

                {msg.proposal ? (
                  <div className="mt-2.5 rounded-2xl border border-line bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-ink">提案 · {msg.proposal.summary}</p>
                      <span className="fd-chip text-[10px]">未经确认不执行</span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {msg.proposal.tasks.map((t, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-ink-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                          <span className="min-w-0 flex-1">
                            {t.title}
                            <span className="ml-1.5 text-[10px] text-ink-3">
                              {t.date} {t.time ? `· ${t.time}` : ''} · P{t.priority}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {msg.status === 'pending' ? (
                      <div className="mt-3 flex items-center gap-2">
                        <button className="fd-btn-primary px-3 py-1.5 text-xs" onClick={() => applyProposal(msg.id, msg.proposal!)}>
                          <Icon name="check" size={13} />
                          确认执行（{msg.proposal.tasks.length} 项）
                        </button>
                        <button className="fd-btn-ghost px-2.5 py-1.5 text-xs" onClick={() => dismissProposal(msg.id)}>
                          忽略
                        </button>
                      </div>
                    ) : (
                      <p className={`mt-2.5 text-[11px] ${msg.status === 'applied' ? 'text-success-ink' : 'text-ink-3'}`}>
                        {msg.status === 'applied' ? '已执行：任务已加入清单，可在「任务」页查看。' : '已忽略，未写入任何数据。'}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {thinking ? (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <span className="fd-gradient-bg grid h-7 w-7 place-items-center rounded-lg text-white">
                <Icon name="sparkles" size={14} />
              </span>
              Jing正在整理…
            </div>
          ) : null}
        </div>

        <div className="border-t border-line-2 p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => (
              <button key={chip} className="fd-chip hover:border-accent hover:text-accent-ink" onClick={() => send(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              aria-label="输入与 Jing 的对话内容"
              className="fd-input max-h-28 min-h-[42px] flex-1 resize-none"
              rows={1}
              placeholder="告诉Jing你想安排什么（演示模式）…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="fd-btn-primary h-[42px] px-3.5" onClick={() => send()} disabled={thinking || !input.trim()}>
              <Icon name="send" size={16} />
              <span className="hidden sm:inline">发送</span>
            </button>
          </div>
        </div>
      </section>

      <p className="px-1 text-[11px] leading-5 text-ink-3">
        说明：本阶段的「Jing」只做交互与流程演示，使用固定规则生成回复与提案，不接任何大模型 API、不消耗额度。所有 AI
        改动都要你点「确认执行」才会写入；后续接入真实模型时，这套「提案 → 确认 → 执行」的流程保持不变。
      </p>
    </div>
  );
}
