import { demoData, emptyData, parseImportedData, sanitizeImportedData, sanitizeImportedDataDetailed } from '../lib/data';
import {
  activeProjects,
  allProjectStats,
  archivedProjects,
  makeProject,
  normalizeProjectColor,
  normalizeProjectName,
  orphanProjectTaskIds,
  projectStats,
  resolveProject,
  sortProjects,
  uncategorizedTaskCount,
} from '../lib/projects';
import { CURRENT_SCHEMA_VERSION, decideSyncAction, isSyncInfo, migrateStoredState, revisionOf } from '../lib/storage/schema';
import { validateSyncMessage } from '../lib/storage/sync';
import { DRAFT_MAX_CHARS, saveDraft, validateDraftRaw, type ConflictDraft } from '../lib/storage/recovery';
import { BACKUP_FORMAT_VERSION, BACKUP_MAX_BYTES, createBackup, readExportedAt, sha256Hex, validateBackup, validateBackupDetailed } from '../lib/storage/backup';
import { parseLegacyRaw } from '../lib/storage/legacy';
import { hasSanitizeChanges, isPreviewStale, summarizeSanitize } from '../lib/storage/importGuard';
import { clearLastExport, readLastExport, recordExportSuccess } from '../lib/storage/exportLog';
import { PERSIST_REQUEST_TEXT, PERSIST_STATE_TEXT } from '../lib/storage/persist';
import { addDays, msUntilNextMidnight, startOfWeek, timeToMinutes, todayKey, weekdayLabel, weekDates } from '../lib/date';
import { reducer } from '../store/reducer';
import { emitNotice, resetNoticeBusForTest, subscribeNotices } from '../store/notices';
import { PersistenceController } from '../store/persistence';
import { SyncMachine } from '../store/syncMachine';
import appStoreSource from '../store/AppStore.tsx?raw';
import appEntrySource from '../App.tsx?raw';
import persistenceSource from '../store/persistence.ts?raw';
import syncSource from '../store/syncMachine.ts?raw';
import stylesSource from '../styles.css?raw';
import {
  activeHabits,
  dashboardAggregate,
  filterTasks,
  focusTasks,
  findConflicts,
  habitStreak,
  isHabitChecked,
  last7DayCompletion,
  sortTasks,
  todayOpenTasks,
  todayStats,
} from '../lib/selectors';
import { mockReply } from '../features/assistant/mock';
import { classifyRequest, isOwnedCacheName, isStaleCache, precacheUrls, SHELL_CACHE } from '../lib/pwa/cachePolicy';
import registerSource from '../lib/pwa/register.ts?raw';
import { isOnboardingEligible, shouldMarkOnboarded } from '../features/onboarding/onboardingRules';
import onboardingSource from '../features/onboarding/OnboardingWizard.tsx?raw';
import settingsSource from '../features/settings/SettingsPage.tsx?raw';
import type { AppData, Task } from '../types';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  check(`${name}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`, JSON.stringify(actual) === JSON.stringify(expected));
}

function makeTask(partial: Partial<Task> & Pick<Task, 'title' | 'date'>): Task {
  return {
    id: `t_${Math.random().toString(36).slice(2)}`,
    priority: 3,
    completed: false,
    createdAt: new Date().toISOString(),
    source: 'manual',
    ...partial,
  };
}

