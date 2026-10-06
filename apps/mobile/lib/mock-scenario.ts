import type { RecognitionScenario } from "@cardflow/shared";

let selectedScenario: RecognitionScenario = "high-confidence";

export function getMockScenario(): RecognitionScenario {
  return selectedScenario;
}

export function setMockScenario(scenario: RecognitionScenario): void {
  selectedScenario = scenario;
}
