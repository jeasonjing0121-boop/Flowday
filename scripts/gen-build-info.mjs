// 生成 src/lib/buildInfo.ts（Beta 版本信息：版本号 / Git commit / 构建日期）
// 用法：node scripts/gen-build-info.mjs
// 该文件会被提交进 Git（仅含版本元信息，不含任何凭据或个人路径）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'src', 'lib', 'buildInfo.ts');

const versionName = process.env.FLOWDAY_VERSION_NAME || '5.0-a-beta.1';
const versionCode = Number(process.env.FLOWDAY_VERSION_CODE || 1);

let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  /* 无 git 环境时保持 unknown */
}

const builtAt = new Date().toISOString();
const channel = process.env.FLOWDAY_CHANNEL || 'beta';

const content = `/**
 * 构建元信息（由 scripts/gen-build-info.mjs 生成，勿手工编辑）。
 * 仅包含版本标识，不含凭据、密钥或个人路径。
 */
export const BUILD_INFO = {
  /** 渠道标识：beta / release */
  channel: ${JSON.stringify(channel)},
  /** 语义化版本号（与 Android versionName 一致） */
  versionName: ${JSON.stringify(versionName)},
  /** Android versionCode */
  versionCode: ${versionCode},
  /** 构建时的 Git commit SHA */
  commit: ${JSON.stringify(commit)},
  /** 构建时间（UTC ISO） */
  builtAt: ${JSON.stringify(builtAt)},
  /** 是否为测试版本（界面展示用） */
  isBeta: ${channel === 'beta'},
} as const;
`;

fs.writeFileSync(OUT, content, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)} (versionName=${versionName}, commit=${commit.slice(0, 7)}, channel=${channel})`);