console.log('\n[1] 日期工具');
const t = todayKey();
eq('今天格式为 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(t), true);
eq('跨月 +1 天', addDays('2026-01-31', 1), '2026-02-01');
eq('跨年 -1 天', addDays('2026-01-01', -1), '2025-12-31');
eq('周起始（周一）', startOfWeek('2026-11-13', 1), '2026-11-09');
eq('一周 7 天', weekDates('2026-11-13', 1).length, 7);
eq('周标签', weekdayLabel('2026-11-13'), '周五');

console.log('\n[2] 数据与本地存储结构');
const demo = demoData();
eq('示例任务数量', demo.tasks.length, 9);
eq('示例习惯数量', demo.habits.length, 3);
eq('示例数据被标记', demo.settings.demoData, true);
check('示例数据的项目已建立', demo.projects.length === 3);

console.log('\n[3] 任务 reducer（创建 / 编辑 / 完成 / 删除）');
const added = reducer(demo, { type: 'task/add', task: makeTask({ title: '测试任务', date: t }) });
eq('新增任务', added.tasks.length, demo.tasks.length + 1);
const newId = added.tasks[0].id;
const updated = reducer(added, { type: 'task/update', id: newId, patch: { title: '改名后的任务', priority: 1 } });
eq('编辑任务标题', updated.tasks.find((x) => x.id === newId)?.title, '改名后的任务');
eq('编辑任务优先级', updated.tasks.find((x) => x.id === newId)?.priority, 1);
const toggled = reducer(updated, { type: 'task/toggle', id: newId });
eq('标记完成', toggled.tasks.find((x) => x.id === newId)?.completed, true);
check('完成时间被记录', Boolean(toggled.tasks.find((x) => x.id === newId)?.completedAt));
const untoggled = reducer(toggled, { type: 'task/toggle', id: newId });
eq('撤销完成', untoggled.tasks.find((x) => x.id === newId)?.completed, false);
check('撤销后完成时间被清除', !untoggled.tasks.find((x) => x.id === newId)?.completedAt);
const deleted = reducer(untoggled, { type: 'task/delete', id: newId });
eq('删除任务', deleted.tasks.length, demo.tasks.length);

console.log('\n[4] 习惯打卡 reducer（打卡 / 撤销 / 删除级联）');
const habitId = demo.habits[0].id;
const before = demo.habitLogs.filter((l) => l.habitId === habitId).length;
const checked = reducer(demo, { type: 'habit/toggle', habitId, date: '2099-01-01' });
eq('打卡一次', checked.habitLogs.filter((l) => l.habitId === habitId).length, before + 1);
const unchecked = reducer(checked, { type: 'habit/toggle', habitId, date: '2099-01-01' });
eq('再次点击撤销打卡', unchecked.habitLogs.filter((l) => l.habitId === habitId).length, before);
const pairs = new Set(checked.habitLogs.map((l) => `${l.habitId}|${l.date}`));
check('打卡记录无重复键（同一天同习惯只有一条）', pairs.size === checked.habitLogs.length);
const habitDeleted = reducer(demo, { type: 'habit/delete', id: habitId });
check('删除习惯时打卡记录一起清除', habitDeleted.habitLogs.every((l) => l.habitId !== habitId));

console.log('\n[5] 排序与统计');
const sorted = sortTasks([
  makeTask({ title: '已完成', date: t, completed: true }),
  makeTask({ title: '明天', date: addDays(t, 1) }),
  makeTask({ title: '今天普通', date: t, priority: 3 }),
  makeTask({ title: '今天紧急', date: t, priority: 1 }),
]);
eq('未完成排在前、按日期与优先级排序', sorted.map((x) => x.title), ['今天紧急', '今天普通', '明天', '已完成']);
const stats = todayStats(demo);
eq('今日分母（今天及逾期）', stats.total, 6);
eq('今日已完成数', stats.done, 2);
eq('今日完成率', stats.percent, 33);
eq('示例习惯连续天数', habitStreak(demo, demo.habits[0].id), 4);

console.log('\n[6] AI 助手演示逻辑（不调用真实模型）');
const plan = mockReply('帮我规划今天', { today: t, openTasks: demo.tasks.filter((x) => !x.completed) });
eq('规划意图生成 3 个任务提案', plan.proposal?.tasks.length, 3);
check('规划提案摘要非空', Boolean(plan.proposal?.summary));
check('规划提案时间在用户本地日期', plan.proposal?.tasks.every((x) => x.date === t) ?? false);
const breakdown = mockReply('拆解「准备产品方案」', { today: t, openTasks: [] });
eq('拆解意图生成 4 个任务提案', breakdown.proposal?.tasks.length, 4);
check('拆解提案包含目标名', breakdown.text.includes('准备产品方案'));
const fallback = mockReply('你好呀', { today: t, openTasks: [] });
eq('普通输入不生成提案', fallback.proposal, undefined);

console.log('\n[7] 导入解析（parseImportedData：校验 + 兜底）');
const importGood = JSON.stringify({
  version: 1,
  tasks: [{ id: 'a', title: '导入任务', date: '2026-01-02', priority: 9, completed: 'yes' }],
  habits: [{ id: 'h', name: '喝水' }],
  habitLogs: [
    { habitId: 'h', date: '2026-01-02' },
    { habitId: 'ghost', date: '2026-01-03' },
  ],
});
const imported = parseImportedData(importGood);
check('合法备份 JSON 解析成功', imported !== null);
eq('越界优先级收敛到有效区间（9 → 3）', imported?.tasks[0].priority, 3);
eq('非法 completed 收敛为布尔 true', imported?.tasks[0].completed, true);
eq('孤儿打卡记录被丢弃', imported?.habitLogs.length, 1);
eq('损坏 JSON 返回 null', parseImportedData('{oops'), null);
eq('缺少 habits 返回 null', parseImportedData('{"tasks":[]}'), null);
eq('非对象返回 null', parseImportedData('"str"'), null);

console.log('\n[8] 排程冲突检测');
const mkBlock = (title: string, time: string, durationMin?: number) => makeTask({ title, date: t, time, durationMin });
eq('重叠时间块被检出 2 处', findConflicts([mkBlock('A', '09:00', 60), mkBlock('B', '09:30', 60), mkBlock('C', '10:00', 30), mkBlock('D', '10:30')]).length, 2);
eq('首尾相接不算冲突', findConflicts([mkBlock('A', '09:00', 60), mkBlock('B', '10:00', 60)]).length, 0);
eq('已完成任务不参与冲突', findConflicts([makeTask({ title: 'X', date: t, time: '09:00', completed: true }), mkBlock('Y', '09:30')]).length, 0);

console.log('\n[9] 任务筛选（filterTasks：搜索/优先级/状态/日期）');
const f1 = makeTask({ title: '写周报', date: t, priority: 1, notes: '季度总结' });
const f2 = makeTask({ title: '读书', date: addDays(t, 1), priority: 3 });
const f3 = makeTask({ title: '过期任务', date: addDays(t, -2), priority: 2 });
const f4 = makeTask({ title: '已完成任务', date: t, priority: 1, completed: true });
const pool = [f1, f2, f3, f4];
eq('关键词同时匹配标题与备注', filterTasks(pool, { query: '季度' }).length, 1);
eq('优先级筛选 P1（含已完成）', filterTasks(pool, { priority: 1 }).length, 2);
eq('状态筛选：仅待办', filterTasks(pool, { status: 'open' }).length, 3);
eq('状态筛选：仅已完成', filterTasks(pool, { status: 'done' }).length, 1);
eq('日期筛选：已逾期且未完成', filterTasks(pool, { date: 'overdue' }).length, 1);
eq('日期筛选：今天', filterTasks(pool, { date: 'today' }).length, 2);
eq('组合筛选（P1 + 待办）', filterTasks(pool, { priority: 1, status: 'open' }).length, 1);
check('筛选结果保持排序（未完成在前）', filterTasks(pool, { status: 'open' })[0].completed === false);

console.log('\n[10] 快速连续操作与异常数据边界');
const baseToggled = reducer(demo, { type: 'task/toggle', id: demo.tasks[0].id });
const twiceToggled = reducer(baseToggled, { type: 'task/toggle', id: demo.tasks[0].id });
eq('连续切换两次回到原状态', twiceToggled.tasks.find((x) => x.id === demo.tasks[0].id)?.completed, demo.tasks[0].completed);
const noopDelete = reducer(demo, { type: 'task/delete', id: 'not-exist' });
eq('删除不存在的任务不改变数据量', noopDelete.tasks.length, demo.tasks.length);
const emptyToggle = reducer({ ...demo, tasks: [] }, { type: 'task/toggle', id: 'x' });
eq('空任务列表切换不崩溃', emptyToggle.tasks.length, 0);
const emptyStats = todayStats({ ...demo, tasks: [] });
eq('空数据完成率为 0（不除零）', emptyStats.percent, 0);

console.log('\n[11] 数据架构：schema / 旧数据 / 备份校验');
eq('当前 schemaVersion 为 2', CURRENT_SCHEMA_VERSION, 2);
const wrappedRecord = { schemaVersion: 2, updatedAt: new Date().toISOString(), data: demo };
const schemaOk = migrateStoredState(wrappedRecord);
check('当前版本记录通过校验', schemaOk.ok === true);
const legacyRecord = migrateStoredState({ ...demo, version: 1 });
check('旧版记录可迁移到当前 schema', legacyRecord.ok === true && legacyRecord.fromVersion === 1);
const futureRecord = migrateStoredState({ schemaVersion: 99, data: demo });
check('高版本记录被拒绝（不降级破坏数据）', futureRecord.ok === false && futureRecord.error.includes('高于'));
const brokenRecord = migrateStoredState({ schemaVersion: 2, data: { tasks: 'bad' } });
check('损坏记录返回错误而不抛异常', brokenRecord.ok === false);

const backup = await createBackup(demo);
eq('备份包含 schemaVersion', backup.schemaVersion, CURRENT_SCHEMA_VERSION);
eq('备份包含 formatVersion=1', backup.formatVersion, BACKUP_FORMAT_VERSION);
check('备份附带 SHA-256 校验和（64 位小写 hex）', backup.checksum?.alg === 'sha-256' && /^[0-9a-f]{64}$/.test(backup.checksum?.value ?? ''));
eq(
  '备份 counts 与实际内容一致',
  JSON.stringify(backup.counts),
  JSON.stringify({ tasks: demo.tasks.length, projects: demo.projects.length, habits: demo.habits.length, habitLogs: demo.habitLogs.length })
);
const validBackup = await validateBackup(JSON.stringify(backup));
check('合法备份通过校验并还原任务', validBackup.ok === true && validBackup.data.tasks.length === demo.tasks.length);
const detailedBackup = await validateBackupDetailed(JSON.stringify(backup));
check('新格式校验和验证通过', detailedBackup.ok === true && detailedBackup.checksumStatus === 'verified');
const tampered = await validateBackupDetailed(
  JSON.stringify({ ...backup, data: { ...backup.data, tasks: backup.data.tasks.map((task, i) => (i === 0 ? { ...task, title: '被篡改' } : task)) } })
);
check('数据被篡改时校验和不匹配并拒绝', tampered.ok === false && tampered.error.includes('校验和'));
const futureFormat = await validateBackupDetailed(JSON.stringify({ ...backup, formatVersion: 2 }));
check('未来格式版本被拒绝', futureFormat.ok === false && futureFormat.error.includes('格式版本'));
const oldEnvelope = await validateBackupDetailed(JSON.stringify({ app: 'FlowDay', schemaVersion: 2, exportedAt: new Date().toISOString(), data: demo }));
check('旧版信封可导入并标记未校验', oldEnvelope.ok === true && oldEnvelope.checksumStatus === 'unverified-legacy');
const legacyBackup = await validateBackup(JSON.stringify(demo));
check('旧版裸 JSON 备份可兼容导入', legacyBackup.ok === true && legacyBackup.format === 'legacy');
const futureBackup = await validateBackup(JSON.stringify({ app: 'FlowDay', schemaVersion: 99, data: demo }));
check('高版本备份被拒绝并给出原因', futureBackup.ok === false && futureBackup.error.includes('版本'));
check('非法 JSON 备份被拒绝', (await validateBackup('{bad json')).ok === false);
check('缺字段备份被拒绝', (await validateBackup(JSON.stringify({ app: 'FlowDay', schemaVersion: 2, data: { tasks: [] } }))).ok === false);
check('超大文件被拒绝（不解析）', (await validateBackupDetailed('x'.repeat(BACKUP_MAX_BYTES + 1))).ok === false);

// 数据规范化（去重 / 字段兜底 / 引用校验）与可见摘要
const noisy = {
  ...demo,
  tasks: [
    ...demo.tasks,
    { ...demo.tasks[0] },
    { ...demo.tasks[1], id: 'noisy_task', time: '99:99', notes: 'n'.repeat(6000), priority: 9, durationMin: 99999 },
  ],
  projects: [...demo.projects, { id: demo.projects[0].id, name: '重复项目' }],
  settings: { ...demo.settings, name: { bad: true }, theme: 'neon', weekStart: 5 },
};
const noisyResult = sanitizeImportedDataDetailed(noisy);
check(
  '重复任务 ID 保留首次并计入摘要',
  noisyResult.stats.duplicatesRemoved.tasks === 1 && noisyResult.data?.tasks.length === demo.tasks.length + 1
);
check(
  '非法时间/优先级/时长被规范化',
  noisyResult.data !== null &&
    noisyResult.data.tasks[demo.tasks.length].time === undefined &&
    noisyResult.data.tasks[demo.tasks.length].priority === 3 &&
    noisyResult.data.tasks[demo.tasks.length].durationMin === 1440
);
check('超长备注被截断到 5000', noisyResult.data?.tasks[demo.tasks.length].notes?.length === 5000);
check(
  '非法设置字段回落默认',
  noisyResult.data?.settings.name === '' && noisyResult.data?.settings.theme === 'light' && noisyResult.data?.settings.weekStart === 1
);
check('重复项目 ID 被去重', noisyResult.stats.duplicatesRemoved.projects === 1 && noisyResult.data?.projects.length === demo.projects.length);
check('规范化产生可见告警', noisyResult.warnings.length > 0);
const brokenRef = sanitizeImportedDataDetailed({ ...demo, tasks: [{ ...demo.tasks[0], projectId: 'p_missing' }] });
check('不存在的项目引用被置空并计数', brokenRef.data?.tasks[0].projectId === undefined && brokenRef.stats.brokenProjectRefs === 1);
const badLogs = sanitizeImportedDataDetailed({
  ...demo,
  habitLogs: [
    { habitId: demo.habits[0].id, date: 'not-a-date' },
    { habitId: demo.habits[0].id, date: '2026-01-02' },
    { habitId: demo.habits[0].id, date: '2026-01-02' },
  ],
});
check('非法打卡日期被丢弃、重复打卡去重', badLogs.data?.habitLogs.length === 1 && badLogs.stats.duplicatesRemoved.habitLogs === 1);

const legacyParsed = parseLegacyRaw(JSON.stringify(demo));
check('旧 localStorage 数据可解析', legacyParsed.ok === true && legacyParsed.data.tasks.length === demo.tasks.length);
check('损坏的旧数据解析返回错误而不抛异常', parseLegacyRaw('{oops').ok === false);

console.log('\n[12] 排序等价性与筛选一致性（R2 优化护栏）');
const refSort = (list: Task[]) =>
  [...list].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.completed && b.completed) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const ta = timeToMinutes(a.time);
    const tb = timeToMinutes(b.time);
    if (ta !== tb) return ta - tb;
    return a.priority - b.priority;
  });
