# Harness Engineering — Source Pack + 30-Slide Deck Brief

**Date:** 2026-07-12  
**Purpose:** Export of Field Theory library sources on harness engineering, plus an instruction prompt for building a 30-slide presentation.  
**Audience:** Engineers, agent builders, tech leads, AI product people  
**Talk length target:** 25–35 minutes + Q&A  
**Narrative spine:** Chat → Copilot → “Bash is all you need” → **Harness is all you need** → Future: **don’t impede the model path**

---

## How to use this document

1. Feed this entire file to a slide-generation agent (or human designer).
2. Follow **§ Instruction prompt for slide deck generation** first.
3. Use **§ 30-slide outline** as the locked structure (do not invent a different arc).
4. Pull quotes, links, and case studies from **§ Source bibliography**.
5. Prefer diagrams over bullet walls; prefer one claim per slide.

---

## Instruction prompt for slide deck generation

Copy everything in the block below into your slide agent / designer:

```text
You are a senior conference talk designer. Create a 30-slide presentation on
"Harness Engineering" for a technical AI/software audience.

## Talk thesis (must appear explicitly by slide 5 and again on the close)

Agent = Model + Harness.

We moved from:
  Chat (conversation) →
  Copilot (inline assist) →
  "Bash is all you need" (raw tools + terminal loop) →
  Harness is all you need (engineered context, tools, verification, recovery) →
  Future: don't impede the model path (harness as thin, evolving substrate—
  not a cage that freezes model progress).

Reliability in agentic software development comes from engineered guardrails
and feedback loops, not model capability alone—but over-engineering the harness
can fight the bitter lesson. The craft is knowing what to make deterministic
and what to leave to the model.

## Hard constraints

- Exactly 30 slides (title + close included). No appendix dump slides.
- One primary claim per slide. Max 5 bullets if bullets are used.
- Every major claim must cite at least one source from the bibliography
  (short form: Author/Org · title or handle · year if known).
- Include at least 6 diagrams (boxes/arrows or simple architecture).
  Prefer plain-language diagrams over decorative visuals.
- Include at least 4 "debate / tension" slides (bitter lesson vs harness,
  universal vs task-specific, skills vs subagents, overfitting).
- Include at least 3 quantified or extreme examples (OpenAI Codex PR story,
  function-calling harness jump, Cursor continuous harness improvement, etc.).
- Visual tone: dark engineering / systems talk, not startup hype.
- Speaker notes: 2–4 sentences per slide, including what to say if short on time.
- Closing CTA: "Ship a v0 harness, instrument traces, hill-climb with evals."

## Narrative arc (do not reorder)

Act I — The migration of the interface (slides 1–7)
  Chat → Copilot → tools/bash → agents → harness as the product

Act II — What a harness actually is (slides 8–14)
  Vocabulary, anatomy, model+harness equation, long-running agents

Act III — Engineering the harness (slides 15–22)
  Context, tools, isolation, tests, policies, review, durability, memory

Act IV — Improvement loops & self-harness (slides 23–26)
  Evals, hill-climbing, self-modifying harnesses, enterprise flywheel

Act V — Future: don't impede the model path (slides 27–30)
  Overfitting risks, bitter lesson, thin harness, close

## Required talk structure for each slide output

For each slide output:
  - Slide number + title
  - On-slide text (headline + bullets or diagram description)
  - Suggested visual
  - 1–2 source citations (from bibliography)
  - Speaker notes
  - Optional "cut if short" note

## Style rules for headlines

- Prefer verbs and claims: "The harness is the product"
- Avoid vague titles: not "Overview" / "More thoughts"
- Use progressive refrains:
  - "Chat was the interface"
  - "Copilot was the interface"
  - "Bash was the interface"
  - "The harness is the interface"
  - "Don't impede the model path"

## Key phrases to use (and define once)

- Harness engineering
- Agent = Model + Harness
- Context engineering vs harness engineering
- Executable feedback (tests, judges, rubrics)
- Task isolation / worktrees / sandboxes
- Trace → eval → improve
- Model–harness fit
- Don't impede the model path
- Determinism where you can, probability where you must

## Deliverables

1. Full 30-slide deck content in Markdown (one H2 per slide).
2. A one-page speaker run-of-show with time boxes.
3. A "sources on screen" list for the final slide (8–12 links max).
4. Optional: Mermaid diagrams for the 6+ architecture slides.

Do not invent papers or URLs. Only use sources listed in the bibliography
section of the source document. If you need a generic claim without a
specific source, mark it as [speaker claim].
```

