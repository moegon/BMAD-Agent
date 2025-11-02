export type PhaseId = "brainstorm" | "map" | "assemble" | "deploy";

export interface PhasePrompt {
  id: PhaseId;
  title: string;
  description: string;
  questions: { id: string; prompt: string; hint?: string }[];
  followUps?: string[];
  resources?: string[];
  deliverables?: string[];
  checklist?: string[];
}

export const bmadPhases: PhasePrompt[] = [
  {
    id: "brainstorm",
    title: "Brainstorm",
    description: "Clarify the vision, constraints, and stakeholders.",
    questions: [
      { id: "goal", prompt: "What problem are we solving and why now?" },
      { id: "users", prompt: "Who are the primary users or stakeholders?" },
      { id: "success", prompt: "What does success look like for this effort?" }
    ],
    followUps: [
      "Capture the high-level narrative and any motivating context.",
      "List unknowns you expect the agent to research.",
      "Document who must approve scope before work begins."
    ],
    resources: ["resources/prompts/brainstorm.json"],
    deliverables: [
      "Problem statement and opportunity framing",
      "Primary stakeholder map and responsibilities",
      "North-star success metrics or qualitative signals"
    ],
    checklist: [
      "Validate that the goal aligns with strategic priorities.",
      "Confirm stakeholder availability for discovery sessions.",
      "Identify must-have and nice-to-have outcomes."
    ]
  },
  {
    id: "map",
    title: "Map",
    description: "Collect domain knowledge, assets, and architectural context.",
    questions: [
      { id: "context", prompt: "What existing systems, repos, or docs are relevant?" },
      { id: "constraints", prompt: "What technical or organizational constraints exist?" }
    ],
    followUps: [
      "Note cross-team dependencies or compliance obligations.",
      "List subject-matter experts that can unblock domain questions.",
      "Capture authoritative documentation that should seed the agent."
    ],
    resources: ["resources/prompts/map.json"],
    deliverables: [
      "System/context diagram or repository inventory",
      "Risks and constraints register",
      "Knowledge gaps and research backlog"
    ],
    checklist: [
      "Verify links to critical documentation are accessible.",
      "Flag integrations that require credentials or sandbox access.",
      "Identify dependencies on external teams or vendors."
    ]
  },
  {
    id: "assemble",
    title: "Assemble",
    description: "Break the work into executable steps and select tooling.",
    questions: [
      { id: "milestones", prompt: "Outline key deliverables or milestones." },
      { id: "tooling", prompt: "Which languages, frameworks, or infra should we target?" }
    ],
    followUps: [
      "Identify reusable components or prior art.",
      "Sequence delivery milestones with clear acceptance conditions.",
      "Validate that tooling choices align with constraints captured in Map."
    ],
    resources: ["resources/prompts/assemble.json"],
    deliverables: [
      "Implementation milestones and timeline",
      "Environment/tooling checklist",
      "Resourcing or pairing plan"
    ],
    checklist: [
      "Break milestones into work units small enough for the agent.",
      "Confirm CI/CD or release procedures are documented.",
      "Schedule regular alignment checkpoints with stakeholders."
    ]
  },
  {
    id: "deploy",
    title: "Deploy",
    description: "Plan validation, release, and feedback loops.",
    questions: [
      { id: "validation", prompt: "How will we test against success criteria?" },
      { id: "rollout", prompt: "Describe launch sequencing or release management steps." }
    ],
    followUps: [
      "Consider observability, support, and post-launch review.",
      "Define how feedback will be gathered and triaged.",
      "Plan contingency steps in case rollout needs to pause."
    ],
    resources: ["resources/prompts/deploy.json"],
    deliverables: [
      "Validation and QA plan",
      "Release or launch checklist",
      "Post-launch review cadence"
    ],
    checklist: [
      "Coordinate communication to impacted teams or customers.",
      "Ensure rollback strategy is documented and rehearsed.",
      "Assign owners for monitoring and incident response."
    ]
  }
];

export function loadPhasePrompt(id: PhaseId): PhasePrompt | undefined {
  return bmadPhases.find((phase) => phase.id === id);
}