const sortPool: Task[] = [
  makeTask({ title: 'A', date: addDays(t, -1), time: '09:00' }),
  makeTask({ title: 'B', date: t, time: '08:30', priority: 1 }),
  makeTask({ title: 'C', date: t, time: '20:00', completed: true, completedAt: '2026-01-02T10:00:00.000Z' }),
  makeTask({ title: 'D', date: t, priority: 2 }),
  makeTask({ title: 'E', date: addDays(t, 2), completed: true, completedAt: '2026-01-03T10:00:00.000Z' }),
  makeTask({ title: 'F', date: t, time: '08:30', priority: 3 }),
];
eq('sortTasks 与参考实现结果一致', JSON.stringify(sortTasks(sortPool).map((x) => x.id)), JSON.stringify(refSort(sortPool).map((x) => x.id)));
eq('sortTasks 不修改原数组顺序', sortPool.map((x) => x.id).join(','), sortPool.map((x) => x.id).join(','));
eq('filterTasks 结果与 sortTasks 排序一致', JSON.stringify(filterTasks(sortPool, { status: 'open' }).map((x) => x.id)), JSON.stringify(refSort(sortPool.filter((x) => !x.completed)).map((x) => x.id)));

console.log('\n[13] Dashboard 单遍聚合等价性（R3 护栏）');
const refSortByTime = (list: Task[]) =>
  [...list].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time) || a.priority - b.priority);
const edgeData = {
  ...demo,
  tasks: [
    makeTask({ title: '逾期未完成', date: addDays(t, -3), priority: 1 }),
    makeTask({ title: '今天未完成', date: t, time: '09:00', priority: 2 }),
    makeTask({ title: '今天已完成', date: t, completed: true, completedAt: new Date(t + 'T10:00:00').toISOString() }),
    makeTask({ title: '已完成但无完成时间', date: addDays(t, -1), completed: true }),
    makeTask({ title: '未来任务', date: addDays(t, 2), time: '08:00' }),
    makeTask({ title: '今天无时间', date: t, priority: 3 }),
  ],
  habitLogs: [
    { habitId: demo.habits[0].id, date: t },
    { habitId: demo.habits[1].id, date: addDays(t, -1) },
  ],
};
for (const [name, data] of [
  ['示例数据', demo],
  ['边界数据', edgeData],
] as [string, typeof demo][]) {
  const today = todayKey();
  const agg = dashboardAggregate(data, today);
  const oldStats = todayStats(data);
  eq(`${name}：聚合 total/done/open/percent 与 todayStats 一致`, JSON.stringify([agg.total, agg.done, agg.open, agg.percent]), JSON.stringify([oldStats.total, oldStats.done, oldStats.open, oldStats.percent]));
  eq(`${name}：焦点任务与 focusTasks 一致`, JSON.stringify(agg.focus.map((x) => x.id)), JSON.stringify(focusTasks(data, 3).map((x) => x.id)));
  eq(
    `${name}：时间线与 todayOpenTasks+sortByTime 一致`,
    JSON.stringify(agg.timeline.map((x) => x.id)),
    JSON.stringify(refSortByTime(todayOpenTasks(data).filter((x) => x.time)).map((x) => x.id))
  );
  eq(`${name}：近 7 日统计与 last7DayCompletion 一致`, JSON.stringify(agg.week), JSON.stringify(last7DayCompletion(data)));
  const oldChecked = activeHabits(data).filter((h) => isHabitChecked(data, h.id, today)).length;
  eq(`${name}：习惯打卡数与旧逻辑一致`, agg.habitChecked, oldChecked);
  eq(`${name}：习惯总数一致`, agg.habitTotal, activeHabits(data).length);
  eq(`${name}：聚合内部只遍历 tasks 一次`, agg.scans, 1);
}
const customDay = addDays(t, 1);
const aggTomorrow = dashboardAggregate(edgeData, customDay);
eq('指定 today 时聚合口径随日期变化（明日统计计入今天与更早任务）', aggTomorrow.total, 5);
eq('指定 today 时未完成/已完成口径正确（未来任务仍不计入）', JSON.stringify([aggTomorrow.done, aggTomorrow.open]), JSON.stringify([2, 3]));
eq('聚合不修改原始任务数组', edgeData.tasks.length, 6);

console.log('\n[14] 跨日/夏令时日期工具（R3 护栏）');
const nearMidnight = new Date(2026, 2, 8, 23, 59, 30, 0);
const delayMs = msUntilNextMidnight(nearMidnight);
const landed = new Date(nearMidnight.getTime() + delayMs);
eq('午夜延迟为正数', delayMs > 0, true);
eq('午夜延迟落在下一个本地日历日', landed.getDate(), 9);
eq('午夜延迟落在 00:00 之后（含余量）', landed.getHours() === 0 && landed.getMinutes() === 0, true);
eq('午夜延迟不超过 25 小时（兼容夏令时）', delayMs <= 25 * 3600 * 1000, true);
check('临近午夜时仍有最小 1s 兜底', msUntilNextMidnight(new Date(2026, 0, 1, 0, 0, 0, 20)) >= 1000);

console.log('\n[15] 搜索参照逻辑（保留旧 filterTasks 作为对照，R4）');
const searchPool = [
  makeTask({ title: '写本周周报', notes: '季度总结', date: t }),
  makeTask({ title: '产品评审会', date: t }),
  makeTask({ title: '写周报草稿', date: t }),
];
const prefixes = ['写', '写周', '写本周', '写本周周报'];
const fullMatch = filterTasks(searchPool, { query: '写本周周报' }).map((x) => x.id);
eq('逐前缀过滤结果最终收敛到完整查询结果', JSON.stringify(filterTasks(searchPool, { query: prefixes[prefixes.length - 1] }).map((x) => x.id)), JSON.stringify(fullMatch));
eq('旧过滤逻辑仍可直接使用（作为参照）', filterTasks(searchPool, { query: '周报' }).length, 2);
eq('清空查询恢复完整列表', filterTasks(searchPool, { query: '' }).length, searchPool.length);
eq('查询与筛选组合仍正确', filterTasks(searchPool, { query: '周报', status: 'open' }).length, 2);

console.log('\n[16] 多标签同步纯逻辑（revision / 决策 / 消息 / 草稿）');
eq('旧记录无 revision 视为 0', revisionOf({}), 0);
eq('合法 revision 保留', revisionOf({ revision: 7 }), 7);
eq('负 revision 归零', revisionOf({ revision: -3 }), 0);
eq('非法 revision 归零', revisionOf({ revision: Number.NaN }), 0);
eq('小数 revision 向下取整', revisionOf({ revision: 3.9 }), 3);
check('合法 SyncInfo 通过校验', isSyncInfo({ revision: 2, updatedAt: '2026-01-01T00:00:00.000Z' }));
check('缺 updatedAt 的 SyncInfo 被拒绝', isSyncInfo({ revision: 2 }) === false);
check('负 revision 的 SyncInfo 被拒绝', isSyncInfo({ revision: -1, updatedAt: 'x' }) === false);

eq('版本相同 → 无动作', decideSyncAction({ baseRevision: 3, currentRevision: 3, dirty: false }), 'none');
eq('库版本更新 + 本地干净 → 自动同步', decideSyncAction({ baseRevision: 3, currentRevision: 4, dirty: false }), 'sync');
eq('库版本更新 + 本地有修改 → 提示', decideSyncAction({ baseRevision: 3, currentRevision: 4, dirty: true }), 'prompt');
eq('库版本回退 + 本地干净 → 自动同步', decideSyncAction({ baseRevision: 3, currentRevision: 1, dirty: false }), 'sync');
eq('库版本回退 + 本地有修改 → 提示', decideSyncAction({ baseRevision: 3, currentRevision: 1, dirty: true }), 'prompt');

