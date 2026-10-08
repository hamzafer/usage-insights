# Setup (example)

A generic example of the Setup file. The real one lives in the data directory
(`<data dir>/setup.md`, ADR 0002), never in this repo. `bun run setup:draft` writes a DRAFT
template there; Reports say "Setup is a DRAFT" until you remove the word DRAFT from its first line.

Claude reads this file, with the week's numbers, to write at most 3 Suggestions.

## Providers and plans

- **Claude (personal)**: Max plan, $100/month. Main coding and side projects.
- **Claude (work)**: Team plan, paid by the employer, extra usage allowed up to $50/month. Work projects only.
- **Codex**: Plus plan, $20/month. Code reviews (one review pass per PR), some coding.
- **Cursor**: Pro plan, $20/month allowance. Rarely used.
- **Copilot**: Free tier, 50 premium requests/month. Barely used.

Where a price is not known, write "unknown, fill in" rather than guessing.

## Goals

- Reduce Waste: allowance left unused at Reset.
- Avoid Limit Hits during working hours.
- Consider shifting work between Providers when one sits idle and another hits its limit.
- Use idle allowances for side projects.
