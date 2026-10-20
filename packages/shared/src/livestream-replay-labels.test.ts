import { describe, expect, it } from "vitest";
import {
  labelAtTime,
  parseLivestreamReplayLabelsJsonl,
} from "./livestream-replay-labels";

const SAMPLE = `# sample labels
{"startSec":0,"endSec":4.5,"tcgdexId":null,"notes":"no card"}
{"startSec":4.5,"endSec":12,"tcgdexId":"base1-58","set":"base1","number":"58","steady":true}
{"startSec":12,"endSec":18,"tcgdexId":"sv1-1","set":"sv1","number":"1","variant":"holo"}
`;

describe("livestream replay labels", () => {
  it("parses JSONL with comments and resolves time", () => {
    const labels = parseLivestreamReplayLabelsJsonl(SAMPLE);
    expect(labels).toHaveLength(3);
    expect(labelAtTime(labels, 1)?.tcgdexId).toBeNull();
    expect(labelAtTime(labels, 5)?.tcgdexId).toBe("base1-58");
    expect(labelAtTime(labels, 15)?.number).toBe("1");
    expect(labelAtTime(labels, 99)).toBeNull();
  });
});