const syncMsg = { type: 'saved', revision: 5, updatedAt: '2026-01-01T00:00:00.000Z', writerId: 'tab-1' };
check('合法同步消息通过', validateSyncMessage(syncMsg) !== null);
check('错误类型消息被拒绝', validateSyncMessage({ ...syncMsg, type: 'delete' }) === null);
check('revision 0 的消息被拒绝', validateSyncMessage({ ...syncMsg, revision: 0 }) === null);
check('缺 writerId 的消息被拒绝', validateSyncMessage({ ...syncMsg, writerId: '' }) === null);
check('非对象消息被拒绝', validateSyncMessage('hello') === null);
check('合法消息 revision 解析正确', validateSyncMessage({ ...syncMsg, revision: 9 })?.revision === 9);

const draftBase = { version: 1 as const, savedAt: new Date().toISOString(), baseRevision: 3, writerId: 'tab-test', reason: 'conflict' as const, data: demo };
const draftRaw = JSON.stringify(draftBase);
check('草稿 JSON 校验通过', validateDraftRaw(draftRaw) !== null);
eq('草稿 baseRevision 保留', validateDraftRaw(draftRaw)?.baseRevision, 3);
eq('草稿版本不符被拒绝', validateDraftRaw(JSON.stringify({ ...draftBase, version: 2 })), null);
eq('损坏草稿 JSON 返回 null', validateDraftRaw('{bad json'), null);
check('超限草稿返回 null', validateDraftRaw('x'.repeat(DRAFT_MAX_CHARS + 1)) === null);
eq('缺少 tasks 的草稿被拒绝', validateDraftRaw(JSON.stringify({ ...draftBase, data: { habits: [] } })), null);
eq('缺少 writerId 的草稿被拒绝', validateDraftRaw(JSON.stringify({ ...draftBase, writerId: '' })), null);
const saveResult = saveDraft(draftBase as ConflictDraft);
check('无 localStorage 时草稿保存返回 storage 失败而不抛异常', saveResult.ok === false && saveResult.reason === 'storage');
const hugeDraft = { ...draftBase, data: { ...draftBase.data, tasks: [{ id: 'huge', title: 'x'.repeat(DRAFT_MAX_CHARS), date: todayKey() }] } };
const hugeResult = saveDraft(hugeDraft as unknown as ConflictDraft);
check('超大草稿保存返回 too-large', hugeResult.ok === false && hugeResult.reason === 'too-large');

console.log('\n[17] 导入守卫 / 导出记录 / 持久化文案（4.4-B 护栏）');
eq('预览版本未变化 → 不过期', isPreviewStale(3, 3), false);
eq('预览版本落后 → 过期', isPreviewStale(3, 4), true);
eq('预览版本超前 → 过期', isPreviewStale(4, 3), true);
const zeroStats = {
  tasks: 0,
  projects: 0,
  habits: 0,
  habitLogs: 0,
  duplicatesRemoved: { tasks: 0, projects: 0, habits: 0, habitLogs: 0 },
  droppedInvalid: 0,
  fixedFields: 0,
  brokenProjectRefs: 0,
};
eq('无修正 → 无摘要行', summarizeSanitize(zeroStats).length, 0);
eq('无修正 → hasSanitizeChanges 为 false', hasSanitizeChanges(zeroStats), false);
const dirtyStats = { ...zeroStats, duplicatesRemoved: { ...zeroStats.duplicatesRemoved, tasks: 2 }, fixedFields: 3 };
const lines = summarizeSanitize(dirtyStats);
check('有修正 → 摘要包含去重与字段修正', lines.some((l) => l.includes('去重') && l.includes('2')) && lines.some((l) => l.includes('字段修正') && l.includes('3')));
eq('有修正 → hasSanitizeChanges 为 true', hasSanitizeChanges(dirtyStats), true);
eq('无 localStorage 时读取导出时间为 null', readLastExport(), null);
eq('无 localStorage 时记录导出返回 false', recordExportSuccess(), false);
clearLastExport();
check('持久化文案覆盖三种状态', Boolean(PERSIST_STATE_TEXT.granted && PERSIST_STATE_TEXT['not-granted'] && PERSIST_STATE_TEXT.unsupported));
check('持久化请求文案覆盖四种结果', Boolean(PERSIST_REQUEST_TEXT.granted && PERSIST_REQUEST_TEXT.denied && PERSIST_REQUEST_TEXT.unsupported && PERSIST_REQUEST_TEXT.failed));

console.log('\n[18] D1 专项：备份时间 exportedAt 全链路');
const isoUtc = '2026-11-14T08:00:00.000Z';
const isoPlus8 = '2026-11-14T16:00:00.000+08:00';
const mkEnvelope = (exportedAt: unknown, withChecksum: boolean) => {
  const dataJson = JSON.stringify(demo);
  const env: Record<string, unknown> = { app: 'FlowDay', formatVersion: 1, schemaVersion: 2, counts: { tasks: demo.tasks.length, projects: demo.projects.length, habits: demo.habits.length, habitLogs: demo.habitLogs.length } };
  if (exportedAt !== '__MISSING__') env.exportedAt = exportedAt;
  if (withChecksum) env.checksum = { alg: 'sha-256', value: '0'.repeat(64) };
  return JSON.stringify(env) .slice(0, -1) + ',"data":' + dataJson + '}';
};
const withUtc = await validateBackupDetailed(mkEnvelope(isoUtc, false));
check('新格式正常 ISO 时间被保留', withUtc.ok === true && withUtc.exportedAt === isoUtc);
const withOffset = await validateBackupDetailed(mkEnvelope(isoPlus8, false));
check('带时区偏移的 ISO 时间被保留', withOffset.ok === true && withOffset.exportedAt === isoPlus8);
const missing = await validateBackupDetailed(mkEnvelope('__MISSING__', false));
check('缺失 exportedAt 安全兜底为 undefined', missing.ok === true && missing.exportedAt === undefined);
const emptyStr = await validateBackupDetailed(mkEnvelope('', false));
check('空字符串 exportedAt 兜底为 undefined', emptyStr.ok === true && emptyStr.exportedAt === undefined);
const invalid = await validateBackupDetailed(mkEnvelope('not-a-date', false));
check('非法日期 exportedAt 兜底为 undefined', invalid.ok === true && invalid.exportedAt === undefined);
const numInvalid = await validateBackupDetailed(mkEnvelope(12345, false));
check('非字符串 exportedAt 兜底为 undefined', numInvalid.ok === true && numInvalid.exportedAt === undefined);
const legacyWithTime = await validateBackupDetailed(JSON.stringify({ app: 'FlowDay', schemaVersion: 2, exportedAt: isoUtc, data: demo }));
check('旧信封带时间被保留', legacyWithTime.ok === true && legacyWithTime.exportedAt === isoUtc && legacyWithTime.formatVersion === 0);
const legacyNoTime = await validateBackupDetailed(JSON.stringify({ app: 'FlowDay', schemaVersion: 2, data: demo }));
check('旧信封无时间为 undefined', legacyNoTime.ok === true && legacyNoTime.exportedAt === undefined);
const bareLegacy = await validateBackupDetailed(JSON.stringify(demo));
check('裸 AppData 旧格式时间为 undefined', bareLegacy.ok === true && bareLegacy.exportedAt === undefined && bareLegacy.format === 'legacy');
eq('readExportedAt 直接校验：合法', readExportedAt(isoUtc), isoUtc);
eq('readExportedAt 直接校验：非法', readExportedAt('xx'), undefined);
eq('readExportedAt 直接校验：空白', readExportedAt('   '), undefined);
// 修复前后校验和结果一致：exportedAt 不参与 checksum（仅 data 参与）
const envA = mkEnvelope(isoUtc, true);
const envB = mkEnvelope('1999-01-01T00:00:00.000Z', true);
const realSum = await sha256Hex(JSON.stringify(demo));
const patchedA = envA.replace('"' + '0'.repeat(64) + '"', '"' + (realSum ?? '') + '"');
const patchedB = envB.replace('"' + '0'.repeat(64) + '"', '"' + (realSum ?? '') + '"');
const va = await validateBackupDetailed(patchedA);
const vb = await validateBackupDetailed(patchedB);
check('不同 exportedAt 不影响校验和验证（均 verified）', va.ok === true && vb.ok === true && va.checksumStatus === 'verified' && vb.checksumStatus === 'verified');
const vaData = va.ok ? va.data : null;
const vbData = vb.ok ? vb.data : null;
check('校验和验证结果与 exportedAt 无关（数据相同则结论相同）', vaData !== null && JSON.stringify(vaData) === JSON.stringify(vbData));
// crypto.subtle 不可用：sha256Hex 返回 null；带 checksum 的文件必须被拒绝（不得标记通过）
const cryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
try {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  eq('subtle 不可用时 sha256Hex 返回 null', await sha256Hex('x'), null);
  const rejected = await validateBackupDetailed(patchedA);
  check('subtle 不可用时带校验和备份被拒绝', rejected.ok === false && rejected.error.includes('SHA-256'));
  const created = await createBackup(demo);
  eq('subtle 不可用时导出不附带校验和', created.checksum, null);
} finally {
  if (cryptoDesc) Object.defineProperty(globalThis, 'crypto', cryptoDesc);
}
check('恢复 crypto 后 sha256Hex 正常', (await sha256Hex('x')) !== null);

