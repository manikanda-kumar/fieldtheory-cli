# Harness Engineering — 30-Slide Presentation Deck

This file contains the complete slide content in Markdown format, the speaker run-of-show, the final on-screen sources, and inline SVG/Mermaid diagram specifications for the architectural slides.

---

## Act I — The migration of the interface (slides 1–7)

### Slide 1: Harness Engineering
* **Claim:** The outer loop is the new engineering boundary.
* **On-Slide Content:**
  * Title: Harness Engineering
  * Subtitle: From chat to “harness is all you need”—and why not to impede the model path
* **Source:** [speaker claim]
* **Speaker Notes:** Welcome the audience. Introduce the core premise: AI capability is shifting from raw model output to the structured environment we wrap around it. We've migrated interfaces rapidly, but the true engineering moat is the harness.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Headline & Subtitle | Concentric Ring Outer Loop Diagram |

---

### Slide 2: The question this talk answers
* **Claim:** Why do two teams with the same model get wildly different agent results?
* **On-Slide Content:**
  * Team A (Raw): Direct prompts, implicit trust, no sandbox, vibe-based.
  * Team B (Engineered): Structured tools, compilers/tests, git worktrees, eval flywheels.
* **Sources:** Viv Trivedy · D7 · 2026 | Jerry Liu · F1 · 2025
* **Speaker Notes:** The difference lies entirely in the engineering of the harness. A raw model behaves probabilistically. An engineered harness wraps the model in structured execution, verification, and recovery loops.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| The Question & Bullet Points | Comparison block of Team A vs Team B pointing to single LLM |

---

### Slide 3: Chat was the interface
* **Claim:** Early LLM UX locked capability inside the prompt window.
* **On-Slide Content:**
  * Conversation was the unit of interaction.
  * User manually copied state back and forth.
  * No programmatic validation or executable feedback.
* **Sources:** [speaker claim] | Philipp Schmid · A6 · 2026
* **Speaker Notes:** In 2023, LLM interaction meant chatting. The user carried the state in their head and manually copied output to their editor. Schmid points out that chat was an interface bottleneck, masking the actual programmatic potential of models.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | User -> LLM -> Chat UI flow diagram |

---

### Slide 4: Copilot was the interface
* **Claim:** Inline completion moved AI into the editor—but remained single-turn.
* **On-Slide Content:**
  * Cursor-driven completions based on local file imports.
  * Human remains the compilation, execution, and test layer.
  * High velocity for typing, low velocity for refactoring.
* **Source:** VS Code Copilot Blog · B6 · 2026
* **Speaker Notes:** Copilots shifted the context loader closer to the code. However, they were still constrained to single-turn autocomplete. The engineer still acted as the compiler and verification harness, manually testing and debugging every generated suggestion.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | Code editor mockup autocomplete preview |

---

### Slide 5: Thesis: Agent = Model + Harness
* **Claim:** Same model, different harness → different product.
* **On-Slide Content:**
  * Model: Raw probabilistic reasoning engine.
  * Harness: Context loaders, sandboxes, tool contracts, AST guardrails, test judges.
* **Sources:** Viv Trivedy · D7 · 2026 | LangChain · A2 · 2025
* **Speaker Notes:** This is the core thesis of the talk. We write the model off as "smart" or "dumb," but in production, we interact with the system. The model acts as the reasoning engine; the harness provides the scaffolding. The same model in a better harness performs like a generation ahead.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Model vs Harness Definition | LangChain Anatomy original illustration preview |

---

### Slide 6: “Bash is all you need”
* **Claim:** Tool-calling + shell felt like the unlock—minimal loop, maximal freedom.
* **On-Slide Content:**
  * Give the model a terminal run-loop and let it write bash scripts.
  * Minimal constraints, high failure rates.
  * Out-of-bounds mutations, recursive updates, dependency breaks.
* **Sources:** [speaker claim] | HumanLayer Blog · E1 · 2026
* **Speaker Notes:** We realized that giving models tool access meant giving them terminal access. The "bash is all you need" phase prioritized raw power. But without structured isolation, a single bad command could delete a database or trigger an infinite loop of pip installs.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | Terminal console with destructive commands |

---

### Slide 7: Then agents hit the wall
* **Claim:** Long runs forget; tools thrash; green tests lie; permissions explode.
* **On-Slide Content:**
  * Context dilution: logs flood the context window.
  * Tool loops: model repeats the same failing action.
  * Shadow bugs: tests pass locally but break side-modules.
  * Security drift: raw execution requests root access.
