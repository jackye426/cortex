import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Actor } from "./types.js";
import { CompanyBrain, CompanyBrainError } from "./service.js";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown) {
  if (error instanceof CompanyBrainError) {
    return textResult({ error: error.code, detail: error.message });
  }
  throw error;
}

export function createCompanyBrainMcpServer(
  brain: CompanyBrain,
  actor: Actor,
): McpServer {
  const server = new McpServer({
    name: "company-brain",
    version: "0.0.0",
  });

  server.registerTool(
    "brain_context",
    {
      description:
        "Return current company state, pending proposals, and contradictory assumptions.",
      inputSchema: {},
    },
    async () => textResult(brain.context()),
  );

  server.registerTool(
    "brain_current_state",
    {
      description: "Return effective company state revisions with citations.",
      inputSchema: {},
    },
    async () => textResult(brain.currentState()),
  );

  server.registerTool(
    "brain_decisions",
    {
      description: "Return approved interpretive state revisions.",
      inputSchema: {},
    },
    async () => textResult(brain.decisions()),
  );

  server.registerTool(
    "brain_changes",
    {
      description: "Return recent source events and state revisions.",
      inputSchema: {},
    },
    async () => textResult(brain.changes()),
  );

  server.registerTool(
    "brain_evidence",
    {
      description:
        "Resolve a citation to immutable evidence. Raw payload is founder-only.",
      inputSchema: {
        eventId: z.string(),
      },
    },
    async ({ eventId }) => {
      try {
        return textResult(brain.evidence(actor, eventId));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "brain_propose_observation",
    {
      description: "Record a factual observation from the current actor.",
      inputSchema: {
        statement: z.string(),
        evidenceIds: z.array(z.string()).default([]),
        topicKeys: z.array(z.string()).default([]),
      },
    },
    async ({ statement, evidenceIds, topicKeys }) => {
      try {
        return textResult(
          brain.proposeObservation({
            actor,
            statement,
            evidenceIds,
            topicKeys,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "brain_propose_decision",
    {
      description: "Propose an interpretive company decision. Does not apply until approved.",
      inputSchema: {
        stateKey: z.string(),
        statement: z.string(),
        evidenceIds: z.array(z.string()),
      },
    },
    async ({ stateKey, statement, evidenceIds }) => {
      try {
        return textResult(
          brain.proposeDecision({ actor, stateKey, statement, evidenceIds }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "brain_propose_state_change",
    {
      description: "Propose a company state change. Enters the approval queue.",
      inputSchema: {
        stateKey: z.string(),
        statement: z.string(),
        evidenceIds: z.array(z.string()),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async ({ stateKey, statement, evidenceIds, confidence }) => {
      try {
        return textResult(
          brain.proposeStateChange({
            actor,
            stateKey,
            statement,
            evidenceIds,
            confidence,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "brain_approve_proposal",
    {
      description: "Founder-only: approve a pending proposal and create a state revision.",
      inputSchema: {
        proposalId: z.string(),
        note: z.string().optional(),
      },
    },
    async ({ proposalId, note }) => {
      try {
        return textResult(
          brain.decideProposal({
            actor,
            proposalId,
            action: "approve",
            note,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "brain_reject_proposal",
    {
      description: "Founder-only: reject a pending proposal.",
      inputSchema: {
        proposalId: z.string(),
        note: z.string().optional(),
      },
    },
    async ({ proposalId, note }) => {
      try {
        return textResult(
          brain.decideProposal({
            actor,
            proposalId,
            action: "reject",
            note,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "brain_refine_proposal",
    {
      description: "Founder-only: approve a refined statement as the next state revision.",
      inputSchema: {
        proposalId: z.string(),
        refinementStatement: z.string(),
        note: z.string().optional(),
      },
    },
    async ({ proposalId, refinementStatement, note }) => {
      try {
        return textResult(
          brain.decideProposal({
            actor,
            proposalId,
            action: "refine",
            note,
            refinementStatement,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
