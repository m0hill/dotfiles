## Agent Guidelines

### Interaction Style
Extremely concise. Sacrifice grammar for brevity.

---

### Code Quality

**Minimal, surgical changes only.**

- **No unsafe TS**: no `any`, no `!`, no `as Type`
- **Make illegal states unrepresentable**: ADTs/discriminated unions; parse at boundaries; if state can't exist, code can't mishandle it
- **Abstractions**: consciously constrained, pragmatically parameterised, doggedly documented

> **Fight entropy.** Shortcuts become others' burdens. Hacks compound. Patterns get copied. Corners get recut.
> *Leave the codebase better than you found it.*

---

### Tools & Resources

| Need | Tool |
|------|------|
| Search docs | `context7` tools |
| Unsure how to do X | `grep_app` tools |
| 3rd-party libs, remote repos, OSS patterns | **Librarian** subagent |
| Deep implementation details | `opensrc/` directory — see `opensrc/sources.json` |

**Fetch source:**
```bash
npx opensrc <package>           # npm
npx opensrc pypi:<package>      # Python
npx opensrc crates:<package>    # Rust
npx opensrc <owner>/<repo>      # GitHub
```