# Copilot Instructions for Lamp

These instructions guide AI assistance for this repository.

## Project Purpose

Lamp is an interactive fiction authoring and playing system.

The long-term system has three major parts:
- Lantern: compiler for the Lamp language.
- Lamplighter: runtime library for compiled games.
- Lighthouse: bundler for shipping playable builds.

Current implementation direction:
- JavaScript
- Node.js command-line tooling

## Source of Truth

When working in this repo, prioritize these files in order for intended behavior and design decisions:
1. devdocs/specs.md
2. devdocs/architecture.md
3. Existing source and sample files

If code and docs disagree, call out the mismatch explicitly and state whether your answer describes intended behavior (docs) or current implementation (source).
For files not covered by the source-of-truth hierarchy (for example, CI configs, package.json, and test fixtures), use existing file content as the authoritative source of intent and note any assumptions in your response summary.
1. Check whether devdocs/specs.md and devdocs/architecture.md exist and contain information relevant to the current task.
2. If either file is missing or contains no relevant information:
	a. State explicitly at the top of your response: "Treating this task as greenfield - [filename] not found / contains no relevant content."
	b. Complete the requested task.
	c. At the end of the response, add or extend the relevant doc following the Documentation Workflow rules below.

## What Copilot Should Not Do
- Do not make assumptions about user intent beyond what is explicitly stated in the prompt or existing documentation. If requirements are incomplete, propose concrete next steps to clarify them before proceeding with implementation.
- Do not introduce new npm dependencies without explicit justification. If a dependency would materially simplify the implementation, name it, state what it replaces, and ask for approval before adding it to package.json. Never add dependencies silently in generated code.
- DO NOT edit files in lib/ without explicit instructions to do so. 
- DO NOT edit files in sample/ without explicit instructions to do so. This directory is intended to be a stable reference for intended usage patterns and should not be changed except by the user.
- The future/ directory is for dumping experimental code and should not be used for implementing intended behavior. Do not add or edit files in future/ without explicit instructions to do so.

## How Copilot Should Help

- Prefer edits scoped to a single function or module at a time. If a task requires changes across more than two files, break it into sequential steps and propose each before proceeding.
- Keep architecture, specs, and code aligned.
- Propose concrete next steps when requirements are incomplete.
- Preserve existing naming unless a rename is requested.
- Do not introduce new npm dependencies without explicit justification. If a dependency would materially simplify the implementation, name it, state what it replaces, and ask for approval before adding it to package.json. Never add dependencies silently in generated code.
- If a question is about end-user gameplay rather than development, briefly answer from the player perspective but note that detailed player documentation is outside the scope of this repo's Copilot instructions.

## Documentation Workflow

When adding or changing behavior:
- Update relevant docs in devdocs.
- Keep language precise and implementation-oriented.
- Track open questions explicitly under an Open Questions heading.

When starting a new subsystem:
- Add purpose and boundaries.
- Define inputs and outputs.
- List assumptions and non-goals.

## Code Style Baseline

For JavaScript and Node.js code:
- Prefer clear module boundaries and pure functions where practical.
- Keep CLI entrypoints thin and delegate logic to lib modules.
- Add inline comments only when a block of logic cannot be understood from the function name and variable names alone - for example, bit manipulation, non-standard algorithm choices, or workarounds for known platform bugs. Do not comment straightforward assignments, simple conditionals, or standard library calls.

For Lamp language examples and library files:
- Preserve existing syntax and formatting conventions in .lamp files.
- Keep examples minimal but runnable.

## Quality Expectations

Before finalizing significant changes:
- Validate related docs are still accurate.
- Add or update tests when behavior changes.
- Note follow-up work if full implementation is deferred.

## Response Expectations for AI Assistance

- Start with a short summary of what changed.
- Call out assumptions and risks.
- Include exact file paths touched.
- Always suggest 1 to 3 logical next steps unless the response is a direct factual answer, a pure documentation lookup, or the user explicitly asked for no follow-up.

## Initial Open Questions

- What is the first vertical slice to deliver (authoring, runtime library, or bundling)?
- What intermediate representation should Lantern emit?
- What packaging target should Lighthouse support first (web or Electron)?
