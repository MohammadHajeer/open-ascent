import assert from "node:assert/strict";
import test from "node:test";

import { LiveCoachAnalyzer } from "./live-analyzer.ts";
import { drawPose } from "./utils/pose-canvas.ts";

// The skeleton overlay is a deliberately small, movement-relevant subset of
// the pose. It is drawn from the same full 33-point array the analyzer reads,
// so leaving the legs out of the drawing never hides them from analysis.

function fakeCanvas() {
  const points = [];
  const context = {
    clearRect() {}, beginPath() {}, stroke() {}, fill() {},
    moveTo(x, y) { points.push([x, y]); },
    lineTo(x, y) { points.push([x, y]); },
    arc(x, y) { points.push([x, y]); },
  };
  return { canvas: { width: 0, height: 0, getContext: () => context }, points };
}

// Every landmark at a distinct, visible position.
const pose = Array.from({ length: 33 }, (_, index) => ({ x: (index + 1) / 40, y: (index + 1) / 50, visibility: 0.99 }));

test("the overlay draws shoulders, arms and hips only, in video pixels", () => {
  const { canvas, points } = fakeCanvas();
  drawPose(canvas, { videoWidth: 720, videoHeight: 1280 }, pose);
  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 1280);
  const drawn = new Set(points.map(([x, y]) => pose.findIndex((p) => p.x * 720 === x && p.y * 1280 === y)));
  assert.deepEqual([...drawn].sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 23, 24]);
});

test("Push-Up still reads the ankle the overlay does not draw", () => {
  const plank = (ankleY) => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 0 }));
    const side = { 11: [0.2, 0.35], 13: [0.2, 0.55], 15: [0.22, 0.75], 23: [0.5, 0.4], 27: [0.85, ankleY] };
    for (const [index, [x, y]] of Object.entries(side)) {
      landmarks[index] = { x, y, visibility: 0.99, presence: 0.99 };
    }
    return landmarks;
  };
  const analyzer = new LiveCoachAnalyzer();
  analyzer.selectMovement("push-up");
  const straight = analyzer.update(plank(0.45), 0, 16 / 9).snapshot.observation;
  const piked = analyzer.update(plank(0.7), 100, 16 / 9).snapshot.observation;
  assert.ok(straight && piked);
  assert.ok(straight.bodyAngleDeg - piked.bodyAngleDeg > 10, "moving only the ankle changes the body line");
  const noAnkle = plank(0.45);
  noAnkle[27] = { ...noAnkle[27], visibility: 0.2, presence: 0.2 };
  assert.equal(analyzer.update(noAnkle, 200, 16 / 9).snapshot.observation, null, "the ankle is required");
});
