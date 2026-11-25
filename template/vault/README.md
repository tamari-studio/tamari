# Starter vault

A blank vault with a ready structure: PARA folders, Maps of Content, a note schema, and three
Claude Code skills. Copy it, make it yours, and point Tamari's **Vault** space at it.

```sh
cp -R template/vault ../my-vault && cd ../my-vault
git init -b main && git add . && git commit -m "Start my vault"
gh repo create my-vault --private --source . --push
```

Then in Tamari: **Connectors** > Custom connector with `VAULT_REPO=<you>/my-vault` and
`VAULT_TOKEN` (a GitHub token that can read the repo). The **Vault** space now shows its folders,
notes and skills.

Open the folder in Obsidian to write, or run `claude` inside it. Start with `AGENTS.md`, then
`SOUL.md` and `CRITICAL_FACTS.md`.
