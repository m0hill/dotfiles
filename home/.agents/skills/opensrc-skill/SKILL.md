---
name: opensrc-skill
description: Use when the user asks to inspect, search, or understand source code for npm packages, PyPI packages, crates.io crates, or GitHub/GitLab/Bitbucket repositories. Teaches how to use the installed opensrc CLI with normal bash, rg, find, and read instead of custom source tools.
disable-model-invocation: true
---

# Opensrc Source Lookup

Use `opensrc` when you need source code for a dependency or remote repository.

`opensrc path <spec>` fetches on cache miss and prints a local directory. After that, use normal tools (`rg`, `find`, `read`, `bash`) on that directory.

## Supported specs

```bash
opensrc path zod                       # npm package, latest or lockfile-detected
opensrc path npm:zod                   # explicit npm package
opensrc path zod@3.22.0                # npm package version
opensrc path pypi:requests             # PyPI package
opensrc path pypi:flask@3.0.0          # PyPI package version
opensrc path crates:serde              # crates.io crate
opensrc path crates:serde@1.0.200      # crate version
opensrc path vercel/next.js            # GitHub repo shorthand
opensrc path github:vercel/next.js     # explicit GitHub repo
opensrc path https://github.com/vercel/next.js
```

## Preferred invocation

Use `opensrc` directly; the environment is already configured with the desired cache location.

```bash
opensrc path --cwd "$PWD" <spec>
```

If `opensrc` is not on PATH, use:

```bash
npx opensrc path --cwd "$PWD" <spec>
```

Use `--cwd "$PWD"` for npm packages so `opensrc` can detect installed versions from lockfiles when possible.

## Common workflows

Get the source path:

```bash
SRC=$(opensrc path --cwd "$PWD" zod)
echo "$SRC"
```

Search source:

```bash
rg "parse" "$SRC"
rg "class Session" "$(opensrc path --cwd "$PWD" pypi:requests)"
```

Inspect structure:

```bash
find "$SRC" -maxdepth 3 -type f | head -100
```

Read files with Pi's `read` tool once you have the absolute path.

## Guidance

- Prefer `opensrc` over web scraping when the task needs package/repository implementation details.
- Do not manually clone GitHub repos unless `opensrc` cannot resolve them.
- Do not create custom source-search commands; use `rg`, `find`, and `read` on the fetched path.
- Quote paths and specs in shell commands.
- For multiple packages, `opensrc path zod react next` prints one path per line.