---

## 30-slide outline (locked structure)

### Act I — The migration of the interface

| # | Title | Claim | Sources to lean on |
|---|--------|--------|--------------------|
| 1 | **Title: Harness Engineering** | Subtitle: From chat to “harness is all you need”—and why not to impede the model path | — |
| 2 | **The question this talk answers** | Why do two teams with the same model get wildly different agent results? | Viv Trivedy recipe tweet; Jerry Liu “model harness is everything” |
| 3 | **Chat was the interface** | Early LLM UX = conversation. Capability lived in the prompt window. | [speaker claim] + Schmid “importance of agent harness” for contrast |
| 4 | **Copilot was the interface** | Inline completion moved AI into the editor—still human-driven, single-turn-ish. | VS Code Copilot harness blog (as later evolution) |
| 5 | **Thesis: Agent = Model + Harness** | Same model, different harness → different product. | Viv `Agent = Model + Harness`; LangChain frameworks/runtimes/harnesses |
| 6 | **“Bash is all you need”** | Tool-calling + shell felt like the unlock—minimal loop, maximal freedom. | [speaker claim] + HumanLayer / coding agent practice; bash-centric agent culture |
| 7 | **Then agents hit the wall** | Long runs forget; tools thrash; green tests lie; permissions explode. | Anthropic long-running agents; Pamela Fox specs drift; Kenton Varda permissions |

### Act II — What a harness actually is

| # | Title | Claim | Sources |
|---|--------|--------|---------|
| 8 | **Vocabulary: framework · runtime · harness** | Framework helps you build; runtime executes graphs; harness is the productized loop around a model. | LangChain “Agent Frameworks, Runtimes, and Harnesses” |
| 9 | **Harness engineering, coined** | Applying context-engineering discipline to *how you use* an existing agent. | dexhorthy origin tweet (2025-11) |
| 10 | **Anatomy of an agent harness** | Tools, context loaders, policies, memory, sandboxes, judges, stop conditions. | LangChain “Anatomy of an Agent Harness”; Viv anatomy tweet |
| 11 | **Diagram: the agent loop** | Observe → act → tool → observe → (judge) → stop; state on disk, not only in context. | Anthropic effective harnesses; Avi Chawla / loop engineering notes |
| 12 | **Long-running agents need low-tech memory** | Progress logs, git commits, explicit feature lists beat “hope the context remembers.” | Anthropic effective harnesses; dabit3 summary notes in FT library |
| 13 | **Harness as a Service (HaaS)** | The moat shifts from model access to productized harness + distribution. | Viv HaaS post; Ryan Carson / Amp “elbow grease in the harness” |
| 14 | **Opinionated agents win** | Too many options, not enough defaults. Encode team taste in prompts/tools/defaults. | Viv “Agents Should Be More Opinionated” |

### Act III — Engineering the harness

| # | Title | Claim | Sources |
|---|--------|--------|---------|
| 15 | **Context is load-bearing** | Skills, progressive disclosure, subagents—when to load vs when to delegate. | dexhorthy; skills vs subagents discussion sources in FT ask |
| 16 | **Tools are contracts** | Bad tool schemas = agent failure that looks like “dumb model.” | Sarah Sachs tool-call work; Notion harness praise; AutoBE function-calling harness |
| 17 | **Task isolation** | One task, one agent, one workspace/worktree/sandbox. | Geoffrey Huntley modularity; worktree culture; Kenton capabilities |
| 18 | **Executable feedback** | Give the agent a failing test / rubric / judge—not a vibe. | Matt Pocock failing-test-first; evals as training data (Viv) |
| 19 | **Architectural guardrails** | AST policies, lint, allowed paths—mechanical constraints > nagging prompts. | steipete AST guardrails |
| 20 | **Review is part of the harness** | Adversarial second agent / dual implementers / human merge gate. | shafty023 adversarial review; Matt dual-agent eval |
| 21 | **Durability & recovery** | Checkpoints, durable execution, resume after failure. | sydneyrunkle durable execution |
| 22 | **Memory: context layer vs harness layer** | Memory in prompt ≠ memory in harness (mods, skills, files, traces). | Dhravya harness-level memory; Sarah Wooders mods; LangChain “your harness, your memory” |

### Act IV — Improvement loops & self-harness

