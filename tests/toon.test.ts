import assert from "node:assert/strict";
import { test } from "node:test";
import { deepEqual, fromToon, toToon } from "../src/toon.js";

const roundtrip = (v: unknown) => {
  const t = toToon(v);
  assert.ok(deepEqual(fromToon(t), JSON.parse(JSON.stringify(v))), `roundtrip failed for:\n${t}`);
  return t;
};

test("uniform arrays become tables", () => {
  const t = roundtrip({ users: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob" }] });
  assert.equal(t, "users[2]{id,name}:\n  1,Ada\n  2,Bob");
});

test("primitive arrays are inline", () => {
  assert.equal(roundtrip({ tags: ["a", "b", "c"] }), "tags[3]: a,b,c");
});

test("tricky strings survive", () => {
  roundtrip({
    a: "", b: " lead", c: "trail ", d: "true", e: "null", f: "123", g: "007", h: "-dash", i: "a,b", j: "k: v",
    k: 'quote " inside', l: "line\nbreak", m: "tab\there", n: "back\\slash", o: "[x]", p: "{y}", q: "unicode ✓ é",
  });
});

test("nested and mixed structures", () => {
  roundtrip({
    a: { b: { c: [1, 2, { d: [] }] }, e: {} },
    list: [{ x: 1, y: { z: 2 } }, { x: 2 }, "str", 5, [1, 2], [], {}, [{ p: 1 }, { p: 2 }]],
    "odd key": 1, "": 2, "a.b": 3,
  });
});

test("root arrays and scalars", () => {
  roundtrip([{ a: 1 }, { a: 2 }]);
  roundtrip([1, 2, 3]);
  roundtrip([]);
  roundtrip({});
  roundtrip([[1, 2], [3]]);
});

test("numbers and null/bool", () => {
  roundtrip({ n: -1.5e-7, big: 12345678901234, z: 0, t: true, f: false, nil: null, arr: [null, true, 1.25] });
});

test("fuzz: random JSON round-trips", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const words = ["a", "b c", "", "x,y", "k:v", "-1", "true", "é", 'q"', "line\nx", "  sp", "[1]", "{}", "#", "a\\b"];
  const gen = (d: number): unknown => {
    const r = rnd();
    if (d > 3 || r < 0.35) {
      const p = rnd();
      return p < 0.3 ? words[Math.floor(rnd() * words.length)] : p < 0.6 ? Math.floor(rnd() * 2000 - 1000) / (rnd() < 0.5 ? 1 : 8) : p < 0.8 ? rnd() < 0.5 : null;
    }
    if (r < 0.65) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
    if (r < 0.8) {
      const keys = ["id", "name", "v"].slice(0, 1 + Math.floor(rnd() * 3));
      return Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => Object.fromEntries(keys.map((k) => [k, rnd() < 0.7 ? words[Math.floor(rnd() * words.length)] : Math.floor(rnd() * 99)])));
    }
    return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => [["k", "key two", "a.b", "_z", ""][i % 5] + i, gen(d + 1)]));
  };
  for (let i = 0; i < 1500; i++) {
    const v = gen(0);
    if (typeof v !== "object" || v === null) continue;
    roundtrip(v);
  }
});
