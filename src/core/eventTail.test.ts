import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tailEvents } from "./eventTail";

const dirs: string[] = [];


function tmpFile(name: string, content: string): string {
  const dir = mkdtemp();
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

function mkdtemp(): string {
  const dir = path.join(os.tmpdir(), `migent-tail-${dirs.length}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

const line1 = JSON.stringify({ v: 2, seq: 1, event: "session.created", timestamp: "t1", data: {} });
const line2 = JSON.stringify({
  v: 2,
  seq: 2,
  event: "execution.started",
  timestamp: "t2",
  execution_id: "0001-plan--attempt-01",
  stage_id: "plan",
  summary: "claude/sonnet",
  data: { execution_order: 1 },
});

describe("tailEvents", () => {
  it("returns an empty read for a missing file", () => {
    const read = tailEvents(path.join(os.tmpdir(), "does-not-exist-events.jsonl"), 0);
    expect(read.events).toEqual([]);
    expect(read.offset).toBe(0);
  });

  it("reads complete lines and stops before a partial line", () => {
    const file = tmpFile("events.jsonl", `${line1}\n${line2}\n${line2.slice(0, 10)}`);
    const first = tailEvents(file, 0);
    expect(first.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(first.events[1]?.executionId).toBe("0001-plan--attempt-01");
    expect(first.events[1]?.stageId).toBe("plan");
    expect(first.events[1]?.summary).toBe("claude/sonnet");
    // The torn tail stays unconsumed.
    expect(tailEvents(file, first.offset).events).toEqual([]);
  });

  it("picks up the previously torn tail once the line is complete", () => {
    const file = tmpFile("events.jsonl", `${line1}\n`);
    const first = tailEvents(file, 0);
    expect(first.events).toHaveLength(1);

    // The kernel appends the rest of the line later.
    writeFileSync(file, `${line1}\n${line2}\n`);
    const second = tailEvents(file, first.offset);
    expect(second.events.map((event) => event.seq)).toEqual([2]);
    expect(second.offset).toBeGreaterThan(first.offset);
  });

  it("consumes nothing when the only content is a torn line", () => {
    const file = tmpFile("events.jsonl", line2.slice(0, 20));
    const read = tailEvents(file, 0);
    expect(read.events).toEqual([]);
    expect(read.offset).toBe(0);
  });

  it("continues after the last offset only", () => {
    const file = tmpFile("events.jsonl", `${line1}\n${line2}\n`);
    const first = tailEvents(file, 0);
    const second = tailEvents(file, first.offset);
    expect(second.events).toEqual([]);
  });

  it("returns the raw line for a line that is not JSON", () => {
    const file = tmpFile("events.jsonl", `${line1}\nnot json at all\n`);
    const read = tailEvents(file, 0);
    expect(read.events).toHaveLength(2);
    expect(read.events[1]?.rawLine).toBe("not json at all");
    expect(read.events[1]?.raw).toBeNull();
    expect(read.events[1]?.event).toBeNull();
  });

  it("returns the raw line for an unknown envelope version, best-effort parsed", () => {
    const future = JSON.stringify({ v: 99, seq: 3, event: "session.created", timestamp: "t3", data: {} });
    const file = tmpFile("events.jsonl", `${future}\n`);
    const read = tailEvents(file, 0);
    expect(read.events).toHaveLength(1);
    expect(read.events[0]?.v).toBe(99);
    expect(read.events[0]?.event).toBe("session.created");
    expect(read.events[0]?.rawLine).toBe(future);
  });

  it("reads a missing v as version 1", () => {
    const legacy = JSON.stringify({ seq: 4, event: "legacy.event", timestamp: "t4", data: {} });
    const file = tmpFile("events.jsonl", `${legacy}\n`);
    expect(tailEvents(file, 0).events[0]?.v).toBe(1);
  });

  it("treats a non-object or eventless line as raw", () => {
    const file = tmpFile("events.jsonl", '[1,2,3]\n{"no_event":true}\n');
    const read = tailEvents(file, 0);
    expect(read.events.map((event) => event.rawLine)).toEqual(['[1,2,3]', '{"no_event":true}']);
  });

  it("handles empty lines by skipping them", () => {
    const file = tmpFile("events.jsonl", `${line1}\n\n${line2}\n`);
    const read = tailEvents(file, 0);
    expect(read.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("handles a file that shrank below the offset", () => {
    const file = tmpFile("events.jsonl", `${line1}\n${line2}\n`);
    const first = tailEvents(file, 0);
    writeFileSync(file, "");
    const read = tailEvents(file, first.offset);
    expect(read.events).toEqual([]);
    expect(read.offset).toBeGreaterThanOrEqual(first.offset);
  });
});