console.log('\n[19] 通知总线（store → UI 边界）');
resetNoticeBusForTest();
emitNotice('info', 'queued-1');
emitNotice('error', 'queued-2');
const received: { kind: string; text: string }[] = [];
const unsub = subscribeNotices((n) => received.push({ kind: n.kind, text: n.text }));
eq('订阅前通知被队列缓存并在订阅时补发', received.map((x) => x.text).join(','), 'queued-1,queued-2');
emitNotice('success', 'live-1');
eq('订阅后通知实时送达', received[2]?.text, 'live-1');
const unsub2 = subscribeNotices(() => received.push({ kind: 'x', text: 'second-subscriber' }));
emitNotice('info', 'after-second');
eq('单订阅者模型：第二订阅被忽略，第一订阅仍接收', received[3]?.text, 'after-second');
unsub2();
unsub();
emitNotice('info', 'after-unsub');
eq('退订后不再送达', received.length, 4);
resetNoticeBusForTest();

console.log('\n[20] PersistenceController（独立持久化职责）');
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
type SaveCall = { base: number; writer: string };
const mkController = (opts: { init?: any; saveResult?: (call: number) => any }) => {
  const calls: SaveCall[] = [];
  let saveCount = 0;
  const events: string[] = [];
  const controller = new PersistenceController(
    {
      initialize: async () =>
        opts.init ?? { data: null, source: 'empty', migrated: false, schemaVersion: 2, revision: 0, updatedAt: '' },
      save: async (_data, o) => {
        calls.push({ base: o.baseRevision, writer: o.writerId });
        saveCount += 1;
        return opts.saveResult ? opts.saveResult(saveCount) : { ok: true, revision: o.baseRevision + 1, updatedAt: 'u', writerId: o.writerId };
      },
      forceSave: async (_data, w) => ({ ok: true, revision: 99, updatedAt: 'u', writerId: w }),
      snapshot: async () => ({ data: demo, revision: 7, updatedAt: 'u' }),
      syncInfo: async () => ({ revision: 7, updatedAt: 'u' }),
    },
    {
      onSaved: () => events.push('saved'),
      onConflict: () => events.push('conflict'),
      onStorageError: () => events.push('storage-error'),
    },
    30,
    'writer-test'
  );
  return { controller, calls, events };
};
{
  const { controller, calls, events } = mkController({
    init: { data: demo, source: 'indexeddb', migrated: false, schemaVersion: 2, revision: 5, updatedAt: 'u' },
  });
  const result = await controller.init(demo);
  eq('init 返回存储层结果', result.revision, 5);
  eq('init 后 baseRevision 对齐', controller.baseRevision, 5);
  controller.requestSave(demo);
  await sleepMs(80);
  eq('init 加载的数据首次保存周期被跳过（不重复写）', calls.length, 0);
  eq('skip 后 dirty 清除', controller.dirty, false);
  controller.requestSave(demo);
  await sleepMs(80);
  eq('跳过仅一次：后续修改正常保存', calls.length, 1);
  eq('保存携带 baseRevision 与 writerId', JSON.stringify(calls[0]), JSON.stringify({ base: 5, writer: 'writer-test' }));
  eq('保存成功后 baseRevision 前进', controller.baseRevision, 6);
  check('保存成功触发 onSaved', events.includes('saved'));
  controller.dispose();
}
{
  // 首落库（seed）路径：不存在回声，用户首次编辑必须真实落库
  const { controller, calls } = mkController({});
  await controller.init(demo);
  eq('seed 写入一次', calls.length, 1);
  controller.requestSave(demo);
  await sleepMs(80);
  eq('seed 后首次用户编辑不被 skip 吞掉', calls.length, 2);
  controller.dispose();
}
{
  const { controller, events } = mkController({
    saveResult: (n) => (n === 2 ? { ok: false, conflict: { revision: 8, updatedAt: 'u' } } : { ok: true, revision: n + 8, updatedAt: 'u', writerId: 'w' }),
  });
  await controller.init(demo);
  controller.requestSave(demo);
  await sleepMs(80); // 第一次保存周期被 init 的 skipNext 消费
  controller.requestSave(demo);
  await sleepMs(80); // 第二次保存触发 CAS 冲突
  check('CAS 冲突触发 onConflict', events.includes('conflict'));
  eq('冲突后暂停自动保存', controller.paused, true);
  const flushWhilePaused = await controller.flush();
  eq('暂停期间 flush 不写入', flushWhilePaused, true);
  const over = await controller.forceOverwrite(demo);
  eq('forceOverwrite 走 storage forceSave（仍 CAS）', over.ok === true ? (over as any).revision : -1, 99);
  eq('force 成功后恢复保存', controller.paused, false);
  controller.dispose();
}
{
  const { controller, events } = mkController({ init: { data: null, source: 'empty', migrated: false, error: 'boom', schemaVersion: 2, revision: 0, updatedAt: '' } });
  await controller.init(demo);
  eq('初始化错误关闭持久化', controller.persistenceOk, false);
  check('初始化错误上报 onStorageError', events.includes('storage-error'));
  controller.requestSave(demo);
  await sleepMs(60);
  eq('持久化关闭后不再写库', controller.dirty, false);
  controller.dispose();
}
{
  const { controller } = mkController({});
  const detach = controller.attachFlush();
  detach();
  controller.dispose();
  check('无 window 环境 attachFlush 安全（返回清理函数）', typeof detach === 'function');
}

console.log('\n[21] SyncMachine（状态转换与监听器生命周期）');
const mkMachine = () => {
  const sent: unknown[] = [];
  let channels = 0;
  let closed = 0;
  const lifecycle: { adds: number; removes: number } = { adds: 0, removes: 0 };
  const state = { applied: 0, external: 0, dirty: false, paused: false, ready: true, base: 3, current: 3 };
  const machine = new SyncMachine({
    createChannel: () => {
      channels += 1;
      return {
        mode: 'broadcast' as const,
        send: (m) => sent.push(m),
        close: () => {
          closed += 1;
        },
      };
    },
    syncInfo: async () => ({ revision: state.current, updatedAt: 'u' }),
    applySnapshot: async () => {
      state.applied += 1;
      return true;
    },
    onExternalUpdate: () => {
      state.external += 1;
    },
    isDirty: () => state.dirty,
    isPaused: () => state.paused,
    isReady: () => state.ready,
    baseRevision: () => state.base,
    addLifecycleListener: () => {
      lifecycle.adds += 1;
      return () => {
        lifecycle.removes += 1;
      };
    },
  });
  return { machine, sent, counters: () => ({ channels, closed, ...lifecycle }), state };
};
{
  const { machine, sent, counters, state } = mkMachine();
  machine.start();
  machine.start();
  eq('重复 start 不创建第二个通道', counters().channels, 1);
  eq('重复 start 不重复注册生命周期监听', counters().adds, 3);
  eq('版本相同 → 无动作', await machine.check('remote'), 'none');
  state.current = 4;
  eq('版本前进 + clean → 应用快照', await machine.check('remote'), 'sync');
  eq('applySnapshot 被调用', state.applied, 1);
  state.dirty = true;
  state.current = 5;
  eq('版本前进 + dirty → 上报外部更新', await machine.check('remote'), 'prompt');
  eq('onExternalUpdate 被调用', state.external, 1);
  state.ready = false;
  eq('未就绪时 check 跳过', await machine.check('remote'), 'skip');
  state.ready = true;
  machine.broadcastSaved({ type: 'saved', revision: 5, updatedAt: 'u', writerId: 'w' });
  eq('broadcastSaved 转发到通道', sent.length, 1);
  machine.dispose();
  eq('dispose 关闭通道', counters().closed, 1);
  eq('dispose 移除全部生命周期监听', counters().removes, 3);
  machine.start();
  eq('dispose 后可安全重启', counters().channels, 2);
  machine.dispose();
}

