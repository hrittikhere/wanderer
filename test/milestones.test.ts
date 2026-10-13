import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MILESTONE_ENTER_THRESHOLD, MILESTONE_EXIT_THRESHOLD, MILESTONE_QUEUE_START_DELAY_MS, MilestoneTracker, milestoneThresholds,
} from '../src/globe/milestones.js';
import { THETA } from '../src/globe/projection.js';

const milestone = (id: string, lat: number, lng: number) => ({ id, title: id, coordinates: [lat, lng] as [number, number] });

/** Turns the globe through one full rotation and returns the ids activated along the way. */
function rotateOnce(tracker: MilestoneTracker, options: { startNow?: number } = {}): string[] {
  const activated: string[] = [];
  let now = (options.startNow ?? 0) + MILESTONE_QUEUE_START_DELAY_MS + 1;
  for (let phi = 0; phi <= Math.PI * 2; phi += 0.002) {
    now += 16;
    const change = tracker.update({ phi, now, sceneReadyAt: 0, interacting: false, lastInteractionAt: -10000 });
    if (change.activated) activated.push(change.activated);
  }
  return activated;
}

describe('milestoneThresholds', () => {
  test('keeps the fixed thresholds inside the band the camera tilt can reach', () => {
    assert.deepEqual(milestoneThresholds(37.58), { enter: MILESTONE_ENTER_THRESHOLD, exit: MILESTONE_EXIT_THRESHOLD });
    assert.deepEqual(milestoneThresholds(0), { enter: MILESTONE_ENTER_THRESHOLD, exit: MILESTONE_EXIT_THRESHOLD });
  });

  test('scales the thresholds down to what a far-south or far-north location can attain', () => {
    for (const lat of [-33.87, -41.29, 69.65, 78.22]) {
      const thresholds = milestoneThresholds(lat)!;
      const maxDepth = Math.cos((lat * Math.PI) / 180 - THETA);
      assert.ok(thresholds, `${lat} has thresholds`);
      assert.ok(thresholds.enter < MILESTONE_ENTER_THRESHOLD && thresholds.enter < maxDepth, `${lat}: enter ${thresholds.enter} is attainable`);
      assert.ok(thresholds.exit < thresholds.enter, `${lat}: exit below enter`);
      assert.ok(thresholds.enter - thresholds.exit > 0.1, `${lat}: hysteresis is kept`);
    }
  });

  test('a location that never faces the viewer has no thresholds', () => {
    assert.equal(milestoneThresholds(-90), null);
    assert.equal(milestoneThresholds(-80), null);
  });
});

describe('MilestoneTracker', () => {
  test('activates milestones in the southern hemisphere and the far north as the globe turns', () => {
    for (const [id, lat, lng] of [['sydney', -33.87, 151.21], ['cape-town', -33.92, 18.42], ['auckland', -36.85, 174.76], ['tromso', 69.65, 18.96]] as const) {
      const tracker = new MilestoneTracker([milestone(id, lat, lng)]);
      assert.deepEqual(rotateOnce(tracker), [id], `${id} activates once per rotation`);
    }
  });

  test('still activates and dismisses a mid-latitude milestone on the fixed thresholds', () => {
    const tracker = new MilestoneTracker([milestone('seoul', 37.58, 126.977)]);
    assert.deepEqual(rotateOnce(tracker), ['seoul']);
    assert.equal(tracker.active, null, 'dismissed after sliding away or timing out');
  });

  test('a south-polar milestone never activates and never blocks the others', () => {
    const tracker = new MilestoneTracker([milestone('pole', -90, 0), milestone('sydney', -33.87, 151.21)]);
    assert.deepEqual(rotateOnce(tracker), ['sydney']);
  });
});
