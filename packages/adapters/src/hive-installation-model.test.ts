import { describe, expect, it } from "vitest";
import { hiveInstallationModel, hiveRunModel } from "./hive-installation-model.js";

const env = {
  HIVE_MODEL_BASE_URL: "http://models.example.test/v1",
  HIVE_MODEL_API_KEY: "installation-key",
  HIVE_DEFAULT_MODEL: "example-model",
};

describe("hiveInstallationModel", () => {
  it("requires the endpoint, the key, and the model", () => {
    expect(hiveInstallationModel(env)).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://models.example.test/v1",
      apiKey: "installation-key",
      model: "example-model",
    });
    expect(hiveInstallationModel({ ...env, HIVE_DEFAULT_MODEL: "  " })).toBeNull();
    expect(hiveInstallationModel({})).toBeNull();
  });

  it("uses a bot model and a bot key when they are set, and the installation otherwise", () => {
    const installation = hiveInstallationModel(env)!;
    expect(hiveRunModel({}, installation)).toEqual(installation);
    expect(
      hiveRunModel(
        { modelProvider: "openai-compatible", modelId: "bot-model" },
        installation,
        "bot-key",
      ),
    ).toEqual({ ...installation, model: "bot-model", apiKey: "bot-key" });
    expect(
      hiveRunModel({ modelProvider: "other", modelId: "bot-model" }, installation),
    ).toEqual(installation);
  });
});
