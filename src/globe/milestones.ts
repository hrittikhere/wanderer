// Milestone callout scheduling. Milestones queue up as the globe turns their
// location toward the viewer and are shown one at a time with an adaptive
// dwell: the closer to center a milestone is when it activates, the longer it
// stays. Interaction (dragging) pauses the queue for a short cooldown. The
// tracker is frame driven and takes its clock from the caller, so it never
// reads the clock itself and needs no timers.
import type { PositionedMilestone } from './renderer-types.js';
import { THETA, clamp, projectMarker } from './projection.js';

export const MILESTONE_QUEUE_START_DELAY_MS = 2200;
export const MILESTONE_ENTER_THRESHOLD = 0.68;
export const MILESTONE_EXIT_THRESHOLD = 0.52;
export const MILESTONE_MIN_DWELL_MS = 2600;
export const MILESTONE_MAX_DWELL_MS = 5200;
export const MILESTONE_DEPTH_DWELL_BONUS_MS = 2200;
export const MILESTONE_INTERACTION_COOLDOWN_MS = 1200;
/** A milestone is queued once it reaches this share of the depth it can attain. */
const MILESTONE_ENTER_RATIO = 0.95;
/** Below this attainable depth a location never turns toward the viewer enough to call out. */
const MILESTONE_MIN_ATTAINABLE_DEPTH = 0.1;

export interface MilestoneThresholds {
  enter: number;
  exit: number;
}

/**
 * Enter and exit depths for a milestone at the given latitude. Over a full
 * rotation a point reaches at most cos(lat - THETA) toward the viewer, which
 * with the camera tilt falls below the fixed enter threshold outside roughly
 * -30..64 degrees, so the thresholds scale down to what the milestone can
 * attain. Null when the location never faces the viewer.
 */
export function milestoneThresholds(latitude: number): MilestoneThresholds | null {
  const maxDepth = Math.cos((latitude * Math.PI) / 180 - THETA);
  if (!(maxDepth > MILESTONE_MIN_ATTAINABLE_DEPTH)) return null;
  const enter = Math.min(MILESTONE_ENTER_THRESHOLD, maxDepth * MILESTONE_ENTER_RATIO);
  return { enter, exit: enter - (MILESTONE_ENTER_THRESHOLD - MILESTONE_EXIT_THRESHOLD) };
}

export interface MilestoneUpdate {
  phi: number;
  now: number;
  /** When the scene became ready for callouts; the queue starts after a delay. */
  sceneReadyAt: number | null;
  interacting: boolean;
  lastInteractionAt: number;
}

export interface MilestoneChange {
  activated?: string;
  dismissed?: string;
}

export class MilestoneTracker {
  private milestones: readonly PositionedMilestone[] = [];
  private thresholds = new Map<string, MilestoneThresholds | null>();
  private wasCenter = new Map<string, boolean>();
  private queue: string[] = [];
  private activeId: string | null = null;
  private shownAt = 0;
  private dwellMs = MILESTONE_MIN_DWELL_MS;

  constructor(milestones: readonly PositionedMilestone[]) {
    this.setMilestones(milestones);
  }

  get active(): string | null {
    return this.activeId;
  }

  find(id: string): PositionedMilestone | undefined {
    return this.milestones.find((milestone) => milestone.id === id);
  }

  /** Replaces the milestone set and drops any pending state for removed ids. */
  setMilestones(milestones: readonly PositionedMilestone[]): void {
    this.milestones = milestones;
    this.thresholds = new Map(milestones.map((milestone) => [milestone.id, milestoneThresholds(milestone.coordinates[0])]));
    const ids = new Set(milestones.map((milestone) => milestone.id));
    for (const id of [...this.wasCenter.keys()]) if (!ids.has(id)) this.wasCenter.delete(id);
    this.queue = this.queue.filter((id) => ids.has(id));
    if (this.activeId !== null && !ids.has(this.activeId)) this.activeId = null;
  }

  /** Adopts an externally chosen milestone (or none) as the active one. */
  setActive(id: string | null, now: number): void {
    if (id === this.activeId) return;
    this.activeId = id !== null && this.find(id) ? id : null;
    this.shownAt = now;
    this.dwellMs = MILESTONE_MAX_DWELL_MS;
    if (this.activeId !== null) this.queue = this.queue.filter((queued) => queued !== this.activeId);
  }

  /** Advances the queue for one frame and reports what changed. */
  update({ phi, now, sceneReadyAt, interacting, lastInteractionAt }: MilestoneUpdate): MilestoneChange {
    const change: MilestoneChange = {};
    if (this.milestones.length === 0 || sceneReadyAt === null) return change;
    if (now - sceneReadyAt <= MILESTONE_QUEUE_START_DELAY_MS) return change;
    if (interacting || now - lastInteractionAt < MILESTONE_INTERACTION_COOLDOWN_MS) return change;

    for (const milestone of this.milestones) {
      const thresholds = this.thresholds.get(milestone.id);
      if (!thresholds) continue;
      const depth = projectMarker(milestone.coordinates[0], milestone.coordinates[1], phi).sz;
      const centered = depth > thresholds.enter;
      const wasCenter = this.wasCenter.get(milestone.id) ?? false;
      if (centered && !wasCenter && this.activeId !== milestone.id && !this.queue.includes(milestone.id)) {
        this.queue.push(milestone.id);
      }
      this.wasCenter.set(milestone.id, centered || (wasCenter && depth > thresholds.exit));
    }

    if (this.activeId !== null) {
      const active = this.find(this.activeId);
      const depth = active ? projectMarker(active.coordinates[0], active.coordinates[1], phi).sz : 0;
      const exit = this.thresholds.get(this.activeId)?.exit ?? MILESTONE_EXIT_THRESHOLD;
      const shownFor = now - this.shownAt;
      const timedOut = shownFor >= this.dwellMs;
      const slidAway = shownFor >= MILESTONE_MIN_DWELL_MS && depth < exit;
      if (timedOut || slidAway) {
        change.dismissed = this.activeId;
        this.activeId = null;
        this.shownAt = 0;
      }
    }

    if (this.activeId === null && this.queue.length > 0) {
      const id = this.queue.shift() as string;
      const milestone = this.find(id);
      if (milestone) {
        const depth = projectMarker(milestone.coordinates[0], milestone.coordinates[1], phi).sz;
        const exit = this.thresholds.get(id)?.exit ?? MILESTONE_EXIT_THRESHOLD;
        const normalizedDepth = clamp((depth - exit) / (1 - exit), 0, 1);
        this.dwellMs = clamp(
          MILESTONE_MIN_DWELL_MS + normalizedDepth * MILESTONE_DEPTH_DWELL_BONUS_MS,
          MILESTONE_MIN_DWELL_MS,
          MILESTONE_MAX_DWELL_MS,
        );
        this.activeId = id;
        this.shownAt = now;
        change.activated = id;
      }
    }

    return change;
  }
}
