import type { ImportStats } from './backup';

/**
 * 导入新鲜度检查（纯函数）：
 * - 版本未变化 → 不过期
 * - 版本变化但写入者是本页自己（writerId 相同）→ 不过期（自身保存推进版本不构成冲突）
 * - 版本变化且写入者不同/未知 → 过期，禁止用旧预览覆盖
 */
export function isPreviewStale(
  previewBaseRevision: number,
  currentRevision: number,
  currentWriterId: string | null | undefined = null,
  myWriterId: string | null | undefined = null
): boolean {
  if (currentRevision === previewBaseRevision) return false;
  if (currentWriterId && myWriterId && currentWriterId === myWriterId) return false;
  return true;
}

/** 把数据清洗统计转成可见的中文摘要行（不静默修正）。 */
export function summarizeSanitize(stats: ImportStats): string[] {
  const lines: string[] = [];
  const dup = stats.duplicatesRemoved;
  const dupParts: string[] = [];
  if (dup.tasks) dupParts.push(`${dup.tasks} 条重复任务`);
  if (dup.projects) dupParts.push(`${dup.projects} 个重复项目`);
  if (dup.habits) dupParts.push(`${dup.habits} 个重复习惯`);
  if (dup.habitLogs) dupParts.push(`${dup.habitLogs} 条重复打卡`);
  if (dupParts.length) lines.push(`去重：丢弃 ${dupParts.join('、')}（保留首次出现）`);
  if (stats.droppedInvalid) lines.push(`无效记录：丢弃 ${stats.droppedInvalid} 条（缺少必要字段或格式错误）`);
  if (stats.brokenProjectRefs) lines.push(`项目引用：${stats.brokenProjectRefs} 条任务的项目不存在，已置为未分类`);
  if (stats.fixedFields) lines.push(`字段修正：${stats.fixedFields} 处（日期/时间/优先级/时长/备注/设置等）`);
  return lines;
}

/** 清洗是否产生过任何修正（用于预览高亮）。 */
export function hasSanitizeChanges(stats: ImportStats): boolean {
  const dup = stats.duplicatesRemoved;
  return (
    dup.tasks > 0 ||
    dup.projects > 0 ||
    dup.habits > 0 ||
    dup.habitLogs > 0 ||
    stats.droppedInvalid > 0 ||
    stats.brokenProjectRefs > 0 ||
    stats.fixedFields > 0
  );
}