* **Sources:** Anthropic Engineering · B1 | Pamela Fox · F9 | Kenton Varda · F10
* **Speaker Notes:** Autonomy without guardrails degrades quickly. Anthropic found that long-running agents thrash when tool outputs are too verbose. Fox highlighted how specs drift silently, and Varda showed that agents require fine-grained capability-based permissions, not root shell access.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Failure Vectors list | Loop trajectory crashing into wall vector |

---

## Act II — What a harness actually is (slides 8–14)

### Slide 8: Vocabulary: framework · runtime · harness
* **Claim:** Disambiguate: frameworks build, runtimes execute, harnesses productize.
* **On-Slide Content:**
  * Framework: abstract libraries, chain patterns, prompt templates.
  * Runtime: graph execution nodes, async state, persistence, retries.
  * Harness: the specific outer environment containing constraints, tools, and evals.
* **Source:** LangChain Blog · A2 · 2025
* **Speaker Notes:** A framework like LangChain or Pydantic AI is how you assemble nodes. The runtime is the execution engine. But the harness is the product itself—the specific sequence of context loaders, sandbox isolation, lint rules, and test loops that make the agent reliable.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Stack Definitions | Layered Cake Stack: Framework -> Runtime -> Harness |

---

### Slide 9: Harness engineering, coined
* **Claim:** Applying context-engineering discipline to how you use an existing agent.
* **On-Slide Content:**
  * Coined in late 2025 by @dexhorthy.
  * The shift from tweaking prompt strings to engineering tools and environments.
  * Focuses on the inputs, boundaries, and validation of the run loop.
* **Source:** dexhorthy origin tweet · A1 · 2025
* **Speaker Notes:** Dexhorthy noticed this transition late 2025. Instead of fighting prompt sensitivity, engineers succeeded by writing better Python runtimes, cleaner tool parsers, and explicit verification loops. The harness became the primary lever for performance.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Coining Quote | Timeline timeline: Prompts -> Contexts -> Harnesses |

---

### Slide 10: Anatomy of an agent harness
* **Claim:** The harness manages context, tools, isolation, tests, policies, and stop conditions.
* **On-Slide Content:**
  * Context: progressive file loaders, active workspace paths.
  * Tools: strict schema parsers, output sanitizers.
  * Policies: AST parsers, allowed directory lists.
  * Checks: test execution runners, compile validators, run limits.
* **Sources:** LangChain Anatomy · C2 · 2026 | Viv Trivedy · D3 · 2026
* **Speaker Notes:** A production harness must coordinate these components. The model has no concept of a sandbox; the harness must isolate it. The model can't run a linter; the harness intercepts its output, runs the linter, and formats the error back to the model.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Harness Parts List | LangChain original anatomy illustration preview |

---

### Slide 11: Diagram: the agent loop
* **Claim:** State must live on disk and traces, not only in model context.
* **On-Slide Content:**
  * Loop: Observe → Act → Tool Run → Observe → Stop.
  * Volatile context is continually pruned.
  * Structured execution records live on disk.
* **Sources:** Anthropic Engineering · B1 | Avi Chawla · B2/B3
* **Speaker Notes:** This is diagram D1. Notice the loop passes through the sandbox. The model cannot bypass the validation step. If the action produces compile errors, the harness feeds the exact compiler output back into the observe stage, preventing context drift.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Loop Phase Descriptions | Four-node loop: Observe -> Model -> Act -> Sandbox |

---

### Slide 12: Long-running agents need low-tech memory
* **Claim:** Progress logs, git commits, explicit feature lists beat “hope the context remembers.”
* **On-Slide Content:**
  * Context size does not equal memory reliability.
  * Force agent to write its own `progress.md` state checklist.
  * Use git diffs to track physical edits between turns.
* **Sources:** Anthropic Engineering · B1 | dabit3 · E4
* **Speaker Notes:** Rather than dumping raw chats or relying on embeddings, high-performing harnesses force agents to write their own checkpoint files on disk. The next turn reads the file first. Low-tech, deterministic memory scales better than high-tech context stuffing.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | Checkpoint progress.md checklist file mockup |

---

### Slide 13: Harness as a Service (HaaS)
* **Claim:** The moat shifts from model access to productized harness + distribution.
* **On-Slide Content:**
  * Model costs trend to zero; weights are open.
  * Execution environments (HaaS) hold state, credentials, and compute.
  * Moat is telemetry, custom sandboxes, and enterprise security.
