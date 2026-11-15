# ⚖️ GitLaw: PR Reviewer that Learns Team Conventions

> **Mines past pull request review comments to learn your team's unwritten rules, then flags incoming PRs that break them with exact line annotations, past PR citations, and one-click commit suggestions.**

---

## 🌟 Why GitLaw?

Every engineering team has tacit knowledge: unwritten coding standards, architectural patterns, and recurring nitpicks that linters cannot catch.
- *"In service classes, always return `Result<T, E>` instead of throwing raw `Error`."*
- *"Don't forget to add composite indexes on foreign keys in migrations."*
- *"Prefer dependency injection over importing singleton instances."*
- *"Use our structured logger instead of `console.log`."*

Senior engineers spend hours re-typing these exact same review comments across PRs. **GitLaw solves this** by automatically mining historical PR review comments, synthesizing verified conventions into an embedded vector database, and auditing incoming pull requests in real time.

```
       Mining Phase (Historical PRs)                    Review Phase (Incoming PR)
┌───────────────────────────────────────────┐     ┌────────────────────────────────────┐
│ • Fetch closed PR review comments         │     │ • Parse incoming unified diff      │
│ • Filter bots, praise, and trivial noise  │     │ • Match globs & semantic vectors   │
│ • Extract structured rules via LLM        │     │ • LLM audits diff against rules    │
│ • Deduplicate & boost confidence          │     │ • Post inline diff comments +      │
└─────────────────────┬─────────────────────┘     │   summary review with PR citations │
                      │                           └─────────────────▲──────────────────┘
                      ▼                                             │
             ┌─────────────────┐                                    │
             │ Embedded SQLite │────────────────────────────────────┘
             │  Vector Store   │
             └─────────────────┘
```

---

## ✨ Features

- 🧠 **Historical Convention Mining:** Scans closed PRs, extracts substantive conventions, and ignores bots, "LGTM", and administrative noise.
- 🔄 **Continuous Learning:** When team members leave review comments on new PRs, GitLaw continuously learns and strengthens existing conventions.
- 📐 **Semantic Vector Search:** Embedded SQLite vector store matches candidate conventions to diff changes using cosine similarity and file glob filters.
- 🎯 **Targeted Inline Review Comments:** Flags violations directly on the exact line of the diff with:
  - Severity level (`🔴 error`, `🟡 warning`, `ℹ️ info`)
  - Confidence rating (e.g., `95% confidence`)
  - Citations to historical PR discussions (`"In PR #104 by @tech-lead..."`)
  - Drop-in ````suggestion ```` code blocks that developers can commit directly from GitHub.
- 🤖 **Provider-Agnostic LLM Engine:** Native support for **Google Gemini**, **OpenAI** (and OpenAI-compatible endpoints like Ollama, Groq, DeepSeek), **Anthropic Claude**, and an offline Mock provider.
- 📄 **Auditable & Versionable:** Export learned conventions to `.github/conventions.md` or JSON so your team can inspect, version, and edit them in git.
- ⚡ **Dual Execution Modes:** Run as a **GitHub App (Probot)** with webhooks and slash commands, or as a standalone **CLI / GitHub Action** in CI pipelines.

---

## 🚀 Quick Start

### 1. Installation

```bash
git clone https://github.com/JaswanthRemiel/GitLaw.git
cd GitLaw
npm install
npm run build
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure your API keys:

```bash
cp .env.example .env
```

```env
# Provider options: "gemini" | "openai" | "anthropic" | "mock"
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key

# GitHub Personal Access Token (for CLI mining/reviews)
GITHUB_TOKEN=ghp_your_github_token
```

---

## 🛠️ CLI Usage

GitLaw comes with a full-featured CLI:

### Mine Past PRs
Mine team conventions from any GitHub repository:

```bash
gitlaw mine --repo my-org/backend-repo --limit 50
```

### Review a PR or Local Diff
Audit an open pull request or local git diff against learned conventions:

```bash
# Review a GitHub PR
gitlaw review --repo my-org/backend-repo --pr 142

# Review a local git diff file
gitlaw review --diff ./path/to/feature.diff

# Review and post inline comments to GitHub
gitlaw review --repo my-org/backend-repo --pr 142 --publish
```

### Manage Conventions

```bash
# List all active learned conventions with confidence scores
gitlaw rules list

# Export conventions to markdown documentation
gitlaw rules export --format markdown --out .github/conventions.md

# Import or seed conventions from JSON
gitlaw rules import --input examples/sample-conventions.json
```

---

## 💬 PR Slash Commands

When running as a GitHub App, engineers can interact with GitLaw directly inside PR comments:

| Command | Action |
| :--- | :--- |
| `/gitlaw review` | Triggers an immediate convention audit on the current PR. |
| `/gitlaw learn` | Mines recent closed PRs to extract and reinforce team conventions. |
| `/gitlaw rules` | Prints a summary list of all active conventions learned so far. |
| `/gitlaw help` | Displays available slash commands and usage guidance. |

---

## 🚢 GitHub Actions CI Integration

You can also run GitLaw directly in GitHub Actions without deploying a server:

```yaml
name: GitLaw Convention Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  audit-conventions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install GitLaw
        run: |
          npm ci
          npm run build

      - name: Run Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: |
          git diff origin/${{ github.base_ref }}...HEAD > pr.diff
          node dist/cli/index.js review --diff pr.diff
```

---

## 🧪 Running Tests

GitLaw includes unit and integration tests covering vector embeddings, noise filtering, database operations, rule synthesis, and diff auditing:

```bash
npm test
```

---

## 📜 License

MIT License. Designed and built with ❤️ by the GitLaw team.
