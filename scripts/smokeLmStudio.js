#!/usr/bin/env node
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    class ChatResponseMarkdownPart {
      constructor(value) {
        this.value = value;
      }
    }

    return {
      ChatResponseMarkdownPart,
      LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
      LanguageModelChatMessage: class {
        constructor() {
          // no-op stub
        }
      },
      lm: {
        selectChatModels: async () => []
      }
    };
  }

  return originalLoad(request, parent, isMain);
};

async function run() {
  const { sendToLmStudio } = require(path.resolve(__dirname, "../dist/lmStudioClient.js"));

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, options) => {
    const body = options?.body ? JSON.parse(options.body.toString()) : {};
    const summarySection = body.messages?.find((msg) => msg.role === "user")?.content || "";
    const responsePayload = {
      choices: [
        {
          message: {
            content: `Echo from LM Studio stub:\n\n${summarySection}`,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "record_task",
                  arguments: JSON.stringify({
                    phaseId: "brainstorm",
                    questionId: "goal",
                    answer: "Validate conversion metrics baseline",
                    priority: "high",
                    notes: "Coordinate with analytics team"
                  })
                }
              }
            ]
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const mockRequest = { prompt: "Provide next steps based on the BMAD summary." };
    const mockAnswers = {
      brainstorm: { goal: "Increase conversion", users: "Marketing", success: "10% uplift" },
      map: { context: "Existing analytics stack", constraints: "Must integrate with CRM" },
      assemble: { milestones: "Phase rollout", tooling: "TypeScript, AWS" },
      deploy: { validation: "A/B test", rollout: "Feature flag" }
    };

    const result = await sendToLmStudio(mockRequest, mockAnswers, {
      url: "http://127.0.0.1:1234/v1",
      model: "stub-model"
    });

    // eslint-disable-next-line no-console
    console.log("LM Studio smoke response:\n", result.responsePart.value);
    if (result.tasks.length) {
      // eslint-disable-next-line no-console
      console.log("Queued tasks:", result.tasks);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error("LM Studio smoke test failed", error);
  process.exit(1);
});
