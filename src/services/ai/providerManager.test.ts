import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/settings", () => {
  const fn = vi.fn();
  return {
    getSetting: fn,
    getSecureSetting: fn,
  };
});

import { createMockAiProvider } from "@/test/mocks";

vi.mock("./providers/claudeProvider", () => ({
  createClaudeProvider: vi.fn(() => createMockAiProvider("claude response")),
  clearClaudeProvider: vi.fn(),
}));

vi.mock("./providers/openaiProvider", () => ({
  createOpenAIProvider: vi.fn(() => createMockAiProvider("openai response")),
  clearOpenAIProvider: vi.fn(),
}));

vi.mock("./providers/geminiProvider", () => ({
  createGeminiProvider: vi.fn(() => createMockAiProvider("gemini response")),
}));

vi.mock("./providers/ollamaProvider", () => ({
  createOllamaProvider: vi.fn(() => createMockAiProvider("ollama response")),
  clearOllamaProvider: vi.fn(),
}));

vi.mock("./providers/copilotProvider", () => ({
  createCopilotProvider: vi.fn(() => createMockAiProvider("copilot response")),
  clearCopilotProvider: vi.fn(),
}));

vi.mock("./providers/customProvider", () => ({
  createCustomProvider: vi.fn(() => createMockAiProvider("custom response")),
  clearCustomProvider: vi.fn(),
}));

import { getSetting } from "@/services/db/settings";
import { createClaudeProvider, clearClaudeProvider } from "./providers/claudeProvider";
import { createOpenAIProvider } from "./providers/openaiProvider";
import { createGeminiProvider } from "./providers/geminiProvider";
import { createOllamaProvider } from "./providers/ollamaProvider";
import { createCopilotProvider } from "./providers/copilotProvider";
import { createCustomProvider, clearCustomProvider } from "./providers/customProvider";
import {
  getActiveProvider,
  getActiveProviderName,
  isAiAvailable,
  clearProviderClients,
} from "./providerManager";

const mockGetSetting = vi.mocked(getSetting);