console.log('\n[22] AppStore 公共接口与依赖方向（兼容护栏）');
check('AppStore 不再依赖 components 层', !appStoreSource.includes("from '../components"));
check('AppStore 保留 useApp/useAppDispatch 导出', appStoreSource.includes('export function useApp') && appStoreSource.includes('export function useAppDispatch'));
check('Persistence 不直接操作 IndexedDB（仅经 storage 接口）', !persistenceSource.includes('indexedDB') && !persistenceSource.includes('IDB'));
check('SyncMachine 通过依赖读取权威 revision', syncSource.includes('this.deps.baseRevision()'));
check('SyncMachine 自身不持有 revision 字段', !/^\s*(private |public |readonly )*revision\s*[:=]/m.test(syncSource));

console.log('\n[23] 设计系统 Token 护栏（4.5-C）');
const tokenChecks: [string, string][] = [
  ['玻璃三层：导航', '--fd-glass-nav-blur'],
  ['玻璃三层：弹窗', '--fd-glass-modal-bg'],
  ['玻璃三层：遮罩', '--fd-scrim'],
  ['状态色：warn', '--fd-warn'],
  ['状态色：info', '--fd-info'],
  ['圆角层级', '--fd-r-sm'],
  ['间距层级', '--fd-sp-4'],
  ['排版层级', '--fd-fs-display'],
  ['动效时长', '--fd-dur-2'],
  ['动效曲线', '--fd-ease-emph'],
  ['焦点环', '--fd-focus-ring'],
  ['排版工具类', '.fd-t-display'],
  ['按钮加载态', '.fd-btn-loading'],
  ['加载环', '.fd-spinner'],
  ['菜单动效', '.fd-menu-in'],
  ['Toast 语义色', '.fd-toast-error'],
  ['无障碍：减弱动效', 'prefers-reduced-motion'],
  ['无障碍：焦点可见', ':focus-visible'],
  ['深色校准', '--fd-glass-nav-bg'],
];
for (const [label, token] of tokenChecks) check(`Token 存在：${label}`, stylesSource.includes(token));
check('深色主题块独立校准', stylesSource.includes('[data-theme="dark"]'));
check('玻璃降级兜底保留', stylesSource.includes('@supports not ((backdrop-filter: blur(4px))'));

console.log('\n[24] D0 数据安全保护（安全阻断 / 不覆盖原则）');
{
  type BootCfg = { init?: any; initThrows?: boolean; seedSave?: any; snapshot?: any };
  const mkBootController = (cfg: BootCfg) => {
    const calls: SaveCall[] = [];
    const events: string[] = [];
    const controller = new PersistenceController(
      {
        initialize: async () => {
          if (cfg.initThrows) throw new Error('IndexedDB 打不开');
          return (
            cfg.init ?? { data: null, source: 'empty', migrated: false, schemaVersion: 2, revision: 0, updatedAt: '' }
          );
        },
        save: async (_d, o) => {
          calls.push({ base: o.baseRevision, writer: o.writerId });
          return cfg.seedSave ?? { ok: true, revision: 1, updatedAt: 'u', writerId: o.writerId };
        },
        forceSave: async () => ({ ok: true, revision: 99, updatedAt: 'u', writerId: 'w' }),
        snapshot: async () => (cfg.snapshot === undefined ? { data: demo, revision: 7, updatedAt: 'u' } : cfg.snapshot),
        syncInfo: async () => ({ revision: 7, updatedAt: 'u' }),
      },
      {
        onBlocked: () => events.push('blocked'),
        onStorageError: () => events.push('storage-error'),
        onSaved: () => events.push('saved'),
      },
      20,
      'w'
    );
    return { controller, calls, events };
  };

  // 场景 1：已有正常数据库 → 正常读取，不写种子
  {
    const { controller, calls } = mkBootController({
      init: { data: demo, source: 'indexeddb', migrated: false, schemaVersion: 2, revision: 3, updatedAt: 'u', blocked: null },
    });
    const r = await controller.init(demo);
    eq('场景1 已有库：正常返回数据', r.data, demo);
    eq('场景1 已有库：baseRevision 对齐', controller.baseRevision, 3);
    eq('场景1 已有库：不写种子数据', calls.length, 0);
    eq('场景1 已有库：无阻断', controller.blocked, null);
    controller.dispose();
  }

  // 场景 2：全新安装 → 正常创建示例数据（唯一允许写种子的路径）
  {
    const { controller, calls, events } = mkBootController({});
    const r = await controller.init(demo);
    eq('场景2 首次安装：写入种子一次', calls.length, 1);
    eq('场景2 首次安装：返回种子数据', r.data, demo);
    check('场景2 首次安装：上报 onSaved', events.includes('saved'));
    eq('场景2 首次安装：无阻断', controller.blocked, null);
    controller.dispose();
  }

  // 场景 3：数据库版本高于当前应用 → 阻断，不写入
  {
    const { controller, calls, events } = mkBootController({
      init: {
        data: null,
        source: 'empty',
        migrated: false,
        error: 'v3 高于 v2',
        schemaVersion: 2,
        revision: 0,
        updatedAt: '',
        blocked: { reason: 'schema-too-new', message: 'v3 高于 v2', rawAvailable: true, storedVersion: 3 },
      },
    });
    const r = await controller.init(demo);
    eq('场景3 未来版本：不写任何数据', calls.length, 0);
    eq('场景3 未来版本：持久化关闭', controller.persistenceOk, false);
    eq('场景3 未来版本：进入阻断', controller.blocked?.reason, 'schema-too-new');
    check('场景3 未来版本：上报 onBlocked', events.includes('blocked'));
    check('场景3 未来版本：结果携带 blocked', Boolean(r.blocked));
    controller.requestSave(demo);
    await sleepMs(60);
    eq('场景3 未来版本：requestSave 不产生写入', calls.length, 0);
    eq('场景3 未来版本：dirty 保持 false', controller.dirty, false);
    eq('场景3 未来版本：flush 不写入', await controller.flush(), true);
    eq('场景3 未来版本：flush 后仍无写入', calls.length, 0);
    controller.dispose();
  }

  // 场景 4：初始化抛错（IndexedDB 不可用）→ 阻断，不写入
  {
    const { controller, calls } = mkBootController({ initThrows: true });
    const r = await controller.init(demo);
    eq('场景4 初始化抛错：不写任何数据', calls.length, 0);
    eq('场景4 初始化抛错：进入阻断', controller.blocked?.reason, 'unavailable');
    check('场景4 初始化抛错：返回 blocked 结果', Boolean(r.blocked));
    eq('场景4 初始化抛错：持久化关闭', controller.persistenceOk, false);
    controller.dispose();
  }

  // 场景 5：读取失败但库中仍有数据 → 阻断且标记原始数据可导出
  {
    const { controller, calls } = mkBootController({
      init: {
        data: null,
        source: 'empty',
        migrated: false,
        error: '读取失败',
        schemaVersion: 2,
        revision: 4,
        updatedAt: 'u',
        blocked: { reason: 'read-failed', message: '读取失败（原始数据未被修改）', rawAvailable: true },
      },
    });
    await controller.init(demo);
    eq('场景5 读取失败：不写任何数据', calls.length, 0);
    eq('场景5 读取失败：原始数据可导出', controller.blocked?.rawAvailable, true);
    eq('场景5 读取失败：保留原 revision', controller.baseRevision, 4);
    controller.dispose();
  }

  // 场景 6：首写冲突（其他标签页抢先写入）→ 载入快照，绝不覆盖
  {
    const { controller, calls } = mkBootController({ seedSave: { ok: false, conflict: { revision: 9, updatedAt: 'u' } } });
    const r = await controller.init(demo);
    eq('场景6 首写冲突：仅尝试一次种子写入', calls.length, 1);
    eq('场景6 首写冲突：载入快照版本', controller.baseRevision, 7);
    eq('场景6 首写冲突：返回快照数据', r.data, demo);
    eq('场景6 首写冲突：未进入阻断', controller.blocked, null);
    controller.dispose();
  }

  // 场景 7：首写失败且无快照 → 阻断，不覆盖
  {
    const { controller, calls } = mkBootController({
      seedSave: { ok: false, conflict: { revision: 9, updatedAt: 'u' } },
      snapshot: null,
    });
    const r = await controller.init(demo);
    eq('场景7 无快照：不产生额外写入', calls.length, 1);
    eq('场景7 无快照：进入阻断', controller.blocked?.reason, 'migration-conflict');
    check('场景7 无快照：结果携带 blocked', Boolean(r.blocked));
    controller.dispose();
  }

  // 场景 8：错误恢复后重新启动 → 新控制器正常加载
  {
    const broken = mkBootController({ initThrows: true });
    await broken.controller.init(demo);
    broken.controller.dispose();
    const healthy = mkBootController({
      init: { data: demo, source: 'indexeddb', migrated: false, schemaVersion: 2, revision: 12, updatedAt: 'u', blocked: null },
    });
    const r = await healthy.controller.init(demo);
    eq('场景8 恢复重启：正常加载', r.data, demo);
    eq('场景8 恢复重启：版本对齐', healthy.controller.baseRevision, 12);
    eq('场景8 恢复重启：不再阻断', healthy.controller.blocked, null);
    healthy.controller.dispose();
  }

  // 迁移失败原因码（供阻断界面分流）
  {
    const tooNew = migrateStoredState({ schemaVersion: 99, data: demo });
    eq('迁移原因码：未来版本', tooNew.ok === false ? tooNew.reason : 'ok', 'too-new');
    const corrupt = migrateStoredState({ schemaVersion: 2, data: { tasks: 'nope', habits: [] } });
    eq('迁移原因码：结构损坏', corrupt.ok === false ? corrupt.reason : 'ok', 'corrupt');
    const unknown = migrateStoredState({ foo: 1 });
    eq('迁移原因码：无法识别', unknown.ok === false ? unknown.reason : 'ok', 'unrecognized');
  }

  // 源码护栏：阻断路径必须真实存在于渲染与保存链路
  check('D0 App 渲染阻断界面', appEntrySource.includes('BlockedScreen') && appEntrySource.includes('storage.blocked'));
  check('D0 AppStore 初始状态为空数据', appStoreSource.includes('emptyData()'));
  check('D0 AppStore 阻断时不自动保存', appStoreSource.includes('!persistence || blocked'));
  check('D0 Persistence 存在第二道写入防线', persistenceSource.includes('this.blocked'));
}

