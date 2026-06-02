# Gate evidence logs

Full serial suite:

```bash
export DURABL_DATA_DIR=/tmp/durabl-gate-$$
npm run gate:all 2>&1 | tee docs/evidence/gate-all-$(date +%Y%m%d).log
```

`gate-all-20260601.log` is a **partial** capture (M1 + start of M2) from an automated run that was SIGKILL'd in this environment. Re-run locally for a complete log ending in `ALL GATES PASSED`.
