const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, Math, Number, String, Array, Object, Set, Map, JSON });

for (const file of ["web/scripts/config.js", "web/scripts/feedback.js", "web/scripts/session-pose.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

vm.runInContext("var state = { punchLock: null };", context);
const classify = vm.runInContext("(current, previous) => classifySingleCameraPunch(current, previous)", context);

function sample(overrides = {}) {
  return {
    leftExtension: 42,
    rightExtension: 42,
    leftDepth: 0,
    rightDepth: 0,
    activePunchSide: "",
    leftX: 0.42,
    rightX: 0.58,
    leftY: 0.44,
    rightY: 0.44,
    noseY: 0.25,
    shoulderY: 0.40,
    shoulderCenterX: 0.50,
    leftReliability: 0.92,
    rightReliability: 0.92,
    bodyReliability: 0.92,
    leftStraightness: 58,
    rightStraightness: 58,
    trackable: true,
    ...overrides,
  };
}

function classifyFresh(current, previous, expected) {
  vm.runInContext("state.punchLock = null;", context);
  const result = classify(current, previous);
  assert(result, `expected ${expected}, got no punch`);
  assert.strictEqual(result.type, expected);
}

classifyFresh(
  sample({ leftExtension: 78, leftX: 0.46, leftY: 0.40, leftStraightness: 94 }),
  sample({ leftExtension: 44, leftX: 0.43, leftY: 0.41, leftStraightness: 64 }),
  "jab",
);

classifyFresh(
  sample({ leftExtension: 58, leftX: 0.56, leftY: 0.41, leftStraightness: 48 }),
  sample({ leftExtension: 47, leftX: 0.43, leftY: 0.42, leftStraightness: 54 }),
  "hook",
);

classifyFresh(
  sample({ leftExtension: 55, leftX: 0.44, leftY: 0.32, leftStraightness: 58 }),
  sample({ leftExtension: 44, leftX: 0.43, leftY: 0.46, leftStraightness: 52 }),
  "upper",
);

console.log("motion classifier smoke tests passed");