* **Sources:** Viv Trivedy · D1 · 2026 | Ryan Carson / Amp · D4 · 2026
* **Speaker Notes:** Trivedy introduced HaaS. Companies are realizing they don't need custom models; they need custom execution scaffolds. The value is in the telemetry, the pre-built integrations, and the deterministic wrappers.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Moat comparison | Gateway client connection diagram |

---

### Slide 14: Opinionated agents win
* **Claim:** Too many options, not enough defaults. Encode team taste in prompts/tools/defaults.
* **On-Slide Content:**
  * Free choice leads to tool thrashing and backtracking.
  * Constrained action sets limit decision trees.
  * Hardcode formatting rules, git checkout setups, and paths.
* **Source:** Viv Trivedy · D2 · 2026
* **Speaker Notes:** Trivedy argues that agents fail when they have too many tools. The best harnesses limit options and enforce a clear protocol. By narrowing the action space, you reduce model error and keep the execution focused and predictable.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Choice vs Opinion | Split path fork: Labyrinth vs Straight Highway |

---

## Act III — Engineering the harness (slides 15–22)

### Slide 15: Context is load-bearing
* **Claim:** Tension: Skills (in-context loaders) vs Subagents (execution delegation).
* **On-Slide Content:**
  * **Skills:** Local files/documentation injected directly. Low latency, risks context dilution.
  * **Subagents:** Child loops with empty context. Slow startup, isolates complex tasks.
* **Sources:** dexhorthy · E2 · 2026 | LangChain Memory · C4 · 2026
* **Speaker Notes:** This is tension slide 1. Packing too many instructions degrades attention. A good harness balances this: keep the main agent thin, inject highly specific skills just-in-time, and spawn isolated subagents for heavy sub-tasks.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Tension definitions | Balance scale weighing Skills vs Subagents |

---

### Slide 16: Tools are contracts
* **Claim:** Bad tool schemas = agent failure that looks like “dumb model.”
* **On-Slide Content:**
  * Vague: `edit_file(path, content)` -> leads to model guessing and overwriting code.
  * Contract: `replace_block(path, target, replacement)` -> forces exact matching, fails safely.
* **Sources:** Sarah Sachs · E4 | Notion Harness · B7 | AutoBE · E6 · 2026
* **Speaker Notes:** Sachs and the AutoBE team showed that tightening tool schemas dramatically cuts model errors. The model shouldn't be asked to edit files with regex strings; the harness should force strict, structural edits that fail early if the code has drifted.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Contract comparison | Comparison boxes of Vague schema vs Strict schema |

---

### Slide 17: Task isolation
* **Claim:** One task, one agent, one workspace/worktree/sandbox.
* **On-Slide Content:**
  * Never let agents modify a dirty git working directory.
  * Isolating work within clean branches/worktrees ensures atomic commits.
  * Contain dependencies and file writes within sandboxed processes.
* **Sources:** Geoffrey Huntley · F8 | Kenton Varda · F10 · 2026
* **Speaker Notes:** Modularity protects the codebase. Huntley observed that letting agents loose in a dirty workspace leads to overlapping bugs. By spinning up clean, isolated sandboxes with strict capability-based permissions, you prevent agents from accidentally modifying the wrong files.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | Dirty Repo vs sandboxed git worktree buffer |

---

### Slide 18: Executable feedback
* **Claim:** Give the agent a failing test / rubric / judge—not a vibe.
* **On-Slide Content:**
  * "Please write cleaner code" is not action-oriented feedback.
  * Run tests on every turn. Return exit codes, compilers, and stack traces.
  * The compiler serves as the objective judge.
* **Sources:** Matt Pocock · F3 · 2025 | Viv Trivedy · D8 · 2026
* **Speaker Notes:** Matt Pocock famously tweeted that writing a failing test first is the best way to steer an agent. Instead of saying "fix the layout," write an assertions test. The harness runs it and provides structured errors. Evals become training data for the loop.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Feedback definitions | Failing test loopback to sandbox compiler |

---

### Slide 19: Architectural guardrails
* **Claim:** AST policies, lint, allowed paths—mechanical constraints > nagging prompts.
* **On-Slide Content:**
  * Prompts: "Please do not use deprecated packages." (Fails under context load).
  * Harness: Static analysis pre-hook parses AST and blocks edits violating policy.
