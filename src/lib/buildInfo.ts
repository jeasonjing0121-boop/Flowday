/**
 * 构建元信息（由 scripts/gen-build-info.mjs 生成，勿手工编辑）。
 * 仅包含版本标识，不含凭据、密钥或个人路径。
 */
export const BUILD_INFO = {
  /** 渠道标识：beta / release */
  channel: "beta",
  /** 语义化版本号（与 Android versionName 一致） */
  versionName: "5.0-a-beta.2",
  /** Android versionCode */
  versionCode: 2,
  /** 构建时的 Git commit SHA */
  commit: "26d059e65e582f1e4f8a74c0dbd85b8888e3cb82",
  /** 构建时间（UTC ISO） */
  builtAt: "2026-11-18T05:38:44.112Z",
  /** 是否为测试版本（界面展示用） */
  isBeta: true,
} as const;