describe("providerManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderClients();
  });

  describe("getActiveProviderName", () => {
    it("defaults to claude when ai_provider is not set", async () => {
      mockGetSetting.mockResolvedValue(null);
      expect(await getActiveProviderName()).toBe("claude");
    });

    it("returns openai when ai_provider is openai", async () => {
      mockGetSetting.mockResolvedValue("openai");
      expect(await getActiveProviderName()).toBe("openai");
    });

    it("returns gemini when ai_provider is gemini", async () => {
      mockGetSetting.mockResolvedValue("gemini");
      expect(await getActiveProviderName()).toBe("gemini");
    });

    it("returns ollama when ai_provider is ollama", async () => {
      mockGetSetting.mockResolvedValue("ollama");
      expect(await getActiveProviderName()).toBe("ollama");
    });

    it("returns copilot when ai_provider is copilot", async () => {
      mockGetSetting.mockResolvedValue("copilot");
      expect(await getActiveProviderName()).toBe("copilot");
    });

    it("defaults to claude for unknown provider value", async () => {
      mockGetSetting.mockResolvedValue("unknown_provider");
      expect(await getActiveProviderName()).toBe("claude");
    });
  });

  describe("getActiveProvider", () => {
    it("creates claude provider with default model", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "claude";
        if (key === "claude_api_key") return "sk-ant-test";
        return null;
      });

      await getActiveProvider();
      // The current Claude model ID carries no date suffix. The previous value
      // `claude-haiku-4-5-20251001` was a stale form (audit: refresh provider
      // model lists).
      expect(createClaudeProvider).toHaveBeenCalledWith("sk-ant-test", "claude-haiku-4-5");
    });

    it("creates openai provider with default model", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "openai";
        if (key === "openai_api_key") return "sk-test";
        return null;
      });

      await getActiveProvider();
      expect(createOpenAIProvider).toHaveBeenCalledWith("sk-test", "gpt-4o-mini");
    });

    it("creates gemini provider with default model", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "gemini";
        if (key === "gemini_api_key") return "AItest";
        return null;
      });

      await getActiveProvider();
      expect(createGeminiProvider).toHaveBeenCalledWith("AItest", "gemini-2.5-flash-preview-05-20");
    });

    it("uses custom model from settings when configured", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "claude";
        if (key === "claude_api_key") return "sk-ant-test";
        if (key === "claude_model") return "claude-sonnet-4-20250514";
        return null;
      });

      await getActiveProvider();
      expect(createClaudeProvider).toHaveBeenCalledWith("sk-ant-test", "claude-sonnet-4-20250514");
    });

    it("invalidates cache when model changes", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "openai";
        if (key === "openai_api_key") return "sk-test";
        if (key === "openai_model") return "gpt-4o-mini";
        return null;
      });

      await getActiveProvider();
      expect(createOpenAIProvider).toHaveBeenCalledTimes(1);

      // Change model
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "openai";
        if (key === "openai_api_key") return "sk-test";
        if (key === "openai_model") return "gpt-4o";
        return null;
      });

      await getActiveProvider();
      expect(createOpenAIProvider).toHaveBeenCalledTimes(2);
      expect(createOpenAIProvider).toHaveBeenLastCalledWith("sk-test", "gpt-4o");
    });

    it("creates copilot provider with default model", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "copilot";
        if (key === "copilot_api_key") return "ghp_test123";
        return null;
      });

      await getActiveProvider();
      expect(createCopilotProvider).toHaveBeenCalledWith("ghp_test123", "openai/gpt-4o-mini");
    });

    it("creates ollama provider with server url and model", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "ollama";
        if (key === "ollama_server_url") return "http://localhost:11434";
        if (key === "ollama_model") return "llama3.2";
        return null;
      });

      await getActiveProvider();
      expect(createOllamaProvider).toHaveBeenCalledWith("http://localhost:11434", "llama3.2");
    });

    it("uses default ollama url and model when not configured", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "ollama";
        return null;
      });

      await getActiveProvider();
      expect(createOllamaProvider).toHaveBeenCalledWith("http://localhost:11434", "llama3.2");
    });

    it("throws NOT_CONFIGURED when API key is missing", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "openai";
        return null;
      });

      await expect(getActiveProvider()).rejects.toThrow("openai API key not configured");
    });

    it("caches provider and reuses on subsequent calls", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "claude";
        if (key === "claude_api_key") return "sk-ant-test";
        return null;
      });

      await getActiveProvider();
      await getActiveProvider();
      expect(createClaudeProvider).toHaveBeenCalledTimes(1);
    });

    it("caches ollama provider and reuses on subsequent calls", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "ollama";
        if (key === "ollama_server_url") return "http://localhost:11434";
        if (key === "ollama_model") return "llama3.2";
        return null;
      });

      await getActiveProvider();
      await getActiveProvider();
      expect(createOllamaProvider).toHaveBeenCalledTimes(1);
    });
  });

  // SPEC-209 — the custom OpenAI-compatible endpoint.
  describe("custom endpoint (SPEC-209)", () => {
    function customSettings(overrides: Record<string, string | null> = {}) {
      const values: Record<string, string | null> = {
        ai_provider: "custom",
        custom_base_url: "https://openrouter.ai/api/v1",
        custom_api_key: "or-key",
        custom_model: "openai/gpt-4o-mini",
        ...overrides,
      };
      mockGetSetting.mockImplementation(async (key: string) => values[key] ?? null);
    }

    it("resolves the name", async () => {
      customSettings();
      expect(await getActiveProviderName()).toBe("custom");
    });

    it("creates the provider from base URL, key and model (REQ-1.1)", async () => {
      customSettings();

      await getActiveProvider();

      expect(createCustomProvider).toHaveBeenCalledWith("https://openrouter.ai/api/v1", "or-key", "openai/gpt-4o-mini");
    });

    it("a blank key and an unset model still build — placeholder key, default model", async () => {
      customSettings({ custom_api_key: null, custom_model: null });

      await getActiveProvider();

      expect(createCustomProvider).toHaveBeenCalledWith("https://openrouter.ai/api/v1", "", "gpt-4o-mini");
    });

    it("throws NOT_CONFIGURED without a base URL — never a silent local default (REQ-1.2)", async () => {
      customSettings({ custom_base_url: null });

      await expect(getActiveProvider()).rejects.toThrow("base URL not configured");
      expect(createCustomProvider).not.toHaveBeenCalled();
    });

    it("isAiAvailable follows the base URL, not a key (REQ-1.2)", async () => {
      customSettings({ custom_api_key: null });
      expect(await isAiAvailable()).toBe(true);

      customSettings({ custom_base_url: null });
      expect(await isAiAvailable()).toBe(false);
    });

    it("caches on base URL, key and model, and clearProviderClients clears it", async () => {
      customSettings();
      await getActiveProvider();
      await getActiveProvider();
      expect(createCustomProvider).toHaveBeenCalledTimes(1);

      customSettings({ custom_model: "deepseek-chat" });
      await getActiveProvider();
      expect(createCustomProvider).toHaveBeenCalledTimes(2);

      clearProviderClients();
      expect(clearCustomProvider).toHaveBeenCalled();
      await getActiveProvider();
      expect(createCustomProvider).toHaveBeenCalledTimes(3);
    });
  });

  describe("isAiAvailable", () => {
    it("returns false when ai_enabled is false", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_enabled") return "false";
        return null;
      });

      expect(await isAiAvailable()).toBe(false);
    });

    it("returns false when active provider API key is missing", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_enabled") return "true";
        if (key === "ai_provider") return "openai";
        // openai_api_key not set
        return null;
      });

      expect(await isAiAvailable()).toBe(false);
    });

    it("returns true when enabled and key exists", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_enabled") return "true";
        if (key === "ai_provider") return "claude";
        if (key === "claude_api_key") return "sk-ant-test";
        return null;
      });

      expect(await isAiAvailable()).toBe(true);
    });

    it("returns true when ai_enabled is not set (defaults to enabled)", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return null;
        if (key === "claude_api_key") return "sk-ant-test";
        return null;
      });

      expect(await isAiAvailable()).toBe(true);
    });

    it("returns true for copilot when API key exists", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_enabled") return "true";
        if (key === "ai_provider") return "copilot";
        if (key === "copilot_api_key") return "ghp_test123";
        return null;
      });

      expect(await isAiAvailable()).toBe(true);
    });

    it("returns true for ollama when server url is configured", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_enabled") return "true";
        if (key === "ai_provider") return "ollama";
        if (key === "ollama_server_url") return "http://localhost:11434";
        return null;
      });

      expect(await isAiAvailable()).toBe(true);
    });

    it("returns false for ollama when server url is not configured", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_enabled") return "true";
        if (key === "ai_provider") return "ollama";
        return null;
      });

      expect(await isAiAvailable()).toBe(false);
    });
  });

  describe("clearProviderClients", () => {
    it("forces re-creation on next getActiveProvider call", async () => {
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "claude";
        if (key === "claude_api_key") return "sk-ant-test";
        return null;
      });

      await getActiveProvider();
      expect(createClaudeProvider).toHaveBeenCalledTimes(1);

      clearProviderClients();
      expect(clearClaudeProvider).toHaveBeenCalled();

      await getActiveProvider();
      expect(createClaudeProvider).toHaveBeenCalledTimes(2);
    });
  });
});