* **Source:** steipete · F5 · 2025
* **Speaker Notes:** Steipete proved that parsing the AST in the harness caught code violations that prompt rules missed entirely. If you want an agent to follow clean architecture, don't write it in the prompt; write a linter rule in the harness. Let the machine enforce structure.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Prompt vs Mechanical | AST tree structure with blocked legacy node |

---

### Slide 20: Review is part of the harness
* **Claim:** Tension: Cooperative review vs Adversarial check loops.
* **On-Slide Content:**
  * **Cooperative:** Agreeable checks, fast merges. Risks leaking bugs.
  * **Adversarial:** Mocking inputs, trying to break edge cases. Higher quality, slower.
* **Sources:** shafty023 · F6 · 2026 | Matt Pocock · F4 · 2026
* **Speaker Notes:** This is tension slide 2. A good harness treats code review as a first-class engineering component, not an afterthought. Adversarial second agents or human gates prevent the build agent from validating its own mistakes.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Tension definitions | Builder vs Reviewer matching into Validated output |

---

### Slide 21: Durability & recovery
* **Claim:** Checkpoints, durable execution, resume after failure.
* **On-Slide Content:**
  * Compute crashes and network dropouts are inevitable in long agent runs.
  * Maintain database transactions for execution logs.
  * Support resuming from the last valid checkpoint step.
* **Source:** sydneyrunkle · F7 · 2026
* **Speaker Notes:** Runkle highlights that long-running agents crash due to infrastructure errors, not model errors. A production-grade harness must use durable execution libraries. Checkpoint the task list, commit files iteratively, and support dry-run recovery.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Recovery patterns | Checkpoint progression timeline: Step 1 -> 2 -> X (reloading 2) |

---

### Slide 22: Memory: context layer vs harness layer
* **Claim:** Memory in prompt ≠ memory in harness (mods, skills, files, traces).
* **On-Slide Content:**
  * Volatile prompt memory: high cost, dilutes fast.
  * Persistent harness memory: indexable files, git, SQLite database storage.
  * Prune model context continuously; reference structured harness memory.
* **Sources:** Dhravya Shah · F15 | Sarah Wooders · F12 | LangChain · C4
* **Speaker Notes:** Do not rely on the LLM's chat history to remember system information. Shah and Wooders argue that memory belongs in the harness. Keep the model context window minimal. Pull down only the relevant schemas and prior steps when needed. Move to Act IV.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Table and details | Context Window slot vs Harness storage cabinets |

---

## Act IV — Improvement loops & self-harness (slides 23–26)

### Slide 23: The default recipe
* **Claim:** v0 agent → harness eng with prod-like evals → (optional) SFT → RL → light harness again.
* **On-Slide Content:**
  * Step 1: Base model + kuat custom harness.
  * Step 2: Extract execution traces to build evaluation suites.
  * Step 3: Fine-tune/SFT model.
  * Step 4: Run RL training to absorb harness logic back into model weights.
* **Source:** Viv Trivedy · D7 · 2026
* **Speaker Notes:** Start with a baseline model and wrap it in a strong verification harness. Use the harness to collect traces. Only fine-tune once you've hit the limits of prompt and tool design. Once the model gets smarter, lighten the harness rules.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Flywheel recipe | LangChain original co-evolution flywheel preview |

---

### Slide 24: Trace → eval → improve
* **Claim:** Traces are the lifeblood of agentic engineering. Every pipeline failure must be mined to create a new evaluation case.
* **On-Slide Content:**
  * Monitor agent traces in production.
  * Capture exact moments of tool failure or infinite retries.
  * Build regression test suites from failed traces to drive code updates.
* **Sources:** Viv Trivedy · D8 | LangChain Better Harness · C3
* **Speaker Notes:** Trivedy calls this the hill-climbing machine. Instead of guessing how prompts work, look at actual traces. If the model fails, write a regression test. That way, when you update tools or switch models, you know immediately if performance improved.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Hill-climbing notes | Circular feedback path: Trace Log -> Eval Suite -> Fix Loop |

---

### Slide 25: Case studies that move the needle
* **Claim:** Extreme harness engineering delivers orders-of-magnitude improvements.
* **On-Slide Content:**
  * **OpenAI Codex:** Strong execution harnesses unlocked PR generation.
  * **Cursor:** Direct context/tool optimizations outperformed raw model upgrades.
  * **AutoBE:** Redesigning tool feedback raised success rate on Qwen from **6.75% to 100%**.
