import { truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { basename } from "path";
import { PLAN_PROGRESS_SPINNER_MS, type PlanProgressTracker } from "./plan-progress.js";
import type { MilestoneTracker } from "./milestone-tracker.js";
import type { FooterPresetName } from "./ui-settings.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface GitStats {
  ahead: number;
  behind: number;
  dirty: number;
  untracked: number;
}

export interface ModelInfo {
  name: string;
  isLatest: boolean;
}

export interface FooterContext {
  cwd: string;
  getModelName: () => string | undefined;
  getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  getGitStats: () => GitStats | undefined;
  getThinkingLevel: () => "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
  getModelInfo: () => ModelInfo | undefined;
}

export interface CacheStats {
  totalInput: number;
  totalCacheRead: number;
}

export interface ActiveTools {
  running: Map<string, string>;
}

type FooterSegmentId = "logo" | "path" | "git" | "model" | "thinking" | "context" | "statuses" | "tools" | "cache";

type FooterSegmentColor = ThemeColor | "path" | "model" | "separator";

type FooterSegment = {
  id: FooterSegmentId;
  text: string;
  icon: string;
  color: FooterSegmentColor;
  priority: number;
};

type FooterPresetDefinition = {
  lines: FooterSegmentId[][];
};

export interface FooterOptions {
  preset?: FooterPresetName;
}

// ═══════════════════════════════════════════════════════════════════════════
// Nerd Font Icons
// ═══════════════════════════════════════════════════════════════════════════

const ICONS = { folder: "", branch: "", model: "󰚩", context: "󰍛", cache: "󰆼", tool: "󰒓", status: "󰄬" } as const;
const ICONS_PLAIN = { folder: "📁", branch: "⎇", model: "◆", context: "◈", cache: "⊡", tool: "▶", status: "●" } as const;

let useNerdIcons = true;
function getIcons() { return useNerdIcons ? ICONS : ICONS_PLAIN; }

// ═══════════════════════════════════════════════════════════════════════════
// Powerline separator (theme-based, works on any background)
// ═══════════════════════════════════════════════════════════════════════════

// U+E0B0 Powerline right arrow
const SEP_POWERLINE = "";

// ═══════════════════════════════════════════════════════════════════════════
// Presets
// ═══════════════════════════════════════════════════════════════════════════

const FOOTER_PRESET_DEFINITIONS: Record<FooterPresetName, FooterPresetDefinition> = {
  default:  { lines: [["path", "git", "model"], ["context", "statuses", "tools", "cache"]] },
  compact:  { lines: [["path", "git", "model", "context", "statuses"]] },
  minimal:  { lines: [["path", "git", "statuses"]] },
};

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function progressBar(percent: number, barWidth: number, theme: Theme): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = barWidth - filled;

  let color: ThemeColor;
  if (clamped < 60) color = "success";
  else if (clamped < 85) color = "warning";
  else color = "error";

  const bar = theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
  const label = theme.fg(color, `${Math.round(clamped)}%`);
  return `${bar} ${label}`;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  return truncateToWidth(text, width, "");
}

const POWERLINE_COLORS = {
  path: "\x1b[38;2;0;175;175m",
  model: "\x1b[38;2;215;135;175m",
  separator: "\x1b[38;5;244m",
} as const;

function getSegmentFgAnsi(color: FooterSegmentColor, theme: Theme): string {
  if (color === "path" || color === "model" || color === "separator") {
    return POWERLINE_COLORS[color];
  }
  return typeof theme.getFgAnsi === "function" ? theme.getFgAnsi(color) : "";
}

function colorSegmentText(color: FooterSegmentColor, text: string, theme: Theme): string {
  return `${getSegmentFgAnsi(color, theme)}${text}\x1b[39m`;
}