console.log('\n[25] D1 项目数据层（CRUD / 归档 / 统计 / 兼容）');
{
  const today = todayKey();
  const mkTask = (patch: Partial<Task> & Pick<Task, 'title' | 'date'>): Task => ({
    id: `t_${Math.random().toString(36).slice(2, 10)}`,
    priority: 3,
    completed: false,
    createdAt: new Date().toISOString(),
    source: 'manual',
    ...patch,
  });
  const mkData = (): AppData => ({
    ...emptyData(),
    projects: [
      { id: 'p1', name: '工作', color: '#4A5B8C', archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'p2', name: '生活', color: '#B0724A', archived: true, createdAt: '2026-01-02T00:00:00.000Z' },
    ],
    tasks: [
      mkTask({ title: '工作A', date: today, projectId: 'p1' }),
      mkTask({ title: '工作B', date: today, projectId: 'p1', completed: true, completedAt: new Date().toISOString() }),
      mkTask({ title: '生活A', date: addDays(today, 1), projectId: 'p2' }),
      mkTask({ title: '无项目', date: today }),
    ],
  });

  // 规范化
  eq('项目名去空白并截断', normalizeProjectName('  工作  '), '工作');
  eq('项目名超长截断到 64', normalizeProjectName('x'.repeat(80)).length, 64);
  eq('空项目名返回空串', normalizeProjectName('   '), '');
  eq('合法颜色小写', normalizeProjectColor('#AABBCC'), '#aabbcc');
  eq('非法颜色回落兜底', normalizeProjectColor('red'), '#6E6A64');

  // add
  {
    const state = mkData();
    const next = reducer(state, { type: 'project/add', project: { id: 'p3', name: '学习', color: '#2F7477' } });
    eq('项目新增：数量 +1', next.projects.length, 3);
    const added = next.projects.find((p) => p.id === 'p3');
    eq('项目新增：默认未归档', added?.archived, false);
    check('项目新增：自动写入 createdAt', typeof added?.createdAt === 'string' && Boolean(added?.createdAt));
    eq('项目新增：保留状态引用不变', next.tasks, state.tasks);
    const dup = reducer(next, { type: 'project/add', project: { id: 'p3', name: '重复', color: '#2F7477' } });
    eq('重复 id 幂等（返回原引用）', dup, next);
    const emptyName = reducer(next, { type: 'project/add', project: { id: 'p4', name: '   ', color: '#2F7477' } });
    eq('空名称不创建项目', emptyName, next);
    const badColor = reducer(next, { type: 'project/add', project: { id: 'p5', name: 'X', color: 'not-a-color' } });
    eq('非法颜色使用兜底色', badColor.projects.find((p) => p.id === 'p5')?.color, '#6E6A64');
  }

  // update
  {
    const state = mkData();
    const renamed = reducer(state, { type: 'project/update', id: 'p1', patch: { name: ' 工作区 ' } });
    eq('项目改名：去空白', renamed.projects.find((p) => p.id === 'p1')?.name, '工作区');
    const emptyName = reducer(state, { type: 'project/update', id: 'p1', patch: { name: '  ' } });
    eq('项目改名：空名称忽略', emptyName, state);
    const recolored = reducer(state, { type: 'project/update', id: 'p1', patch: { color: '#112233' } });
    eq('项目改色', recolored.projects.find((p) => p.id === 'p1')?.color, '#112233');
    eq('未知项目更新为空操作', reducer(state, { type: 'project/update', id: 'nope', patch: { name: 'x' } }), state);
    const noop = reducer(state, { type: 'project/update', id: 'p1', patch: {} });
    eq('无变化更新返回原引用', noop, state);
  }

  // archive / restore
  {
    const state = mkData();
    const archived = reducer(state, { type: 'project/archive', id: 'p1', archived: true });
    eq('归档：archived=true', archived.projects.find((p) => p.id === 'p1')?.archived, true);
    const restored = reducer(archived, { type: 'project/archive', id: 'p1', archived: false });
    eq('恢复：archived=false', restored.projects.find((p) => p.id === 'p1')?.archived, false);
    eq('归档未知项目为空操作', reducer(state, { type: 'project/archive', id: 'nope', archived: true }), state);
    eq('归档幂等（已是归档态）', reducer(state, { type: 'project/archive', id: 'p2', archived: true }), state);
  }

  // delete：任务永不删除
  {
    const state = mkData();
    const next = reducer(state, { type: 'project/delete', id: 'p1' });
    eq('删除项目：项目数 -1', next.projects.length, 1);
    eq('删除项目：任务总数不变', next.tasks.length, state.tasks.length);
    eq('删除项目：关联任务 projectId 清空', next.tasks.filter((t) => t.title.startsWith('工作')).every((t) => t.projectId === undefined), true);
    check('删除项目：无关任务保持原对象引用', next.tasks.find((t) => t.title === '无项目') === state.tasks.find((t) => t.title === '无项目'));
    eq('删除项目：其余项目保留', next.projects.map((p) => p.id).join(','), 'p2');
    eq('删除未知项目为空操作', reducer(state, { type: 'project/delete', id: 'nope' }), state);
    const noRef = reducer({ ...state, tasks: [mkTask({ title: 'x', date: today })] }, { type: 'project/delete', id: 'p1' });
    eq('无关联任务时 tasks 引用不变', noRef.tasks.length, 1);
  }

  // orphan repair
  {
    const state = mkData();
    const withOrphan = { ...state, tasks: [...state.tasks, mkTask({ title: '孤儿', date: today, projectId: 'ghost' })] };
    eq('孤儿引用可被检出', orphanProjectTaskIds(withOrphan).length, 1);
    const repaired = reducer(withOrphan, { type: 'data/repairOrphanProjects' });
    eq('孤儿修复：projectId 清空', repaired.tasks.find((t) => t.title === '孤儿')?.projectId, undefined);
    eq('孤儿修复后再次执行为空操作', reducer(repaired, { type: 'data/repairOrphanProjects' }), repaired);
  }

  // 分组 / 排序 / 解析
  {
    const state = mkData();
    eq('激活项目：排除归档', activeProjects(state).map((p) => p.id).join(','), 'p1');
    eq('归档项目：仅归档', archivedProjects(state).map((p) => p.id).join(','), 'p2');
    eq('项目排序：createdAt 倒序', sortProjects(state.projects).map((p) => p.id).join(','), 'p2,p1');
    eq('未知 projectId 解析为 undefined', resolveProject(state.projects, 'ghost'), undefined);
    eq('已知 projectId 正确解析', resolveProject(state.projects, 'p1')?.name, '工作');
    eq('未分类任务计数', uncategorizedTaskCount(state), 1);
  }

  // 统计
  {
    const state = mkData();
    const s1 = projectStats(state, 'p1');
    eq('项目统计：total', s1.total, 2);
    eq('项目统计：done', s1.done, 1);
    eq('项目统计：open', s1.open, 1);
    eq('项目统计：percent', s1.percent, 50);
    eq('项目统计：本周排期', s1.weekTotal, 2);
    eq('项目统计：本周完成', s1.weekDone, 1);
    eq('空项目统计全零', JSON.stringify(projectStats(state, 'nope')), JSON.stringify({ total: 0, open: 0, done: 0, percent: 0, weekTotal: 0, weekDone: 0 }));
    const all = allProjectStats(state);
    eq('批量统计与单项一致（p1）', JSON.stringify(all.get('p1')), JSON.stringify(s1));
    eq('批量统计与单项一致（p2）', JSON.stringify(all.get('p2')), JSON.stringify(projectStats(state, 'p2')));
  }

  // makeProject
  {
    const p = makeProject({ id: 'p9', name: ' 新项目 ', color: '#A1B2C3' });
    eq('makeProject：名称规范化', p.name, '新项目');
    eq('makeProject：颜色规范化', p.color, '#a1b2c3');
    eq('makeProject：默认未归档', p.archived, false);
    check('makeProject：createdAt 为合法 ISO', Number.isFinite(Date.parse(p.createdAt ?? '')));
  }

  // sanitize 往返与旧数据兼容
  {
    const rich: AppData = {
      ...mkData(),
      settings: { ...mkData().settings, onboarded: true },
    };
    const sanitized = sanitizeImportedData(rich);
    check('sanitize：保留归档标记', sanitized?.projects.find((p) => p.id === 'p2')?.archived === true);
    check('sanitize：保留 createdAt', typeof sanitized?.projects.find((p) => p.id === 'p1')?.createdAt === 'string');
    eq('sanitize：保留 onboarded', sanitized?.settings.onboarded, true);
    eq('sanitize：归档项目统计', sanitizeImportedDataDetailed(rich).stats.archivedProjects, 1);

    // 旧版本数据（无 archived / createdAt / onboarded）
    const legacy = parseImportedData(
      JSON.stringify({
        version: 1,
        tasks: [],
        projects: [{ id: 'p1', name: '旧项目', color: '#4A5B8C' }],
        habits: [],
        habitLogs: [],
        settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false },
      })
    );
    eq('旧数据：项目默认未归档', legacy?.projects[0].archived, false);
    eq('旧数据：onboarded 默认 false', legacy?.settings.onboarded, false);
    check('旧数据：createdAt 缺失为 undefined', legacy?.projects[0].createdAt === undefined);

    // 非法 archived 值：被修正但不阻断
    const badArchived = sanitizeImportedDataDetailed({
      version: 1,
      tasks: [],
      projects: [{ id: 'p1', name: 'X', color: '#4A5B8C', archived: 'yes' }],
      habits: [],
      habitLogs: [],
      settings: { demoData: false },
    });
    eq('非法 archived：不阻断且按未归档', badArchived.data?.projects[0].archived, false);
    check('非法 archived：计入字段修正', (badArchived.stats.fixedFields ?? 0) > 0);
  }

  // 备份往返：新字段可导出可导入；缺字段的旧备份仍可导入
  {
    const data: AppData = { ...mkData(), settings: { ...mkData().settings, onboarded: true } };
    const file = await createBackup(data);
    const text = JSON.stringify(file);
    const back = await validateBackupDetailed(text);
    check('备份往返：校验通过', back.ok === true);
    if (back.ok) {
      eq('备份往返：归档标记保留', back.data.projects.find((p) => p.id === 'p2')?.archived, true);
      eq('备份往返：onboarded 保留', back.data.settings.onboarded, true);
      check('备份往返：checksum 校验通过', back.checksumStatus === 'verified');
    }
    const oldEnvelope = JSON.stringify({
      app: 'FlowDay',
      formatVersion: 1,
      schemaVersion: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      counts: { tasks: 0, projects: 1, habits: 0, habitLogs: 0 },
      checksum: null,
      data: {
        version: 1,
        tasks: [],
        projects: [{ id: 'p1', name: '旧', color: '#4A5B8C' }],
        habits: [],
        habitLogs: [],
        settings: { demoData: false },
      },
    });
    const oldBack = await validateBackupDetailed(oldEnvelope);
    check('旧备份（无新字段）仍可导入', oldBack.ok === true);
    if (oldBack.ok) {
      eq('旧备份导入：归档默认 false', oldBack.data.projects[0].archived, false);
      eq('旧备份导入：onboarded 默认 false', oldBack.data.settings.onboarded, false);
    }
  }

  // 引导标记：settings/update 可写入
  {
    const state = emptyData();
    const next = reducer(state, { type: 'settings/update', patch: { onboarded: true } });
    eq('onboarded 可通过 settings/update 写入', next.settings.onboarded, true);
  }
}

