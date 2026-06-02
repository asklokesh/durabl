# Thin wrappers around npm scripts — see package.json and README.md.
.PHONY: demo ui test gate-all typecheck clean-data

NPM ?= npm

demo:
	$(NPM) run demo

ui:
	$(NPM) run ui

test:
	$(NPM) run test

gate-all:
	$(NPM) run gate:all

typecheck:
	$(NPM) run typecheck

# Remove default harness data dirs and lock (not build output — use npm run clean).
clean-data:
	@set -e; \
	tmp="$${TMPDIR:-/tmp}"; \
	rm -rf "$$tmp/durabl-m1" /tmp/durabl-gate-* "$$tmp"/durabl-gate-* 2>/dev/null || true; \
	rm -f /tmp/durabl-harness.lock; \
	if [ -n "$${DURABL_DATA_DIR:-}" ]; then rm -rf "$$DURABL_DATA_DIR"; fi; \
	echo "clean-data: removed harness journal/effect data and lock"