| # | Title | Claim | Sources |
|---|--------|--------|---------|
| 23 | **The default recipe** | v0 agent → harness eng with prod-like evals → (optional) SFT → RL → light harness again. | Viv default recipe tweet |
| 24 | **Trace → eval → improve** | Traces are the lifeblood; every failure becomes an eval. | Viv hill-climbing machine; LangChain Better Harness |
| 25 | **Case studies that move the needle** | OpenAI Codex harness eng (massive PR throughput); Cursor continual harness improvement; AutoBE 6.75%→100%. | OpenAI harness engineering; Cursor blog; AutoBE |
| 26 | **Self-harness: agents rewrite the loop** | Weakness mining → harness proposal → regression validate. Skills evolve. Trust batteries. | Harrison Self-Harness; MetaHarness; Memento-Skills; Nityesh trust battery |

### Act V — Future: don’t impede the model path

| # | Title | Claim | Sources |
|---|--------|--------|---------|
| 27 | **Tension: harness progress vs model progress** | Universal model gains can swallow specialized harness tricks. | Mike Knoop; bitter lesson discussions; Daniel Miessler good/bad harness |
| 28 | **Don’t overfit the harness** | Brittle prompts/tools that only work for today’s model version. | Drew Breunig overfitting; model–harness fit framing |
| 29 | **Don’t impede the model path** | Build thin, measurable, swappable harnesses. Determinism where you can; probability where you must. Leave room for the next model to win. | Viv “AGI will have a harness but JIT”; Knoop; Miessler; speaker synthesis |
| 30 | **Close: ship the flywheel** | Start: v0 harness + traces + one eval suite. Mantra: harness is all you need *until* it isn’t—then evolve it without blocking the model. Sources list. | All of Act IV + awesome-harness-engineering |

---

## Suggested run-of-show (30 minutes)

| Minutes | Slides | Mode |
|---------|--------|------|
| 0–2 | 1–2 | Hook + question |
| 2–7 | 3–7 | Historical arc (fast) |
| 7–14 | 8–14 | Definitions + anatomy |
| 14–22 | 15–22 | Engineering patterns |
| 22–26 | 23–26 | Improvement & self-harness |
| 26–29 | 27–29 | Future / bitter lesson |
| 29–30 | 30 | Close + CTA |
| +Q&A | — | Debate slides 27–28 as backup |

**If cut to 15 minutes:** keep slides 1, 5, 7, 8, 10, 12, 18, 23, 25, 29, 30.

---

## Diagram briefs (for the 6+ architecture slides)

### D1 — Evolution of the interface (slide 3–7 cluster)

```text
[Chat UI] → [Copilot in editor] → [Tools / Bash loop] → [Agent product] → [Harness product]
   prompt           completion           shell+tools        multi-step         full system
```

### D2 — Framework vs Runtime vs Harness (slide 8)

```text
Framework: building blocks (chains, tools, prompts)
Runtime:   durable graph execution, state, retries
Harness:   the opinionated outer loop users actually run
```

### D3 — Agent = Model + Harness (slide 5 / 10)

```text
┌──────────────────────────────────────────┐
│                 HARNESS                  │
│  context · tools · policy · sandbox      │
│  memory · judge · stop · observability   │
│         ┌──────────────────┐             │
│         │      MODEL       │             │
│         └──────────────────┘             │
└──────────────────────────────────────────┘
```

### D4 — Long-running harness (slide 12)

```text
Feature list ──► Agent session (context N)
     ▲                 │
     │            git commit + progress.md
     │                 │
     └──────── new session (context N+1)
```

### D5 — Improvement flywheel (slide 23–24)

```text
Ship v0 → Collect traces → Mine failures → Write evals
   ↑                                         │
   └──── Harness change / model change ◄─────┘
```

### D6 — Thin harness vs cage (slide 29)

```text
Cage: frozen prompts, model-specific hacks, opaque tools
Thin: contracts, evals, sandboxes, swappable models, measurable loops
```

---

## Source bibliography

Organized for the deck. Prefer **long-form** on-screen; use **X** for quotes.

### A. Definitions & framing