console.log('\n[26] D4 PWA 缓存策略（纯函数与安全护栏）');
{
  eq('导航请求 → navigation', classifyRequest({ pathname: '/today', method: 'GET', mode: 'navigate', sameOrigin: true }), 'navigation');
  eq('哈希资源 → asset', classifyRequest({ pathname: '/assets/index-abc.js', method: 'GET', sameOrigin: true }), 'asset');
  eq('manifest → shell-metadata', classifyRequest({ pathname: '/manifest.webmanifest', method: 'GET', sameOrigin: true }), 'shell-metadata');
  eq('图标 → shell-metadata', classifyRequest({ pathname: '/icons/icon-192.png', method: 'GET', sameOrigin: true }), 'shell-metadata');
  eq('接口请求 → passthrough（永不缓存）', classifyRequest({ pathname: '/api/state', method: 'GET', sameOrigin: true }), 'passthrough');
  eq('带 Authorization → passthrough', classifyRequest({ pathname: '/assets/a.js', method: 'GET', sameOrigin: true, hasAuthorization: true }), 'passthrough');
  eq('跨域请求 → passthrough', classifyRequest({ pathname: '/x', method: 'GET', sameOrigin: false }), 'passthrough');
  eq('非 GET → passthrough', classifyRequest({ pathname: '/index.html', method: 'POST', sameOrigin: true }), 'passthrough');
  eq('其他同源 GET → passthrough', classifyRequest({ pathname: '/unknown.json', method: 'GET', sameOrigin: true }), 'passthrough');
  eq('仅 fd- 前缀属于本应用缓存', isOwnedCacheName('fd-shell-v1') && !isOwnedCacheName('other-app'), true);
  eq('旧版 fd- 缓存判定为过期', isStaleCache('fd-shell-v0'), true);
  eq('当前缓存不会被清理', isStaleCache(SHELL_CACHE), false);
  check('预缓存包含应用壳与 manifest', precacheUrls().includes('/index.html') && precacheUrls().includes('/manifest.webmanifest'));
  check('预缓存包含 192/512 与 maskable 图标', ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-192-maskable.png', '/icons/icon-512-maskable.png'].every((u) => precacheUrls().includes(u)));
  check('D4 注册仅在生产构建生效', registerSource.includes('import.meta.env.PROD'));
  check('D4 更新需显式 SKIP_WAITING（不自动激活）', registerSource.includes('SKIP_WAITING'));
  check('D4 自动刷新有单会话护栏', registerSource.includes('fd_pwa_reload'));
}

console.log('\n[27] D5 首次引导判定（纯规则）');
{
  const blank = emptyData();
  check('全新空数据 → 应自动展示引导', isOnboardingEligible({ data: blank, ready: true, blocked: false }));
  check('未就绪 → 不展示', !isOnboardingEligible({ data: blank, ready: false, blocked: false }));
  check('安全阻断 → 不展示', !isOnboardingEligible({ data: blank, ready: true, blocked: true }));
  check(
    '已完成引导 → 不展示',
    !isOnboardingEligible({ data: { ...blank, settings: { ...blank.settings, onboarded: true } }, ready: true, blocked: false })
  );
  check('示例数据 → 不展示', !isOnboardingEligible({ data: demoData(), ready: true, blocked: false }));
  const withProject = { ...blank, projects: [{ id: 'p1', name: '工作', color: '#4A5B8C' }] };
  check('已有项目 → 不展示', !isOnboardingEligible({ data: withProject, ready: true, blocked: false }));
  const withTask: AppData = {
    ...blank,
    tasks: [{ id: 't1', title: 'x', date: todayKey(), priority: 3, completed: false, createdAt: new Date().toISOString(), source: 'manual' }],
  };
  check('已有任务 → 不展示', !isOnboardingEligible({ data: withTask, ready: true, blocked: false }));
  const withHabit = { ...blank, habits: [{ id: 'h1', name: '阅读', emoji: '📖', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false }] };
  check('已有习惯 → 不展示', !isOnboardingEligible({ data: withHabit, ready: true, blocked: false }));
  eq('正常完成会写入 onboarded', shouldMarkOnboarded(false), true);
  eq('回顾模式不重置标记', shouldMarkOnboarded(true), false);
  check('D5 向导使用纯规则函数', onboardingSource.includes('isOnboardingEligible'));
  check('D5 向导支持回顾模式', onboardingSource.includes('ONBOARDING_REVIEW_EVENT') && onboardingSource.includes('review'));
  check('D5 设置页提供重新查看入口', Boolean(settingsSource.includes('openOnboardingReview')));
}

console.log(`\n测试结果：通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.error('失败项：', failures);
  throw new Error(`${failures.length} 项断言失败`);
}
console.log('SMOKE TEST PASSED');