function getExtensionStatusText(statuses: ReadonlyMap<string, string>): string | null {
  const parts = [...statuses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v.trim())
    .filter((v) => visibleWidth(v) > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Render a line of segments with Powerline separators.
 * Uses the original-style foreground palette; no background blocks.
 *
 * Visual: [teal project][green main][mauve model]
 */
function renderPowerlineLine(segments: FooterSegment[], width: number, theme: Theme): string {
  if (width <= 0 || segments.length === 0) return "";

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const icon = seg.icon ? `${seg.icon} ` : "";
    parts.push(colorSegmentText(seg.color, ` ${icon}${seg.text}`, theme));

    if (i < segments.length - 1) {
      parts.push(colorSegmentText("separator", SEP_POWERLINE, theme));
    }
  }

  return fitLine(parts.join(""), width);
}

// ═══════════════════════════════════════════════════════════════════════════
// RoachFooter
// ═══════════════════════════════════════════════════════════════════════════

export class RoachFooter implements Component {
  private theme: Theme;
  private footerData: ReadonlyFooterDataProvider;
  private footerCtx: FooterContext;
  private cacheStats: CacheStats;
  private activeTools: ActiveTools;
  private planProgress: PlanProgressTracker | null;
  private tui: Pick<TUI, "requestRender"> | null;
  private milestoneTracker: MilestoneTracker | null;
  private preset: FooterPresetName;
  private unsubscribePlanProgress: (() => void) | null = null;
  private unsubscribeMilestone: (() => void) | null = null;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    theme: Theme,
    footerData: ReadonlyFooterDataProvider,
    footerCtx: FooterContext,
    cacheStats: CacheStats,
    activeTools: ActiveTools,
    planProgress: PlanProgressTracker | null = null,
    tui: Pick<TUI, "requestRender"> | null = null,
    milestoneTracker: MilestoneTracker | null = null,
    options: FooterOptions = {},
  ) {
    this.theme = theme;
    this.footerData = footerData;
    this.footerCtx = footerCtx;
    this.cacheStats = cacheStats;
    this.activeTools = activeTools;
    this.planProgress = planProgress;
    this.milestoneTracker = milestoneTracker;
    this.preset = options.preset ?? "default";
    this.tui = tui;
    this.unsubscribePlanProgress = this.planProgress?.subscribeOnChange(() => this.schedulePlanRender()) ?? null;
    this.unsubscribeMilestone = this.milestoneTracker?.subscribeOnChange(() => this.schedulePlanRender()) ?? null;
    this.updateSpinnerTimer();
  }

  invalidate() { this.schedulePlanRender(); }

  dispose() {
    if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = null; }
    this.unsubscribePlanProgress?.(); this.unsubscribePlanProgress = null;
    this.unsubscribeMilestone?.(); this.unsubscribeMilestone = null;
  }

  private schedulePlanRender() {
    this.updateSpinnerTimer();
    this.tui?.requestRender();
  }

  private updateSpinnerTimer() {
    const has = (this.planProgress?.getProgress().running ?? 0) > 0;
    if (has && !this.spinnerTimer) {
      this.spinnerTimer = setInterval(() => {
        if ((this.planProgress?.getProgress().running ?? 0) === 0) { this.updateSpinnerTimer(); return; }
        this.tui?.requestRender();
      }, PLAN_PROGRESS_SPINNER_MS);
    } else if (!has && this.spinnerTimer) {
      clearInterval(this.spinnerTimer); this.spinnerTimer = null;
    }
  }

  render(width: number): string[] {
    this.updateSpinnerTimer();
    const normalLines = this.renderNormalFooter(width);
    const border = normalLines[0];

    const hasMilestones = this.milestoneTracker?.hasMilestones() ?? false;
    const hasPlan = this.planProgress?.hasPlan() ?? false;

    if (hasMilestones || hasPlan) {
      const lines: string[] = [border];
      const pw = Math.max(0, width - 4);
      if (this.milestoneTracker && hasMilestones) {
        lines.push(...this.milestoneTracker.render(this.theme, pw).map((l) => fitLine(l, width)));
        if (hasPlan) lines.push(fitLine(this.theme.fg("dim", "  ·"), width));
      }
      if (this.planProgress && hasPlan) {
        lines.push(...this.planProgress.render(this.theme, pw).map((l) => fitLine(l, width)));
      }
      lines.push(...normalLines);
      return lines;
    }
    return normalLines;
  }

  private renderNormalFooter(width: number): string[] {
    const t = this.theme;
    const border = t.fg("dim", "─".repeat(Math.max(0, width)));
    const segments = this.buildSegments();
    const preset = FOOTER_PRESET_DEFINITIONS[this.preset] ?? FOOTER_PRESET_DEFINITIONS.default;
    const renderedLines = preset.lines.map((line) => renderPowerlineLine(this.pickSegments(line, segments), width, t));
    return [border, ...renderedLines];
  }

  private pickSegments(ids: FooterSegmentId[], segments: Map<FooterSegmentId, FooterSegment>): FooterSegment[] {
    return ids.map((id) => segments.get(id)).filter((s): s is FooterSegment => !!s);
  }

  private buildSegments(): Map<FooterSegmentId, FooterSegment> {
    const t = this.theme;
    const icons = getIcons();
    const dirName = basename(this.footerCtx.cwd) || this.footerCtx.cwd;
    const branch = this.footerData.getGitBranch();
    const modelName = this.footerCtx.getModelName() ?? "no model";
    const usage = this.footerCtx.getContextUsage();

    const pct = usage?.percent ?? 0;
    const tokens = usage?.tokens ?? 0;
    const ctxK = usage ? Math.round(usage.contextWindow / 1000) : 0;
    const tokK = Math.round(tokens / 1000);
    const bar = progressBar(pct, 15, t);
    const ctxPart = `${t.fg("dim", "ctx")} ${bar} ${t.fg("dim", `${tokK}k/${ctxK}k`)}`;

    const totalTokens = this.cacheStats.totalInput + this.cacheStats.totalCacheRead;
    const cacheRate = totalTokens > 0 ? Math.round((this.cacheStats.totalCacheRead / totalTokens) * 100) : 0;
    let cacheColor: ThemeColor;
    if (cacheRate >= 50) cacheColor = "success";
    else if (cacheRate >= 20) cacheColor = "warning";
    else cacheColor = "dim";

    const segs = new Map<FooterSegmentId, FooterSegment>();

    segs.set("path", { id: "path", text: dirName, icon: icons.folder, color: "path", priority: 0 });
    if (branch && branch !== "detached") {
      segs.set("git", { id: "git", text: branch, icon: icons.branch, color: "success", priority: 1 });
    }
    segs.set("model", { id: "model", text: modelName, icon: icons.model, color: "model", priority: 2 });
    segs.set("context", { id: "context", text: ctxPart, icon: icons.context, color: "dim", priority: 0 });
    segs.set("cache", { id: "cache", text: `cache ${cacheRate}%`, icon: icons.cache, color: cacheColor, priority: 5 });

    const statuses = this.footerData.getExtensionStatuses?.() ?? new Map<string, string>();
    const statusText = getExtensionStatusText(statuses);
    if (statusText) {
      segs.set("statuses", { id: "statuses", text: statusText, icon: icons.status, color: "warning", priority: 1 });
    }

    if (this.activeTools.running.size > 0) {
      const names = [...new Set(this.activeTools.running.values())];
      const count = this.activeTools.running.size;
      segs.set("tools", { id: "tools", text: `${count} ${names.join(",")}`, icon: icons.tool, color: "accent", priority: 4 });
    }

    return segs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test exports
// ═══════════════════════════════════════════════════════════════════════════

export function setUseNerdIcons(value: boolean): void { useNerdIcons = value; }
export { ICONS, ICONS_PLAIN };
