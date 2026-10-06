import { describe, expect, it } from "vitest";
import { applyLocalEnv, parseEnvFile } from "./local-env";

describe("local API .env", () => {
  it("fills missing keys and leaves CI overrides alone", () => {
    expect(parseEnvFile("CARD_FLOW_OBB_ONNX_PATH=models/yolo11n-obb.onnx\n# skip\n")).toEqual({
      CARD_FLOW_OBB_ONNX_PATH: "models/yolo11n-obb.onnx",
    });
    const env: NodeJS.Dict<string | undefined> = { CARD_FLOW_STORE: "memory" };
    applyLocalEnv(env, {
      CARD_FLOW_STORE: "sqlite",
      CARD_FLOW_OBB_ONNX_PATH: "models/yolo11n-obb.onnx",
    });
    expect(env.CARD_FLOW_STORE).toBe("memory");
    expect(env.CARD_FLOW_OBB_ONNX_PATH).toBe("models/yolo11n-obb.onnx");
  });
});