| # | Title | URL |
|---|--------|-----|
| A1 | dexhorthy — coining “harness engineering” | https://x.com/dexhorthy/status/1985699548153467120 |
| A2 | LangChain — Agent Frameworks, Runtimes, and Harnesses | https://blog.langchain.com/agent-frameworks-runtimes-and-harnesses-oh-my/ |
| A3 | Latent Patterns — Agent Harness glossary | https://latentpatterns.com/glossary/agent-harness |
| A4 | Martin Fowler — Harness Engineering | https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html |
| A5 | Martin Fowler — Harness engineering for coding agent users | https://martinfowler.com/articles/harness-engineering.html |
| A6 | Philipp Schmid — The importance of Agent Harness in 2026 | https://www.philschmid.de/agent-harness-2026 |
| A7 | Addy Osmani — Agent Harness Engineering | https://addyosmani.com/blog/agent-harness-engineering/ |
| A8 | Daniel Miessler — Good and Bad Harness Engineering | https://danielmiessler.com/blog/good-and-bad-harness-engineering |
| A9 | inference.sh — The Agent Harness Is a Shell | https://inference.sh/blog/opinions/harness-is-a-shell |
| A10 | Pydantic — What makes a good agent harness | https://pydantic.dev/articles/what-makes-a-good-harness |

### B. Lab / vendor case studies

| # | Title | URL |
|---|--------|-----|
| B1 | Anthropic — Effective harnesses for long-running agents | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents |
| B2 | Anthropic — Harness design for long-running application development | https://www.anthropic.com/engineering/harness-design-long-running-apps |
| B3 | OpenAI — Harness engineering: leveraging Codex in an agent-first world | https://openai.com/index/harness-engineering/ |
| B4 | OpenAI — Unlocking the Codex harness | https://openai.com/index/unlocking-the-codex-harness/ |
| B5 | Cursor — Continually improving our agent harness | https://cursor.com/blog/continually-improving-agent-harness |
| B6 | VS Code — The Coding Harness Behind GitHub Copilot | https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode |
| B7 | Claude — Harnessing Claude's Intelligence (patterns) | https://claude.com/blog/harnessing-claudes-intelligence |

### C. LangChain / Deep Agents research line

| # | Title | URL |
|---|--------|-----|
| C1 | Improving Deep Agents with harness engineering | https://blog.langchain.com/improving-deep-agents-with-harness-engineering/ |
| C2 | The Anatomy of an Agent Harness | https://blog.langchain.com/the-anatomy-of-an-agent-harness/ |
| C3 | Better Harness: hill-climbing with evals | https://blog.langchain.com/better-harness-a-recipe-for-harness-hill-climbing-with-evals/ |
| C4 | Your harness, your memory | https://blog.langchain.com/your-harness-your-memory/ |
| C5 | deepagents better-harness example | https://github.com/langchain-ai/deepagents/tree/main/examples/better-harness |
| C6 | Harrison Chase — Self-Harness paper thread | https://x.com/hwchase17/status/2069443268593537470 |

### D. Vivek Trivedy (thought-leader spine)

| # | Title | URL |
|---|--------|-----|
| D1 | HaaS — Claude Code SDK / Harness as a Service | https://www.vtrivedy.com/posts/claude-code-sdk-haas-harness-as-a-service |
| D2 | Agents Should Be More Opinionated | https://www.vtrivedy.com/posts/agents-should-be-more-opinionated |
| D3 | What’s actually in an agent & harness? | https://x.com/Vtrivedy10/status/2002077611548135756 |
| D4 | Harness eng as execution loop + runtime management | https://x.com/Vtrivedy10/status/2006860001571185087 |
| D5 | Building better coding agent harnesses | https://x.com/Vtrivedy10/status/2022018287408910745 |
| D6 | Anatomy of an Agent Harness (X) | https://x.com/Vtrivedy10/status/2031408954517971368 |
| D7 | Default recipe: Agent = Model + Harness | https://x.com/Vtrivedy10/status/2063429138304668093 |
| D8 | Building the hill-climbing machine | https://x.com/Vtrivedy10/status/2066366762111672348 |
| D9 | Prediction: AGI will have a JIT harness | https://x.com/Vtrivedy10/status/2038694275987181723 |

### E. Practical coding-agent harnesses

| # | Title | URL |
|---|--------|-----|
| E1 | HumanLayer — Skill Issue: Harness Engineering for Coding Agents | https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents |
| E2 | dexhorthy — 10 things learned about harness engineering | https://x.com/dexhorthy/status/2032524853530832921 |
| E3 | Alex Lavaee — Harness coding agents with infrastructure | https://alexlavaee.me/blog/harness-engineering-why-coding-agents-need-infrastructure/ |
| E4 | 12 Agentic Harness Patterns from Claude Code | https://generativeprogrammer.com/p/12-agentic-harness-patterns-from |
| E5 | iii.dev — How to Build Your Own Agent Harness | https://iii.dev/blog/how-to-build-your-own-agent-harness/ |
| E6 | AutoBE — Function Calling Harness: 6.75% → 100% | https://autobe.dev/blog/function-calling-harness-qwen-meetup-korea/ |
| E7 | Akash Bajwa — Workload–Harness Fit | https://www.akashbajwa.co/p/agent-labs-workload-harness-fit |
| E8 | Lee Han Chung — Hidden technical debt: agent harness | https://leehanchung.github.io/blogs/2026/05/08/hidden-technical-debt-agent-harness/ |
| E9 | Drew Breunig — The Cost of Overfitting the Harness | https://www.dbreunig.com/2026/05/10/overfitting-the-harness.html |
| E10 | Latent Space — Extreme Harness Engineering (Lopopolo) | https://www.latent.space/p/harness-eng |

