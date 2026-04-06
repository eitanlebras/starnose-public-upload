# starnose

See what Claude Code is reading, thinking, and doing.
Understand every decision. Know if it's stuck.

```bash
npx snose on
# add the printed PATH export to ~/.zshrc
source ~/.zshrc

# use claude normally
claude "refactor the auth module"

# in another terminal — watch it work
snose sense

# after — understand every decision
snose dig
```

## commands

`snose on` · `snose off` · `snose status`
`snose sense` · `snose dig`

Both `snose` and `starnose` work as binary names.

## how it works

Starnose sits between Claude Code and the Anthropic API as an HTTP proxy.
One env var (`ANTHROPIC_BASE_URL`), zero code changes to Claude Code.
Every call is recorded to SQLite with full system prompt parsing,
thinking block extraction, compaction detection, and missing context tracking.

## install

```bash
npm install
npm run build
```

MIT. starnose.dev
