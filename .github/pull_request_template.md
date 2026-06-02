## Summary

<!-- What changed and why? One logical change per PR. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Docs / evidence only
- [ ] Harness / gate
- [ ] Dependency update (Dependabot)

## Testing

Before requesting review, run the gates relevant to your change locally:

```bash
npm install
npm run build
npm test              # M1 gate
# npm run gate:m2     # fork — if touched
# npm run gate:m3     # replay — if touched
# npm run gate:m4     # neutrality — if touched
# npm run gate:m5     # HITL — if touched
npm run gate:all      # full serial suite (required before merge)
```

- [ ] `npm run gate:all` passed locally (or I documented why a subset is sufficient below)
- [ ] Updated `docs/build-status.md` if milestone evidence changed
- [ ] No secrets, API keys, or `.env` contents in this PR

## Notes for reviewers

<!-- Optional: risk areas, follow-ups, live-provider keys needed for optional gates. -->