### F. High-signal X posts (quotes / debate)

| # | Handle / topic | URL |
|---|----------------|-----|
| F1 | Jerry Liu — The Model Harness is Everything | https://x.com/jerryjliu0/status/2026840829441225127 |
| F2 | NVIDIA / Jensen — model thinks, harness gives form | https://x.com/nvidia/status/2068000859321970871 |
| F3 | Matt Pocock — failing test first | https://x.com/mattpocockuk/status/2025935480609468862 |
| F4 | Matt Pocock — dual implementer eval | https://x.com/mattpocockuk/status/2068680605705838808 |
| F5 | steipete — AST guardrails | https://x.com/steipete/status/1963411717192651154 |
| F6 | shafty023 — adversarial review | https://x.com/shafty023/status/2038682025662750748 |
| F7 | sydneyrunkle — durable execution | https://x.com/sydneyrunkle/status/2049132897227936073 |
| F8 | Geoffrey Huntley — modularity vs forgetfulness | https://x.com/GeoffreyHuntley/status/2036878840413278411 |
| F9 | Pamela Fox — specs alone insufficient | https://x.com/pamelafox/status/2047195483815465181 |
| F10 | Kenton Varda — capability-based agent auth | https://x.com/KentonVarda/status/2069765917018382568 |
| F11 | Mike Knoop — LLM systems swallow harness progress | https://x.com/mikeknoop/status/2036323325912424885 |
| F12 | Sarah Wooders — agents rewrite harness (mods) | https://x.com/sarahwooders/status/2070643422139224151 |
| F13 | muratcan — Memento-Skills | https://x.com/muratcan/status/2067299058335531172 |
| F14 | Nityesh — trust battery / skill self-edit | https://x.com/nityeshaga/status/2067705249259983231 |
| F15 | Dhravya — memory on harness level | https://x.com/DhravyaShah/status/2069232087929156006 |
| F16 | akshay_pachaar — Don’t train the model, evolve the harness | https://x.com/akshay_pachaar/status/2072961737008336937 |
| F17 | Santiago — model / harness / context / users | https://x.com/svpino/status/2070210421995569537 |
| F18 | Aravind Srinivas — model-harness-sandbox-eval flywheel | https://x.com/AravSrinivas/status/2070938739350900944 |
| F19 | Fred K. Schott — Flue harness framework | https://x.com/FredKSchott/status/2050274923852210397 |
| F20 | Daniel Miessler — life harnesses | https://x.com/DanielMiessler/status/2071737735199813930 |
| F21 | Cognition — Devin Fusion hybrid harness | https://x.com/cognition/status/2071624568465490170 |
| F22 | Vercel — AI SDK HarnessAgent | https://x.com/vercel_dev/status/2065509970775519569 |

### G. Open source & demos

| # | Project | URL |
|---|---------|-----|
| G1 | awesome-harness-engineering | https://github.com/ai-boost/awesome-harness-engineering |
| G2 | walkinglabs/learn-harness-engineering | https://github.com/walkinglabs/learn-harness-engineering |
| G3 | stanford-iris-lab/meta-harness | https://github.com/stanford-iris-lab/meta-harness |
| G4 | coleam00/Linear-Coding-Agent-Harness | https://github.com/coleam00/Linear-Coding-Agent-Harness |
| G5 | GetSmallAI/SmallHarness | https://github.com/GetSmallAI/SmallHarness |
| G6 | wedow/harness | https://github.com/wedow/harness |
| G7 | MaxGfeller/open-harness | https://github.com/MaxGfeller/open-harness |
| G8 | aliou/pi-harness | https://github.com/aliou/pi-harness |
| G9 | browser-use/browser-harness | https://github.com/browser-use/browser-harness |
| G10 | agentharnesses/agentharnesses | https://github.com/agentharnesses/agentharnesses |
| G11 | TejasQ/basically-ai-harness | https://github.com/TejasQ/basically-ai-harness |
| G12 | AlexKenbo/codex-harness-internals | https://github.com/AlexKenbo/codex-harness-internals |
| G13 | poolsideai/pool | https://github.com/poolsideai/pool |
| G14 | Flue framework | https://flueframework.com/ |
| G15 | Cloudflare — Flue / agents platform | https://blog.cloudflare.com/agents-platform-flue-sdk/ |