* **Sources:** OpenAI · B3/B4 | Cursor · B5 | AutoBE · E6 · 2026
* **Speaker Notes:** These are the 3 quantified/extreme examples. AutoBE is the most striking: they didn't train Qwen or prompt-engineer it to be smarter. They simply rewrote the function-calling harness to parse and feed back errors structurally. Same model, 15x success rate jump.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Extreme details | Performance Bar Chart: 6.75% vs 100% |

---

### Slide 26: Self-harness: agents rewrite the loop
* **Claim:** Weakness mining → harness proposal → regression validate. Skills evolve. Trust batteries.
* **On-Slide Content:**
  * Agents inspect their own trace history.
  * Write proposals for new helper scripts/tools.
  * Validate against the eval suite.
  * Build a trust battery through incremental, validated modifications.
* **Sources:** Harrison Chase · C6 | MetaHarness · G3 | Memento · F13 | Nityesh · F14
* **Speaker Notes:** Self-harnessing shifts the outer loop to the agent. Harrison Chase and the MetaHarness paper demonstrated agents generating their own API wrappers to solve novel tasks. The developer's role moves from coding to grading the self-edit.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | Self Modifying Loop: Agent Logic editing tools.json |

---

## Act V — Future: don’t impede the model path (slides 27–30)

### Slide 27: Tension: harness progress vs model progress
* **Claim:** Tension: Will specialized harness tricks be swallowed by native model gains?
* **On-Slide Content:**
  * **Harness Tricks:** Custom retry parsers, prompt hacks (risk becoming obsolete).
  * **Model Gains:** Native reasoning, structural JSON output, native execution.
* **Sources:** Mike Knoop · F11 | Daniel Miessler · A8 · 2026
* **Speaker Notes:** This is tension slide 3 (debate slide). Mike Knoop points out that complex prompt engineering can be wiped out by a new model release. However, Miessler shows that the harness handles what the model cannot: authorization, database connections, and real-world side effects.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Tension definitions | LangChain original co-evolution benchmark diagram preview |

---

### Slide 28: Don’t overfit the harness
* **Claim:** Tension: Overfitting to current model quirks vs designing generalizable interfaces.
* **On-Slide Content:**
  * Avoid brittle hacks that break on next-gen models.
  * Prioritize clean schema contracts over prompt-specific instructions.
  * Keep codebases model-agnostic.
* **Sources:** Drew Breunig · E9 · 2026 | Akash Bajwa · E7 · 2026
* **Speaker Notes:** This is tension slide 4 (debate slide). Breunig warns that building highly custom prompts to patch model quirks is a form of technical debt. Build clean interfaces and schemas. Let the next model succeed by keeping your harness simple and swappable.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Tension definitions | Brittle Fit circle vs Clean Decoupled box |

---

### Slide 29: Don’t impede the model path
* **Claim:** Build thin, measurable, swappable harnesses. Determinism where you can; probability where you must.
* **On-Slide Content:**
  * Cage: hardcoded prompts, model-specific overrides, opaque tools (blocks progress).
  * Thin: contracts, isolated environments, test suites, swappable APIs.
* **Sources:** Viv Trivedy · D9 · 2026 | Mike Knoop · F11 | Daniel Miessler · A8
* **Speaker Notes:** This is diagram D6. Keep your harness architecture decoupled. If your harness relies on model-specific hacks, you can't swap when a cheaper or faster model drops. The harness should coordinate tools and verify outputs, leaving reasoning to the model.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Bullet Points & Citations | Comparison concept diagram: The Cage vs Thin Harness |

---

### Slide 30: Close: ship the flywheel
* **Claim:** Harness is all you need until it isn't—then evolve it without blocking the model.
* **On-Slide Content:**
  * Final CTA: Ship a v0 harness, instrument traces, hill-climb with evals.
  * Focus on trace collection and regression suite expansion.
  * Resources: awesome-harness-engineering (https://github.com/ai-boost/awesome-harness-engineering)
* **Sources:** All of Act IV + awesome-harness-engineering
* **Speaker Notes:** Summarize the closing CTA. Don't wait for the perfect model or the perfect prompt. Build your v0 harness, gather traces, and let the failures drive your eval suite. Evolve your execution loop continuously. Open up for Q&A.

| Left Side (Text) | Right Side (Visual) |
|---|---|
| Closing CTA & References | Circular loop showing Flywheel Ship |