### H. Videos & talks

| # | Title | URL |
|---|--------|-----|
| H1 | Harness Engineering Masterclass | https://www.youtube.com/watch?v=mQfTdNVCOB0 |
| H2 | Harnesses in AI — Tejas Kumar, IBM | https://www.youtube.com/watch?v=C_GG5g38vLU |
| H3 | Ryan Lopopolo — Humans steer, agents execute | https://www.youtube.com/watch?v=am_oeAoUhew |
| H4 | 0xSero — I used every AI harness | https://www.youtube.com/watch?v=AE7aeZWdobY |
| H5 | Context vs Harness vs Software Engineering | https://www.youtube.com/watch?v=gX9WpYY61xA |
| H6 | Vivek Trivedy — Never Ending Lore of Harness | https://www.youtube.com/watch?v=NovNcsKX8AU |
| H7 | What if the harness mattered more than the model? (Etsy) | https://www.youtube.com/watch?v=2e9ANoOEn28 |
| H8 | Rethinking AI Agents: Rise of Harness Engineering | https://www.youtube.com/watch?v=Xxuxg8PcBvc |
| H9 | Harness engineering beyond skills | https://www.youtube.com/watch?v=uLWOLmeHOSE |
| H10 | [Podcast] The Agent Harness | https://www.youtube.com/watch?v=_efJ8baMSDw |

### I. Meta / further reading

| # | Title | URL |
|---|--------|-----|
| I1 | theharness.blog — The Third Axis | https://theharness.blog/blog/the-third-axis/ |
| I2 | Tony Kipkemboi — One company harness | https://www.linkedin.com/pulse/case-one-company-harness-more-agents-tony-kipkemboi-uek6e |
| I3 | DAIR — Dynamic workflows / generating harnesses | https://academy.dair.ai/events/cmpzo9kk3000g04lgsgf5io3z |

---

## Quote bank (ready for slides)

> “there's a new concept I'm seeing emerging in AI Agents (especially coding agents), which I'll call **harness engineering**”  
> — @dexhorthy · A1

> **Agent = Model + Harness** — you should “train” both.  
> — @Vtrivedy10 · D7

> “The Model Harness is Everything”  
> — @jerryjliu0 · F1

> “The model thinks. The harness gives it form.”  
> — NVIDIA / Jensen framing · F2

> Long-running agents: progress logs, git commits, explicit feature lists.  
> — Anthropic Engineering · B1

> “Don’t train the model, evolve the harness.”  
> — @akshay_pachaar · F16

> LLM systems can swallow harness progress; design for model path, not against it.  
> — @mikeknoop · F11 + speaker synthesis

> Determinism where you can, probability where you must.  
> — community framing · F-series / A10

---

## Final on-screen sources (slide 30 — pick 10)

1. https://blog.langchain.com/agent-frameworks-runtimes-and-harnesses-oh-my/  
2. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents  
3. https://openai.com/index/harness-engineering/  
4. https://blog.langchain.com/the-anatomy-of-an-agent-harness/  
5. https://blog.langchain.com/better-harness-a-recipe-for-harness-hill-climbing-with-evals/  
6. https://www.vtrivedy.com/posts/agents-should-be-more-opinionated  
7. https://cursor.com/blog/continually-improving-agent-harness  
8. https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents  
9. https://www.dbreunig.com/2026/05/10/overfitting-the-harness.html  
10. https://github.com/ai-boost/awesome-harness-engineering  

---

## Provenance

- Compiled from Field Theory CLI knowledge base (`ft ask`, `ft search`, `ft grep`, library bookmarks under `~/.fieldtheory/library/bookmarks/*harness*`).  
- ~150 unique harness-named sources in the local library; this doc is the curated subset for a 30-slide talk.  
- Related FT note: prior conversational export 2026-07-12 on harness engineering sources.

---

## Next actions (optional)

- [ ] Generate actual deck HTML/PPTX from this brief  
- [ ] Record 60s cold open for slide 2  
- [ ] Build one live demo: failing test → harness loop → green (slides 18 + 23)  
- [ ] Save deck under `docs/talks/` next to this file  
